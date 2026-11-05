import { describe, expect, it } from 'vitest';

import type { SecretBrokerPort } from '../../src/core/index.js';
import {
  assertAuthorizationCode,
  assertOAuthConfig,
  assertSafeInAppTarget,
  buildAuthorizeUrl,
  completeOAuth,
  createMapSecretBroker,
  mintOAuthState,
  selectVerifiedEmail,
  verifyOAuthState,
  type GitHubOAuthConfig,
  type GitHubOAuthTransport,
} from '../../src/modules/github/index.js';

/**
 * WP3-22 — GitHub OAuth sign-in over broker-held credentials (FR3-29/FR3-30).
 *
 * Pure tests with a fake transport: no network, no OAuth App. They prove
 * the config gate (absolute https redirect outside localhost), the
 * purpose-bound state token (tamper/expiry/mode/origin), the authorize
 * URL, verified-email selection, and specific provider errors without
 * secret leakage. Live sign-in proof needs an authorized OAuth App and
 * stays blocked; the HTTP round-trip is proven with stubs in
 * `tests/http/t50-github-auth.test.ts`.
 */

const SECRET = 'oauth-state-secret-32-chars-minimum!';
const NOW_MS = Date.parse('2026-11-03T00:00:00.000Z');

function config(overrides: Partial<GitHubOAuthConfig> = {}): GitHubOAuthConfig {
  return {
    clientId: 'Iv1.0123456789abcdef',
    redirectUri: 'https://app.example.com/api/auth/github/callback',
    clientSecretRef: 'github-client-secret',
    stateSecretRef: 'github-state-secret',
    ...overrides,
  };
}

function fakeTransport(behavior: {
  token?: string;
  profile?: { githubId: string; login: string; email: string };
  failExchange?: Error;
  failProfile?: Error;
}): { transport: GitHubOAuthTransport; seenSecrets: string[] } {
  const seenSecrets: string[] = [];
  return {
    seenSecrets,
    transport: {
      exchangeCode: (input) => {
        seenSecrets.push(input.clientSecret);
        if (behavior.failExchange !== undefined) return Promise.reject(behavior.failExchange);
        return Promise.resolve(behavior.token ?? 'gho_faketoken');
      },
      fetchProfile: () => {
        if (behavior.failProfile !== undefined) return Promise.reject(behavior.failProfile);
        return Promise.resolve(
          behavior.profile ?? { githubId: '12345', login: 'octocat', email: 'octo@example.com' },
        );
      },
    },
  };
}

describe('OAuth config gate', () => {
  it('accepts a complete https config and a localhost http config', () => {
    expect((): void => { assertOAuthConfig(config()); }).not.toThrow();
    expect((): void => {
      assertOAuthConfig(config({ redirectUri: 'http://127.0.0.1:4179/api/auth/github/callback' }));
    }).not.toThrow();
  });

  it('refuses an empty client id, missing refs, and bad redirects', () => {
    expect((): void => { assertOAuthConfig(config({ clientId: '  ' })); }).toThrow(/client id/i);
    expect((): void => { assertOAuthConfig(config({ clientSecretRef: '' })); }).toThrow(/secret ref/i);
    expect((): void => { assertOAuthConfig(config({ redirectUri: 'not-a-url' })); }).toThrow(/redirect/i);
    expect((): void => { assertOAuthConfig(config({ redirectUri: 'http://app.example.com/callback' })); }).toThrow(/https/);
    expect((): void => { assertOAuthConfig(config({ redirectUri: 'https://user:pw@app.example.com/cb' })); }).toThrow(
      /credentials/i,
    );
  });
});

describe('in-app return targets', () => {
  it('accepts absolute in-app paths and refuses open redirects', () => {
    expect((): void => { assertSafeInAppTarget('/'); }).not.toThrow();
    expect((): void => { assertSafeInAppTarget('/app/runs'); }).not.toThrow();
    for (const evil of ['', 'https://evil.example/', '//evil.example/x', '/\\evil', '/x:y', '/a b', '/a<b']) {
      expect((): void => { assertSafeInAppTarget(evil); }).toThrow(/safe in-app path/);
    }
  });
});

