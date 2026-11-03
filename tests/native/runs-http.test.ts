import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';

import type { EmailDeliveryReceipt, EmailMessage } from '../../src/core/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import {
  composeEmailIdentity,
  composeFileEvidence,
  composeIdentityStore,
  composeJobs,
  composeLifecycle,
  composePublicSite,
  composeQueries,
  composeUsage,
  type JobsComposition,
  type LifecycleComposition,
  type UsageComposition,
} from '../../src/orchestrator/index.js';
import { createMapSecretBroker } from '../../src/modules/github/broker.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * T-45 — run-journey HTTP routes over real PostgreSQL + the real server.
 *
 * Native check, reported separately: run with `DATABASE_URL=…` against a
 * disposable PostgreSQL 16 container. Applies V1–V7 + V10 into its own
 * `t_runshttp` database. The account exists through the real
 * register → verify → claim → login flow; repository grants and the
 * entitlement are seeded (no product API owns them yet — recorded
 * backend gaps, never faked journey steps). Worker progress is
 * simulated at the store boundary with the run's real job id.
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

const fileDbUrl = databaseUrlFor(databaseUrl, 't_runshttp');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const sent: EmailMessage[] = [];
const delivery = {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    sent.push(message);
    return Promise.resolve({ messageId: `runs-http-${String(sent.length)}`, acceptedAt: new Date().toISOString() });
  },
};
const secrets = createMapSecretBroker(new Map([['email-challenge-secret', 'runs-http-challenge-secret-32plus!!']]));

const evidenceDir = mkdtempSync(join(tmpdir(), 'cp-runshttp-evidence-'));
const evidence = composeFileEvidence(evidenceDir);
let usage: UsageComposition;
let jobs: JobsComposition;
let lifecycle: LifecycleComposition;
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

async function callBytes(
  method: string,
  path: string,
  cookie?: string,
): Promise<{ status: number; text: string; contentType: string | null }> {
  const headers: Record<string, string> = { 'X-Requested-With': 'ChangeProofUI' };
  if (cookie !== undefined) headers['Cookie'] = cookie;
  const response = await fetch(`${base}${path}`, { method, headers });
  return { status: response.status, text: await response.text(), contentType: response.headers.get('content-type') };
}

function cookieOf(callResult: Call): string {
  const first = callResult.setCookie[0];
  if (first === undefined) throw new Error('Expected a session cookie.');
  return first.split(';')[0] ?? '';
}

