import { describe, expect, it } from 'vitest';

import type { IdentityDb } from '../../src/modules/identity/index.js';
import { composeIdentityStore } from '../../src/orchestrator/index.js';

/**
 * WP3-21 composition wiring.
 *
 * The composition root injects the database handle into the identity store
 * without adding behavior. The stub below never connects — durable behavior
 * is proven natively in `tests/native/identity-services.test.ts`, not here.
 */
describe('composeIdentityStore', () => {
  const stubDb: IdentityDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    connect: () =>
      Promise.resolve({
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        release: () => undefined,
      }),
  };

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeIdentityStore(stubDb);

    for (const key of [
      'createTenant',
      'createSession',
      'deriveContext',
      'revokeSession',
      'revokeUserSessions',
      'createInvitation',
      'acceptInvitation',
      'changeMemberRole',
      'removeMember',
      'deleteTenant',
      'recordRetention',
      'advancePurge',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
    expect(typeof composed.assertNoLastOwnerLockout).toBe('function');
  });

  it('reuses the same last-owner guard the store enforces', () => {
    const composed = composeIdentityStore(stubDb);

    expect(() => {
      composed.assertNoLastOwnerLockout([{ userId: 'u-1', role: 'owner' }], 'u-1');
    }).toThrow(/last owner/i);
  });
});