describe('state mint and verify', () => {
  it('round-trips login state with hints intact', () => {
    const state = mintOAuthState({
      mode: 'login',
      nonce: 'nonce-1',
      tenantId: 'acme',
      returnTarget: '/app/runs',
      rememberMe: true,
      origin: 'register',
      nowMs: NOW_MS,
      secret: SECRET,
    });
    expect(verifyOAuthState({ state, nowMs: NOW_MS + 1000, secret: SECRET })).toEqual({
      mode: 'login',
      nonce: 'nonce-1',
      tenantId: 'acme',
      returnTarget: '/app/runs',
      rememberMe: true,
      origin: 'register',
    });
  });

  it('binds link state to the starting session user', () => {
    const state = mintOAuthState({ mode: 'link', nonce: 'nonce-2', userId: 'user-7', nowMs: NOW_MS, secret: SECRET });
    const verified = verifyOAuthState({ state, nowMs: NOW_MS, secret: SECRET });
    expect(verified.mode).toBe('link');
    expect(verified.userId).toBe('user-7');
  });

  it('refuses cross-mode subjects and missing link users at mint', () => {
    expect(() => mintOAuthState({ mode: 'link', nonce: 'n', nowMs: NOW_MS, secret: SECRET })).toThrow(
      /starting session user/i,
    );
    expect(() =>
      mintOAuthState({ mode: 'login', nonce: 'n', userId: 'user-7', nowMs: NOW_MS, secret: SECRET }),
    ).toThrow(/carries no user/i);
  });

  it('refuses tampered, expired, future, and wrong-secret states', () => {
    const state = mintOAuthState({ mode: 'login', nonce: 'nonce-3', nowMs: NOW_MS, secret: SECRET });
    const tampered = `${state.slice(0, -1)}${state.endsWith('0') ? '1' : '0'}`;
    expect(() => verifyOAuthState({ state: tampered, nowMs: NOW_MS, secret: SECRET })).toThrow(/signature/i);
    expect(() => verifyOAuthState({ state: 'v1.broken', nowMs: NOW_MS, secret: SECRET })).toThrow(/malformed/);
    expect(() => verifyOAuthState({ state, nowMs: NOW_MS + 11 * 60_000, secret: SECRET })).toThrow(/expired/);
    expect(() => verifyOAuthState({ state, nowMs: NOW_MS - 1000, secret: SECRET })).toThrow(/future/);
    expect(() => verifyOAuthState({ state, nowMs: NOW_MS, secret: 'wrong-secret' })).toThrow(/signature/i);
    expect(() => verifyOAuthState({ state, nowMs: NOW_MS, secret: '' })).toThrow(/secret is missing/);
  });

  it('refuses an evil return target at mint, never at redirect time', () => {
    expect(() =>
      mintOAuthState({ mode: 'login', nonce: 'n', returnTarget: 'https://evil.example/', nowMs: NOW_MS, secret: SECRET }),
    ).toThrow(/safe in-app path/);
  });
});

describe('authorize URL', () => {
  it('points at GitHub with the least-privilege scope', () => {
    const url = new URL(buildAuthorizeUrl(config(), 'state-opaque'));
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv1.0123456789abcdef');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/auth/github/callback');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toBe('state-opaque');
  });

  it('refuses to build without state or with a bad config', () => {
    expect(() => buildAuthorizeUrl(config(), '')).toThrow(/state is missing/);
    expect(() => buildAuthorizeUrl(config({ clientId: '' }), 's')).toThrow(/client id/i);
  });
});

describe('authorization codes', () => {
  it('accepts bounded opaque codes and refuses blanks and whitespace', () => {
    expect((): void => { assertAuthorizationCode('abc123._-'); }).not.toThrow();
    expect((): void => { assertAuthorizationCode(''); }).toThrow(/malformed/);
    expect((): void => { assertAuthorizationCode('has space'); }).toThrow(/malformed/);
    expect((): void => { assertAuthorizationCode('x'.repeat(501)); }).toThrow(/malformed/);
  });
});

describe('verified email selection', () => {
  it('prefers the primary verified address, else the first verified one', () => {
    expect(
      selectVerifiedEmail([
        { email: 'alt@example.com', verified: true, primary: false },
        { email: 'Primary@Example.com', verified: true, primary: true },
      ]),
    ).toBe('primary@example.com');
    expect(selectVerifiedEmail([{ email: 'Only@Example.com', verified: true, primary: false }])).toBe(
      'only@example.com',
    );
  });

  it('fails closed without a verified address or with an unreadable list', () => {
    expect(() => selectVerifiedEmail([{ email: 'a@example.com', verified: false, primary: true }])).toThrow(
      /no verified email/i,
    );
    expect(() => selectVerifiedEmail([])).toThrow(/no verified email/i);
    expect(() => selectVerifiedEmail([{ nope: true }])).toThrow(/unreadable email list/);
  });
});

describe('code completion', () => {
  function brokerWith(secret: string): { broker: SecretBrokerPort; seen: string[] } {
    const seen: string[] = [];
    const inner = createMapSecretBroker(new Map([['github-client-secret', secret]]));
    return {
      seen,
      broker: { readCredential: async (refId: string): Promise<string> => {
        seen.push(refId);
        return inner.readCredential(refId);
      } },
    };
  }

  it('reads the client secret from the broker and returns the profile', async () => {
    const { broker, seen } = brokerWith('broker-secret-value');
    const { transport, seenSecrets } = fakeTransport({});
    const profile = await completeOAuth({ code: 'code-1', config: config(), secrets: broker, transport });
    expect(profile).toEqual({ githubId: '12345', login: 'octocat', email: 'octo@example.com' });
    expect(seen).toEqual(['github-client-secret']);
    expect(seenSecrets).toEqual(['broker-secret-value']);
  });

  it('fails closed on unknown secret refs without leaking the value', async () => {
    const broker = createMapSecretBroker(new Map());
    const { transport } = fakeTransport({});
    const failure = await completeOAuth({ code: 'code-1', config: config(), secrets: broker, transport }).then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : 'non-error'),
    );
    expect(failure).toMatch(/unknown or missing/);
    expect(failure).not.toContain('broker-secret-value');
  });

  it('propagates transport failures without wrapping them in success', async () => {
    const { broker } = brokerWith('s');
    const { transport } = fakeTransport({ failExchange: new Error('Code exchange: GitHub refused the request.') });
    await expect(completeOAuth({ code: 'code-1', config: config(), secrets: broker, transport })).rejects.toThrow(
      /refused/,
    );
  });

  it('refuses malformed codes before touching the broker', async () => {
    const { broker, seen } = brokerWith('s');
    const { transport } = fakeTransport({});
    await expect(completeOAuth({ code: '', config: config(), secrets: broker, transport })).rejects.toThrow(/malformed/);
    expect(seen).toEqual([]);
  });
});
