import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMemoryEvidenceStore } from '../../src/modules/evidence/index.js';
import { createIdentityStore } from '../../src/modules/identity/index.js';
import { createJobsStore, createOpsStore, pickFairTenant } from '../../src/modules/jobs/index.js';
import { createDeletionStore } from '../../src/modules/lifecycle/index.js';
import { createLifecycleStore } from '../../src/modules/lifecycle/index.js';
import { createUsageStore } from '../../src/modules/usage/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-26 / T-40 — service operations on real PostgreSQL (native).
 *
 * Three tenants share one disposable database behind RLS. Capacity caps
 * isolate a noisy tenant without starving others; fairness serves the
 * least-loaded tenant first; drain refuses new work while in-flight jobs
 * finish; quarantine blocks one worker only; outages block their component
 * until a healthy probe resolves them; deletion fences refuse new effects,
 * tombstones block downloads, and restore replays tombstones first; signed
 * payment events drive an idempotent billing lifecycle while forgeries
 * change nothing (NEG3-26/27/36).
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
const v11 = migration('V11__service_operations.sql');

const fileDbUrl = databaseUrlFor(databaseUrl, 't40_ops');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const identity = createIdentityStore(appPool);
const jobs = createJobsStore(appPool);
const ops = createOpsStore(appPool);
const usage = createUsageStore(appPool);
const deletion = createDeletionStore(appPool);
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

const NOW = '2026-11-02T00:00:00.000Z';
const LATER = '2026-11-02T01:00:00.000Z';
const DIGEST = 'a'.repeat(64);
const SECRET = 't40-webhook-secret';

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function sign(payload: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex')}`;
}

async function admitJob(tenantId: string, key: string): Promise<{ runId: string; jobId: string }> {
  const admitted = await jobs.admitRun({
    runId: uniqueId('run'),
    jobId: uniqueId('job'),
    tenantId,
    idempotencyKey: `${uniqueId('idem')}-${key}`,
    reservationId: uniqueId('res'),
    nowIso: NOW,
  });
  return { runId: admitted.runId, jobId: admitted.jobId };
}

function claimFor(tenantId: string, workerId: string, maxConcurrent = 4) {
  return {
    tenantId,
    workerId,
    guestId: uniqueId('guest'),
    imageDigest: DIGEST,
    candidateDigest: DIGEST,
    planDigest: DIGEST,
    grantVersion: 0,
    ttlMs: 3_600_000,
    maxConcurrent,
    nowIso: NOW,
  };
}

async function tenantLoad(): Promise<{ tenantId: string; active: number; queued: number }[]> {
  const found = await admin.query(
    `SELECT tenant_id,
            COUNT(*) FILTER (WHERE state IN ('claimed', 'running'))::int AS active,
            COUNT(*) FILTER (WHERE state = 'queued')::int AS queued
     FROM jobs GROUP BY tenant_id`,
  );
  return (found.rows as { tenant_id: string; active: number; queued: number }[]).map((row) => ({
    tenantId: row.tenant_id,
    active: row.active,
    queued: row.queued,
  }));
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't40_ops');
  await admin.query(v1);
  await admin.query(v2);
  await admin.query(v3);
  await admin.query(v4);
  await admin.query(v5);
  await admin.query(v6);
  await admin.query(v7);
  await admin.query(v10);
  await admin.query(v11);
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('capacity, fairness, drain, quarantine, and outage', () => {
  it('isolates tenants, drains, quarantines, and recovers on real rows', async () => {
    const noisy = uniqueId('noisy');
    const quiet = uniqueId('quiet');
    const idle = uniqueId('idle');
    await identity.createTenant(noisy);
    await identity.createTenant(quiet);
    await identity.createTenant(idle);

    await admitJob(noisy, 'n1');
    await admitJob(noisy, 'n2');
    await admitJob(noisy, 'n3');
    await admitJob(quiet, 'q1');
    await admitJob(idle, 'i1');

    // Noisy tenant caps at 2 while quiet and idle still claim.
    expect((await jobs.claimJob(claimFor(noisy, 'w-1', 2)))?.jobId).toBeDefined();
    expect((await jobs.claimJob(claimFor(noisy, 'w-1', 2)))?.jobId).toBeDefined();
    expect(await jobs.claimJob(claimFor(noisy, 'w-1', 2))).toBeNull();
    expect((await jobs.claimJob(claimFor(quiet, 'w-2')))?.jobId).toBeDefined();

    // Fairness over real counts serves idle (0 active, 1 queued) first.
    const loads = (await tenantLoad()).filter((row) => [noisy, quiet, idle].includes(row.tenantId));
    expect(pickFairTenant(loads)).toBe(idle);

    // Drain refuses new work while an in-flight job still completes.
    const inFlight = await jobs.claimJob(claimFor(idle, 'w-3'));
    if (inFlight === null) {
      throw new Error('Idle claim unexpectedly empty.');
    }
    await ops.setDraining({ draining: true, nowIso: NOW });
    expect(await ops.isDraining()).toBe(true);
    await expect(admitJob(noisy, 'drained')).rejects.toThrow(/drain/i);
    await expect(jobs.claimJob(claimFor(quiet, 'w-2'))).rejects.toThrow(/drain/i);
    await expect(
      jobs.completeJob({
        tenantId: idle,
        jobId: inFlight.jobId,
        ownerId: 'w-3',
        epoch: inFlight.lease.epoch,
        version: inFlight.lease.version,
        nowIso: NOW,
        currentGrantVersion: 0,
      }),
    ).resolves.toBeUndefined();
    await ops.setDraining({ draining: false, nowIso: NOW });
    await expect(admitJob(noisy, 'after-drain')).resolves.toBeDefined();

    // Quarantine blocks one worker; release reopens it.
    await ops.quarantineWorker({ workerId: 'w-bad', reason: 'flaky heartbeats', nowIso: NOW });
    expect(await ops.quarantinedWorkers()).toContain('w-bad');
    await expect(jobs.claimJob(claimFor(quiet, 'w-bad'))).rejects.toThrow(/quarantine/i);
    await ops.releaseWorker('w-bad');
    expect(await ops.quarantinedWorkers()).not.toContain('w-bad');

    // Outage blocks dispatch until a healthy probe after the start resolves it.
    await ops.recordOutage({ component: 'dispatch', nowIso: NOW });
    await expect(jobs.claimJob(claimFor(quiet, 'w-2'))).rejects.toThrow(/outage/i);
    await expect(
      ops.resolveOutage({ component: 'dispatch', checkedAt: '2026-11-02T00:00:00.000Z', probeReceipt: 'stale' }),
    ).rejects.toThrow(/predates/i);
    await ops.resolveOutage({ component: 'dispatch', checkedAt: LATER, probeReceipt: 'probe-ok-1' });
    expect(await ops.openOutage('dispatch')).toBeNull();
    await ops.recordOutage({ component: 'admission', nowIso: NOW });
    await expect(admitJob(quiet, 'outaged')).rejects.toThrow(/outage/i);
    await ops.resolveOutage({ component: 'admission', checkedAt: LATER, probeReceipt: 'probe-ok-2' });
    await expect(admitJob(quiet, 'after-outage')).resolves.toBeDefined();
  }, 120_000);
});

