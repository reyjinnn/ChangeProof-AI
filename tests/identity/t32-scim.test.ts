import { describe, expect, it } from 'vitest';

import { ScimEventSchema, type ScimEvent } from '../../src/core/index.js';
import {
  decideScimApply,
  hashScimToken,
  mintScimTokenValue,
  scimTokenMatches,
} from '../../src/modules/identity/index.js';

/**
 * WP3-32 / T-32 — SCIM pure failure-path tests (NEG3-38).
 *
 * Written before the implementation. Tokens are compared in constant time
 * with length guards, versions order effects per external id (older never
 * overwrites newer, retries land once), and a same-version conflict is
 * refused instead of guessed.
 */

function event(overrides: Partial<ScimEvent> = {}): ScimEvent {
  return ScimEventSchema.parse({
    schemaVersion: '1',
    eventId: 'scim-event-1',
    tenantId: 'tenant-a',
    externalId: 'idp-user-1',
    operation: 'provision',
    version: 1,
    groups: [],
    ...overrides,
  });
}

describe('SCIM token handling (NEG3-38)', () => {
  it('mints prefixed tokens whose hashes verify in constant time', () => {
    const first = mintScimTokenValue();
    const second = mintScimTokenValue();
    expect(first).toMatch(/^scim_[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
    expect(hashScimToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(scimTokenMatches(hashScimToken(first), hashScimToken(first))).toBe(true);
    expect(scimTokenMatches(hashScimToken(first), hashScimToken(second))).toBe(false);
  });

  it('refuses malformed hashes instead of comparing them', () => {
    expect(scimTokenMatches('short', hashScimToken(mintScimTokenValue()))).toBe(false);
    expect(scimTokenMatches('z'.repeat(64), hashScimToken(mintScimTokenValue()))).toBe(false);
  });
});

describe('SCIM version ordering (NEG3-38)', () => {
  it('applies the first event for an external id', () => {
    expect(decideScimApply(null, { version: 1, operation: 'provision' })).toBe('apply');
  });

  it('treats a retried event as a duplicate, never a second effect', () => {
    expect(
      decideScimApply(
        { version: 2, operation: 'update' },
        { version: 2, operation: 'update' },
      ),
    ).toBe('duplicate');
  });

  it('supersedes older versions instead of applying them over newer state', () => {
    expect(
      decideScimApply({ version: 3, operation: 'disable' }, { version: 2, operation: 'update' }),
    ).toBe('superseded');
  });

  it('refuses a same-version conflict instead of guessing the winner', () => {
    expect(
      decideScimApply(
        { version: 2, operation: 'disable' },
        { version: 2, operation: 'provision' },
      ),
    ).toBe('conflict');
  });

  it('rejects events with unusable versions or operations', () => {
    expect(() => event({ version: 0 })).toThrow();
    expect(() => event({ operation: 'promote' as never })).toThrow();
  });
});
