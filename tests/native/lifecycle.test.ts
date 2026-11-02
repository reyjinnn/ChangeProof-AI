import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TenantContext } from '../../src/core/index.js';
import { createMemoryEvidenceStore } from '../../src/modules/evidence/index.js';
import { createLifecycleStore } from '../../src/modules/lifecycle/index.js';
import { createIdentityStore } from '../../src/modules/identity/index.js';
import { createJobsStore } from '../../src/modules/jobs/index.js';
import { createUsageStore } from '../../src/modules/usage/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-25 / T-28 — run-lifecycle API on real PostgreSQL (native).
 *
 * Written before the implementation. Two tenants share one disposable
 * database behind RLS: the full journey (project → draft revisions → immutable
 * submit with real usage reservation + real jobs enqueue → poll cursor →
 * cancel → retry → grant-checked artifact download) plus the negatives:
 * cross-tenant reads denied without disclosure, viewer mutations denied,
 * duplicate submits collapse to one run/reservation/job, repo revocation
 * mid-flight stops new effects and cancels queued runs (NEG3-22), revoked
 * sessions deny downloads (NEG3-27), and tampered artifacts are refused by
 * digest recomputation (NEG3-33).
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required; start the disposable PostgreSQL container first.');
}

const here = dirname(fileURLToPath(import.meta.url));
const migration = (name: string): string =>
  readFileSync(join(here, '..', '..', 'infra', 'postgres', name), 'utf8');
const v1 = migration('V1__identity_tenancy.sql');
const v2 = migration('V2__identity_services.sql');
const v3 = migration('V3__jobs.sql');
const v4 = migration('V4__usage.sql');
const v5 = migration('V5__email_identity.sql');
const v6 = migration('V6__lifecycle.sql');
const v7 = migration('V7__engagement.sql');
const v10 = migration('V10__enterprise.sql');

const fileDbUrl = databaseUrlFor(databaseUrl, 't_lifecycle');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const identity = createIdentityStore(appPool);
const jobs = createJobsStore(appPool);
const usage = createUsageStore(appPool);
const evidence = createMemoryEvidenceStore();
const lifecycle = createLifecycleStore(appPool, {
  session: { deriveContext: (input) => identity.deriveContext(input) },
  usage: {
    reserveRun: (input) =>
      usage.admitReservation({
        tenantId: input.tenantId,
        runId: input.runId,
        reservationId: input.reservationId,
        effectId: input.effectId,
        requested: input.requested,
        nowIso: input.nowIso,
      }),
  },
  jobs: {
    enqueueRun: (input) =>
      jobs.admitRun({
        runId: input.runId,
        jobId: input.jobId,
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
        reservationId: input.reservationId,
        nowIso: input.nowIso,
      }),
    requestJobCancel: (input) => jobs.requestCancel(input),
  },
  evidence: { fetchArtifact: (digest) => evidence.get(digest) },
});

const NOW_MS = Date.parse('2026-11-02T00:00:00.000Z');
const NOW_ISO = '2026-11-02T00:00:00.000Z';
const HOUR_MS = 3_600_000;

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function idempotencyKey(seed: string): string {
  return createHash('sha256').update(`lifecycle:${seed}`).digest('hex');
}

async function seedMember(tenantId: string, userId: string, role: string): Promise<void> {
  await admin.query(
    'INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, $3, 0)',
    [tenantId, userId, role],
  );
}

async function seedRepoGrant(tenantId: string, repositoryId: string, projectId: string): Promise<void> {
  await admin.query(
    'INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)',
    [tenantId, repositoryId, projectId],
  );
}

async function freshSession(tenantId: string, userId: string): Promise<{ sessionId: string }> {
  return identity.createSession({ tenantId, userId, ttlMs: HOUR_MS, nowMs: NOW_MS });
}

interface Fixture {
  tenantId: string;
  userId: string;
  sessionId: string;
  projectId: string;
  repositoryId: string;
}