describe('deletion fences, tombstones, and restore replay', () => {
  it('refuses fenced effects and tombstoned downloads, then restores survivors', async () => {
    const tenantId = uniqueId('gone-tenant');
    const userId = uniqueId('gone-user');
    const repositoryId = uniqueId('gone-repo');
    await identity.createTenant(tenantId);
    await admin.query('INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, $3, 0)', [
      tenantId,
      userId,
      'owner',
    ]);
    const { sessionId } = await identity.createSession({
      tenantId,
      userId,
      ttlMs: 3_600_000,
      nowMs: Date.parse(NOW),
    });
    const actor = { sessionId, nowIso: NOW };
    const project = await lifecycle.createProject(actor, { name: 'gone project' });
    await admin.query('INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)', [
      tenantId,
      repositoryId,
      project.projectId,
    ]);
    await usage.setEntitlement({ tenantId, capAmount: 1000, rateVersion: 't40-rates', periodId: 'p1', nowIso: NOW });
    const draft = await lifecycle.saveDraftRevision(actor, {
      projectId: project.projectId,
      body: { intent: 't40 deletion probe', budgetCap: 50 },
    });
    const ctx = await identity.deriveContext(actor);
    const submit = {
      schemaVersion: '1' as const,
      requestId: uniqueId('req'),
      tenantId,
      actorId: userId,
      projectId: project.projectId,
      repositoryIds: [repositoryId],
      sourceRefs: ['git:abc1234'],
      intentRef: uniqueId('intent'),
      executionMode: 'real_runtime' as const,
      invariantRefs: [uniqueId('inv')],
      verificationPlanRef: uniqueId('plan'),
      budgetProfileId: uniqueId('budget'),
      publicationConsent: false,
      idempotencyKey: createHash('sha256').update(`t40:${uniqueId('k')}`).digest('hex'),
      expectedGrantVersion: ctx.grantVersion,
      draftId: draft.draftId,
      draftRevision: 1,
      requestedBudget: 50,
    };
    const admitted = await lifecycle.submitRun(actor, submit);
    expect(admitted.duplicate).toBe(false);

    await deletion.fenceScope({ tenantId, scope: 'runs', nowIso: NOW });
    await expect(
      lifecycle.submitRun(actor, {
        ...submit,
        requestId: uniqueId('req'),
        idempotencyKey: createHash('sha256').update(`t40:${uniqueId('k')}`).digest('hex'),
      }),
    ).rejects.toThrow(/fenced/i);
    await deletion.unfenceScope({ tenantId, scope: 'runs' });

    const { digest } = evidence.put('t40-artifact-bytes');
    await lifecycle.recordRunEvent({
      tenantId,
      jobId: admitted.jobId,
      runId: admitted.runId,
      kind: 'artifact',
      payload: { digest },
      nowIso: NOW,
    });
    const before = await lifecycle.downloadArtifact(actor, { runId: admitted.runId, digest });
    expect(before.digest).toBe(digest);
    await deletion.recordTombstone({
      tenantId,
      subjectKind: 'artifact',
      subjectId: digest,
      nowIso: NOW,
      purgeAfter: '2026-12-02T00:00:00.000Z',
    });
    await expect(lifecycle.downloadArtifact(actor, { runId: admitted.runId, digest })).rejects.toThrow(/deleted/i);

    const survivors = await deletion.restoreWithTombstones(tenantId, [
      { tenantId, subjectKind: 'artifact', subjectId: digest },
      { tenantId, subjectKind: 'artifact', subjectId: 'keep-1' },
    ]);
    expect(survivors).toEqual([{ tenantId, subjectKind: 'artifact', subjectId: 'keep-1' }]);

    await expect(
      deletion.purgeTombstone({ tenantId, subjectKind: 'artifact', subjectId: digest, nowIso: NOW }),
    ).rejects.toThrow(/retention|deadline/i);
    expect(
      await deletion.purgeTombstone({
        tenantId,
        subjectKind: 'artifact',
        subjectId: digest,
        nowIso: '2026-12-03T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      await deletion.purgeTombstone({
        tenantId,
        subjectKind: 'artifact',
        subjectId: digest,
        nowIso: '2026-12-03T00:00:00.000Z',
      }),
    ).toBe(false);
  }, 120_000);
});

