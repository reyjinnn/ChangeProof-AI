import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIdentityStore } from '../../src/modules/identity/index.js';
import { createJobsStore } from '../../src/modules/jobs/index.js';
import { createLifecycleStore } from '../../src/modules/lifecycle/index.js';
import { createMemoryEvidenceStore } from '../../src/modules/evidence/index.js';
import { createNotificationsStore } from '../../src/modules/notifications/index.js';
import { createQueriesStore } from '../../src/modules/queries/index.js';
import { createUsageStore } from '../../src/modules/usage/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-29 / T-29 — queries + notifications on real PostgreSQL (native).
 *
 * Written before the implementation. Two tenants share one disposable
 * database behind RLS. Notifications prove durable inbox + preferences +
 * transactional outbox + event dedup (NEG3-31: duplicates collapse and forged
 * recipients are refused). Queries prove current-grant search/filter/count
 * with version-bound cache invalidation (NEG3-32: a revoked grant removes
 * runs from results, counts, and cache), scoped digest-stamped exports, and
 * budgeted reproduction through the lifecycle retry path.
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required; start the disposable PostgreSQL container first.');
}

const here = dirname(fileURLToPath(import.meta.url));
const migration = (name: string): string =>
  readFileSync(join(here, '..', '..', 'infra', 'postgres', name), 'utf8');
const migrations = [
  'V1__identity_tenancy.sql',
  'V2__identity_services.sql',
  'V3__jobs.sql',
  'V4__usage.sql',
  'V5__email_identity.sql',
  'V6__lifecycle.sql',
  'V7__engagement.sql',
  'V10__enterprise.sql',
].map((name) => migration(name));

