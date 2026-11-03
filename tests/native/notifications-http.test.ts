import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  composeNotifications,
  composePublicSite,
  composeQueries,
  composeUsage,
  type IdentityComposition,
  type NotificationsComposition,
} from '../../src/orchestrator/index.js';
import { createMapSecretBroker } from '../../src/modules/github/broker.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * T-47 — notifications HTTP routes over real PostgreSQL + the real server.
 *
 * Native check, reported separately: run with `DATABASE_URL=…` against a
 * disposable PostgreSQL 16 container. Applies V1/V2/V5/V6/V7 into its own
 * `t_notificationshttp` database. Publishing is simulated at the store
 * boundary (no HTTP publish exists by design); every inbox step goes
 * over HTTP as app_user, so RLS fencing is real.
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

const fileDbUrl = databaseUrlFor(databaseUrl, 't_notificationshttp');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const sent: EmailMessage[] = [];
const delivery = {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    sent.push(message);
    return Promise.resolve({ messageId: `notif-http-${String(sent.length)}`, acceptedAt: new Date().toISOString() });
  },
};
const secrets = createMapSecretBroker(new Map([['email-challenge-secret', 'notif-http-challenge-secret-32plus!']]));

const evidenceDir = mkdtempSync(join(tmpdir(), 'cp-notifhttp-evidence-'));

let identity: IdentityComposition;
let notifications: NotificationsComposition;
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

interface Fixture {
  readonly email: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly cookie: string;
  readonly projectId: string;
  readonly repositoryId: string;
}

async function seedFixture(tag: string): Promise<Fixture> {
  counter += 1;
  const email = `notifhttp-${tag}-${String(counter)}@example.com`;
  const tenantId = `notifhttp-${tag}-${String(counter)}`;
  const repositoryId = `repo-${tag}-${String(counter)}`;
  const registered = await call('POST', '/api/auth/register', { email, password: 'correct-horse-42' });
  expect(registered.status).toBe(201);
  const verified = await call('POST', '/api/auth/verify', { token: tokenFrom('verif') });
  expect(verified.status).toBe(200);
  const ticket = (verified.body as { data: { claimTicket: string } }).data.claimTicket;
  const claimed = await call('POST', '/api/orgs', { tenantId, ticket });
  expect(claimed.status).toBe(201);
  const logged = await call('POST', '/api/auth/login', { email, password: 'correct-horse-42', rememberMe: false });
  expect(logged.status).toBe(200);
  const cookie = cookieOf(logged);
  const created = await call('POST', '/api/projects', { name: `${tag} project` }, cookie);
  expect(created.status).toBe(201);
  const projectId = (created.body as { data: { projectId: string } }).data.projectId;
  await admin.query('INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)', [
    tenantId,
    repositoryId,
    projectId,
  ]);
  const session = await call('GET', '/api/auth/session', undefined, cookie);
  const userId = (session.body as { data: { userId: string } }).data.userId;
  return { email, userId, tenantId, cookie, projectId, repositoryId };
}

