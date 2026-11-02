import { describe, expect, it, vi } from 'vitest';

import type { IdentityStore } from '../../src/modules/identity/index.js';
import type { LifecycleStore } from '../../src/modules/lifecycle/index.js';
import type { NotificationsDb } from '../../src/modules/notifications/index.js';
import type { QueriesDb } from '../../src/modules/queries/index.js';
import { composeNotifications, composeQueries } from '../../src/orchestrator/index.js';

/**
 * WP3-29 composition wiring.
 *
 * The composition root binds the notifications and queries stores without
 * adding behavior. The stubs below never connect — durable behavior is proven
 * natively in `tests/native/engagement.test.ts`, not here.
 */
describe('composeNotifications', () => {
  const stubDb: NotificationsDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    connect: () =>
      Promise.resolve({
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        release: () => undefined,
      }),
  };

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeNotifications(stubDb, { deriveContext: vi.fn() } as unknown as IdentityStore);

    for (const key of [
      'publishFromEvent',
      'listNotifications',
      'markRead',
      'markDismissed',
      'markAllRead',
      'getPreferences',
      'setPreferences',
      'claimOutboxBatch',
      'ackOutbox',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
  });
});

describe('composeQueries', () => {
  const stubDb: QueriesDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    connect: () =>
      Promise.resolve({
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        release: () => undefined,
      }),
  };

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeQueries(stubDb, {
      identity: { deriveContext: vi.fn() } as unknown as IdentityStore,
      lifecycle: { retryRun: vi.fn() } as unknown as LifecycleStore,
    });

    for (const key of [
      'search',
      'exportAudit',
      'requestReproduction',
      'bumpGrantEpoch',
      'invalidateTenantCache',
      'cacheStats',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
  });
});