function idempotencyKey(seed: string): string {
  return createHash('sha256').update(`runs-http:${seed}`).digest('hex');
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

async function login(email: string, password: string): Promise<string> {
  const logged = await call('POST', '/api/auth/login', { email, password, rememberMe: false });
  expect(logged.status).toBe(200);
  return cookieOf(logged);
}

interface Fixture {
  readonly email: string;
  readonly tenantId: string;
  readonly cookie: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly grantVersion: number;
}

async function seedFixture(tag: string): Promise<Fixture> {
  counter += 1;
  const email = `runshttp-${tag}-${String(counter)}@example.com`;
  const tenantId = `runshttp-${tag}-${String(counter)}`;
  const repositoryId = `repo-${tag}-${String(counter)}`;
  await registerVerifyClaim(email, 'correct-horse-42', tenantId);
  const cookie = await login(email, 'correct-horse-42');
  const created = await call('POST', '/api/projects', { name: `${tag} project` }, cookie);
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
  const session = await call('GET', '/api/auth/session', undefined, cookie);
  const data = (session.body as { data: { grantVersion: number; repositoryGrants: string[] } }).data;
  expect(data.repositoryGrants).toContain(repositoryId);
  return { email, tenantId, cookie, projectId, repositoryId, grantVersion: data.grantVersion };
}

async function saveDraft(fixture: Fixture, intent: string): Promise<{ draftId: string; revision: number }> {
  const saved = await call(
    'POST',
    '/api/drafts',
    { projectId: fixture.projectId, body: { intent, budgetCap: 50 } },
    fixture.cookie,
  );
  expect(saved.status).toBe(201);
  return (saved.body as { data: { draftId: string; revision: number } }).data;
}

function submitBody(fixture: Fixture, draft: { draftId: string; revision: number }, seed: string): Record<string, unknown> {
  return {
    projectId: fixture.projectId,
    repositoryIds: [fixture.repositoryId],
    sourceRefs: ['git:abc1234'],
    intentRef: `intent-${seed}`,
    executionMode: 'real_runtime',
    invariantRefs: [`invariant-${seed}`],
    verificationPlanRef: `plan-${seed}`,
    budgetProfileId: `budget-${seed}`,
    publicationConsent: false,
    idempotencyKey: idempotencyKey(seed),
    expectedGrantVersion: fixture.grantVersion,
    draftId: draft.draftId,
    draftRevision: draft.revision,
    requestedBudget: 50,
  };
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_runshttp');
  for (const name of [
    'V1__identity_tenancy.sql',
    'V2__identity_services.sql',
    'V3__jobs.sql',
    'V4__usage.sql',
    'V5__email_identity.sql',
    'V6__lifecycle.sql',
    'V7__engagement.sql',
    'V10__enterprise.sql',
  ]) {
    await admin.query(migration(name));
  }
  const identity = composeIdentityStore(appPool);
  usage = composeUsage(appPool);
  jobs = composeJobs(appPool);
  lifecycle = composeLifecycle(appPool, {
    identity: identity.store,
    usage: usage.store,
    jobs: jobs.store,
    evidence: evidence.store,
  });
  const queries = composeQueries(appPool, { identity: identity.store, lifecycle: lifecycle.store });
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

test('session exposes the grant version and grant lists the run form needs', async () => {
  const fixture = await seedFixture('grants');
  const session = await call('GET', '/api/auth/session', undefined, fixture.cookie);
  expect(session.body).toMatchObject({
    ok: true,
    data: {
      authenticated: true,
      tenantId: fixture.tenantId,
      grantVersion: fixture.grantVersion,
      projectGrants: [fixture.projectId],
      repositoryGrants: [fixture.repositoryId],
    },
  });
});

test('drafts save revisions and read back exactly; unknown drafts 404 quietly', async () => {
  const fixture = await seedFixture('drafts');
  const first = await saveDraft(fixture, 'restore checkout');
  const second = await call(
    'POST',
    '/api/drafts',
    { projectId: fixture.projectId, draftId: first.draftId, body: { intent: 'restore checkout v2' } },
    fixture.cookie,
  );
  expect((second.body as { data: { revision: number } }).data.revision).toBe(2);
  const read = await call('GET', `/api/drafts/${first.draftId}?revision=1`, undefined, fixture.cookie);
  expect((read.body as { data: { body: { intent: string } } }).data.body.intent).toBe('restore checkout');
  const missing = await call('GET', '/api/drafts/draft-nope', undefined, fixture.cookie);
  expect(missing.status).toBe(404);
  const message = (missing.body as { error: { message: string } }).error.message;
  expect(message).not.toContain(fixture.tenantId);
  expect(message).not.toContain(fixture.projectId);
});

test('submit → queued → submitted event → duplicate key returns the same run', async () => {
  const fixture = await seedFixture('submit');
  const draft = await saveDraft(fixture, 'restore checkout');
  const body = submitBody(fixture, draft, `submit-${fixture.tenantId}`);
  const submitted = await call('POST', '/api/runs', body, fixture.cookie);
  expect(submitted.status).toBe(201);
  const data = (submitted.body as { data: { runId: string; submitDigest: string; duplicate: boolean } }).data;
  expect(data.duplicate).toBe(false);
  expect(data.submitDigest).toMatch(/^[0-9a-f]{64}$/);
  const read = await call('GET', `/api/runs/${data.runId}`, undefined, fixture.cookie);
  expect((read.body as { data: { state: string; version: number } }).data).toMatchObject({
    state: 'queued',
    version: 0,
  });
  const events = await call('GET', `/api/runs/${data.runId}/events?afterSeq=0&limit=10`, undefined, fixture.cookie);
  const page = (events.body as { data: { events: { kind: string }[]; cursor: number } }).data;
  expect(page.events.map((event) => event.kind)).toEqual(['submitted']);
  expect(page.cursor).toBe(1);
  const again = await call('POST', '/api/runs', body, fixture.cookie);
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ data: { runId: data.runId, duplicate: true } });
});

test('stale grants refuse loudly; a bumped membership needs a fresh login', async () => {
  const fixture = await seedFixture('refusals');
  const draft = await saveDraft(fixture, 'restore checkout');
  const stale = await call(
    'POST',
    '/api/runs',
    { ...submitBody(fixture, draft, `stale-${fixture.tenantId}`), expectedGrantVersion: fixture.grantVersion + 99 },
    fixture.cookie,
  );
  expect(stale.status).toBe(400);
  expect((stale.body as { error: { message: string } }).error.message).toMatch(/stale grant/);
  await admin.query('UPDATE memberships SET grant_version = grant_version + 1 WHERE tenant_id = $1', [
    fixture.tenantId,
  ]);
  const dead = await call('GET', '/api/runs/run-nope', undefined, fixture.cookie);
  expect(dead.status).toBe(401);
  const freshCookie = await login(fixture.email, 'correct-horse-42');
  const read = await call('GET', '/api/auth/session', undefined, freshCookie);
  expect((read.body as { data: { grantVersion: number } }).data.grantVersion).toBe(fixture.grantVersion + 1);
});

