import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword, assertPasswordAcceptable } from '../../src/modules/identity/passwords.js';

/**
 * WP3-28 — password policy and hashing (FR3-38).
 *
 * Written before the email store. Policy is length-bounded server
 * validation, not the mockup's minimum; verification is fail-closed on
 * malformed stored hashes.
 */
describe('password policy (FR3-38)', () => {
  it('accepts a 10-character password and rejects shorter ones', () => {
    expect(() => {
      assertPasswordAcceptable('0123456789');
    }).not.toThrow();
    expect(() => {
      assertPasswordAcceptable('short');
    }).toThrow(/10\.\.128/);
  });

  it('rejects passwords past the 128-character hashing bound', () => {
    expect(() => {
      assertPasswordAcceptable('x'.repeat(129));
    }).toThrow(/10\.\.128/);
  });
});

describe('password hashing', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct-horse-42');
    expect(stored.startsWith('scrypt$v1$')).toBe(true);
    expect(await verifyPassword('correct-horse-42', stored)).toBe(true);
    expect(await verifyPassword('correct-horse-43', stored)).toBe(false);
  });

  it('salts hashes so the same password stores differently twice', async () => {
    const first = await hashPassword('same-password-1');
    const second = await hashPassword('same-password-1');
    expect(first).not.toBe(second);
    expect(await verifyPassword('same-password-1', first)).toBe(true);
    expect(await verifyPassword('same-password-1', second)).toBe(true);
  });

  it('returns false for malformed stored hashes instead of authenticating', async () => {
    expect(await verifyPassword('anything-here', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything-here', 'scrypt$v1$1$2$3$aaaa$bbbb')).toBe(false);
    expect(await verifyPassword('anything-here', '')).toBe(false);
  });
});
