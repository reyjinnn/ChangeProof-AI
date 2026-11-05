import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';

import type { EmailDeliveryReceipt, EmailMessage } from '../../src/core/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import {
  composeAdapterCapabilities,
  composeCollaboration,
  composeEmailIdentity,
  composeFileEvidence,
  composeIdentityStore,
  composeJobs,
  composeLifecycle,
  composeNotifications,
  composePublicSite,
  composeQueries,
  composeSupport,
  composeUsage,
  type CollaborationComposition,
  type IdentityComposition,
  type SupportComposition,
  type UsageComposition,
} from '../../src/orchestrator/index.js';
import { createMapSecretBroker } from '../../src/modules/github/broker.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * T-48 — teamwork HTTP routes over real PostgreSQL + the real server.
 *
 * Native check, reported separately: run with `DATABASE_URL=…` against a
 * disposable PostgreSQL 16 container. Applies V1–V8 + V10 + V12 into its own
 * `t_teamworkhttp` database. Operator memberships and job leases are
 * seeded (no product API owns them yet); every teamwork step goes over
 * HTTP as app_user, so RLS fencing and the owner/operator split are
 * real. Candidate revisions are recorded at the store boundary
 * (worker-only, no HTTP route by design).
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL is required (e.g. postgresql://postgres:<pw>@127.0.0.1:55433/postgres). ' +
      'Start the disposable probe container first.',
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const migration = (name: string): string => readFileSync(join(rootDir, 'infra', 'postgres', name), 'utf8');

const fileDbUrl = databaseUrlFor(databaseUrl, 't_teamworkhttp');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const sent: EmailMessage[] = [];
const delivery = {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    sent.push(message);
    return Promise.resolve({ messageId: `teamwork-http-${String(sent.length)}`, acceptedAt: new Date().toISOString() });
  },
};
const secrets = createMapSecretBroker(new Map([['email-challenge-secret', 'teamwork-http-secret-32plus!!!!']]));

const evidenceDir = mkdtempSync(join(tmpdir(), 'cp-teamworkhttp-evidence-'));

let identity: IdentityComposition;
let support: SupportComposition;
let collaboration: CollaborationComposition;
let usage: UsageComposition;
let handle: HttpHandle | undefined;
let base = '';
let counter = 0;

