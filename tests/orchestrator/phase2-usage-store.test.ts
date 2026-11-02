import { describe, expect, it } from 'vitest';

import type { UsageDb } from '../../src/modules/usage/index.js';
import { composeUsage } from '../../src/orchestrator/index.js';

/**
 * WP3-24 composition wiring.
 *
 * The composition root injects the database handle into the usage store
 * without adding behavior. The stub below never connects — atomic behavior
 * is proven natively in `tests/native/usage-atomic.test.ts`, not here.
 */
describe('composeUsage', () => {
  const stubDb: UsageDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    connect: () =>
      Promise.resolve({
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        release: () => undefined,
      }),
  };

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeUsage(stubDb);

    for (const key of [
      'setEntitlement',
      'rolloverPeriod',
      'admitReservation',
      'recordConsume',
      'releaseReservation',
      'settleReservation',
      'readBalances',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
  });
});