async function seedFixture(prefix: string, role = 'owner'): Promise<Fixture> {
  const tenantId = uniqueId(`${prefix}-tenant`);
  const userId = uniqueId(`${prefix}-user`);
  const repositoryId = uniqueId(`${prefix}-repo`);
  await identity.createTenant(tenantId);
  await seedMember(tenantId, userId, role);
  const { sessionId } = await freshSession(tenantId, userId);
  const project = await lifecycle.createProject({ sessionId, nowIso: NOW_ISO }, { name: `${prefix} project` });
  await seedRepoGrant(tenantId, repositoryId, project.projectId);
  await usage.setEntitlement({
    tenantId,
    capAmount: 1000,
    rateVersion: 'test-rates-1',
    periodId: 'period-1',
    nowIso: NOW_ISO,
  });
  return { tenantId, userId, sessionId, projectId: project.projectId, repositoryId };
}

function submitFor(fixture: Fixture, ctx: TenantContext, seed: string) {
  return {
    schemaVersion: '1' as const,
    requestId: uniqueId('req'),
    tenantId: fixture.tenantId,
    actorId: fixture.userId,
    projectId: fixture.projectId,
    repositoryIds: [fixture.repositoryId],
    sourceRefs: ['git:abc1234'],
    intentRef: uniqueId('intent'),
    executionMode: 'real_runtime' as const,
    invariantRefs: [uniqueId('invariant')],
    verificationPlanRef: uniqueId('plan'),
    budgetProfileId: uniqueId('budget'),
    publicationConsent: false,
    idempotencyKey: idempotencyKey(seed),
    expectedGrantVersion: ctx.grantVersion,
    draftId: uniqueId('draft'),
    draftRevision: 1,
    requestedBudget: 50,
  };
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_lifecycle');
  await admin.query(v1);
  await admin.query(v2);
  await admin.query(v3);
  await admin.query(v4);
  await admin.query(v5);
  await admin.query(v6);
  await admin.query(v7);
  await admin.query(v10);
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('run-lifecycle journey on real PostgreSQL', () => {
  it('runs project to retry with one reservation and one job', async () => {
    const fixture = await seedFixture('journey');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const ctx = await identity.deriveContext(actor);

    const first = await lifecycle.saveDraftRevision(actor, {
      projectId: fixture.projectId,
      body: { intent: 'Fix the checkout total.', budgetCap: 50 },
    });
    const second = await lifecycle.saveDraftRevision(actor, {
      projectId: fixture.projectId,
      draftId: first.draftId,
      body: { intent: 'Fix the checkout total.', budgetCap: 60 },
    });
    expect(second.revision).toBe(2);
    const draft = await lifecycle.getDraft(actor, { draftId: first.draftId });
    expect(draft.revision).toBe(2);
    expect(draft.body).toMatchObject({ intent: 'Fix the checkout total.' });

    const submit = { ...submitFor(fixture, ctx, 'journey-1'), draftId: first.draftId, draftRevision: 2 };
    const admitted = await lifecycle.submitRun(actor, submit);
    expect(admitted.duplicate).toBe(false);
    expect(admitted.submitDigest).toMatch(/^[0-9a-f]{64}$/);

    const run = await lifecycle.getRun(actor, { runId: admitted.runId });
    expect(run.state).toBe('queued');
    expect(run.submitDigest).toBe(admitted.submitDigest);

    const polled = await lifecycle.pollEvents(actor, { runId: admitted.runId, afterSeq: 0, limit: 10 });
    expect(polled.events.map((event) => event.kind)).toEqual(['submitted']);
    expect(polled.cursor).toBe(1);

    await lifecycle.recordRunEvent({
      tenantId: fixture.tenantId,
      jobId: admitted.jobId,
      runId: admitted.runId,
      kind: 'started',
      payload: {},
      nowIso: NOW_ISO,
    });
    const running = await lifecycle.getRun(actor, { runId: admitted.runId });
    expect(running.state).toBe('running');

    const cancelled = await lifecycle.cancelRun(actor, { runId: admitted.runId });
    expect(cancelled.state).toBe('cancelled');

    const retried = await lifecycle.retryRun(actor, { runId: admitted.runId, idempotencyKey: idempotencyKey('journey-2') });
    expect(retried.runId).not.toBe(admitted.runId);
    const retryRun = await lifecycle.getRun(actor, { runId: retried.runId });
    expect(retryRun.submitDigest).toBe(admitted.submitDigest);
    expect(retryRun.state).toBe('queued');
  }, 120_000);

  it('collapses duplicate submits to one run, one reservation, one job', async () => {
    const fixture = await seedFixture('dup');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const ctx = await identity.deriveContext(actor);
    const draft = await lifecycle.saveDraftRevision(actor, {
      projectId: fixture.projectId,
      body: { intent: 'Dedup me.' },
    });
    const submit = { ...submitFor(fixture, ctx, 'dup-1'), draftId: draft.draftId, draftRevision: 1 };

    const first = await lifecycle.submitRun(actor, submit);
    const second = await lifecycle.submitRun(actor, submit);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.runId).toBe(first.runId);
    expect(second.jobId).toBe(first.jobId);
    expect(second.reservationId).toBe(first.reservationId);

    const runs = await admin.query('SELECT COUNT(*)::TEXT AS count FROM lifecycle_runs WHERE tenant_id = $1', [
      fixture.tenantId,
    ]);
    expect((runs.rows[0] as { count: string }).count).toBe('1');
  }, 120_000);

  it('denies cross-tenant reads without disclosure', async () => {
    const a = await seedFixture('alpha');
    const b = await seedFixture('beta');
    const actorA = { sessionId: a.sessionId, nowIso: NOW_ISO };
    const actorB = { sessionId: b.sessionId, nowIso: NOW_ISO };
    const ctxA = await identity.deriveContext(actorA);
    const draft = await lifecycle.saveDraftRevision(actorA, {
      projectId: a.projectId,
      body: { intent: 'Private.' },
    });
    const admitted = await lifecycle.submitRun(actorA, {
      ...submitFor(a, ctxA, 'alpha-1'),
      draftId: draft.draftId,
      draftRevision: 1,
    });

    await expect(lifecycle.getRun(actorB, { runId: admitted.runId })).rejects.toThrow(/unknown or not shared/i);
    await expect(lifecycle.pollEvents(actorB, { runId: admitted.runId, afterSeq: 0, limit: 10 })).rejects.toThrow(
      /unknown or not shared/i,
    );
    await expect(lifecycle.getDraft(actorB, { draftId: draft.draftId })).rejects.toThrow(/unknown or not shared/i);
  }, 120_000);

  it('denies viewer mutations but allows viewer reads', async () => {
    const owner = await seedFixture('own');
    const viewerId = uniqueId('own-viewer');
    await seedMember(owner.tenantId, viewerId, 'viewer');
    const viewerSession = await freshSession(owner.tenantId, viewerId);
    const actorOwner = { sessionId: owner.sessionId, nowIso: NOW_ISO };
    const actorViewer = { sessionId: viewerSession.sessionId, nowIso: NOW_ISO };
    const ctxOwner = await identity.deriveContext(actorOwner);
    const draft = await lifecycle.saveDraftRevision(actorOwner, {
      projectId: owner.projectId,
      body: { intent: 'Viewable.' },
    });
    const admitted = await lifecycle.submitRun(actorOwner, {
      ...submitFor(owner, ctxOwner, 'own-1'),
      draftId: draft.draftId,
      draftRevision: 1,
    });

    await expect(
      lifecycle.saveDraftRevision(actorViewer, { projectId: owner.projectId, body: { intent: 'No.' } }),
    ).rejects.toThrow(/role/i);
    const read = await lifecycle.getRun(actorViewer, { runId: admitted.runId });
    expect(read.runId).toBe(admitted.runId);

    const operatorId = uniqueId('own-operator');
    await seedMember(owner.tenantId, operatorId, 'operator');
    const operatorSession = await freshSession(owner.tenantId, operatorId);
    await expect(
      lifecycle.getRun({ sessionId: operatorSession.sessionId, nowIso: NOW_ISO }, { runId: admitted.runId }),
    ).rejects.toThrow(/no tenant authority/i);
  }, 120_000);
});

