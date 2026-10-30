import { describe, expect, it } from 'vitest';

import {
  assertNonceUnused,
  assertSafeReturnTarget,
  mintChallenge,
  verifyChallenge,
  type MintChallengeInput,
} from '../../src/modules/identity/index.js';

/**
 * WP3-28 / T2-9 — email challenge failure-path tests (NEG3-29, NEG3-30).
 *
 * Written before the implementation. Verification/reset challenges are
 * purpose-bound, expiring, and single-use; enumeration and replay buy an
 * attacker nothing. Actual email delivery needs authorized infrastructure and
 * stays `blocked` — this is the token core both transports will share.
 */

const SECRET = 'broker-held-challenge-secret';
const NOW = 1_700_000_000_000;

function mint(overrides: Partial<MintChallengeInput> = {}) {
  return mintChallenge({
    purpose: 'verify_email',
    subjectId: 'user-1',
    issuedAtMs: NOW,
    ttlMs: 15 * 60_000,
    nonce: 'nonce-1',
    secret: SECRET,
    ...overrides,
  });
}

describe('purpose-bound expiring single-use challenges (NEG3-30)', () => {
  it('verifies a fresh challenge for its own purpose', () => {
    const verified = verifyChallenge({ token: mint(), expectedPurpose: 'verify_email', nowMs: NOW + 1000, secret: SECRET });

    expect(verified.subjectId).toBe('user-1');
    expect(verified.nonce).toBe('nonce-1');
  });

  it('rejects a forged token instead of resolving it to an account', () => {
    const token = mint();
    const forged = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;

    expect(() =>
      verifyChallenge({ token: forged, expectedPurpose: 'verify_email', nowMs: NOW + 1000, secret: SECRET }),
    ).toThrow();
  });

  it('rejects purpose reuse: a reset token never verifies an email', () => {
    const reset = mint({ purpose: 'reset_password', nonce: 'nonce-2' });

    expect(() =>
      verifyChallenge({ token: reset, expectedPurpose: 'verify_email', nowMs: NOW + 1000, secret: SECRET }),
    ).toThrow(/purpose/);
  });

  it('rejects an expired challenge instead of extending it', () => {
    expect(() =>
      verifyChallenge({ token: mint(), expectedPurpose: 'verify_email', nowMs: NOW + 60 * 60_000, secret: SECRET }),
    ).toThrow(/expired/);
  });

  it('rejects a replayed nonce: one use only', () => {
    const verified = verifyChallenge({ token: mint(), expectedPurpose: 'verify_email', nowMs: NOW + 1000, secret: SECRET });

    expect(() => { assertNonceUnused(new Set([verified.nonce]), verified.nonce); }).toThrow(/replay|single/i);
    expect(() => { assertNonceUnused(new Set(), verified.nonce); }).not.toThrow();
  });

  it('fails closed on a malformed token instead of guessing its meaning', () => {
    expect(() =>
      verifyChallenge({ token: 'not-a-challenge', expectedPurpose: 'verify_email', nowMs: NOW, secret: SECRET }),
    ).toThrow();
  });
});

describe('login return targets are validated server-side (NEG3-29)', () => {
  it('accepts an in-app path', () => {
    expect(() => { assertSafeReturnTarget('/dashboard?next=1'); }).not.toThrow();
    expect(() => { assertSafeReturnTarget('/'); }).not.toThrow();
  });

  it('rejects absolute URLs, protocol-relative URLs, and backslashes', () => {
    expect(() => { assertSafeReturnTarget('https://evil.example/'); }).toThrow(/return target/i);
    expect(() => { assertSafeReturnTarget('//evil.example/'); }).toThrow(/return target/i);
    expect(() => { assertSafeReturnTarget('/\\evil'); }).toThrow(/return target/i);
  });

  it('rejects an empty target instead of defaulting somewhere', () => {
    expect(() => { assertSafeReturnTarget(''); }).toThrow(/return target/i);
  });
});
