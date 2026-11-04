import { describe, expect, it } from 'vitest';

import {
  createGitHubIdentityStore,
  derivePersonalTenantId,
  GITHUB_ONLY_PASSWORD_MARKER_PREFIX,
  type GitHubIdentityDb,
} from '../../src/modules/identity/index.js';
import { verifyPassword } from '../../src/modules/identity/index.js';

/**
 * WP3-28/WP3-22 — GitHub identity store over a stub database (FR3-29/FR3-38).
 *
 * The stub answers the V13 exact-match functions with scripted rows; it
 * proves link lookup, collision mapping (email/link/tenant), personal
 * tenant derivation, session tenant selection, and the unusable-password
 * marker. Durable behavior is proven natively in
 * `tests/native/github-auth.test.ts`, not here.
 */

const NOW_ISO = '2026-11-03T00:00:00.000Z';

interface StubState {
  links: Map<string, { user_id: string; login: string }>;
  emails: Map<string, string>;
  tenants: Map<string, string[]>;
  fenced: Set<string>;
  failTenantOnce: boolean;
  registered: { userId: string; email: string; hash: string; githubId: string; login: string; tenant: string }[];
}

/** Indexed probe params: strings only, arity asserted, no unchecked access. */
function str(params: readonly unknown[], index: number): string {
  const value = params[index];
  if (typeof value !== 'string') throw new Error(`probe param ${String(index)} is not a string`);
  return value;
}

function stubDb(state: StubState): GitHubIdentityDb & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    query: (text: string, params: readonly unknown[] = []) => {
      calls.push(text);
      if (text.includes('lookup_github_link')) {
        const link = state.links.get(String(params[0]));
        return Promise.resolve({ rows: link === undefined ? [] : [link], rowCount: link === undefined ? 0 : 1 });
      }
      if (text.includes('lookup_email_user')) {
        const id = state.emails.get(String(params[0]));
        return Promise.resolve({ rows: id === undefined ? [] : [{ id }], rowCount: id === undefined ? 0 : 1 });
      }
      if (text.includes('list_github_links')) {
        const rows = [...state.links.entries()]
          .filter(([, link]) => link.user_id === String(params[0]))
          .map(([github_id, link]) => ({ github_id, login: link.login }));
        return Promise.resolve({ rows, rowCount: rows.length });
      }
      if (text.includes('list_user_tenants')) {
        const rows = (state.tenants.get(String(params[0])) ?? []).map((tenant) => ({ list_user_tenants: tenant }));
        return Promise.resolve({ rows, rowCount: rows.length });
      }
      if (text.includes('register_github_user')) {
        const userId = str(params, 0);
        const email = str(params, 1);
        const hash = str(params, 2);
        const githubId = str(params, 3);
        const login = str(params, 4);
        const tenant = str(params, 5);
        if (state.emails.has(email)) return Promise.reject(new Error('duplicate_email'));
        if (state.links.has(githubId)) return Promise.reject(new Error('duplicate_github'));
        if (state.failTenantOnce) {
          state.failTenantOnce = false;
          return Promise.reject(new Error('duplicate_tenant'));
        }
        state.emails.set(email, userId);
        state.links.set(githubId, { user_id: userId, login });
        state.tenants.set(userId, [tenant]);
        state.registered.push({ userId, email, hash, githubId, login, tenant });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('link_github_identity')) {
        const userId = str(params, 0);
        const githubId = str(params, 1);
        const login = str(params, 2);
        if (![...state.emails.values()].includes(userId)) return Promise.reject(new Error('unknown_email_user'));
        if (state.links.has(githubId)) return Promise.reject(new Error('duplicate_github'));
        state.links.set(githubId, { user_id: userId, login });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('create_session')) {
        const tenant = str(params, 1);
        if (state.fenced.has(tenant)) return Promise.reject(new Error('tenant_fenced'));
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.reject(new Error(`unexpected query: ${text}`));
    },
  };
}