const fileDbUrl = databaseUrlFor(databaseUrl, 't_engagement');
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
const notifications = createNotificationsStore(appPool, {
  deriveContext: (input) => identity.deriveContext(input),
});
const queries = createQueriesStore(appPool, {
  session: { deriveContext: (input) => identity.deriveContext(input) },
  repro: { retryRun: (actor, retry) => lifecycle.retryRun(actor, retry) },
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
  return createHash('sha256').update(`engagement:${seed}`).digest('hex');
}

interface Fixture {
  tenantId: string;
  userId: string;
  sessionId: string;
  projectId: string;
  repositoryId: string;
}

async function seedFixture(prefix: string): Promise<Fixture> {
  const tenantId = uniqueId(`${prefix}-tenant`);
  const userId = uniqueId(`${prefix}-user`);
  const repositoryId = uniqueId(`${prefix}-repo`);
  await identity.createTenant(tenantId);
  await admin.query('INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, $3, 0)', [
    tenantId,
    userId,
    'owner',
  ]);
  const session = await identity.createSession({ tenantId, userId, ttlMs: HOUR_MS, nowMs: NOW_MS });
  const project = await lifecycle.createProject(
    { sessionId: session.sessionId, nowIso: NOW_ISO },
    { name: `${prefix} project` },
  );
  await admin.query('INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)', [
    tenantId,
    repositoryId,
    project.projectId,
  ]);
  await usage.setEntitlement({
    tenantId,
    capAmount: 1000,
    rateVersion: 'test-rates-1',
    periodId: 'period-1',
    nowIso: NOW_ISO,
  });
  return { tenantId, userId, sessionId: session.sessionId, projectId: project.projectId, repositoryId };
}

async function seedRun(fixture: Fixture, seed: string, intent: string): Promise<{ runId: string; jobId: string }> {
  const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
  const ctx = await identity.deriveContext(actor);
  const draft = await lifecycle.saveDraftRevision(actor, { projectId: fixture.projectId, body: { intent } });
  const admitted = await lifecycle.submitRun(actor, {
    schemaVersion: '1',
    requestId: uniqueId('req'),
    tenantId: fixture.tenantId,
    actorId: fixture.userId,
    projectId: fixture.projectId,
    repositoryIds: [fixture.repositoryId],
    sourceRefs: ['git:abc1234'],
    intentRef: uniqueId('intent'),
    executionMode: 'real_runtime',
    invariantRefs: [uniqueId('invariant')],
    verificationPlanRef: uniqueId('plan'),
    budgetProfileId: uniqueId('budget'),
    publicationConsent: false,
    idempotencyKey: idempotencyKey(seed),
    expectedGrantVersion: ctx.grantVersion,
    draftId: draft.draftId,
    draftRevision: draft.revision,
    requestedBudget: 50,
  });
  return { runId: admitted.runId, jobId: admitted.jobId };
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_engagement');
  for (const sql of migrations) {
    await admin.query(sql);
  }
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('notifications inbox, preferences, and outbox (native)', () => {
  it('dedups repeat events and commits the outbox atomically (NEG3-31)', async () => {
    const fixture = await seedFixture('notif');
    const event = {
      tenantId: fixture.tenantId,
      eventId: uniqueId('event'),
      category: 'results' as const,
      title: 'Run finished',
      body: 'The run finished with evidence.',
      userId: fixture.userId,
      deepLink: '/app/runs/run-1',
      nowIso: NOW_ISO,
    };

    const first = await notifications.publishFromEvent(event);
    const second = await notifications.publishFromEvent(event);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.notificationId).toBe(first.notificationId);

    const rows = await admin.query('SELECT COUNT(*)::TEXT AS count FROM notifications WHERE tenant_id = $1', [
      fixture.tenantId,
    ]);
    expect((rows.rows[0] as { count: string }).count).toBe('1');
    const outbox = await admin.query(
      'SELECT state FROM notification_outbox WHERE tenant_id = $1 AND event_id = $2',
      [fixture.tenantId, event.eventId],
    );
    expect((outbox.rows[0] as { state: string }).state).toBe('pending');
  }, 120_000);

  it('refuses a forged recipient who is not a member (NEG3-31)', async () => {
    const fixture = await seedFixture('forge');

    await expect(
      notifications.publishFromEvent({
        tenantId: fixture.tenantId,
        eventId: uniqueId('event'),
        category: 'access',
        title: 'Access changed',
        body: ' Forged.',
        userId: 'ghost-user',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/not a member|unknown user/i);
  }, 120_000);

  it('lists, reads, and dismisses per user with durable state', async () => {
    const fixture = await seedFixture('inbox');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    await notifications.publishFromEvent({
      tenantId: fixture.tenantId,
      eventId: uniqueId('event-a'),
      category: 'blockers',
      title: 'Blocked',
      body: 'A blocker needs review.',
      userId: fixture.userId,
      nowIso: NOW_ISO,
    });
    await notifications.publishFromEvent({
      tenantId: fixture.tenantId,
      eventId: uniqueId('event-b'),
      category: 'quota',
      title: 'Quota',
      body: 'Quota is close to the cap.',
      userId: fixture.userId,
      nowIso: NOW_ISO,
    });

    const listed = await notifications.listNotifications(actor, { limit: 10 });
    expect(listed.items).toHaveLength(2);
    expect(listed.unreadCount).toBe(2);

    const firstId = listed.items[0]?.notificationId ?? '';
    await notifications.markRead(actor, { notificationId: firstId });
    const afterRead = await notifications.listNotifications(actor, { limit: 10 });
    expect(afterRead.unreadCount).toBe(1);
    const unread = await notifications.listNotifications(actor, { limit: 10, unreadOnly: true });
    expect(unread.items).toHaveLength(1);

    await notifications.markDismissed(actor, { notificationId: firstId });
    const marked = await notifications.markAllRead(actor);
    expect(marked.marked).toBe(1);
    const done = await notifications.listNotifications(actor, { limit: 10 });
    expect(done.unreadCount).toBe(0);
  }, 120_000);

  it('suppresses muted categories and isolates tenants', async () => {
    const a = await seedFixture('mutea');
    const b = await seedFixture('muteb');
    const actorA = { sessionId: a.sessionId, nowIso: NOW_ISO };
    await notifications.setPreferences(actorA, { muted: ['quota'] });
    const prefs = await notifications.getPreferences(actorA);
    expect(prefs.muted).toEqual(['quota']);

    const suppressed = await notifications.publishFromEvent({
      tenantId: a.tenantId,
      eventId: uniqueId('event'),
      category: 'quota',
      title: 'Quota',
      body: 'Muted.',
      userId: a.userId,
      nowIso: NOW_ISO,
    });
    expect(suppressed.suppressed).toBe(true);
    const listedA = await notifications.listNotifications(actorA, { limit: 10 });
    expect(listedA.items).toHaveLength(0);

    const listedB = await notifications.listNotifications({ sessionId: b.sessionId, nowIso: NOW_ISO }, { limit: 10 });
    expect(listedB.items).toHaveLength(0);
    expect(listedB.unreadCount).toBe(0);
  }, 120_000);

  it('excludes grant-lost notifications without leaking snippets', async () => {
    const fixture = await seedFixture('notifrev');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const run = await seedRun(fixture, 'notifrev-1', 'Linked run.');
    await notifications.publishFromEvent({
      tenantId: fixture.tenantId,
      eventId: uniqueId('event'),
      category: 'results',
      title: 'Run finished',
      body: 'Secret snippet.',
      userId: fixture.userId,
      runId: run.runId,
      projectId: fixture.projectId,
      repositoryId: fixture.repositoryId,
      nowIso: NOW_ISO,
    });
    const before = await notifications.listNotifications(actor, { limit: 10 });
    expect(before.items).toHaveLength(1);

    await admin.query('DELETE FROM repository_grants WHERE tenant_id = $1 AND repository_id = $2', [
      fixture.tenantId,
      fixture.repositoryId,
    ]);
    await queries.bumpGrantEpoch(fixture.tenantId);
    const after = await notifications.listNotifications(actor, { limit: 10 });
    expect(after.items).toHaveLength(0);
    expect(after.unreadCount).toBe(0);
  }, 120_000);

  it('claims and acks outbox batches with a bounded retry cap', async () => {
    const fixture = await seedFixture('outbox');
    const eventId = uniqueId('event');
    await notifications.publishFromEvent({
      tenantId: fixture.tenantId,
      eventId,
      category: 'cleanup',
      title: 'Cleanup failed',
      body: 'A cleanup failed and needs attention.',
      userId: fixture.userId,
      nowIso: NOW_ISO,
    });

    const batch = await notifications.claimOutboxBatch({ tenantId: fixture.tenantId, limit: 10, maxAttempts: 3 });
    expect(batch.map((entry) => entry.eventId)).toContain(eventId);
    await notifications.ackOutbox({ tenantId: fixture.tenantId, eventId, outcome: 'sent' });
    const empty = await notifications.claimOutboxBatch({ tenantId: fixture.tenantId, limit: 10, maxAttempts: 3 });
    expect(empty).toHaveLength(0);
  }, 120_000);
});

describe('queries search, export, and reproduction (native)', () => {
  it('searches projects, runs, and audit events with filters', async () => {
    const fixture = await seedFixture('search');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const run = await seedRun(fixture, 'search-1', 'Checkout total repair.');
    await lifecycle.recordRunEvent({
      tenantId: fixture.tenantId,
      jobId: run.jobId,
      runId: run.runId,
      kind: 'started',
      payload: {},
      nowIso: NOW_ISO,
    });

    const projects = await queries.search(actor, {
      schemaVersion: '1',
      scope: 'projects',
      text: 'search project',
      limit: 10,
    });
    expect(projects.totalCount).toBe(1);
    expect(projects.hits[0]?.kind).toBe('project');

    const runs = await queries.search(actor, {
      schemaVersion: '1',
      scope: 'runs',
      runState: 'running',
      limit: 10,
    });
    expect(runs.totalCount).toBe(1);
    expect(runs.hits[0]?.id).toBe(run.runId);

    const audit = await queries.search(actor, {
      schemaVersion: '1',
      scope: 'audit',
      eventKind: 'started',
      limit: 10,
    });
    expect(audit.totalCount).toBe(1);
    expect(audit.hits[0]?.kind).toBe('audit-event');
  }, 120_000);

  it('removes revoked runs from results, counts, and cache (NEG3-32)', async () => {
    const fixture = await seedFixture('qrev');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    await seedRun(fixture, 'qrev-1', 'Revocable search.');
    const query = { schemaVersion: '1' as const, scope: 'runs' as const, limit: 10 };

    const before = await queries.search(actor, query);
    expect(before.totalCount).toBe(1);
    const statsBefore = queries.cacheStats();
    await queries.search(actor, query);
    expect(queries.cacheStats().hits).toBe(statsBefore.hits + 1);

    await admin.query('DELETE FROM repository_grants WHERE tenant_id = $1 AND repository_id = $2', [
      fixture.tenantId,
      fixture.repositoryId,
    ]);
    await queries.bumpGrantEpoch(fixture.tenantId);
    const after = await queries.search(actor, query);
    expect(after.totalCount).toBe(0);
    expect(after.hits).toHaveLength(0);
  }, 120_000);

  it('returns nothing across tenants without disclosure', async () => {
    const a = await seedFixture('qa');
    const b = await seedFixture('qb');
    await seedRun(a, 'qa-1', 'Private run.');
    const actorB = { sessionId: b.sessionId, nowIso: NOW_ISO };

    const runs = await queries.search(actorB, { schemaVersion: '1', scope: 'runs', limit: 10 });
    expect(runs.totalCount).toBe(0);
    expect(runs.hits).toHaveLength(0);
    const audit = await queries.search(actorB, { schemaVersion: '1', scope: 'audit', limit: 10 });
    expect(audit.totalCount).toBe(0);
  }, 120_000);

  it('exports scoped audit rows with a verifiable digest', async () => {
    const fixture = await seedFixture('export');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const run = await seedRun(fixture, 'export-1', 'Exported run.');
    await lifecycle.recordRunEvent({
      tenantId: fixture.tenantId,
      jobId: run.jobId,
      runId: run.runId,
      kind: 'started',
      payload: {},
      nowIso: NOW_ISO,
    });

    const first = await queries.exportAudit(actor, { runId: run.runId, after: 0, limit: 1 });
    expect(first.rows).toHaveLength(1);
    expect(first.manifest.rowCount).toBe(1);
    const recomputed = createHash('sha256').update(JSON.stringify(first.rows), 'utf8').digest('hex');
    expect(first.manifest.digest).toBe(recomputed);

    const second = await queries.exportAudit(actor, { runId: run.runId, after: first.cursor, limit: 10 });
    expect(second.rows).toHaveLength(1);
    expect(second.cursor).toBe(2);
  }, 120_000);

  it('reproduces a failed run through the budgeted retry path', async () => {
    const fixture = await seedFixture('repro');
    const actor = { sessionId: fixture.sessionId, nowIso: NOW_ISO };
    const run = await seedRun(fixture, 'repro-1', 'Reproduced run.');
    await lifecycle.recordRunEvent({
      tenantId: fixture.tenantId,
      jobId: run.jobId,
      runId: run.runId,
      kind: 'started',
      payload: {},
      nowIso: NOW_ISO,
    });
    await lifecycle.recordRunEvent({
      tenantId: fixture.tenantId,
      jobId: run.jobId,
      runId: run.runId,
      kind: 'failed',
      payload: { reason: 'assertion' },
      nowIso: NOW_ISO,
    });

    const reproduced = await queries.requestReproduction(actor, {
      runId: run.runId,
      idempotencyKey: idempotencyKey('repro-2'),
    });
    expect(reproduced.runId).not.toBe(run.runId);
    const source = await lifecycle.getRun(actor, { runId: run.runId });
    expect(reproduced.submitDigest).toBe(source.submitDigest);
  }, 120_000);
});