describe('signed billing lifecycle', () => {
  it('applies verified events idempotently and refuses forgeries', async () => {
    const tenantId = uniqueId('acme');
    await identity.createTenant(tenantId);
    await usage.setEntitlement({ tenantId, capAmount: 1000, rateVersion: 't40-rates', periodId: 'p1', nowIso: NOW });

    const checkout = JSON.stringify({ id: 'evt-t40-1', type: 'checkout.completed', tenant: tenantId });
    const first = await usage.recordPaymentEvent({
      tenantId,
      eventId: 'evt-t40-1',
      kind: 'checkout.completed',
      amount: 4900,
      periodId: 'p1',
      payload: checkout,
      signature: sign(checkout),
      webhookSecret: SECRET,
      nowIso: NOW,
    });
    expect(first.duplicate).toBe(false);
    const replay = await usage.recordPaymentEvent({
      tenantId,
      eventId: 'evt-t40-1',
      kind: 'checkout.completed',
      amount: 4900,
      periodId: 'p1',
      payload: checkout,
      signature: sign(checkout),
      webhookSecret: SECRET,
      nowIso: NOW,
    });
    expect(replay.duplicate).toBe(true);

    const forged = JSON.stringify({ id: 'evt-t40-2', type: 'checkout.completed', tenant: tenantId });
    await expect(
      usage.recordPaymentEvent({
        tenantId,
        eventId: 'evt-t40-2',
        kind: 'checkout.completed',
        amount: 4900,
        periodId: 'p1',
        payload: forged,
        signature: 'sha256=deadbeef',
        webhookSecret: SECRET,
        nowIso: NOW,
      }),
    ).rejects.toThrow(/forged|signature/i);

    const stranger = uniqueId('stranger');
    await identity.createTenant(stranger);
    const refundEarly = JSON.stringify({ id: 'evt-t40-3', type: 'refund.issued', tenant: stranger });
    await expect(
      usage.recordPaymentEvent({
        tenantId: stranger,
        eventId: 'evt-t40-3',
        kind: 'refund.issued',
        amount: 100,
        periodId: 'p1',
        payload: refundEarly,
        signature: sign(refundEarly),
        webhookSecret: SECRET,
        nowIso: NOW,
      }),
    ).rejects.toThrow(/charge|refund/i);

    const refund = JSON.stringify({ id: 'evt-t40-4', type: 'refund.issued', tenant: tenantId });
    const refunded = await usage.recordPaymentEvent({
      tenantId,
      eventId: 'evt-t40-4',
      kind: 'refund.issued',
      amount: 100,
      periodId: 'p1',
      payload: refund,
      signature: sign(refund),
      webhookSecret: SECRET,
      nowIso: NOW,
    });
    expect(refunded.duplicate).toBe(false);

    // The money path still settles behind a server-verified receipt ref.
    const reservation = await usage.admitReservation({
      tenantId,
      runId: uniqueId('run'),
      reservationId: uniqueId('res'),
      effectId: 'b'.repeat(64),
      requested: 100,
      nowIso: NOW,
    });
    await usage.recordConsume({
      tenantId,
      reservationId: reservation.reservationId,
      effectId: 'c'.repeat(64),
      provider: 'model',
      measuredUnits: 40,
      unitName: 'tokens',
      nowIso: NOW,
    });
    const settled = await usage.settleReservation({
      tenantId,
      reservationId: reservation.reservationId,
      effectId: 'd'.repeat(64),
      providerReceiptRef: 'evt-t40-1',
      nowIso: NOW,
    });
    expect(settled.duplicate).toBe(false);
    expect(settled.consumed).toBe(40);
  }, 120_000);
});
