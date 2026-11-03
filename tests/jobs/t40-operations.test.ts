import { describe, expect, it } from 'vitest';

import { HostedServiceProfileSchema } from '../../src/core/index.js';
import {
  assertCapacityAvailable,
  assertComponentHealthy,
  assertNotDraining,
  assertWorkerUsable,
  pickFairTenant,
} from '../../src/modules/jobs/operations.js';

/**
 * WP3-26 / T-40 — service operations gate tests (NEG3-26).
 *
 * Written before the durable wiring. Per-tenant and global caps admit work
 * independently so a noisy neighbor starves nobody; the least-loaded tenant
 * with queued work wins fairly; draining pools refuse new work while
 * in-flight jobs finish; quarantined workers get no claims; and an outage
 * blocks its component until a healthy probe after the outage start.
 */

describe('capacity and fairness isolate noisy neighbors', () => {
  it('caps each tenant without starving others', () => {
    expect(() => {
      assertCapacityAvailable({ tenantActive: 4, tenantConcurrency: 4, globalActive: 4, globalConcurrency: 16 });
    }).toThrow(/cap/i);
    expect(() => {
      assertCapacityAvailable({ tenantActive: 1, tenantConcurrency: 4, globalActive: 16, globalConcurrency: 16 });
    }).toThrow(/cap/i);
    expect(() => {
      assertCapacityAvailable({ tenantActive: 1, tenantConcurrency: 4, globalActive: 5, globalConcurrency: 16 });
    }).not.toThrow();
  });

  it('picks the least-loaded tenant with queued work', () => {
    expect(
      pickFairTenant([
        { tenantId: 'noisy', active: 8, queued: 30 },
        { tenantId: 'quiet', active: 0, queued: 1 },
      ]),
    ).toBe('quiet');
    expect(
      pickFairTenant([
        { tenantId: 'b', active: 1, queued: 2 },
        { tenantId: 'a', active: 1, queued: 2 },
      ]),
    ).toBe('a');
    expect(pickFairTenant([{ tenantId: 'idle', active: 0, queued: 0 }])).toBeNull();
  });
});

describe('drain, quarantine, and outage block new work only', () => {
  it('refuses new work while draining or quarantined', () => {
    expect(() => {
      assertNotDraining(true);
    }).toThrow(/drain/i);
    expect(() => {
      assertNotDraining(false);
    }).not.toThrow();
    expect(() => {
      assertWorkerUsable(new Set(['w-9']), 'w-9');
    }).toThrow(/quarantine/i);
    expect(() => {
      assertWorkerUsable(new Set(['w-9']), 'w-1');
    }).not.toThrow();
  });

  it('reopens an outage only on a healthy probe after the start', () => {
    const outage = { component: 'worker-pool', startedAt: '2026-11-02T10:00:00.000Z' };
    expect(() => {
      assertComponentHealthy(outage, null);
    }).toThrow(/outage/i);
    expect(() => {
      assertComponentHealthy(outage, { component: 'worker-pool', checkedAt: '2026-11-02T09:00:00.000Z', healthy: true });
    }).toThrow(/predates/i);
    expect(() => {
      assertComponentHealthy(outage, { component: 'worker-pool', checkedAt: '2026-11-02T11:00:00.000Z', healthy: false });
    }).toThrow(/outage/i);
    expect(() => {
      assertComponentHealthy(outage, { component: 'worker-pool', checkedAt: '2026-11-02T11:00:00.000Z', healthy: true });
    }).not.toThrow();
    expect(() => {
      assertComponentHealthy({ ...outage, resolvedAt: '2026-11-02T11:00:00.000Z' }, null);
    }).not.toThrow();
    expect(() => {
      assertComponentHealthy(null, null);
    }).not.toThrow();
  });
});

describe('frozen service profile pins finite numbers', () => {
  it('parses the T-40 calibrated profile from docs/decisions/t40-service-profile.md', () => {
    const profile = HostedServiceProfileSchema.parse({
      schemaVersion: '1',
      profileId: 'hosted-1',
      environment: 'production-eu',
      maxTenants: 64,
      maxConcurrentRuns: 16,
      maxQueueDepth: 200,
      maxRunsPerTenant: 4,
      queueWaitMs: 300000,
      fairnessWindowMs: 60000,
      costOvershootUsd: 50,
      sloAvailability: 0.995,
      rpoMs: 3600000,
      rtoMs: 14400000,
      retentionDays: 400,
      deletionSloMs: 2592000000,
      campaignMethod: 't40-local-probe',
      frozenAt: '2026-11-02T00:00:00.000Z',
    });
    expect(profile.maxConcurrentRuns).toBe(16);
  });
});