describe('run-lifecycle revocation and artifact negatives', () => {
  it('stops new effects when the repo grant is revoked mid-flight (NEG3-22)', async () => {
    const fixture = await seedFixture('revoke');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const ctx = await identity.deriveContext(actor);
    const draft = await lifecycle.saveDraftRevision(actor, {
      projectId: fixture.projectId,
      body: { intent: 'Revocable.' },
    });
    const admitted = await lifecycle.submitRun(actor, {
      ...submitFor(fixture, ctx, 'revoke-1'),
      draftId: draft.draftId,
      draftRevision: 1,
    });
    expect(admitted.duplicate).toBe(false);
    const { digest } = evidence.put('evidence-bytes-revoke');
    await lifecycle.recordRunEvent({
      tenantId: fixture.tenantId,
      jobId: admitted.jobId,
      runId: admitted.runId,
      kind: 'artifact',
      payload: { digest },
      nowIso: NOW_ISO,
    });

    await admin.query('DELETE FROM repository_grants WHERE tenant_id = $1 AND repository_id = $2', [
      fixture.tenantId,
      fixture.repositoryId,
    ]);
    const revoked = await lifecycle.applyRepoRevocation({
      tenantId: fixture.tenantId,
      repositoryId: fixture.repositoryId,
      nowIso: NOW_ISO,
    });
    expect(revoked.cancelledRunIds).toContain(admitted.runId);

    const after = await lifecycle.getRun(actor, { runId: admitted.runId });
    expect(after.state).toBe('cancelled');
    await expect(lifecycle.downloadArtifact(actor, { runId: admitted.runId, digest })).rejects.toThrow(/repository/i);
    const fresh = await identity.deriveContext(actor);
    await expect(
      lifecycle.submitRun(actor, {
        ...submitFor(fixture, fresh, 'revoke-2'),
        draftId: draft.draftId,
        draftRevision: 1,
      }),
    ).rejects.toThrow(/repository/i);
  }, 120_000);

  it('denies artifact downloads after the session is revoked (NEG3-27)', async () => {
    const fixture = await seedFixture('dlrev');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const ctx = await identity.deriveContext(actor);
    const draft = await lifecycle.saveDraftRevision(actor, {
      projectId: fixture.projectId,
      body: { intent: 'Downloadable.' },
    });
    const admitted = await lifecycle.submitRun(actor, {
      ...submitFor(fixture, ctx, 'dlrev-1'),
      draftId: draft.draftId,
      draftRevision: 1,
    });
    const { digest } = evidence.put('evidence-bytes-dlrev');
    await lifecycle.recordRunEvent({
      tenantId: fixture.tenantId,
      jobId: admitted.jobId,
      runId: admitted.runId,
      kind: 'artifact',
      payload: { digest },
      nowIso: NOW_ISO,
    });

    const downloaded = await lifecycle.downloadArtifact(actor, { runId: admitted.runId, digest });
    expect(Buffer.from(downloaded.bytes).toString('utf8')).toBe('evidence-bytes-dlrev');

    await identity.revokeSession(fixture.sessionId);
    await expect(lifecycle.downloadArtifact(actor, { runId: admitted.runId, digest })).rejects.toThrow(
      /revoked|re-authentication/i,
    );
  }, 120_000);

  it('refuses a tampered artifact whose bytes miss the digest (NEG3-33)', async () => {
    const fixture = await seedFixture('tamper');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const ctx = await identity.deriveContext(actor);
    const draft = await lifecycle.saveDraftRevision(actor, {
      projectId: fixture.projectId,
      body: { intent: 'Tamper-evident.' },
    });
    const admitted = await lifecycle.submitRun(actor, {
      ...submitFor(fixture, ctx, 'tamper-1'),
      draftId: draft.draftId,
      draftRevision: 1,
    });
    const { digest } = evidence.put('genuine-bytes');
    await lifecycle.recordRunEvent({
      tenantId: fixture.tenantId,
      jobId: admitted.jobId,
      runId: admitted.runId,
      kind: 'artifact',
      payload: { digest },
      nowIso: NOW_ISO,
    });
    const tampered = createLifecycleStore(appPool, {
      session: { deriveContext: (input) => identity.deriveContext(input) },
      usage: {
        reserveRun: (input) =>
          usage.admitReservation({
            tenantId: input.tenantId,
            runId: input.runId,
            reservationId: input.reservationId,
            effectId: input.effectId,
            requested: input.requested,
            nowIso: input.nowIso,
          }),
      },
      jobs: {
        enqueueRun: (input) =>
          jobs.admitRun({
            runId: input.runId,
            jobId: input.jobId,
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
            reservationId: input.reservationId,
            nowIso: input.nowIso,
          }),
        requestJobCancel: (input) => jobs.requestCancel(input),
      },
      evidence: { fetchArtifact: () => new TextEncoder().encode('forged-bytes') },
    });

    await expect(tampered.downloadArtifact(actor, { runId: admitted.runId, digest })).rejects.toThrow(
      /digest mismatch|tamper/i,
    );
  }, 120_000);
});
