import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';

import type { GitHubOAuthProfile, GitHubOAuthTransport } from '../../src/modules/github/index.js';
import { createMapSecretBroker } from '../../src/modules/github/broker.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import { composeEmailIdentity, composeGitHubAuth, composeIdentityStore } from '../../src/orchestrator/index.js';
import type { EmailDeliveryReceipt, EmailMessage } from '../../src/core/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * GitHub OAuth over real PostgreSQL + the real server (FR3-29/FR3-38).
 *
 * Native check, reported separately: run with `DATABASE_URL=…` against a
 * disposable PostgreSQL 16 container. Applies V1 + V2 + V5 + V10 + V13
 * into its own `t_githubauth` database. The provider transport is a fake
 * at the port boundary (no OAuth App credentials in tests); every
 * database effect here — registration, link, session, tenant — is real,
 * and the live GitHub round-trip stays blocked until the operator
 * authorizes an OAuth App.
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

const fileDbUrl = databaseUrlFor(databaseUrl, 't_githubauth');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const sent: EmailMessage[] = [];
const delivery = {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    sent.push(message);
    return Promise.resolve({ messageId: `github-auth-${String(sent.length)}`, acceptedAt: new Date().toISOString() });
  },
};
const secrets = createMapSecretBroker(
  new Map([
    ['email-challenge-secret', 'github-auth-challenge-secret-32plus!'],
    ['github-client-secret', 'github-auth-client-secret'],
  ]),
);

let profile: GitHubOAuthProfile = { githubId: '424242', login: 'octocat', email: 'octo-native@example.com' };
const transport: GitHubOAuthTransport = {
  exchangeCode: () => Promise.resolve('gho_native_fake'),
  fetchProfile: () => Promise.resolve(profile),
};

let handle: HttpHandle | undefined;
let base = '';

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_githubauth');
  await admin.query(migration('V1__identity_tenancy.sql'));
  await admin.query(migration('V2__identity_services.sql'));
  await admin.query(migration('V5__email_identity.sql'));
  await admin.query(migration('V10__enterprise.sql'));
  await admin.query(migration('V13__github_identity.sql'));
  const { composePublicSite } = await import('../../src/orchestrator/index.js');
  handle = createHttpServer({
    publicSite: composePublicSite(),
    manifestPath: join(rootDir, 'config', 'publicsite', 'manifest.json'),
    auth: {
      identity: composeIdentityStore(appPool),
      email: composeEmailIdentity(appPool, { delivery, secrets, challengeSecretRef: 'email-challenge-secret' }),
      github: composeGitHubAuth({
        db: appPool,
        secrets,
        clientId: 'Iv1.nativeprobe',
        redirectUri: 'http://127.0.0.1:4179/api/auth/github/callback',
        clientSecretRef: 'github-client-secret',
        stateSecretRef: 'email-challenge-secret',
        transport,
      }),
    },
  });
  await new Promise<void>((resolve) => handle?.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
  base = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await handle?.close();
  await appPool.end();
  await admin.end();
});

interface Call {
  readonly status: number;
  readonly location: string | null;
  readonly cookies: readonly string[];
}

async function call(path: string, cookie?: string): Promise<Call> {
  const response = await fetch(`${base}${path}`, {
    method: 'GET',
    redirect: 'manual',
    headers: { ...(cookie === undefined ? {} : { Cookie: cookie }) },
  });
  await response.text();
  return { status: response.status, location: response.headers.get('location'), cookies: response.headers.getSetCookie() };
}

function cookiePair(setCookie: readonly string[], name: string): string | undefined {
  const hit = setCookie.find((entry) => entry.startsWith(`${name}=`));
  if (hit === undefined) return undefined;
  return hit.split(';')[0];
}

async function roundTrip(startQuery: string, sessionCookie?: string): Promise<Call> {
  const started = await call(`/api/auth/github/start${startQuery}`, sessionCookie);
  expect(started.status).toBe(302);
  const state = new URL(started.location ?? '').searchParams.get('state') ?? '';
  expect(state).not.toBe('');
  const nonce = cookiePair(started.cookies, 'cp_oauth') ?? '';
  expect(nonce.startsWith('cp_oauth=')).toBe(true);
  return call(`/api/auth/github/callback?code=native-code&state=${encodeURIComponent(state)}`, nonce);
}

test('native registration creates a verified user, link, tenant, and session', async () => {
  profile = { githubId: '424242', login: 'octocat', email: 'octo-native@example.com' };
  const done = await roundTrip('?origin=register');
  expect(done.status).toBe(302);
  expect(done.location).toBe('/');
  const session = cookiePair(done.cookies, 'cp_session') ?? '';
  expect(session.startsWith('cp_session=sess-')).toBe(true);
  const user = await admin.query(`SELECT id, email, verified_at FROM email_users WHERE email = $1`, ['octo-native@example.com']);
  expect(user.rows).toHaveLength(1);
  expect((user.rows[0] as { verified_at: Date }).verified_at).toBeInstanceOf(Date);
  const link = await admin.query(`SELECT user_id, login FROM github_identities WHERE github_id = $1`, ['424242']);
  expect(link.rows).toHaveLength(1);
  // The session authorizes downstream reads: the account is real.
  const me = await fetch(`${base}/api/auth/session`, { headers: { Cookie: session } });
  const envelope = (await me.json()) as { data: { authenticated: boolean; tenantId: string } };
  expect(envelope.data.authenticated).toBe(true);
  expect(envelope.data.tenantId.startsWith('gh-octocat-')).toBe(true);
});

test('native password accounts never auto-link on a matching email', async () => {
  const registered = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI' },
    body: JSON.stringify({ email: 'taken-native@example.com', password: 'long-enough-password' }),
  });
  expect(registered.status).toBe(201);
  profile = { githubId: '565656', login: 'hubot', email: 'taken-native@example.com' };
  const done = await roundTrip('');
  expect(done.location).toBe('/#/login?githubError=email_taken');
  const link = await admin.query(`SELECT user_id FROM github_identities WHERE github_id = $1`, ['565656']);
  expect(link.rows).toHaveLength(0);
});