function tokenFrom(subjectPart: string): string {
  const found = [...sent].reverse().find((message) => message.subject.toLowerCase().includes(subjectPart));
  if (found === undefined) throw new Error(`No mail with subject containing "${subjectPart}".`);
  const match = /Token \(single use[^\n]*\n(\S+)\s*/.exec(found.textBody);
  if (match?.[1] === undefined) throw new Error('Mail carries no extractable token.');
  return match[1];
}

interface Call {
  readonly status: number;
  readonly body: unknown;
  readonly setCookie: readonly string[];
}

async function call(method: string, path: string, body?: unknown, cookie?: string): Promise<Call> {
  const headers: Record<string, string> = { 'X-Requested-With': 'ChangeProofUI' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie !== undefined) headers['Cookie'] = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.getSetCookie();
  return { status: response.status, body: await response.json(), setCookie };
}

function cookieOf(callResult: Call): string {
  const first = callResult.setCookie[0];
  if (first === undefined) throw new Error('Expected a session cookie.');
  return first.split(';')[0] ?? '';
}

function idempotencyKey(seed: string): string {
  return createHash('sha256').update(`teamwork-http:${seed}`).digest('hex');
}

interface Fixture {
  readonly tenantId: string;
  readonly ownerCookie: string;
  readonly ownerId: string;
  readonly memberCookie: string;
  readonly memberId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly grantVersion: number;
  readonly runId: string;
  readonly submitDigest: string;
}

async function registerVerifyClaim(email: string, password: string, tenantId: string): Promise<void> {
  const registered = await call('POST', '/api/auth/register', { email, password });
  expect(registered.status).toBe(201);
  const verified = await call('POST', '/api/auth/verify', { token: tokenFrom('verif') });
  expect(verified.status).toBe(200);
  const ticket = (verified.body as { data: { claimTicket: string } }).data.claimTicket;
  const claimed = await call('POST', '/api/orgs', { tenantId, ticket });
  expect(claimed.status).toBe(201);
}

async function seedFixture(tag: string): Promise<Fixture> {
  counter += 1;
  const stamp = `${tag}-${String(counter)}`;
  const tenantId = `teamwork-${stamp}`;
  const repositoryId = `repo-${stamp}`;
  const ownerEmail = `teamwork-owner-${stamp}@example.com`;
  await registerVerifyClaim(ownerEmail, 'correct-horse-42', tenantId);
  const ownerCookie = cookieOf(await call('POST', '/api/auth/login', { email: ownerEmail, password: 'correct-horse-42', rememberMe: false }));
  const created = await call('POST', '/api/projects', { name: `${tag} project` }, ownerCookie);
  expect(created.status).toBe(201);
  const projectId = (created.body as { data: { projectId: string } }).data.projectId;
  await admin.query('INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)', [
    tenantId,
    repositoryId,
    projectId,
  ]);
  await usage.store.setEntitlement({
    tenantId,
    capAmount: 1000,
    rateVersion: 'test-rates-1',
    periodId: 'period-1',
    nowIso: new Date().toISOString(),
  });
  const session = await call('GET', '/api/auth/session', undefined, ownerCookie);
  const sessionData = (session.body as { data: { userId: string; grantVersion: number } }).data;
  const saved = await call(
    'POST',
    '/api/drafts',
    { projectId, body: { intent: `teamwork run ${stamp}`, budgetCap: 50 } },
    ownerCookie,
  );
  expect(saved.status).toBe(201);
  const draft = (saved.body as { data: { draftId: string; revision: number } }).data;
  const submitted = await call(
    'POST',
    '/api/runs',
    {
      projectId,
      repositoryIds: [repositoryId],
      sourceRefs: ['git:abc1234'],
      intentRef: `intent-${stamp}`,
      executionMode: 'real_runtime',
      invariantRefs: [`invariant-${stamp}`],
      verificationPlanRef: `plan-${stamp}`,
      budgetProfileId: `budget-${stamp}`,
      publicationConsent: false,
      idempotencyKey: idempotencyKey(stamp),
      expectedGrantVersion: sessionData.grantVersion,
      draftId: draft.draftId,
      draftRevision: draft.revision,
      requestedBudget: 50,
    },
    ownerCookie,
  );
  expect(submitted.status).toBe(201);
  const run = (submitted.body as { data: { runId: string; submitDigest: string } }).data;
  const invited = await call('POST', `/api/orgs/${tenantId}/invitations`, { role: 'member' }, ownerCookie);
  expect(invited.status).toBe(201);
  const inviteToken = (invited.body as { data: { token: string } }).data.token;
  const memberEmail = `teamwork-member-${stamp}@example.com`;
  await registerVerifyClaim(memberEmail, 'correct-horse-42', `${tenantId}-home`);
  const memberHomeCookie = cookieOf(await call('POST', '/api/auth/login', { email: memberEmail, password: 'correct-horse-42', rememberMe: false }));
  const accepted = await call('POST', '/api/invitations/accept', { token: inviteToken }, memberHomeCookie);
  expect(accepted.status).toBe(200);
  const memberLogin = await call('POST', '/api/auth/login', { email: memberEmail, password: 'correct-horse-42', rememberMe: false, tenantId });
  expect(memberLogin.status).toBe(200);
  const memberCookie = cookieOf(memberLogin);
  const memberSession = await call('GET', '/api/auth/session', undefined, memberCookie);
  const memberId = (memberSession.body as { data: { userId: string; role: string; tenantId: string } }).data;
  expect(memberId.role).toBe('member');
  expect(memberId.tenantId).toBe(tenantId);
  return {
    tenantId,
    ownerCookie,
    ownerId: sessionData.userId,
    memberCookie,
    memberId: memberId.userId,
    projectId,
    repositoryId,
    grantVersion: sessionData.grantVersion,
    runId: run.runId,
    submitDigest: run.submitDigest,
  };
}

async function seedOperator(tag: string): Promise<{ cookie: string; userId: string; tenantId: string }> {
  counter += 1;
  const email = `teamwork-operator-${tag}-${String(counter)}@example.com`;
  const tenantId = `teamwork-op-${tag}-${String(counter)}`;
  await registerVerifyClaim(email, 'correct-horse-42', tenantId);
  const logged = await call('POST', '/api/auth/login', { email, password: 'correct-horse-42', rememberMe: false });
  const cookie = cookieOf(logged);
  const session = await call('GET', '/api/auth/session', undefined, cookie);
  const userId = (session.body as { data: { userId: string } }).data.userId;
  await admin.query("UPDATE memberships SET role = 'operator' WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId]);
  return { cookie, userId, tenantId };
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_teamworkhttp');
  for (const name of [
    'V1__identity_tenancy.sql',
    'V2__identity_services.sql',
    'V3__jobs.sql',
    'V4__usage.sql',
    'V5__email_identity.sql',
    'V6__lifecycle.sql',
    'V7__engagement.sql',
    'V8__teamwork.sql',
    'V10__enterprise.sql',
    'V12__workspace.sql',
  ]) {
    await admin.query(migration(name));
  }
  identity = composeIdentityStore(appPool);
  usage = composeUsage(appPool);
  const jobs = composeJobs(appPool);
  const evidence = composeFileEvidence(evidenceDir);
  const lifecycle = composeLifecycle(appPool, {
    identity: identity.store,
    usage: usage.store,
    jobs: jobs.store,
    evidence: evidence.store,
  });
  const queries = composeQueries(appPool, { identity: identity.store, lifecycle: lifecycle.store });
  const notificationsComp = composeNotifications(appPool, identity.store);
  support = composeSupport(appPool, { identity: identity.store, jobs: jobs.store });
  collaboration = composeCollaboration(appPool, { identity: identity.store, notifications: notificationsComp.store });
  handle = createHttpServer({
    publicSite: composePublicSite(),
    manifestPath: join(rootDir, 'config', 'publicsite', 'manifest.json'),
    auth: {
      identity,
      email: composeEmailIdentity(appPool, {
        delivery,
        secrets,
        challengeSecretRef: 'email-challenge-secret',
      }),
    },
    runs: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      lifecycle,
      queries,
    },
    notifications: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      notifications: notificationsComp,
    },
    teamwork: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      support,
      collaboration,
      capabilities: composeAdapterCapabilities().registry,
    },
  });
  await new Promise<void>((resolve) => handle?.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
  base = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.close();
  await appPool.end();
  await admin.end();
  rmSync(evidenceDir, { recursive: true, force: true });
});

