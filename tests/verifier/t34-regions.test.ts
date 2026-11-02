import { describe, expect, it } from 'vitest';

import type { RegionCampaign, RegionFault } from '../../src/core/index.js';
import {
  freezeRegionPlan,
  reduceConsistency,
  runRegionCampaign,
  verifyRegionPlan,
  type RegionFaultDriver,
  type RegionWorkload,
} from '../../src/modules/verifier/index.js';

/**
 * WP3-19 / T-34 — multi-region supervisor failure-path tests (NEG3-08, NEG3-17, NEG3-40).
 *
 * Written before the implementation. Plans freeze with resolvable targets;
 * a fault that never applies or never heals invalidates the experiment
 * instead of blaming the application; RPO/RTO and ordering reduce to
 * per-check verdicts; and a single-host probe reports `probe-only` even
 * when every check is green — only complete, all-green evidence from
 * provisioned regions reports `qualified`.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const PLAN_HASH = 'f'.repeat(64);

function plan(overrides: Partial<Parameters<typeof freezeRegionPlan>[0]> = {}): RegionCampaign {
  return freezeRegionPlan({
    planId: 'region-plan-1',
    planHash: PLAN_HASH,
    topology: {
      schemaVersion: '1',
      topologyId: 'topo-1',
      regions: [
        { regionId: 'a', role: 'primary', endpointRef: 'ep-a' },
        { regionId: 'b', role: 'replica', endpointRef: 'ep-b' },
      ],
      provenance: { kind: 'single-host-probe', detail: 'unit-test topology' },
      consistencyClaimed: 'eventual',
      clockSource: 'test-clock',
    },
    faults: [
      {
        faultId: 'partition-a-b',
        kind: 'partition',
        targets: ['a-b'],
        startAfterMs: 0,
        durationMs: 100,
        heal: { kind: 'reconnect', verifyWithinMs: 1_000 },
      },
    ],
    trials: 1,
    workload: { writesPerTrial: 2, writeRegion: 'a', readRegions: ['a', 'b'] },
    orderingBound: { maxSeqGap: 0, maxDuplicates: 0 },
    rpoBound: { maxLostAckedWrites: 0 },
    rtoBound: { maxRestoreMs: 1_000 },
    frozenAt: NOW,
    ...overrides,
  });
}

function healthyDriver(): RegionFaultDriver & { calls: string[] } {
  const calls: string[] = [];
  let partitioned = false;
  return {
    calls,
    applyFault: (input) => {
      calls.push(`apply:${input.fault.faultId}`);
      partitioned = true;
      return Promise.resolve({ appliedAt: NOW, applied: true });
    },
    healFault: (input) => {
      calls.push(`heal:${input.fault.faultId}`);
      partitioned = false;
      return Promise.resolve({ healedAt: NOW, healed: true, verified: true });
    },
    roles: () => Promise.resolve(partitioned ? { a: 'primary', b: 'replica' } : { a: 'primary', b: 'replica' }),
  };
}

function healthyWorkload(): RegionWorkload {
  let seq = 0;
  return {
    write: () => {
      seq += 1;
      return Promise.resolve({ seq, acked: true });
    },
    read: () => Promise.resolve({ present: true }),
    journal: () => {
      const entries = [];
      for (let i = 1; i <= seq; i += 1) {
        entries.push({ seq: i, acked: true });
      }
      return Promise.resolve(entries);
    },
  };
}

function harness() {
  let now = Date.parse(NOW);
  return {
    nowIso: (): string => new Date(now).toISOString(),
    sleep: (ms: number): Promise<void> => {
      now += ms;
      return Promise.resolve();
    },
  };
}

describe('region plan freeze', () => {
  it('freezes and verifies a well-formed plan', () => {
    const frozen = plan();
    expect(verifyRegionPlan(frozen).digest).toBe(frozen.digest);
  });

  it('refuses drift, unknown targets, and single-region topologies', () => {
    const frozen = plan();
    expect(() => verifyRegionPlan({ ...frozen, digest: '0'.repeat(64) })).toThrow(/digest/);
    const firstFault = frozen.faults[0];
    if (firstFault === undefined) {
      throw new Error('fixture is empty');
    }
    const badTarget: RegionFault = { ...firstFault, targets: ['a-zz'] };
    expect(() => plan({ faults: [badTarget] })).toThrow(/unknown to the topology/);
    expect(() =>
      plan({
        topology: {
          ...frozen.topology,
          regions: [{ regionId: 'a', role: 'primary', endpointRef: 'ep-a' }],
        },
      }),
    ).toThrow();
  });
});

describe('region trial execution', () => {
  it('runs a healthy trial with measured receipts', async () => {
    const frozen = plan();
    const clock = harness();
    const report = await runRegionCampaign({
      plan: frozen,
      driver: healthyDriver(),
      workload: healthyWorkload(),
      nowIso: clock.nowIso,
      sleep: clock.sleep,
    });
    expect(report.receipts).toHaveLength(1);
    expect(report.receipts[0]).toMatchObject({
      faultApplied: true,
      faultHealed: true,
      healVerified: true,
      measuredRpoLostWrites: 0,
    });
    expect(report.consistency.qualification).toBe('probe-only');
    expect(report.consistency.checks.every((check) => check.pass)).toBe(true);
  });

  it('invalidates the experiment when the fault never applies or never heals', async () => {
    const frozen = plan();
    const noOp: RegionFaultDriver = {
      applyFault: () => Promise.resolve({ appliedAt: NOW, applied: false }),
      healFault: () => Promise.resolve({ healedAt: NOW, healed: true, verified: true }),
      roles: () => Promise.resolve({ a: 'primary', b: 'replica' }),
    };
    const clock = harness();
    const noopReport = await runRegionCampaign({
      plan: frozen,
      driver: noOp,
      workload: healthyWorkload(),
      nowIso: clock.nowIso,
      sleep: clock.sleep,
    });
    expect(noopReport.consistency.qualification).toBe('invalid');
    expect(noopReport.consistency.reasons.join(' ')).toMatch(/never applied/);

    const unhealed: RegionFaultDriver = {
      ...healthyDriver(),
      healFault: () => Promise.resolve({ healedAt: NOW, healed: false, verified: false }),
    };
    const unhealedReport = await runRegionCampaign({
      plan: frozen,
      driver: unhealed,
      workload: healthyWorkload(),
      nowIso: clock.nowIso,
      sleep: clock.sleep,
    });
    expect(unhealedReport.consistency.qualification).toBe('invalid');
    expect(unhealedReport.consistency.reasons.join(' ')).toMatch(/never healed/);
  });

  it('fails the RPO check when acked writes stay missing, without blaming the harness', async () => {
    const frozen = plan();
    const divergent: RegionWorkload = {
      ...healthyWorkload(),
      read: (region: string) => Promise.resolve({ present: region === 'a' }),
      journal: (region: string) =>
        region === 'a'
          ? Promise.resolve([
              { seq: 1, acked: true },
              { seq: 2, acked: true },
            ])
          : Promise.resolve([]),
    };
    const clock = harness();
    const report = await runRegionCampaign({
      plan: frozen,
      driver: healthyDriver(),
      workload: divergent,
      nowIso: clock.nowIso,
      sleep: clock.sleep,
    });
    expect(report.consistency.qualification).toBe('invalid');
    const rpo = report.consistency.checks.find((check) => check.id === 'rpo-within-bound');
    expect(rpo?.pass).toBe(false);
  });
});

describe('consistency reduction (NEG3-40)', () => {
  it('qualifies only complete, all-green, provisioned evidence', () => {
    const frozen = plan({
      topology: {
        schemaVersion: '1',
        topologyId: 'topo-1',
        regions: [
          { regionId: 'a', role: 'primary', endpointRef: 'ep-a' },
          { regionId: 'b', role: 'replica', endpointRef: 'ep-b' },
        ],
        provenance: { kind: 'provisioned-regions', detail: 'unit-test provisioned topology' },
        consistencyClaimed: 'eventual',
        clockSource: 'test-clock',
      },
    });
    const receipt = {
      schemaVersion: '1' as const,
      planDigest: frozen.digest,
      trialIndex: 0,
      faultId: 'partition-a-b',
      faultApplied: true,
      faultHealed: true,
      healVerified: true,
      rolesBefore: { a: 'primary' as const, b: 'replica' as const },
      rolesAfter: { a: 'primary' as const, b: 'replica' as const },
      journal: { writesAttempted: 2, writesAcked: 2, writesPresentAfter: 2, maxSeqGap: 0, duplicates: 0 },
      measuredRpoLostWrites: 0,
      measuredRtoMs: 100,
      startedAt: NOW,
      finishedAt: NOW,
    };
    const qualified = reduceConsistency({ plan: frozen, receipts: [receipt] });
    expect(qualified.qualification).toBe('qualified');
    const incomplete = reduceConsistency({ plan: frozen, receipts: [] });
    expect(incomplete.qualification).toBe('invalid');
    expect(incomplete.reasons.join(' ')).toMatch(/missing/);
  });
});
