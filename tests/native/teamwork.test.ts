import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCollaborationStore } from '../../src/modules/collaboration/index.js';
import { createIdentityStore } from '../../src/modules/identity/index.js';
import { createJobsStore } from '../../src/modules/jobs/index.js';
import { createLifecycleStore } from '../../src/modules/lifecycle/index.js';
import { createMemoryEvidenceStore } from '../../src/modules/evidence/index.js';
import { createNotificationsStore } from '../../src/modules/notifications/index.js';
import { createQueriesStore } from '../../src/modules/queries/index.js';
import { createSupportStore } from '../../src/modules/support/index.js';
import { createUsageStore } from '../../src/modules/usage/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-30 / T-30 — support + collaboration on real PostgreSQL (native).
 *
 * Written before the implementation. Support tickets, access requests with
 * separate scoped grants, operator incidents with fenced drain receipts, and
 * candidate-bound discussion threads with audience control and safe sharing:
 * a request never authorizes (NEG3-34), owners cannot reach operator actions,
 * comments carry no verdict authority and reject active markup (NEG3-35), and
 * every support-scoped read is logged.
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
  'V8__teamwork.sql',
  'V10__enterprise.sql',
].map((name) => migration(name));

const fileDbUrl = databaseUrlFor(databaseUrl, 't_teamwork');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const identity = createIdentityStore(appPool);
const jobs = createJobsStore(appPool);
const usage = createUsageStore(appPool);
const evidence = createMemoryEvidenceStore();
const notifications = createNotificationsStore(appPool, {
  deriveContext: (input) => identity.deriveContext(input),
});
const lifecycle = createLifecycleStore(
  appPool,
  {
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
  },
  {
    support: {
      listActiveScopes: (tenantId, userId, nowIso) => support.listActiveScopes(tenantId, userId, nowIso),
      logAccess: (input) => support.logAccess(input),
    },
  },
);
const queries = createQueriesStore(
  appPool,
  {
    session: { deriveContext: (input) => identity.deriveContext(input) },
    repro: { retryRun: (actor, retry) => lifecycle.retryRun(actor, retry) },
  },
  {
    support: {
      listActiveScopes: (tenantId, userId, nowIso) => support.listActiveScopes(tenantId, userId, nowIso),
      logAccess: (input) => support.logAccess(input),
    },
  },
);
const support = createSupportStore(appPool, {
  session: { deriveContext: (input) => identity.deriveContext(input) },
  jobs: { requestJobCancel: (input) => jobs.requestCancel(input) },
});
const collaboration = createCollaborationStore(appPool, {
  session: { deriveContext: (input) => identity.deriveContext(input) },
  mentions: {
    notifyMention: (input) =>
      notifications
        .publishFromEvent({
          tenantId: input.tenantId,
          eventId: input.eventId,
          category: 'results',
          title: 'Mentioned in a discussion',
          body: `${input.mentionedBy} mentioned you in thread ${input.threadId}.`,
          userId: input.userId,
          deepLink: `/app/runs/${input.runId}`,
          runId: input.runId,
          nowIso: input.nowIso,
        })
        .then(() => undefined),
  },
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
  return createHash('sha256').update(`teamwork:${seed}`).digest('hex');
}

interface Fixture {
  tenantId: string;
  ownerId: string;
  ownerSession: string;
  memberId: string;
  memberSession: string;
  operatorId: string;
  operatorSession: string;
  projectId: string;
  repositoryId: string;
}

async function seedFixture(prefix: string): Promise<Fixture> {
  const tenantId = uniqueId(`${prefix}-tenant`);
  const ownerId = uniqueId(`${prefix}-owner`);
  const memberId = uniqueId(`${prefix}-member`);
  const operatorId = uniqueId(`${prefix}-operator`);
  const repositoryId = uniqueId(`${prefix}-repo`);
  await identity.createTenant(tenantId);
  for (const [userId, role] of [
    [ownerId, 'owner'],
    [memberId, 'member'],
    [operatorId, 'operator'],
  ] as const) {
    await admin.query('INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, $3, 0)', [
      tenantId,
      userId,
      role,
    ]);
  }
  const ownerSession = await identity.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
  const memberSession = await identity.createSession({ tenantId, userId: memberId, ttlMs: HOUR_MS, nowMs: NOW_MS });
  const operatorSession = await identity.createSession({ tenantId, userId: operatorId, ttlMs: HOUR_MS, nowMs: NOW_MS });
  const project = await lifecycle.createProject(
    { sessionId: ownerSession.sessionId, nowIso: NOW_ISO },
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
  return {
    tenantId,
    ownerId,
    ownerSession: ownerSession.sessionId,
    memberId,
    memberSession: memberSession.sessionId,
    operatorId,
    operatorSession: operatorSession.sessionId,
    projectId: project.projectId,
    repositoryId,
  };
}

async function seedRun(fixture: Fixture, seed: string): Promise<{ runId: string; jobId: string }> {
  const actor = { sessionId: fixture.ownerSession, nowIso: NOW_ISO };
  const ctx = await identity.deriveContext(actor);
  const draft = await lifecycle.saveDraftRevision(actor, { projectId: fixture.projectId, body: { intent: seed } });
  const admitted = await lifecycle.submitRun(actor, {
    schemaVersion: '1',
    requestId: uniqueId('req'),
    tenantId: fixture.tenantId,
    actorId: fixture.ownerId,
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

const actorFor = (sessionId: string, nowIso = NOW_ISO) => ({ sessionId, nowIso });

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_teamwork');
  for (const sql of migrations) {
    await admin.query(sql);
  }
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('support tickets (native)', () => {
  it('files, triages, and resolves with role-split visibility', async () => {
    const fixture = await seedFixture('ticket');
    const owner = actorFor(fixture.ownerSession);
    const member = actorFor(fixture.memberSession);

    const filed = await support.createTicket(member, {
      category: 'bug',
      summary: 'Total mismatch.',
      context: 'Two-item order shows the wrong total.',
    });
    expect(filed.status).toBe('open');

    const ownerList = await support.listTickets(owner, { limit: 10 });
    expect(ownerList.items.map((ticket) => ticket.ticketId)).toContain(filed.ticketId);
    const memberList = await support.listTickets(member, { limit: 10 });
    expect(memberList.items.map((ticket) => ticket.ticketId)).toContain(filed.ticketId);

    await expect(support.triageTicket(member, { ticketId: filed.ticketId })).rejects.toThrow(/owner|admin/i);
    await support.triageTicket(owner, { ticketId: filed.ticketId });
    await support.resolveTicket(owner, { ticketId: filed.ticketId });
    const resolved = await support.listTickets(owner, { limit: 10, status: 'resolved' });
    expect(resolved.items.map((ticket) => ticket.ticketId)).toContain(filed.ticketId);
  }, 120_000);

  it('refuses credential-shaped ticket context', async () => {
    const fixture = await seedFixture('ticksec');

    await expect(
      support.createTicket(actorFor(fixture.memberSession), {
        category: 'bug',
        summary: 'Auth fails.',
        context: 'My api_key: abc123 does not work.',
      }),
    ).rejects.toThrow(/secret/i);
  }, 120_000);
});

describe('access requests are never grants (NEG3-34, native)', () => {
  it('denies reads on a pending request and allows them after approval with audit', async () => {
    const fixture = await seedFixture('access');
    const run = await seedRun(fixture, 'access-1');
    const operator = actorFor(fixture.operatorSession);
    const owner = actorFor(fixture.ownerSession);

    const requested = await support.requestAccess(operator, {
      resourceType: 'run',
      resourceId: run.runId,
      reason: 'Help diagnose the failure.',
      ttlMs: HOUR_MS,
    });
    expect(requested.status).toBe('pending');

    await expect(lifecycle.getRun(operator, { runId: run.runId })).rejects.toThrow(/no tenant authority|denied/i);

    const decided = await support.decideAccess(owner, { requestId: requested.requestId, decision: 'approve' });
    expect(decided.grantId).not.toBeNull();
    if (decided.grantId === null) throw new Error('Approval minted no grant.');

    const read = await lifecycle.getRun(operator, { runId: run.runId });
    expect(read.runId).toBe(run.runId);
    const logged = await admin.query('SELECT COUNT(*)::TEXT AS count FROM support_access_log WHERE tenant_id = $1', [
      fixture.tenantId,
    ]);
    expect((logged.rows[0] as { count: string }).count).toBe('1');

    await support.revokeGrant(owner, { grantId: decided.grantId });
    await expect(lifecycle.getRun(operator, { runId: run.runId })).rejects.toThrow(/no tenant authority|denied|expired/i);
  }, 120_000);

  it('scopes operator search and export to covering grants', async () => {
    const fixture = await seedFixture('opscope');
    const run = await seedRun(fixture, 'opscope-1');
    const operator = actorFor(fixture.operatorSession);
    const owner = actorFor(fixture.ownerSession);
    const query = { schemaVersion: '1' as const, scope: 'runs' as const, limit: 10 };

    await expect(queries.search(operator, query)).rejects.toThrow(/no tenant authority/i);

    const requested = await support.requestAccess(operator, {
      resourceType: 'run',
      resourceId: run.runId,
      reason: 'Scoped search.',
      ttlMs: HOUR_MS,
    });
    await support.decideAccess(owner, { requestId: requested.requestId, decision: 'approve' });
    await queries.bumpGrantEpoch(fixture.tenantId);

    const found = await queries.search(operator, query);
    expect(found.totalCount).toBe(1);
    expect(found.hits[0]?.id).toBe(run.runId);
    const exported = await queries.exportAudit(operator, { runId: run.runId, after: 0, limit: 10 });
    expect(exported.rows.length).toBeGreaterThan(0);
    await expect(queries.exportAudit(operator, { after: 0, limit: 10 })).rejects.toThrow(/explicit run or project/i);
  }, 120_000);

  it('denies approval by actors without the full scope', async () => {
    const fixture = await seedFixture('scope');
    const run = await seedRun(fixture, 'scope-1');
    const requested = await support.requestAccess(actorFor(fixture.operatorSession), {
      resourceType: 'run',
      resourceId: run.runId,
      reason: 'Scope check.',
      ttlMs: HOUR_MS,
    });

    await expect(
      support.decideAccess(actorFor(fixture.memberSession), { requestId: requested.requestId, decision: 'approve' }),
    ).rejects.toThrow(/owner|admin/i);
  }, 120_000);

  it('expires grants at their deadline', async () => {
    const fixture = await seedFixture('expiry');
    const run = await seedRun(fixture, 'expiry-1');
    const requested = await support.requestAccess(actorFor(fixture.operatorSession), {
      resourceType: 'run',
      resourceId: run.runId,
      reason: 'Short visit.',
      ttlMs: HOUR_MS,
    });
    const decided = await support.decideAccess(actorFor(fixture.ownerSession), {
      requestId: requested.requestId,
      decision: 'approve',
    });
    expect(decided.grantId).not.toBeNull();

    const late = actorFor(fixture.operatorSession, '2026-11-02T02:00:01.000Z');
    await expect(lifecycle.getRun(late, { runId: run.runId })).rejects.toThrow(/no tenant authority|denied|expired/i);
  }, 120_000);
});

describe('operator console boundaries (NEG3-34, native)', () => {
  it('lets operators manage incidents while owners cannot mutate them', async () => {
    const fixture = await seedFixture('incident');
    const owner = actorFor(fixture.ownerSession);
    const operator = actorFor(fixture.operatorSession);

    await expect(
      support.reportIncident(owner, { component: 'queue', summary: 'Owner report.' }),
    ).rejects.toThrow(/operator/i);

    const incident = await support.reportIncident(operator, {
      component: 'worker-fleet',
      summary: 'Queue latency is above the bound.',
      queueImpact: 'Runs wait longer than usual.',
    });
    expect(incident.status).toBe('open');

    const visible = await support.listIncidents(owner, { limit: 10 });
    expect(visible.items.map((entry) => entry.incidentId)).toContain(incident.incidentId);
    await support.resolveIncident(operator, { incidentId: incident.incidentId });
  }, 120_000);

  it('fences drain actions against the live lease epoch', async () => {
    const fixture = await seedFixture('drain');
    const run = await seedRun(fixture, 'drain-1');
    const owner = actorFor(fixture.ownerSession);
    const operator = actorFor(fixture.operatorSession);

    await expect(
      support.drainTarget(owner, { tenantId: fixture.tenantId, jobId: run.jobId, expectedEpoch: 1, reason: 'Owner drain.' }),
    ).rejects.toThrow(/operator/i);

    const claimed = await jobs.claimJob({
      tenantId: fixture.tenantId,
      workerId: uniqueId('worker'),
      guestId: uniqueId('guest'),
      imageDigest: '1'.repeat(64),
      candidateDigest: '2'.repeat(64),
      planDigest: '3'.repeat(64),
      grantVersion: 0,
      ttlMs: HOUR_MS,
      maxConcurrent: 1,
      nowIso: NOW_ISO,
    });
    if (claimed === null) throw new Error('No job to drain; refusing a fenceless test.');
    const lease = await admin.query('SELECT epoch FROM job_leases WHERE job_id = $1', [run.jobId]);
    const epoch = (lease.rows[0] as { epoch: number }).epoch;

    await expect(
      support.drainTarget(operator, { tenantId: fixture.tenantId, jobId: run.jobId, expectedEpoch: epoch + 99, reason: 'Stale drain.' }),
    ).rejects.toThrow(/epoch|stale|fence/i);
    const receipt = await support.drainTarget(operator, {
      tenantId: fixture.tenantId,
      jobId: run.jobId,
      expectedEpoch: epoch,
      reason: 'Worker stopped heartbeating.',
    });
    expect(receipt.leaseEpoch).toBe(epoch);

    const actions = await support.listOperatorActions(owner, { limit: 10 });
    expect(actions.items.map((entry) => entry.actionId)).toContain(receipt.actionId);
  }, 120_000);
});

describe('discussion threads (native)', () => {
  it('discusses a run without touching its proof (NEG3-35)', async () => {
    const fixture = await seedFixture('thread');
    const run = await seedRun(fixture, 'thread-1');
    const owner = actorFor(fixture.ownerSession);
    const member = actorFor(fixture.memberSession);
    const before = await lifecycle.getRun(owner, { runId: run.runId });

    const thread = await collaboration.createThread(member, {
      runId: run.runId,
      candidateDigest: 'e'.repeat(64),
      audience: 'internal',
    });
    const comment = await collaboration.postComment(member, { threadId: thread.threadId, body: 'The total looks right.' });
    await collaboration.editComment(member, { commentId: comment.commentId, body: 'The total looks right now.' });
    await collaboration.resolveThread(member, { threadId: thread.threadId });

    const after = await lifecycle.getRun(owner, { runId: run.runId });
    expect(after.state).toBe(before.state);
    expect(after.submitDigest).toBe(before.submitDigest);
    const listed = await collaboration.listThreads(owner, { runId: run.runId });
    expect(listed.threads[0]?.status).toBe('resolved');
  }, 120_000);

  it('rejects active markup in comments (NEG3-35)', async () => {
    const fixture = await seedFixture('xss');
    const run = await seedRun(fixture, 'xss-1');
    const member = actorFor(fixture.memberSession);
    const thread = await collaboration.createThread(member, {
      runId: run.runId,
      candidateDigest: 'e'.repeat(64),
      audience: 'internal',
    });

    await expect(
      collaboration.postComment(member, { threadId: thread.threadId, body: 'Hi <script>alert(1)</script>' }),
    ).rejects.toThrow(/active markup/i);
  }, 120_000);

  it('marks comments outdated on candidate revision without moving them', async () => {
    const fixture = await seedFixture('outdate');
    const run = await seedRun(fixture, 'outdate-1');
    const member = actorFor(fixture.memberSession);
    const thread = await collaboration.createThread(member, {
      runId: run.runId,
      candidateDigest: 'e'.repeat(64),
      audience: 'internal',
    });
    await collaboration.postComment(member, { threadId: thread.threadId, body: 'Reviewing the first candidate.' });

    const marked = await collaboration.recordCandidateRevision({
      tenantId: fixture.tenantId,
      runId: run.runId,
      candidateDigest: 'f'.repeat(64),
      nowIso: NOW_ISO,
    });
    expect(marked.outdated).toBe(1);

    const comments = await collaboration.listComments(member, { threadId: thread.threadId });
    expect(comments.comments[0]?.outdated).toBe(true);
    expect(comments.comments[0]?.body).toBe('Reviewing the first candidate.');
    const threads = await collaboration.listThreads(member, { runId: run.runId });
    expect(threads.threads[0]?.candidateDigest).toBe('e'.repeat(64));
  }, 120_000);

  it('shares internal threads explicitly and revokes cleanly', async () => {
    const fixture = await seedFixture('share');
    const viewerId = uniqueId('share-viewer');
    await admin.query('INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, $3, 0)', [
      fixture.tenantId,
      viewerId,
      'viewer',
    ]);
    const viewerSession = await identity.createSession({ tenantId: fixture.tenantId, userId: viewerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const run = await seedRun(fixture, 'share-1');
    const owner = actorFor(fixture.ownerSession);
    const viewer = actorFor(viewerSession.sessionId);

    const thread = await collaboration.createThread(owner, {
      runId: run.runId,
      candidateDigest: 'e'.repeat(64),
      audience: 'internal',
    });
    await expect(collaboration.listComments(viewer, { threadId: thread.threadId })).rejects.toThrow(/not shared|denied/i);

    const share = await collaboration.shareThread(owner, { threadId: thread.threadId, userId: viewerId });
    expect(share.shareId.length).toBeGreaterThan(0);
    const shared = await collaboration.listComments(viewer, { threadId: thread.threadId });
    expect(shared.comments).toHaveLength(0);

    await collaboration.revokeShare(owner, { shareId: share.shareId });
    await expect(collaboration.listComments(viewer, { threadId: thread.threadId })).rejects.toThrow(/not shared|denied/i);
  }, 120_000);

  it('narrows audience only through owners with recorded history', async () => {
    const fixture = await seedFixture('audience');
    const run = await seedRun(fixture, 'audience-1');
    const member = actorFor(fixture.memberSession);
    const owner = actorFor(fixture.ownerSession);
    const thread = await collaboration.createThread(member, {
      runId: run.runId,
      candidateDigest: 'e'.repeat(64),
      audience: 'reviewer',
    });

    await expect(
      collaboration.changeAudience(member, { threadId: thread.threadId, audience: 'internal' }),
    ).rejects.toThrow(/owner|admin/i);

    const narrowed = await collaboration.changeAudience(owner, { threadId: thread.threadId, audience: 'internal' });
    expect(narrowed.audience).toBe('internal');
    expect(narrowed.audienceHistory).toHaveLength(1);
    expect(narrowed.audienceHistory[0]).toMatchObject({ from: 'reviewer', to: 'internal' });
  }, 120_000);

  it('notifies mentioned users with access and nobody else', async () => {
    const fixture = await seedFixture('mention');
    const run = await seedRun(fixture, 'mention-1');
    const owner = actorFor(fixture.ownerSession);
    const member = actorFor(fixture.memberSession);
    const thread = await collaboration.createThread(member, {
      runId: run.runId,
      candidateDigest: 'e'.repeat(64),
      audience: 'internal',
    });

    await collaboration.postComment(member, {
      threadId: thread.threadId,
      body: `Please confirm, @${fixture.ownerId}.`,
    });
    const inbox = await notifications.listNotifications(owner, { limit: 10 });
    expect(inbox.items.some((item) => item.body.includes(thread.threadId))).toBe(true);

    await collaboration.postComment(member, {
      threadId: thread.threadId,
      body: 'Pinging @ghost-user-nope for no reason.',
    });
    const ghostInbox = await notifications.listNotifications(owner, { limit: 20 });
    expect(ghostInbox.items.filter((item) => item.body.includes('ghost-user-nope'))).toHaveLength(0);
  }, 120_000);
});