function freshState(): StubState {
  return { links: new Map(), emails: new Map(), tenants: new Map(), fenced: new Set(), failTenantOnce: false, registered: [] };
}

describe('link and email lookup', () => {
  it('finds links by provider id and users by normalized email', async () => {
    const state = freshState();
    state.links.set('123', { user_id: 'user-1', login: 'octocat' });
    state.emails.set('a@example.com', 'user-2');
    const store = createGitHubIdentityStore(stubDb(state));
    expect(await store.findLinkByGitHubId('123')).toEqual({ userId: 'user-1', login: 'octocat' });
    expect(await store.findLinkByGitHubId('999')).toBeNull();
    expect(await store.findUserIdByEmail('A@Example.com')).toBe('user-2');
    expect(await store.findUserIdByEmail('nobody@example.com')).toBeNull();
  });

  it('lists one user links without leaking other users', async () => {
    const state = freshState();
    state.links.set('1', { user_id: 'user-1', login: 'octocat' });
    state.links.set('2', { user_id: 'user-2', login: 'hubot' });
    const store = createGitHubIdentityStore(stubDb(state));
    expect(await store.listLinksByUser('user-1')).toEqual([{ githubId: '1', login: 'octocat' }]);
  });

  it('refuses malformed provider ids and emails before any query', async () => {
    const db = stubDb(freshState());
    const store = createGitHubIdentityStore(db);
    await expect(store.findLinkByGitHubId('abc')).rejects.toThrow(/malformed/);
    await expect(store.findUserIdByEmail('not-an-email')).rejects.toThrow(/malformed/);
    expect(db.calls).toEqual([]);
  });
});

describe('registration', () => {
  it('registers a verified user with an unusable password and a personal tenant', async () => {
    const state = freshState();
    const store = createGitHubIdentityStore(stubDb(state));
    const { userId, tenantId } = await store.registerGitHubUser({
      email: 'Octo@Example.com',
      githubId: '12345',
      login: 'octocat',
      nowIso: NOW_ISO,
    });
    expect(userId).toMatch(/^emailuser-/);
    expect(tenantId).toMatch(/^gh-octocat-/);
    const row = state.registered[0];
    expect(row?.email).toBe('octo@example.com');
    expect(row?.hash.startsWith(GITHUB_ONLY_PASSWORD_MARKER_PREFIX)).toBe(true);
    // The marker is not a password: verification reads it as false, never access.
    expect(await verifyPassword('anything-at-all-12', row?.hash ?? '')).toBe(false);
    expect(await store.findLinkByGitHubId('12345')).toEqual({ userId, login: 'octocat' });
  });

  it('maps email and link collisions to the link path, never a second account', async () => {
    const state = freshState();
    state.emails.set('taken@example.com', 'user-old');
    state.links.set('777', { user_id: 'user-other', login: 'hubot' });
    const store = createGitHubIdentityStore(stubDb(state));
    await expect(
      store.registerGitHubUser({ email: 'taken@example.com', githubId: '888', login: 'new', nowIso: NOW_ISO }),
    ).rejects.toThrow(/already has a password account/);
    await expect(
      store.registerGitHubUser({ email: 'fresh@example.com', githubId: '777', login: 'new', nowIso: NOW_ISO }),
    ).rejects.toThrow(/already linked to a different user/);
    expect(state.registered).toEqual([]);
  });

  it('retries a collided tenant id with fresh randomness, bounded', async () => {
    const state = freshState();
    state.failTenantOnce = true;
    const store = createGitHubIdentityStore(stubDb(state));
    const { tenantId } = await store.registerGitHubUser({
      email: 'fresh@example.com',
      githubId: '999',
      login: 'octocat',
      nowIso: NOW_ISO,
    });
    expect(tenantId).toMatch(/^gh-octocat-/);
    expect(state.registered).toHaveLength(1);
  });

  it('derives Id-shaped tenants from hostile logins', () => {
    expect(derivePersonalTenantId('Octo_Cat!', 'a1b2c3d4')).toMatch(/^gh-octo_cat--[a-f0-9]+$/);
    expect(derivePersonalTenantId('!!!', 'a1b2c3d4')).toBe('gh-a1b2c3d4');
  });
});