test('ungranted repos and foreign projects 403, bad keys 400', async () => {
  const fixture = await seedFixture('gates');
  const draft = await saveDraft(fixture, 'restore checkout');
  const ungranted = await call(
    'POST',
    '/api/runs',
    { ...submitBody(fixture, draft, `ungranted-${fixture.tenantId}`), repositoryIds: ['repo-stranger'] },
    fixture.cookie,
  );
  expect(ungranted.status).toBe(403);
  // The store checks the project grant before existence: a foreign
  // id refuses as 403 with a message that discloses nothing.
  const unknownProject = await call(
    'POST',
    '/api/runs',
    { ...submitBody(fixture, draft, `unknownproj-${fixture.tenantId}`), projectId: 'project-nope' },
    fixture.cookie,
  );
  expect(unknownProject.status).toBe(403);
  expect((unknownProject.body as { error: { message: string } }).error.message).toMatch(/not authorized/);
  const badKey = await call('POST', '/api/runs', { ...submitBody(fixture, draft, 'x'), idempotencyKey: 'nope' }, fixture.cookie);
  expect(badKey.status).toBe(400);
});

test('cancel ends a queued run; retry files a new run for the same meaning', async () => {
  const fixture = await seedFixture('cancel');
  const draft = await saveDraft(fixture, 'restore checkout');
  const submitted = await call('POST', '/api/runs', submitBody(fixture, draft, `cancel-${fixture.tenantId}`), fixture.cookie);
  const runId = (submitted.body as { data: { runId: string } }).data.runId;
  const cancelled = await call('POST', `/api/runs/${runId}/cancel`, {}, fixture.cookie);
  expect(cancelled.status).toBe(200);
  expect(cancelled.body).toEqual({ ok: true, data: { state: 'cancelled' } });
  const read = await call('GET', `/api/runs/${runId}`, undefined, fixture.cookie);
  expect((read.body as { data: { state: string; version: number } }).data).toMatchObject({
    state: 'cancelled',
    version: 1,
  });
  const events = await call('GET', `/api/runs/${runId}/events?afterSeq=0&limit=10`, undefined, fixture.cookie);
  expect((events.body as { data: { events: { kind: string }[] } }).data.events.map((event) => event.kind)).toEqual([
    'submitted',
    'cancelled',
  ]);
  const again = await call('POST', `/api/runs/${runId}/cancel`, {}, fixture.cookie);
  expect(again.status).toBe(400);
  const retried = await call(
    'POST',
    `/api/runs/${runId}/retry`,
    { idempotencyKey: idempotencyKey(`retry-${fixture.tenantId}`) },
    fixture.cookie,
  );
  expect(retried.status).toBe(201);
  const retryData = (retried.body as { data: { runId: string; submitDigest: string } }).data;
  expect(retryData.runId).not.toBe(runId);
  expect(retryData.submitDigest).toBe((submitted.body as { data: { submitDigest: string } }).data.submitDigest);
  const early = await call(
    'POST',
    `/api/runs/${retryData.runId}/retry`,
    { idempotencyKey: idempotencyKey(`early-${fixture.tenantId}`) },
    fixture.cookie,
  );
  expect(early.status).toBe(400);
});

test('artifacts download behind the session; tampered bytes and unknown digests refuse', async () => {
  const fixture = await seedFixture('artifact');
  const draft = await saveDraft(fixture, 'restore checkout');
  const submitted = await call(
    'POST',
    '/api/runs',
    submitBody(fixture, draft, `artifact-${fixture.tenantId}`),
    fixture.cookie,
  );
  const runId = (submitted.body as { data: { runId: string } }).data.runId;
  const run = await call('GET', `/api/runs/${runId}`, undefined, fixture.cookie);
  const jobId = (run.body as { data: { jobId: string } }).data.jobId;
  const { digest } = evidence.store.put('genuine-evidence-bytes');
  // Worker simulation at the store boundary: the run's own job id,
  // the tenant fence, the terminal-state guard — all enforced.
  await lifecycle.store.recordRunEvent({
    tenantId: fixture.tenantId,
    jobId,
    runId,
    kind: 'artifact',
    payload: { digest },
    nowIso: new Date().toISOString(),
  });
  const downloaded = await callBytes('GET', `/api/runs/${runId}/artifacts/${digest}`, fixture.cookie);
  expect(downloaded.status).toBe(200);
  expect(downloaded.contentType).toContain('application/octet-stream');
  expect(downloaded.text).toBe('genuine-evidence-bytes');
  const guest = await callBytes('GET', `/api/runs/${runId}/artifacts/${digest}`);
  expect(guest.status).toBe(401);
  const unknown = await callBytes('GET', `/api/runs/${runId}/artifacts/${'b'.repeat(64)}`, fixture.cookie);
  expect(unknown.status).toBe(404);
  writeFileSync(join(evidenceDir, digest), 'forged-bytes');
  const tampered = await callBytes('GET', `/api/runs/${runId}/artifacts/${digest}`, fixture.cookie);
  expect(tampered.status).toBe(400);
});

