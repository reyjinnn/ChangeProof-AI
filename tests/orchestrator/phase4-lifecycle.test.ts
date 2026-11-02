import { describe, expect, it, vi } from 'vitest';

import type { EvidenceStore } from '../../src/modules/evidence/index.js';
import type { IdentityStore } from '../../src/modules/identity/index.js';
import type { JobsStore } from '../../src/modules/jobs/index.js';
import type { LifecycleDb } from '../../src/modules/lifecycle/index.js';
import type { UsageStore } from '../../src/modules/usage/index.js';
import { composeLifecycle } from '../../src/orchestrator/index.js';

/**
 * WP3-25 composition wiring.
 *
 * The composition root binds the lifecycle store to the identity, usage,
 * jobs, and evidence stores without adding behavior. The stubs below never
 * connect — durable behavior is proven natively in
 * `tests/native/lifecycle.test.ts`, not here.
 */
describe('composeLifecycle', () => {
  const stubDb: LifecycleDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    connect: () =>
      Promise.resolve({
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        release: () => undefined,
      }),
  };

  function stubDeps() {
    return {
      identity: { deriveContext: vi.fn() } as unknown as IdentityStore,
      usage: { admitReservation: vi.fn() } as unknown as UsageStore,
      jobs: { admitRun: vi.fn(), requestCancel: vi.fn() } as unknown as JobsStore,
      evidence: { get: vi.fn() } as unknown as EvidenceStore,
    };
  }

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeLifecycle(stubDb, stubDeps());

    for (const key of [
      'createProject',
      'saveDraftRevision',
      'getDraft',
      'submitRun',
      'getRun',
      'pollEvents',
      'recordRunEvent',
      'cancelRun',
      'retryRun',
      'applyRepoRevocation',
      'downloadArtifact',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
  });
});
