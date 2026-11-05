import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { GITHUB_API_BASE, exchangeInstallationToken, mintAppJwt } from '../../src/modules/github/app-token.js';

/**
 * GitHub App token minting (installation connect flow).
 *
 * The server holds the App private key behind the broker and mints
 * short-lived installation tokens on demand; tokens are never stored and
 * never appear in errors. All network here is faked; the live exchange
 * is proven separately by the operator minter and the connect endpoint.
 */

function throwawayKey(): { privatePem: string; publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'] } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privatePem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), publicKey };
}

function verifyJwt(jwt: string, publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']): unknown {
  const [header, payload, signature] = jwt.split('.');
  if (header === undefined || payload === undefined || signature === undefined) throw new Error('not a JWT');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  verifier.end();
  expect(verifier.verify(publicKey, signature, 'base64url')).toBe(true);
  expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ alg: 'RS256', typ: 'JWT' });
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

describe('mintAppJwt', () => {
  it('mints a verifiable JWT with bounded claims', () => {
    const { privatePem, publicKey } = throwawayKey();
    const nowMs = Date.parse('2026-11-05T05:00:00.000Z');
    const claims = verifyJwt(mintAppJwt({ appId: '5617882', privateKeyPem: privatePem, nowMs }), publicKey) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(claims.iss).toBe('5617882');
    expect(claims.exp - claims.iat).toBe(600);
    expect(claims.iat * 1000).toBeLessThanOrEqual(nowMs);
  });

  it('refuses a non-numeric App id without signing', () => {
    const { privatePem } = throwawayKey();
    expect(() => mintAppJwt({ appId: 'app-1', privateKeyPem: privatePem, nowMs: Date.now() })).toThrow(
      /positive integer/,
    );
  });

  it('refuses a non-PEM key without signing', () => {
    expect(() => mintAppJwt({ appId: '5617882', privateKeyPem: 'not-a-key', nowMs: Date.now() })).toThrow(
      /PEM private key/,
    );
  });
});

describe('exchangeInstallationToken', () => {
  const JWT = 'header.payload.signature';

  function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit }): typeof fetch {
    return ((url: string, init?: RequestInit) => {
      seen.url = url;
      if (init !== undefined) seen.init = init;
      return Promise.resolve({ status, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
  }

  it('posts to the fixed token endpoint and returns the token', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const result = await exchangeInstallationToken({
      installationId: '178697398',
      jwt: JWT,
      fetchImpl: fakeFetch(201, { token: 'ghs-live-token', expires_at: '2026-11-05T06:00:00Z' }, seen),
    });
    expect(result).toEqual({ token: 'ghs-live-token', expiresAt: '2026-11-05T06:00:00Z' });
    expect(seen.url).toBe(`${GITHUB_API_BASE}/app/installations/178697398/access_tokens`);
    const init = seen.init as { method: string; headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${JWT}`);
    expect(init.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('ignores extra provider fields on the token response', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const result = await exchangeInstallationToken({
      installationId: '178697398',
      jwt: JWT,
      fetchImpl: fakeFetch(
        201,
        {
          token: 'ghs-live-token',
          expires_at: '2026-11-05T06:00:00Z',
          permissions: { contents: 'read' },
          repository_selection: 'selected',
          single_file: null,
        },
        seen,
      ),
    });
    expect(result).toEqual({ token: 'ghs-live-token', expiresAt: '2026-11-05T06:00:00Z' });
  });

  it('maps a missing installation to an unknown-installation refusal', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await expect(
      exchangeInstallationToken({ installationId: '999', jwt: JWT, fetchImpl: fakeFetch(404, {}, seen) }),
    ).rejects.toThrow(/unknown or not shared/);
  });

  it('maps a rejected credential without leaking anything', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const message = await exchangeInstallationToken({
      installationId: '178697398',
      jwt: JWT,
      fetchImpl: fakeFetch(401, {}, seen),
    }).then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(message).toMatch(/rejected the App credential/);
    expect(message).not.toContain(JWT);
  });

  it('refuses a tokenless response and an unreachable API', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await expect(
      exchangeInstallationToken({ installationId: '178697398', jwt: JWT, fetchImpl: fakeFetch(200, {}, seen) }),
    ).rejects.toThrow(/no installation token/);
    const unreachable = (() => Promise.reject(new Error('socket hang up'))) as unknown as typeof fetch;
    await expect(
      exchangeInstallationToken({ installationId: '178697398', jwt: JWT, fetchImpl: unreachable }),
    ).rejects.toThrow(/unreachable/);
  });

  it('refuses a non-numeric installation id before any request', async () => {
    let called = false;
    const spy = (() => {
      called = true;
      return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof fetch;
    await expect(
      exchangeInstallationToken({ installationId: '../x', jwt: JWT, fetchImpl: spy }),
    ).rejects.toThrow(/positive integer/);
    expect(called).toBe(false);
  });
});
