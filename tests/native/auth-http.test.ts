import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';

import type { EmailDeliveryReceipt, EmailMessage } from '../../src/core/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import { composeEmailIdentity, composeIdentityStore } from '../../src/orchestrator/index.js';
import { createMapSecretBroker } from '../../src/modules/github/broker.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * T-44 — auth/organization HTTP routes over real PostgreSQL + the real
 * server (FR3-29/38, NEG3-21/29/30).
 *
 * Native check, reported separately: run with `DATABASE_URL=…` against a
 * disposable PostgreSQL 16 container. Applies V1 + V2 + V5 + V10 into
 * its own `t_authhttp` database (V10 carries memberships.status, which
 * deriveContext reads). Delivery is an in-memory recorder at the port
 * boundary (real SMTP delivery is proven by E2E Mailpit runs, and the
 * T-18 native suite); every flow here uses the captured single-use
 * tokens, never fabricated ones.
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

const fileDbUrl = databaseUrlFor(databaseUrl, 't_authhttp');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const sent: EmailMessage[] = [];
const delivery = {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    sent.push(message);
    return Promise.resolve({ messageId: `auth-http-${String(sent.length)}`, acceptedAt: new Date().toISOString() });
  },
};
const secrets = createMapSecretBroker(new Map([['email-challenge-secret', 'auth-http-challenge-secret-32plus!']]));

let handle: HttpHandle | undefined;
let base = '';
let counter = 0;

function uniqueEmail(): string {
  counter += 1;
  return `authhttp${String(counter)}@example.com`;
}

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

async function registerVerifyClaim(email: string, password: string, tenantId: string): Promise<void> {
  const registered = await call('POST', '/api/auth/register', { email, password });
  expect(registered.status).toBe(201);
  const verified = await call('POST', '/api/auth/verify', { token: tokenFrom('verif') });
  expect(verified.status).toBe(200);
  const ticket = (verified.body as { data: { claimTicket: string } }).data.claimTicket;
  const claimed = await call('POST', '/api/orgs', { tenantId, ticket });
  expect(claimed.status).toBe(201);
}

