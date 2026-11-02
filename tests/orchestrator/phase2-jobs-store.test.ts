import { describe, expect, it } from 'vitest';

import type { JobsDb } from '../../src/modules/jobs/index.js';
import { composeJobs } from '../../src/orchestrator/index.js';

/**
 * WP3-23 composition wiring.
 *
 * The composition root injects the database handle into the jobs store
 * without adding behavior. The stub below never connects — durable behavior
 * is proven natively in `tests/native/jobs-durable.test.ts`, not here.
 */
describe('composeJobs', () => {
  const stubDb: JobsDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    connect: () =>
      Promise.resolve({
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        release: () => undefined,
      }),
  };

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeJobs(stubDb);

    for (const key of [
      'admitRun',
      'claimJob',
      'heartbeat',
      'writeCheckpoint',
      'enqueueEffect',
      'dispatchEffects',
      'reconcileEffect',
      'completeJob',
      'failJob',
      'requestCancel',
      'settleCancelled',
      'expireStaleLeases',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
  });
});