async function publish(
  fixture: Fixture,
  eventId: string,
  extra: { category?: string; projectId?: string; repositoryId?: string } = {},
): Promise<string> {
  const done = await notifications.store.publishFromEvent({
    tenantId: fixture.tenantId,
    eventId,
    category: extra.category ?? 'results',
    title: `Event ${eventId}`,
    body: `Body for ${eventId}.`,
    userId: fixture.userId,
    nowIso: new Date().toISOString(),
    ...(extra.projectId === undefined ? {} : { projectId: extra.projectId }),
    ...(extra.repositoryId === undefined ? {} : { repositoryId: extra.repositoryId }),
  });
  expect(done.suppressed).toBe(false);
  return done.notificationId;
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_notificationshttp');
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
  identity = composeIdentityStore(appPool);
  notifications = composeNotifications(appPool, identity.store);
  const usage = composeUsage(appPool);
  const jobs = composeJobs(appPool);
  const lifecycle = composeLifecycle(appPool, {
    identity: identity.store,
    usage: usage.store,
    jobs: jobs.store,
    evidence: composeFileEvidence(evidenceDir).store,
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
    notifications: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      notifications,
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

test('inbox lists, reads, dismisses, and reads-all over HTTP', async () => {
  const fixture = await seedFixture('journey');
  const first = await publish(fixture, `evt-journey-1-${fixture.tenantId}`);
  const second = await publish(fixture, `evt-journey-2-${fixture.tenantId}`);
  const listed = await call('GET', '/api/notifications?limit=20', undefined, fixture.cookie);
  expect(listed.status).toBe(200);
  const data = (listed.body as { data: { items: { notificationId: string }[]; unreadCount: number } }).data;
  expect(data.unreadCount).toBe(2);
  expect(data.items.map((item) => item.notificationId).sort()).toEqual([first, second].sort());
  const read = await call('POST', `/api/notifications/${first}/read`, {}, fixture.cookie);
  expect(read.status).toBe(200);
  const unread = await call('GET', '/api/notifications?limit=20&unreadOnly=true', undefined, fixture.cookie);
  expect((unread.body as { data: { unreadCount: number } }).data.unreadCount).toBe(1);
  const dismissed = await call('POST', `/api/notifications/${second}/dismiss`, {}, fixture.cookie);
  expect(dismissed.status).toBe(200);
  const afterDismiss = await call('GET', '/api/notifications?limit=20', undefined, fixture.cookie);
  expect((afterDismiss.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  const cleared = await call('POST', '/api/notifications/read-all', {}, fixture.cookie);
  expect(cleared.body).toEqual({ ok: true, data: { marked: 0 } });
});

test('guests and unknown ids fail closed', async () => {
  const fixture = await seedFixture('closed');
  await publish(fixture, `evt-closed-1-${fixture.tenantId}`);
  const guest = await call('GET', '/api/notifications?limit=20');
  expect(guest.status).toBe(401);
  const missing = await call('POST', '/api/notifications/notif-missing/read', {}, fixture.cookie);
  expect(missing.status).toBe(404);
  const other = await seedFixture('closed-other');
  const foreign = await publish(other, `evt-closed-2-${other.tenantId}`);
  const crossRead = await call('POST', `/api/notifications/${foreign}/read`, {}, fixture.cookie);
  expect(crossRead.status).toBe(404);
});

test('forged recipients are refused at publish (NEG3-31)', async () => {
  const fixture = await seedFixture('forged');
  await expect(
    notifications.store.publishFromEvent({
      tenantId: fixture.tenantId,
      eventId: `evt-forged-${fixture.tenantId}`,
      category: 'results',
      title: 'Forged',
      body: 'This recipient is not a member.',
      userId: 'user-stranger',
      nowIso: new Date().toISOString(),
    }),
  ).rejects.toThrow('not a member of this tenant');
});

test('lost grants hide the notification, snippet, and count at list time (NEG3-32)', async () => {
  const fixture = await seedFixture('stale');
  await publish(fixture, `evt-stale-plain-${fixture.tenantId}`);
  await publish(fixture, `evt-stale-repo-${fixture.tenantId}`, { repositoryId: fixture.repositoryId });
  const before = await call('GET', '/api/notifications?limit=20', undefined, fixture.cookie);
  expect((before.body as { data: { unreadCount: number } }).data.unreadCount).toBe(2);
  await admin.query('DELETE FROM repository_grants WHERE tenant_id = $1 AND repository_id = $2', [
    fixture.tenantId,
    fixture.repositoryId,
  ]);
  const after = await call('GET', '/api/notifications?limit=20', undefined, fixture.cookie);
  const data = (after.body as { data: { items: unknown[]; unreadCount: number } }).data;
  expect(data.unreadCount).toBe(1);
  expect(data.items).toHaveLength(1);
});

test('muted categories suppress at publish; duplicates collapse', async () => {
  const fixture = await seedFixture('muted');
  const saved = await call('POST', '/api/notification-preferences', { muted: ['quota'] }, fixture.cookie);
  expect(saved.status).toBe(200);
  const suppressed = await notifications.store.publishFromEvent({
    tenantId: fixture.tenantId,
    eventId: `evt-muted-1-${fixture.tenantId}`,
    category: 'quota',
    title: 'Quota note',
    body: 'Muted at publish.',
    userId: fixture.userId,
    nowIso: new Date().toISOString(),
  });
  expect(suppressed.suppressed).toBe(true);
  const eventId = `evt-muted-2-${fixture.tenantId}`;
  const first = await notifications.store.publishFromEvent({
    tenantId: fixture.tenantId,
    eventId,
    category: 'results',
    title: 'Once',
    body: 'First delivery.',
    userId: fixture.userId,
    nowIso: new Date().toISOString(),
  });
  const retry = await notifications.store.publishFromEvent({
    tenantId: fixture.tenantId,
    eventId,
    category: 'results',
    title: 'Once',
    body: 'Second delivery.',
    userId: fixture.userId,
    nowIso: new Date().toISOString(),
  });
  expect(first.duplicate).toBe(false);
  expect(retry.duplicate).toBe(true);
  expect(retry.notificationId).toBe(first.notificationId);
  const listed = await call('GET', '/api/notifications?limit=20', undefined, fixture.cookie);
  expect((listed.body as { data: { unreadCount: number } }).data.unreadCount).toBe(1);
  const current = await call('GET', '/api/notification-preferences', undefined, fixture.cookie);
  expect(current.body).toEqual({
    ok: true,
    data: { schemaVersion: '1', tenantId: fixture.tenantId, userId: fixture.userId, muted: ['quota'] },
  });
});

test('a second tenant sees none of the first tenant inbox (isolation)', async () => {
  const first = await seedFixture('iso-first');
  const second = await seedFixture('iso-second');
  await publish(first, `evt-iso-${first.tenantId}`);
  const listed = await call('GET', '/api/notifications?limit=20', undefined, second.cookie);
  const data = (listed.body as { data: { items: unknown[]; unreadCount: number } }).data;
  expect(data.items).toHaveLength(0);
  expect(data.unreadCount).toBe(0);
});
