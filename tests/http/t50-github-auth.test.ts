import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { ChangeProofError, type TenantContext } from '../../src/core/index.js';
import type { AuthDeps } from '../../src/http/routes-auth.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import type { EmailIdentityStore } from '../../src/modules/identity/index.js';
import type { IdentityStore } from '../../src/modules/identity/index.js';
import type { GitHubIdentityDb } from '../../src/modules/identity/index.js';
import type { GitHubOAuthProfile, GitHubOAuthTransport } from '../../src/modules/github/index.js';
import { composeGitHubAuth, composePublicSite, type GitHubAuthComposition } from '../../src/orchestrator/index.js';
import { createMapSecretBroker } from '../../src/modules/github/index.js';

/**
 * GitHub OAuth HTTP proof: the real server over a stub session store, a
 * scripted identity database, and a fake provider transport. No network,
 * no OAuth App — the live round-trip needs authorized credentials and
 * stays blocked. The native suite proves the real V13 functions; this
 * file proves the HTTP contract: 302s, cookies, error codes, and the
 * both-identities linking rule.
 */

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const manifestPath = join(rootDir, 'config', 'publicsite', 'manifest.json');

const CTX: TenantContext = {
  schemaVersion: '1',
  tenantId: 'acme',
  userId: 'user-owner',
  sessionId: 'sess-good',
  role: 'owner',
  projectGrants: [],
  repositoryGrants: [],
  grantVersion: 0,
  expiresAt: '2030-01-01T00:00:00.000Z',
  authoritySource: 'server',
};

function unimplemented(what: string): () => Promise<never> {
  return () => Promise.reject(new ChangeProofError(`${what} is not part of this probe.`));
}

const identityStore: IdentityStore = {
  createTenant: unimplemented('createTenant'),
  createSession: unimplemented('createSession'),
  deriveContext: (input) =>
    input.sessionId === 'sess-good'
      ? Promise.resolve(CTX)
      : Promise.reject(new ChangeProofError('Session is unknown.')),
  revokeSession: unimplemented('revokeSession'),
  revokeUserSessions: unimplemented('revokeUserSessions'),
  createInvitation: unimplemented('createInvitation'),
  acceptInvitation: unimplemented('acceptInvitation'),
  changeMemberRole: unimplemented('changeMemberRole'),
  removeMember: unimplemented('removeMember'),
  deleteTenant: unimplemented('deleteTenant'),
  recordRetention: unimplemented('recordRetention'),
  advancePurge: unimplemented('advancePurge'),
  listMembers: unimplemented('listMembers'),
};

const emailStore: EmailIdentityStore = {
  registerUser: unimplemented('registerUser'),
  resendVerification: unimplemented('resendVerification'),
  verifyEmail: unimplemented('verifyEmail'),
  loginWithPassword: unimplemented('loginWithPassword'),
  requestPasswordReset: unimplemented('requestPasswordReset'),
  resetPassword: unimplemented('resetPassword'),
  claimTenant: unimplemented('claimTenant'),
  listUserSessions: unimplemented('listUserSessions'),
};

interface Scenario {
  links: Map<string, { user_id: string; login: string }>;
  emails: Map<string, string>;
  tenants: Map<string, string[]>;
  profile: GitHubOAuthProfile | Error;
  registered: string[];
}

function scenario(): Scenario {
  return { links: new Map(), emails: new Map(), tenants: new Map(), profile: { githubId: '1001', login: 'octocat', email: 'octo@example.com' }, registered: [] };
}

let current: Scenario = scenario();

/** Indexed probe params: strings only, arity asserted, no unchecked access. */
function str(params: readonly unknown[], index: number): string {
  const value = params[index];
  if (typeof value !== 'string') throw new Error(`probe param ${String(index)} is not a string`);
  return value;
}