test('search lists runs and projects inside the tenant fence', async () => {
  const fixture = await seedFixture('search');
  const draft = await saveDraft(fixture, 'restore checkout');
  const submitted = await call(
    'POST',
    '/api/runs',
    submitBody(fixture, draft, `search-${fixture.tenantId}`),
    fixture.cookie,
  );
  const runId = (submitted.body as { data: { runId: string } }).data.runId;
  const runs = await call(
    'POST',
    '/api/search',
    { schemaVersion: '1', scope: 'runs', limit: 20 },
    fixture.cookie,
  );
  expect(runs.status).toBe(200);
  expect((runs.body as { data: { hits: { id: string }[] } }).data.hits.map((hit) => hit.id)).toContain(runId);
  const projects = await call('POST', '/api/search', { schemaVersion: '1', scope: 'projects', limit: 20 }, fixture.cookie);
  expect((projects.body as { data: { hits: { id: string }[] } }).data.hits.map((hit) => hit.id)).toContain(
    fixture.projectId,
  );
  const other = await seedFixture('search-other');
  const fenced = await call('POST', '/api/search', { schemaVersion: '1', scope: 'runs', limit: 20 }, other.cookie);
  expect((fenced.body as { data: { hits: { id: string }[] } }).data.hits.map((hit) => hit.id)).not.toContain(runId);
});

test('viewers read runs but cannot submit (denied, not silent)', async () => {
  const fixture = await seedFixture('viewer');
  counter += 1;
  const viewerEmail = `runshttp-viewer-${String(counter)}@example.com`;
  const viewerTenant = `runshttp-viewerhome-${String(counter)}`;
  await registerVerifyClaim(viewerEmail, 'correct-horse-42', viewerTenant);
  const viewerCookie = await login(viewerEmail, 'correct-horse-42');
  const invited = await call('POST', `/api/orgs/${fixture.tenantId}/invitations`, { role: 'viewer' }, fixture.cookie);
  expect(invited.status).toBe(201);
  const token = (invited.body as { data: { token: string } }).data.token;
  const accepted = await call('POST', '/api/invitations/accept', { token }, viewerCookie);
  expect(accepted.status).toBe(200);
  const draft = await saveDraft(fixture, 'restore checkout');
  const submitted = await call(
    'POST',
    '/api/runs',
    submitBody(fixture, draft, `viewer-${fixture.tenantId}`),
    fixture.cookie,
  );
  const runId = (submitted.body as { data: { runId: string } }).data.runId;
  const viewerCookieOnTenant = cookieOf(
    await call('POST', '/api/auth/login', { email: viewerEmail, password: 'correct-horse-42', rememberMe: false, tenantId: fixture.tenantId }),
  );
  const read = await call('GET', `/api/runs/${runId}`, undefined, viewerCookieOnTenant);
  expect(read.status).toBe(200);
  const denied = await call(
    'POST',
    '/api/runs',
    submitBody(fixture, draft, `viewer-denied-${fixture.tenantId}`),
    viewerCookieOnTenant,
  );
  expect(denied.status).toBe(403);
  expect((denied.body as { error: { message: string } }).error.message).toMatch(/may read but not change/);
});

test('guests get 401 on every runs path they touch', async () => {
  const fixture = await seedFixture('guests');
  const draft = await saveDraft(fixture, 'restore checkout');
  const submitted = await call(
    'POST',
    '/api/runs',
    submitBody(fixture, draft, `guests-${fixture.tenantId}`),
    fixture.cookie,
  );
  const runId = (submitted.body as { data: { runId: string } }).data.runId;
  for (const [method, path, body] of [
    ['POST', '/api/projects', { name: 'x' }],
    ['POST', '/api/drafts', { projectId: fixture.projectId, body: { intent: 'x' } }],
    ['GET', `/api/drafts/${draft.draftId}`, undefined],
    ['POST', '/api/runs', submitBody(fixture, draft, 'guest-x')],
    ['GET', `/api/runs/${runId}`, undefined],
    ['GET', `/api/runs/${runId}/events?afterSeq=0&limit=5`, undefined],
    ['POST', `/api/runs/${runId}/cancel`, {}],
    ['POST', `/api/runs/${runId}/retry`, { idempotencyKey: idempotencyKey('guest-r') }],
    ['POST', '/api/search', { schemaVersion: '1', scope: 'runs', limit: 5 }],
  ] as const) {
    const attempt = await call(method, path, body);
    expect(attempt.status, `${method} ${path}`).toBe(401);
  }
});