test('tickets file, list by role, and transition open to closed', async () => {
  const fixture = await seedFixture('tickets');
  const filed = await call(
    'POST',
    '/api/support/tickets',
    { category: 'bug', summary: 'Checkout 500s', context: 'Pay step fails.', runId: fixture.runId },
    fixture.memberCookie,
  );
  expect(filed.status).toBe(201);
  const ticketId = (filed.body as { data: { ticketId: string } }).data.ticketId;
  const memberList = await call('GET', '/api/support/tickets?limit=20', undefined, fixture.memberCookie);
  expect((memberList.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  const ownerList = await call('GET', '/api/support/tickets?limit=20', undefined, fixture.ownerCookie);
  expect((ownerList.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  const memberTriage = await call('POST', `/api/support/tickets/${ticketId}/triage`, {}, fixture.memberCookie);
  expect(memberTriage.status).toBe(403);
  for (const step of ['triage', 'resolve', 'close'] as const) {
    const moved = await call('POST', `/api/support/tickets/${ticketId}/${step}`, {}, fixture.ownerCookie);
    expect(moved.status).toBe(200);
  }
  const reopen = await call('POST', `/api/support/tickets/${ticketId}/triage`, {}, fixture.ownerCookie);
  expect(reopen.status).toBe(404);
  const guest = await call('GET', '/api/support/tickets?limit=20');
  expect(guest.status).toBe(401);
});

test('access requests approve into a grant and revoke; request is not a grant (NEG3-34)', async () => {
  const fixture = await seedFixture('access');
  const requested = await call(
    'POST',
    '/api/support/access-requests',
    { resourceType: 'run', resourceId: fixture.runId, reason: 'Review the fix.', ttlMs: 3_600_000 },
    fixture.memberCookie,
  );
  expect(requested.status).toBe(201);
  const requestId = (requested.body as { data: { requestId: string } }).data.requestId;
  const memberDecide = await call(
    'POST',
    `/api/support/access-requests/${requestId}/decide`,
    { decision: 'approve' },
    fixture.memberCookie,
  );
  expect(memberDecide.status).toBe(403);
  const approved = await call(
    'POST',
    `/api/support/access-requests/${requestId}/decide`,
    { decision: 'approve' },
    fixture.ownerCookie,
  );
  expect(approved.status).toBe(200);
  const grantId = (approved.body as { data: { grantId: string } }).data.grantId;
  expect(grantId).toMatch(/^grant-/);
  const again = await call(
    'POST',
    `/api/support/access-requests/${requestId}/decide`,
    { decision: 'deny' },
    fixture.ownerCookie,
  );
  expect(again.status).toBe(400);
  const revoked = await call('POST', `/api/support/grants/${grantId}/revoke`, {}, fixture.ownerCookie);
  expect(revoked.status).toBe(200);
  const unknown = await call('POST', '/api/support/grants/grant-missing/revoke', {}, fixture.ownerCookie);
  expect(unknown.status).toBe(404);
});

test('incidents list for tenants; only operators manage them (NEG3-34)', async () => {
  const fixture = await seedFixture('incidents');
  const operator = await seedOperator('incidents');
  const ownerReport = await call(
    'POST',
    '/api/operator/incidents',
    { component: 'queue', summary: 'Backlog growing.' },
    fixture.ownerCookie,
  );
  expect(ownerReport.status).toBe(403);
  const reported = await call(
    'POST',
    '/api/operator/incidents',
    { component: 'queue', summary: 'Backlog growing.' },
    operator.cookie,
  );
  expect(reported.status).toBe(201);
  const incidentId = (reported.body as { data: { incidentId: string } }).data.incidentId;
  const tenantList = await call('GET', '/api/support/incidents?limit=20', undefined, fixture.ownerCookie);
  expect((tenantList.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  const acknowledged = await call('POST', `/api/operator/incidents/${incidentId}/acknowledge`, {}, operator.cookie);
  expect(acknowledged.status).toBe(200);
  const resolved = await call('POST', `/api/operator/incidents/${incidentId}/resolve`, {}, operator.cookie);
  expect(resolved.status).toBe(200);
  const ownerAck = await call('POST', `/api/operator/incidents/${incidentId}/acknowledge`, {}, fixture.ownerCookie);
  expect(ownerAck.status).toBe(403);
});

test('operator targets inspect, drain, and quarantine under the lease fence', async () => {
  const fixture = await seedFixture('targets');
  const operator = await seedOperator('targets');
  const now = new Date().toISOString();
  const jobId = `job-${fixture.tenantId}`;
  await admin.query(
    'INSERT INTO runs (id, tenant_id, idempotency_key, reservation_id, state, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [`runrec-${fixture.tenantId}`, fixture.tenantId, `idem-${fixture.tenantId}`, `res-${fixture.tenantId}`, 'running', now],
  );
  await admin.query('INSERT INTO jobs (id, tenant_id, run_id, state, created_at) VALUES ($1, $2, $3, $4, $5)', [
    jobId,
    fixture.tenantId,
    `runrec-${fixture.tenantId}`,
    'running',
    now,
  ]);
  await admin.query(
    'INSERT INTO job_leases (job_id, tenant_id, epoch, version, owner_id, guest_id, image_digest, candidate_digest, plan_digest, heartbeat_at, expires_at, state, retry_count, grant_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
    [jobId, fixture.tenantId, 4, 0, 'worker-1', 'guest-1', 'img', 'cand', 'plan', now, now, 'active', 0, 1],
  );
  const ownerInspect = await call(
    'POST',
    '/api/operator/targets/inspect',
    { tenantId: fixture.tenantId, jobId },
    fixture.ownerCookie,
  );
  expect(ownerInspect.status).toBe(403);
  const inspected = await call(
    'POST',
    '/api/operator/targets/inspect',
    { tenantId: fixture.tenantId, jobId },
    operator.cookie,
  );
  expect(inspected.status).toBe(200);
  expect(inspected.body).toMatchObject({ ok: true, data: { tenantId: fixture.tenantId, state: 'running', epoch: 4 } });
  const stale = await call(
    'POST',
    '/api/operator/targets/drain',
    { tenantId: fixture.tenantId, jobId, expectedEpoch: 3, reason: 'Stale attempt.' },
    operator.cookie,
  );
  expect(stale.status).toBe(400);
  const drained = await call(
    'POST',
    '/api/operator/targets/drain',
    { tenantId: fixture.tenantId, jobId, expectedEpoch: 4, reason: 'Stuck lease.' },
    operator.cookie,
  );
  expect(drained.status).toBe(200);
  expect(drained.body).toMatchObject({ ok: true, data: { kind: 'drain', leaseEpoch: 4 } });
  const quarantined = await call(
    'POST',
    '/api/operator/targets/quarantine',
    { tenantId: fixture.tenantId, jobId, expectedEpoch: 4, reason: 'Suspect guest.' },
    operator.cookie,
  );
  expect(quarantined.status).toBe(200);
  const audited = await call('GET', '/api/operator/actions?limit=20', undefined, fixture.ownerCookie);
  expect((audited.body as { data: { items: unknown[] } }).data.items).toHaveLength(2);
});

test('threads carry comments, edits, history, audience, and shares (NEG3-35 shape)', async () => {
  const fixture = await seedFixture('threads');
  const created = await call(
    'POST',
    '/api/threads',
    { runId: fixture.runId, candidateDigest: fixture.submitDigest, audience: 'internal' },
    fixture.ownerCookie,
  );
  expect(created.status).toBe(201);
  const threadId = (created.body as { data: { threadId: string } }).data.threadId;
  const listed = await call('GET', `/api/threads?runId=${fixture.runId}`, undefined, fixture.memberCookie);
  expect((listed.body as { data: { threads: unknown[] } }).data.threads).toHaveLength(1);
  const hostile = await call(
    'POST',
    `/api/threads/${threadId}/comments`,
    { body: '<script>alert(1)</script> looks right' },
    fixture.memberCookie,
  );
  expect(hostile.status).toBe(400);
  expect((hostile.body as { error: { message: string } }).error.message).toContain('active markup');
  const inert = '<b>bold?</b> looks right';
  const posted = await call('POST', `/api/threads/${threadId}/comments`, { body: inert }, fixture.memberCookie);
  expect(posted.status).toBe(201);
  const commentId = (posted.body as { data: { commentId: string } }).data.commentId;
  const comments = await call('GET', `/api/threads/${threadId}/comments`, undefined, fixture.ownerCookie);
  expect((comments.body as { data: { comments: { body: string }[] } }).data.comments[0]?.body).toBe(inert);
  const edited = await call('POST', `/api/comments/${commentId}/edit`, { body: 'Looks right.' }, fixture.memberCookie);
  expect(edited.status).toBe(200);
  const history = await call('GET', `/api/comments/${commentId}/history`, undefined, fixture.ownerCookie);
  const versions = (history.body as { data: { versions: { version: number; body: string }[] } }).data.versions;
  expect(versions).toHaveLength(1);
  expect(versions[0]).toMatchObject({ version: 1, body: inert });
  const memberAudience = await call(
    'POST',
    `/api/threads/${threadId}/audience`,
    { audience: 'reviewer' },
    fixture.memberCookie,
  );
  expect(memberAudience.status).toBe(403);
  const audience = await call(
    'POST',
    `/api/threads/${threadId}/audience`,
    { audience: 'reviewer' },
    fixture.ownerCookie,
  );
  expect(audience.status).toBe(200);
  const shared = await call('POST', `/api/threads/${threadId}/share`, { userId: fixture.memberId }, fixture.ownerCookie);
  expect(shared.status).toBe(201);
  const shareId = (shared.body as { data: { shareId: string } }).data.shareId;
  const unshared = await call('POST', `/api/threads/shares/${shareId}/revoke`, {}, fixture.ownerCookie);
  expect(unshared.status).toBe(200);
  const resolved = await call('POST', `/api/threads/${threadId}/resolve`, {}, fixture.memberCookie);
  expect(resolved.status).toBe(200);
  const missing = await call('GET', '/api/threads/thread-missing/comments', undefined, fixture.ownerCookie);
  expect(missing.status).toBe(404);
});

test('a newer candidate revision marks older comments outdated; tenants stay fenced', async () => {
  const fixture = await seedFixture('outdated');
  const other = await seedFixture('outdated-other');
  const created = await call(
    'POST',
    '/api/threads',
    { runId: fixture.runId, candidateDigest: fixture.submitDigest, audience: 'internal' },
    fixture.ownerCookie,
  );
  const threadId = (created.body as { data: { threadId: string } }).data.threadId;
  await call('POST', `/api/threads/${threadId}/comments`, { body: 'First look.' }, fixture.ownerCookie);
  const marked = await collaboration.store.recordCandidateRevision({
    tenantId: fixture.tenantId,
    runId: fixture.runId,
    candidateDigest: 'e'.repeat(64),
    nowIso: new Date().toISOString(),
  });
  expect(marked.outdated).toBe(1);
  const comments = await call('GET', `/api/threads/${threadId}/comments`, undefined, fixture.ownerCookie);
  expect((comments.body as { data: { comments: { outdated: boolean }[] } }).data.comments[0]?.outdated).toBe(true);
  const foreign = await call('GET', `/api/threads/${threadId}/comments`, undefined, other.ownerCookie);
  expect(foreign.status).toBe(404);
});

test('capability matrix reports the fourteen registered tuples with target/proven split', async () => {
  const fixture = await seedFixture('caps');
  const matrix = await call('GET', '/api/support/capabilities', undefined, fixture.ownerCookie);
  expect(matrix.status).toBe(200);
  const records = (
    matrix.body as {
      data: {
        capabilities: {
          ecosystem: string;
          framework: string;
          version: string;
          feature: string;
          changeType: string;
          targetLevel: string;
          provenLevel: string;
        }[];
      };
    }
  ).data.capabilities;
  expect(records).toHaveLength(14);
  const rank = (level: string): number => ({ none: 0, L1: 1, L2: 2, L3: 3 })[level] ?? -1;
  for (const record of records) {
    expect(record.ecosystem.length).toBeGreaterThan(0);
    expect(record.framework.length).toBeGreaterThan(0);
    // No "all versions" claims: every tuple names an explicit range.
    expect(record.version.trim().toLowerCase()).not.toMatch(/^(?:\*|any|all|latest|>=0)$/);
    expect(rank(record.provenLevel)).toBeGreaterThanOrEqual(0);
    expect(rank(record.targetLevel)).toBeGreaterThanOrEqual(1);
    expect(rank(record.provenLevel)).toBeLessThanOrEqual(rank(record.targetLevel));
  }
  const guest = await call('GET', '/api/support/capabilities');
  expect(guest.status).toBe(401);
});
