import { describe, expect, it } from 'vitest';

import type { EmailIdentityDb, EmailIdentityDeps } from '../../src/modules/identity/index.js';
import { composeEmailIdentity } from '../../src/orchestrator/index.js';

/**
 * WP3-28 composition wiring.
 *
 * The composition root injects the database handle, delivery transport, and
 * secret broker into the email store without adding behavior. The stubs below
 * never connect or send — flows are proven natively in
 * `tests/native/email-identity.test.ts` and delivery in
 * `tests/native/email-delivery.test.ts`, not here.
 */
describe('composeEmailIdentity', () => {
  const stubDb: EmailIdentityDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
  };
  const stubDeps: EmailIdentityDeps = {
    delivery: {
      send: () => Promise.resolve({ messageId: 'stub', acceptedAt: '2026-11-01T00:00:00.000Z' }),
    },
    secrets: {
      readCredential: () => Promise.resolve('stub-secret'),
    },
    challengeSecretRef: 'stub-ref',
  };

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeEmailIdentity(stubDb, stubDeps);

    for (const key of [
      'registerUser',
      'resendVerification',
      'verifyEmail',
      'loginWithPassword',
      'requestPasswordReset',
      'resetPassword',
      'claimTenant',
      'listUserSessions',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
  });
});