describe('linking', () => {
  it('links a proven profile and refuses double-links and unknown users', async () => {
    const state = freshState();
    state.emails.set('a@example.com', 'user-1');
    state.links.set('777', { user_id: 'user-9', login: 'hubot' });
    const store = createGitHubIdentityStore(stubDb(state));
    await store.linkGitHubIdentity({ userId: 'user-1', githubId: '555', login: 'octocat', nowIso: NOW_ISO });
    expect(await store.findLinkByGitHubId('555')).toEqual({ userId: 'user-1', login: 'octocat' });
    await expect(
      store.linkGitHubIdentity({ userId: 'user-1', githubId: '777', login: 'x', nowIso: NOW_ISO }),
    ).rejects.toThrow(/already linked to a different user/);
    await expect(
      store.linkGitHubIdentity({ userId: 'ghost', githubId: '556', login: 'x', nowIso: NOW_ISO }),
    ).rejects.toThrow(/unknown/);
  });
});

describe('session issue', () => {
  it('issues sessions for single-tenant users and honors remember-me lifetimes', async () => {
    const state = freshState();
    state.tenants.set('user-1', ['acme']);
    const store = createGitHubIdentityStore(stubDb(state));
    const short = await store.loginWithGitHub({ userId: 'user-1', rememberMe: false, nowIso: NOW_ISO });
    expect(short.tenantId).toBe('acme');
    expect(short.sessionId).toMatch(/^sess-/);
    expect(Date.parse(short.expiresAt) - Date.parse(NOW_ISO)).toBe(12 * 3_600_000);
    const long = await store.loginWithGitHub({ userId: 'user-1', rememberMe: true, nowIso: NOW_ISO });
    expect(Date.parse(long.expiresAt) - Date.parse(NOW_ISO)).toBe(30 * 24 * 3_600_000);
  });

  it('selects tenants explicitly and never guesses across organizations', async () => {
    const state = freshState();
    state.tenants.set('user-1', ['acme', 'globex']);
    const store = createGitHubIdentityStore(stubDb(state));
    await expect(store.loginWithGitHub({ userId: 'user-1', rememberMe: false, nowIso: NOW_ISO })).rejects.toThrow(
      /Several organizations/,
    );
    await expect(
      store.loginWithGitHub({ userId: 'user-1', tenantId: 'evil', rememberMe: false, nowIso: NOW_ISO }),
    ).rejects.toThrow(/No membership/);
    const picked = await store.loginWithGitHub({ userId: 'user-1', tenantId: 'globex', rememberMe: false, nowIso: NOW_ISO });
    expect(picked.tenantId).toBe('globex');
  });

  it('withholds sessions without tenants, on fenced tenants, and on evil returns', async () => {
    const state = freshState();
    state.tenants.set('lonely', []);
    state.tenants.set('fenced-user', ['gone']);
    state.fenced.add('gone');
    const store = createGitHubIdentityStore(stubDb(state));
    await expect(store.loginWithGitHub({ userId: 'lonely', rememberMe: false, nowIso: NOW_ISO })).rejects.toThrow(
      /No organization yet/,
    );
    await expect(store.loginWithGitHub({ userId: 'fenced-user', rememberMe: false, nowIso: NOW_ISO })).rejects.toThrow(
      /deletion fence/,
    );
    await expect(
      store.loginWithGitHub({ userId: 'lonely', rememberMe: false, returnTarget: 'https://evil.example/', nowIso: NOW_ISO }),
    ).rejects.toThrow(/safe in-app path/);
  });
});