const db: GitHubIdentityDb = {
  query: (text: string, params: readonly unknown[] = []) => {
    if (text.includes('lookup_github_link')) {
      const link = current.links.get(String(params[0]));
      return Promise.resolve({ rows: link === undefined ? [] : [link], rowCount: link === undefined ? 0 : 1 });
    }
    if (text.includes('lookup_email_user')) {
      const id = current.emails.get(String(params[0]));
      return Promise.resolve({ rows: id === undefined ? [] : [{ id }], rowCount: id === undefined ? 0 : 1 });
    }
    if (text.includes('list_github_links')) {
      const rows = [...current.links.entries()]
        .filter(([, link]) => link.user_id === String(params[0]))
        .map(([github_id, link]) => ({ github_id, login: link.login }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    if (text.includes('list_user_tenants')) {
      const rows = (current.tenants.get(String(params[0])) ?? []).map((tenant) => ({ list_user_tenants: tenant }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    if (text.includes('register_github_user')) {
      const userId = str(params, 0);
      const email = str(params, 1);
      const githubId = str(params, 3);
      const login = str(params, 4);
      const tenant = str(params, 5);
      if (current.emails.has(email)) return Promise.reject(new Error('duplicate_email'));
      if (current.links.has(githubId)) return Promise.reject(new Error('duplicate_github'));
      current.emails.set(email, userId);
      current.links.set(githubId, { user_id: userId, login });
      current.tenants.set(userId, [tenant]);
      current.registered.push(userId);
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('link_github_identity')) {
      const userId = str(params, 0);
      const githubId = str(params, 1);
      const login = str(params, 2);
      if (![...current.emails.values()].includes(userId)) return Promise.reject(new Error('unknown_email_user'));
      if (current.links.has(githubId)) return Promise.reject(new Error('duplicate_github'));
      current.links.set(githubId, { user_id: userId, login });
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('create_session')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.reject(new Error(`unexpected query: ${text}`));
  },
};

const transport: GitHubOAuthTransport = {
  exchangeCode: (input) => {
    if (input.clientSecret !== 'client-secret-value') return Promise.reject(new Error('wrong broker secret'));
    if (current.profile instanceof Error) return Promise.reject(current.profile);
    return Promise.resolve('gho_fake');
  },
  fetchProfile: () =>
    current.profile instanceof Error ? Promise.reject(current.profile) : Promise.resolve(current.profile),
};

function github(): GitHubAuthComposition {
  return composeGitHubAuth({
    db,
    secrets: createMapSecretBroker(
      new Map([
        ['email-challenge-secret', 'http-probe-challenge-secret-32plus!'],
        ['github-client-secret', 'client-secret-value'],
      ]),
    ),
    clientId: 'Iv1.probeclient',
    redirectUri: 'http://127.0.0.1:4179/api/auth/github/callback',
    clientSecretRef: 'github-client-secret',
    stateSecretRef: 'email-challenge-secret',
    transport,
  });
}

function authDeps(withGithub: boolean): AuthDeps {
  return {
    identity: { store: identityStore, saml: undefined as never, scim: undefined as never, assertNoLastOwnerLockout: () => undefined },
    email: { store: emailStore },
    ...(withGithub ? { github: github() } : {}),
  };
}

let handle: HttpHandle | undefined;
let bare: HttpHandle | undefined;
let base = '';
let bareBase = '';

beforeAll(async () => {
  handle = createHttpServer({ publicSite: composePublicSite(), manifestPath, auth: authDeps(true) });
  await new Promise<void>((resolve) => handle?.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
  base = `http://127.0.0.1:${address.port}`;
  bare = createHttpServer({ publicSite: composePublicSite(), manifestPath, auth: authDeps(false) });
  await new Promise<void>((resolve) => bare?.server.listen(0, '127.0.0.1', resolve));
  const bareAddress = bare.server.address();
  if (typeof bareAddress !== 'object' || bareAddress === null) throw new Error('Bare server did not bind.');
  bareBase = `http://127.0.0.1:${bareAddress.port}`;
});

afterAll(async () => {
  await handle?.close();
  await bare?.close();
});

interface Call {
  readonly status: number;
  readonly location: string | null;
  readonly cookies: readonly string[];
  readonly body: unknown;
}

async function call(method: string, url: string, cookie?: string): Promise<Call> {
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    headers: { ...(cookie === undefined ? {} : { Cookie: cookie }) },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    body = text;
  }
  return { status: response.status, location: response.headers.get('location'), cookies: response.headers.getSetCookie(), body };
}

function cookiePair(setCookie: readonly string[], name: string): string | undefined {
  const hit = setCookie.find((entry) => entry.startsWith(`${name}=`));
  if (hit === undefined) return undefined;
  return hit.split(';')[0];
}

async function startFlow(query = '', cookie?: string, root = base): Promise<Call> {
  return call('GET', `${root}/api/auth/github/start${query}`, cookie);
}

async function startState(query = '', cookie?: string): Promise<{ state: string; nonce: string }> {
  const started = await startFlow(query, cookie);
  expect(started.status).toBe(302);
  const location = new URL(started.location ?? '');
  expect(`${location.origin}${location.pathname}`).toBe('https://github.com/login/oauth/authorize');
  expect(location.searchParams.get('client_id')).toBe('Iv1.probeclient');
  expect(location.searchParams.get('scope')).toBe('read:user user:email');
  const state = location.searchParams.get('state') ?? '';
  expect(state).not.toBe('');
  const nonceCookie = cookiePair(started.cookies, 'cp_oauth') ?? '';
  expect(nonceCookie.startsWith('cp_oauth=')).toBe(true);
  expect(started.cookies.join(';')).toContain('SameSite=Lax');
  return { state, nonce: nonceCookie };
}

test('providers report the real wiring plus the separate App flag', async () => {
  const wired = await call('GET', `${base}/api/auth/providers`);
  expect(wired.status).toBe(200);
  expect((wired.body as { data: unknown }).data).toEqual({ email: true, github: true, githubApp: false });
  const unwired = await call('GET', `${bareBase}/api/auth/providers`);
  expect((unwired.body as { data: unknown }).data).toEqual({ email: true, github: false, githubApp: false });
});

test('unconfigured servers fail closed with a specific error', async () => {
  const started = await call('GET', `${bareBase}/api/auth/github/start`);
  expect(started.status).toBe(503);
  expect(JSON.stringify(started.body)).toContain('github_unavailable');
  const callback = await call('GET', `${bareBase}/api/auth/github/callback?code=x&state=y`);
  expect(callback.status).toBe(302);
  expect(callback.location).toBe('/#/login?githubError=github_unavailable');
});

test('new GitHub users register, verify implicitly, and land in a session', async () => {
  current = scenario();
  const { state, nonce } = await startState('?origin=register');
  const done = await call('GET', `${base}/api/auth/github/callback?code=code-1&state=${encodeURIComponent(state)}`, nonce);
  expect(done.status).toBe(302);
  expect(done.location).toBe('/');
  const session = cookiePair(done.cookies, 'cp_session') ?? '';
  expect(session.startsWith('cp_session=sess-')).toBe(true);
  expect(done.cookies.join(';')).toContain('SameSite=Strict');
  expect(cookiePair(done.cookies, 'cp_oauth')).toBe('cp_oauth=');
  expect(current.registered).toHaveLength(1);
});

test('returning users log in without a second registration', async () => {
  current = scenario();
  current.links.set('1001', { user_id: 'user-1', login: 'octocat' });
  current.emails.set('octo@example.com', 'user-1');
  current.tenants.set('user-1', ['acme']);
  const { state, nonce } = await startState();
  const done = await call('GET', `${base}/api/auth/github/callback?code=code-2&state=${encodeURIComponent(state)}`, nonce);
  expect(done.status).toBe(302);
  expect(done.location).toBe('/');
  expect(cookiePair(done.cookies, 'cp_session')?.startsWith('cp_session=sess-')).toBe(true);
  expect(current.registered).toHaveLength(0);
});

test('a forged state, a missing code, and a nonce mismatch all fail closed', async () => {
  current = scenario();
  const { state, nonce } = await startState();
  const tampered = `${state.slice(0, -1)}${state.endsWith('0') ? '1' : '0'}`;
  const forged = await call('GET', `${base}/api/auth/github/callback?code=c&state=${encodeURIComponent(tampered)}`, nonce);
  expect(forged.location).toBe('/#/login?githubError=state_invalid');
  const noCode = await call('GET', `${base}/api/auth/github/callback?state=${encodeURIComponent(state)}`, nonce);
  expect(noCode.location).toBe('/#/login?githubError=state_invalid');
  const wrongBrowser = await call(
    'GET',
    `${base}/api/auth/github/callback?code=c&state=${encodeURIComponent(state)}`,
    'cp_oauth=attacker-nonce',
  );
  expect(wrongBrowser.location).toBe('/#/login?githubError=state_invalid');
  expect(wrongBrowser.cookies.join(';')).not.toContain('cp_session=');
});

test('denial at GitHub and provider outage map to specific pages', async () => {
  current = scenario();
  const { state, nonce } = await startState('?origin=register');
  const denied = await call(
    'GET',
    `${base}/api/auth/github/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    nonce,
  );
  expect(denied.location).toBe('/#/register?githubError=access_denied');
  current.profile = new Error('Profile fetch: GitHub is unreachable.');
  const outage = await call('GET', `${base}/api/auth/github/callback?code=c&state=${encodeURIComponent(state)}`, nonce);
  expect(outage.location).toBe('/#/register?githubError=provider_error');
});

test('matching emails never auto-link: the password side must come first', async () => {
  current = scenario();
  current.emails.set('octo@example.com', 'user-password');
  current.tenants.set('user-password', ['acme']);
  const { state, nonce } = await startState();
  const done = await call('GET', `${base}/api/auth/github/callback?code=c&state=${encodeURIComponent(state)}`, nonce);
  expect(done.location).toBe('/#/login?githubError=email_taken');
  expect(done.cookies.join(';')).not.toContain('cp_session=sess-');
  expect(current.registered).toHaveLength(0);
  expect(current.links.has('1001')).toBe(false);
});

test('multi-tenant users name their organization instead of landing somewhere', async () => {
  current = scenario();
  current.links.set('1001', { user_id: 'user-1', login: 'octocat' });
  current.emails.set('octo@example.com', 'user-1');
  current.tenants.set('user-1', ['acme', 'globex']);
  const { state, nonce } = await startState();
  const done = await call('GET', `${base}/api/auth/github/callback?code=c&state=${encodeURIComponent(state)}`, nonce);
  expect(done.location).toBe('/#/login?githubError=choose_tenant');
  const hinted = await startState('?tenant=globex');
  const picked = await call(
    'GET',
    `${base}/api/auth/github/callback?code=c&state=${encodeURIComponent(hinted.state)}`,
    hinted.nonce,
  );
  expect(picked.status).toBe(302);
  expect(picked.location).toBe('/');
  expect(cookiePair(picked.cookies, 'cp_session')?.startsWith('cp_session=sess-')).toBe(true);
});

test('evil return targets and modes are refused at the start', async () => {
  const evil = await startFlow('?return=https%3A%2F%2Fevil.example%2F');
  expect(evil.status).toBe(400);
  const mode = await startFlow('?mode=admin');
  expect(mode.status).toBe(400);
  const origin = await startFlow('?origin=console');
  expect(origin.status).toBe(400);
});

test('link mode needs a session, then binds both identities to the account', async () => {
  current = scenario();
  current.emails.set('owner@example.com', 'user-owner');
  const anonymous = await startFlow('?mode=link');
  expect(anonymous.status).toBe(401);
  const { state, nonce } = await startState('?mode=link', 'cp_session=sess-good');
  const done = await call('GET', `${base}/api/auth/github/callback?code=c&state=${encodeURIComponent(state)}`, nonce);
  expect(done.location).toBe('/#/account?githubLinked=1');
  expect(current.links.get('1001')).toEqual({ user_id: 'user-owner', login: 'octocat' });
});

test('linking a profile owned elsewhere fails closed on the account page', async () => {
  current = scenario();
  current.emails.set('owner@example.com', 'user-owner');
  current.links.set('1001', { user_id: 'user-other', login: 'octocat' });
  const { state, nonce } = await startState('?mode=link', 'cp_session=sess-good');
  const done = await call('GET', `${base}/api/auth/github/callback?code=c&state=${encodeURIComponent(state)}`, nonce);
  expect(done.location).toBe('/#/account?githubError=github_taken');
});

test('status reports the authenticated link state, never another user', async () => {
  current = scenario();
  current.links.set('1001', { user_id: 'user-owner', login: 'octocat' });
  const anonymous = await call('GET', `${base}/api/auth/github/status`);
  expect(anonymous.status).toBe(401);
  const linked = await call('GET', `${base}/api/auth/github/status`, 'cp_session=sess-good');
  expect((linked.body as { data: unknown }).data).toEqual({
    configured: true,
    linked: true,
    links: [{ login: 'octocat' }],
  });
  const unwired = await call('GET', `${bareBase}/api/auth/github/status`, 'cp_session=sess-good');
  expect((unwired.body as { data: unknown }).data).toEqual({ configured: false, linked: false, links: [] });
});