async function login(email: string, password: string, extra?: Record<string, unknown>): Promise<Call> {
  return call('POST', '/api/auth/login', { email, password, rememberMe: false, ...(extra ?? {}) });
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_authhttp');
  await admin.query(migration('V1__identity_tenancy.sql'));
  await admin.query(migration('V2__identity_services.sql'));
  await admin.query(migration('V5__email_identity.sql'));
  await admin.query(migration('V10__enterprise.sql'));
  const { composePublicSite } = await import('../../src/orchestrator/index.js');
  handle = createHttpServer({
    publicSite: composePublicSite(),
    manifestPath: join(rootDir, 'config', 'publicsite', 'manifest.json'),
    auth: {
      identity: composeIdentityStore(appPool),
      email: composeEmailIdentity(appPool, { delivery, secrets, challengeSecretRef: 'email-challenge-secret' }),
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
});

test('register → verify → claim → login → session reads back', async () => {
  const email = uniqueEmail();
  await registerVerifyClaim(email, 'correct-horse-42', 'acme-http');
  const logged = await login(email, 'correct-horse-42');
  expect(logged.status).toBe(200);
  const cookie = cookieOf(logged);
  expect(cookie.startsWith('cp_session=')).toBe(true);
  const session = await call('GET', '/api/auth/session', undefined, cookie);
  expect(session.status).toBe(200);
  expect(session.body).toMatchObject({ ok: true, data: { authenticated: true, tenantId: 'acme-http', role: 'owner' } });
});

test('wrong password and unknown user share one message (NEG3-30)', async () => {
  const email = uniqueEmail();
  await registerVerifyClaim(email, 'correct-horse-42', 'acme-neg30');
  const wrong = await login(email, 'wrong-password-1');
  const unknown = await login(uniqueEmail(), 'wrong-password-1');
  expect(wrong.status).toBe(400);
  expect(unknown.status).toBe(400);
  const wrongBody = wrong.body as { error: { code: string; message: string } };
  const unknownBody = unknown.body as { error: { code: string; message: string } };
  expect(wrongBody.error).toEqual(unknownBody.error);
});

test('forged return targets are refused server-side (NEG3-29)', async () => {
  const email = uniqueEmail();
  await registerVerifyClaim(email, 'correct-horse-42', 'acme-neg29');
  for (const target of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)', '/app\\x']) {
    const attempt = await login(email, 'correct-horse-42', { returnTarget: target });
    expect(attempt.status, target).toBe(400);
  }
  const valid = await login(email, 'correct-horse-42', { returnTarget: '/app/projects/new' });
  expect(valid.status).toBe(200);
});

test('cross-tenant paths 404 without disclosure (NEG3-21)', async () => {
  const email = uniqueEmail();
  await registerVerifyClaim(email, 'correct-horse-42', 'acme-mine');
  const cookie = cookieOf(await login(email, 'correct-horse-42'));
  const forged = await call('POST', '/api/orgs/acme-yours/invitations', { role: 'member' }, cookie);
  expect(forged.status).toBe(404);
  const deleted = await call('DELETE', '/api/orgs/acme-yours', { reason: 'x' }, cookie);
  expect(deleted.status).toBe(404);
});

test('missing and revoked sessions 401; logout is idempotent', async () => {
  const none = await call('GET', '/api/auth/sessions');
  expect(none.status).toBe(401);
  expect((none.body as { error: { code: string } }).error.code).toBe('session_required');

  const email = uniqueEmail();
  await registerVerifyClaim(email, 'correct-horse-42', 'acme-logout');
  const cookie = cookieOf(await login(email, 'correct-horse-42'));
  const list = await call('GET', '/api/auth/sessions', undefined, cookie);
  expect(list.status).toBe(200);
  const sessions = (list.body as { data: readonly { current: boolean }[] }).data;
  expect(sessions.some((session) => session.current)).toBe(true);

  const out = await call('POST', '/api/auth/logout', {}, cookie);
  expect(out.status).toBe(200);
  const after = await call('GET', '/api/auth/sessions', undefined, cookie);
  expect(after.status).toBe(401);
  const again = await call('POST', '/api/auth/logout', {}, cookie);
  expect(again.status).toBe(200);
});

test('foreign session ids cannot be revoked (NEG3-21)', async () => {
  const first = uniqueEmail();
  const second = uniqueEmail();
  await registerVerifyClaim(first, 'correct-horse-42', 'acme-first');
  await registerVerifyClaim(second, 'correct-horse-42', 'acme-second');
  const cookieFirst = cookieOf(await login(first, 'correct-horse-42'));
  const cookieSecond = cookieOf(await login(second, 'correct-horse-42'));
  const list = await call('GET', '/api/auth/sessions', undefined, cookieSecond);
  const victim = (list.body as { data: readonly { sessionId: string }[] }).data[0]?.sessionId ?? '';
  const attempt = await call('DELETE', `/api/auth/sessions/${victim}`, undefined, cookieFirst);
  expect(attempt.status).toBe(404);
  const stillThere = await call('GET', '/api/auth/sessions', undefined, cookieSecond);
  expect(stillThere.status).toBe(200);
});

test('reset tokens are single-use; unknown addresses match shape (NEG3-30)', async () => {
  const email = uniqueEmail();
  await registerVerifyClaim(email, 'correct-horse-42', 'acme-reset');
  const forgot = await call('POST', '/api/auth/password/forgot', { email });
  expect(forgot.status).toBe(200);
  const unknownForgot = await call('POST', '/api/auth/password/forgot', { email: uniqueEmail() });
  expect(unknownForgot.status).toBe(forgot.status);
  expect(unknownForgot.body).toEqual(forgot.body);

  const token = tokenFrom('reset');
  const reset = await call('POST', '/api/auth/password/reset', { token, newPassword: 'new-correct-horse-43' });
  expect(reset.status).toBe(200);
  const replay = await call('POST', '/api/auth/password/reset', { token, newPassword: 'another-horse-44' });
  expect(replay.status).toBe(400);
  const relogin = await login(email, 'new-correct-horse-43');
  expect(relogin.status).toBe(200);
});

test('invite → accept → member login; viewer cannot invite; member cannot delete', async () => {
  const ownerEmail = uniqueEmail();
  await registerVerifyClaim(ownerEmail, 'correct-horse-42', 'acme-invite');
  const ownerCookie = cookieOf(await login(ownerEmail, 'correct-horse-42'));

  const invited = await call('POST', '/api/orgs/acme-invite/invitations', { role: 'member' }, ownerCookie);
  expect(invited.status).toBe(201);
  const token = (invited.body as { data: { token: string } }).data.token;

  const memberEmail = uniqueEmail();
  await registerVerifyClaim(memberEmail, 'correct-horse-42', 'acme-member-home');
  const memberCookie = cookieOf(await login(memberEmail, 'correct-horse-42'));

  const accepted = await call('POST', '/api/invitations/accept', { token }, memberCookie);
  expect(accepted.status).toBe(200);
  expect(accepted.body).toMatchObject({ ok: true, data: { tenantId: 'acme-invite', role: 'member' } });

  const replay = await call('POST', '/api/invitations/accept', { token }, memberCookie);
  expect(replay.status).toBe(400);

  const memberLogin = await login(memberEmail, 'correct-horse-42', { tenantId: 'acme-invite' });
  expect(memberLogin.status).toBe(200);
  const memberSession = await call('GET', '/api/auth/session', undefined, cookieOf(memberLogin));
  expect(memberSession.body).toMatchObject({ ok: true, data: { tenantId: 'acme-invite', role: 'member' } });

  const viewerInvite = await call(
    'POST',
    '/api/orgs/acme-invite/invitations',
    { role: 'viewer' },
    cookieOf(memberLogin),
  );
  expect(viewerInvite.status).toBe(400);

  const memberDelete = await call('DELETE', '/api/orgs/acme-invite', { reason: 'takeover' }, cookieOf(memberLogin));
  expect(memberDelete.status).toBe(400);
});

test('owner deletes the organization; the fence admits nothing new', async () => {
  const email = uniqueEmail();
  await registerVerifyClaim(email, 'correct-horse-42', 'acme-doomed');
  const cookie = cookieOf(await login(email, 'correct-horse-42'));
  const deleted = await call('DELETE', '/api/orgs/acme-doomed', { reason: 'e2e cleanup' }, cookie);
  expect(deleted.status).toBe(200);
  const relogin = await login(email, 'correct-horse-42');
  expect(relogin.status).toBe(400);
});

test('member role change and removal work over the API', async () => {
  const ownerEmail = uniqueEmail();
  await registerVerifyClaim(ownerEmail, 'correct-horse-42', 'acme-roles');
  const ownerCookie = cookieOf(await login(ownerEmail, 'correct-horse-42'));
  const invited = await call('POST', '/api/orgs/acme-roles/invitations', { role: 'viewer' }, ownerCookie);
  const token = (invited.body as { data: { token: string } }).data.token;

  const memberEmail = uniqueEmail();
  await registerVerifyClaim(memberEmail, 'correct-horse-42', 'acme-roles-home');
  const memberCookie = cookieOf(await login(memberEmail, 'correct-horse-42'));
  await call('POST', '/api/invitations/accept', { token }, memberCookie);
  const memberSession = await call('GET', '/api/auth/session', undefined, memberCookie);
  const memberId = (memberSession.body as { data: { userId: string } }).data.userId;

  const promoted = await call('PATCH', '/api/orgs/acme-roles/members', { userId: memberId, role: 'admin' }, ownerCookie);
  expect(promoted.status).toBe(200);
  const removed = await call('DELETE', `/api/orgs/acme-roles/members/${memberId}`, undefined, ownerCookie);
  expect(removed.status).toBe(200);
});

test('servers without a database refuse account calls explicitly', async () => {
  const { composePublicSite } = await import('../../src/orchestrator/index.js');
  const bare = createHttpServer({
    publicSite: composePublicSite(),
    manifestPath: join(rootDir, 'config', 'publicsite', 'manifest.json'),
  });
  await new Promise<void>((resolve) => bare.server.listen(0, '127.0.0.1', resolve));
  try {
    const address = bare.server.address();
    if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/session`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('auth_unavailable');
  } finally {
    await bare.close();
  }
});
