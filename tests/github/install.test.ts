import { describe, expect, it } from 'vitest';

import {
  assertAppSlug,
  assertInstallationId,
  assertSetupAction,
  buildInstallUrl,
  mintInstallState,
  verifyInstallState,
} from '../../src/modules/github/index.js';

/**
 * GitHub App installation connect (Vercel-style entry, FR3-30).
 *
 * Pure tests: no network, no GitHub App. They prove the install URL, the
 * user-bound state token (tamper/expiry/purpose/nonce), and strict
 * callback validation (installation id shape, setup action allowlist).
 * Live installation proof needs an authorized GitHub App and stays
 * blocked; the HTTP round-trip is proven with stubs in
 * `tests/http/t45-runs.test.ts`.
 */

const SECRET = 'install-state-secret-32-chars-min!';
const NOW_MS = Date.parse('2026-11-03T00:00:00.000Z');

function mint(overrides: { userId?: string; nonce?: string; nowMs?: number; ttlMs?: number; secret?: string } = {}): string {
  return mintInstallState({
    userId: 'user-owner',
    nonce: 'nonce-abcdef0123456789',
    nowMs: NOW_MS,
    secret: SECRET,
    ...overrides,
  });
}

describe('install URL', () => {
  it('points at the App install page with the opaque state', () => {
    const url = buildInstallUrl({ appSlug: 'changeproof-ai', state: 'v1.opaque.sig' });
    expect(url).toBe('https://github.com/apps/changeproof-ai/installations/new?state=v1.opaque.sig');
  });

  it('refuses a malformed slug or a missing state', () => {
    expect(() => buildInstallUrl({ appSlug: '../evil', state: 's' })).toThrow('slug is malformed');
    expect(() => buildInstallUrl({ appSlug: 'UPPER', state: 's' })).toThrow('slug is malformed');
    expect(() => buildInstallUrl({ appSlug: 'changeproof-ai', state: '' })).toThrow('state is missing');
  });

  it('accepts slug edges and rejects overlong values', () => {
    expect(() => {
      assertAppSlug('a');
    }).not.toThrow();
    expect(() => {
      assertAppSlug('app-1-x');
    }).not.toThrow();
    expect(() => {
      assertAppSlug('a'.repeat(101));
    }).toThrow('slug is malformed');
    expect(() => {
      assertAppSlug('');
    }).toThrow('slug is malformed');
  });
});

describe('install state', () => {
  it('round-trips the user and nonce inside their lifetime', () => {
    const verified = verifyInstallState({ state: mint(), nowMs: NOW_MS + 60_000, secret: SECRET });
    expect(verified).toEqual({ userId: 'user-owner', nonce: 'nonce-abcdef0123456789' });
  });

  it('refuses to mint without a user, a nonce, or a secret', () => {
    expect(() => mint({ userId: '' })).toThrow();
    expect(() => mint({ nonce: '' })).toThrow();
    expect(() => mint({ secret: '' })).toThrow('secret is missing');
    expect(() => mint({ ttlMs: 0 })).toThrow('positive duration');
  });

  it('refuses tampered, expired, future, and foreign-purpose states', () => {
    const good = mint();
    const tampered = `${good.slice(0, -1)}0`;
    expect(() => verifyInstallState({ state: tampered, nowMs: NOW_MS, secret: SECRET })).toThrow('signature mismatch');
    expect(() => verifyInstallState({ state: 'v1.e30.00', nowMs: NOW_MS, secret: SECRET })).toThrow('malformed');
    expect(() => verifyInstallState({ state: mint(), nowMs: NOW_MS + 11 * 60_000, secret: SECRET })).toThrow('expired');
    expect(() => verifyInstallState({ state: mint(), nowMs: NOW_MS - 1, secret: SECRET })).toThrow('in the future');
    expect(() => verifyInstallState({ state: good, nowMs: NOW_MS, secret: 'wrong-secret-32-chars-minimum!!' })).toThrow(
      'signature mismatch',
    );
  });
});

describe('callback validation', () => {
  it('accepts numeric installation ids and completed setup actions', () => {
    expect(() => {
      assertInstallationId('178697398');
    }).not.toThrow();
    expect(assertSetupAction('install')).toBe('install');
    expect(assertSetupAction('update')).toBe('update');
  });

  it('refuses malformed ids and non-install actions', () => {
    expect(() => {
      assertInstallationId('0');
    }).toThrow('malformed');
    expect(() => {
      assertInstallationId('12a');
    }).toThrow('malformed');
    expect(() => {
      assertInstallationId('');
    }).toThrow('malformed');
    expect(() => assertSetupAction('request')).toThrow('did not complete');
    expect(() => assertSetupAction('')).toThrow('did not complete');
  });
});
