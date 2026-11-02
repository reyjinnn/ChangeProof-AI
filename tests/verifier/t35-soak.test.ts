import { describe, expect, it } from 'vitest';

import type { SoakPlan } from '../../src/core/index.js';
import {
  freezeSoakPlan,
  reduceSoak,
  runSoakCampaign,
  verifySoakPlan,
  type SoakRestarter,
  type SoakSampler,
  type SoakWorkload,
} from '../../src/modules/verifier/index.js';

/**
 * WP3-19 / T-35 — long-horizon profiler failure-path tests (NEG3-18, NEG3-40).
 *
 * Written before the implementation. Plans freeze with a horizon beyond the
 * known onset; a short smoke run reports `smoke-only` even when every check
 * is green and a full-horizon run that never reaches its horizon reports
 * `invalid` — short no-OOM never passes as qualification. Series fit slope
 * with uncertainty per segment between restarts; workload accounting must
 * close inside its frozen tolerance; an uncalibrated profiler is
 * inconclusive; and a restart the policy cannot explain invalidates the run
 * instead of hiding a leak.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const BASE_HEAP = 50_000_000;
const BASE_RSS = 120_000_000;

function plan(overrides: Partial<Parameters<typeof freezeSoakPlan>[0]> = {}): SoakPlan {
  return freezeSoakPlan({
    planId: 'soak-plan-1',
    profileId: 'node-service-leak',
    provenance: { kind: 'full-horizon', detail: 'unit-test soak' },
    knownOnset: { cycles: 50_000, minDurationMs: 6 * 3_600_000 },
    horizon: { cycles: 100_000, minDurationMs: 12 * 3_600_000 },
    workload: { opsPerCycle: 100, description: 'sustained mixed read/write load' },
    runtime: {
      runtime: 'node',
      runtimeVersion: '22.11.0',
      allocator: 'v8-default',
      gcSettings: '--expose-gc --max-old-space-size=512',
      profiler: 'clinic-doctor',
      profilerVersion: '13.0.0',
    },
    requiredSeries: ['heapUsedBytes', 'rssBytes'],
    slopeBounds: { heapUsedBytes: 10, rssBytes: 20 },
    minSamplesPerSegment: 8,
    workloadTolerance: { maxDroppedOps: 0, maxTimeoutOps: 0 },
    restartPolicy: { kind: 'forbidden' },
    frozenAt: NOW,
    ...overrides,
  });
}

/** Flat series with deterministic jitter small enough to sit inside any sane bound. */
function plateau(cycle: number, base: number): number {
  return base + (cycle % 5) - 2;
}

function healthyWorkload(): SoakWorkload {
  return {
    runCycle: () => Promise.resolve({ attempted: 100, completed: 100, dropped: 0, timeouts: 0 }),
  };
}

function plateauSampler(): SoakSampler {
  return {
    sample: (cycleIndex) =>
      Promise.resolve({
        heapUsedBytes: plateau(cycleIndex, BASE_HEAP),
        rssBytes: plateau(cycleIndex, BASE_RSS),
      }),
  };
}

function leakingSampler(growthPerCycle: number): SoakSampler {
  return {
    sample: (cycleIndex) =>
      Promise.resolve({
        heapUsedBytes: BASE_HEAP + growthPerCycle * cycleIndex,
        rssBytes: plateau(cycleIndex, BASE_RSS),
      }),
  };
}

function strictRestarter(): SoakRestarter & { calls: number } {
  const recorder = {
    calls: 0,
    restart: () => {
      recorder.calls += 1;
      return Promise.resolve({ restartedAt: NOW, restarted: true });
    },
  };
  return recorder;
}

async function run(input: {
  plan: SoakPlan;
  workload?: SoakWorkload;
  sampler?: SoakSampler;
  restarter?: SoakRestarter;
  profiler?: { overheadCalibrated: boolean; calibrationRef: string };
  msPerCycle?: number;
}): Promise<ReturnType<typeof runSoakCampaign>> {
  let now = Date.parse(NOW);
  const msPerCycle = input.msPerCycle ?? 1_000;
  return runSoakCampaign({
    plan: input.plan,
    workload: input.workload ?? healthyWorkload(),
    sampler: input.sampler ?? plateauSampler(),
    ...(input.restarter === undefined ? {} : { restarter: input.restarter }),
    profiler: input.profiler ?? { overheadCalibrated: true, calibrationRef: 'cal-1' },
    nowIso: () => new Date(now).toISOString(),
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
    cycleMs: msPerCycle,
  });
}

describe('soak plan freeze', () => {
  it('binds the frozen bytes to the digest and refuses drift', () => {
    const frozen = plan();
    expect(verifySoakPlan(frozen).digest).toBe(frozen.digest);
    expect(() => verifySoakPlan({ ...frozen, planId: 'tampered-plan' })).toThrow(/drift/);
  });

  it('refuses a horizon at or below the known onset', () => {
    expect(() =>
      plan({ horizon: { cycles: 50_000, minDurationMs: 24 * 3_600_000 } }),
    ).toThrow(/onset/);
    expect(() =>
      plan({ horizon: { cycles: 200_000, minDurationMs: 6 * 3_600_000 } }),
    ).toThrow(/onset/);
  });

  it('requires a slope bound for every required series', () => {
    expect(() =>
      plan({ requiredSeries: ['heapUsedBytes', 'rssBytes', 'fds'], slopeBounds: { heapUsedBytes: 10, rssBytes: 20 } }),
    ).toThrow(/slope bound/);
  });
});

describe('soak qualification labels', () => {
  it('reports a green smoke run as smoke-only, never qualified (NEG3-40)', async () => {
    const smoke = plan({
      profileId: 'node-api-smoke',
      provenance: { kind: 'smoke', detail: 'short local fixture, 10 cycles' },
      knownOnset: { cycles: 5, minDurationMs: 1_000 },
      horizon: { cycles: 10, minDurationMs: 5_000 },
    });
    const { receipt, report } = await run({ plan: smoke, msPerCycle: 1_000 });
    expect(receipt.cyclesCompleted).toBe(10);
    expect(report.checks.every((check) => check.pass)).toBe(true);
    expect(report.qualification).toBe('smoke-only');
  });

  it('qualifies a full-horizon plateau run with all checks green', async () => {
    const full = plan({
      knownOnset: { cycles: 5, minDurationMs: 1_000 },
      horizon: { cycles: 10, minDurationMs: 5_000 },
    });
    const { report } = await run({ plan: full, msPerCycle: 1_000 });
    expect(report.checks.every((check) => check.pass)).toBe(true);
    expect(report.qualification).toBe('qualified');
  });

  it('invalidates a full-horizon run that never reaches its horizon (NEG3-40)', async () => {
    const full = plan({
      knownOnset: { cycles: 5, minDurationMs: 1_000 },
      horizon: { cycles: 10, minDurationMs: 5_000 },
    });
    const shortWorkload: SoakWorkload = {
      runCycle: (cycleIndex) => {
        if (cycleIndex >= 4) {
          throw new Error('worker stopped early');
        }
        return Promise.resolve({ attempted: 100, completed: 100, dropped: 0, timeouts: 0 });
      },
    };
    const { report } = await run({ plan: full, workload: shortWorkload, msPerCycle: 1_000 });
    expect(report.qualification).toBe('invalid');
    expect(report.checks.find((check) => check.id === 'horizon-reached')?.pass).toBe(false);
  });
});

describe('soak series and workload evidence', () => {
  function smallPlan(): SoakPlan {
    return plan({
      knownOnset: { cycles: 5, minDurationMs: 1_000 },
      horizon: { cycles: 10, minDurationMs: 5_000 },
    });
  }

  it('fails the heap series on a real leak and passes a plateau', async () => {
    const leaking = await run({ plan: smallPlan(), sampler: leakingSampler(1_000), msPerCycle: 1_000 });
    expect(leaking.report.checks.find((check) => check.id === 'series-heapUsedBytes')?.pass).toBe(false);
    expect(leaking.report.qualification).toBe('invalid');
    const flat = await run({ plan: smallPlan(), msPerCycle: 1_000 });
    expect(flat.report.checks.find((check) => check.id === 'series-heapUsedBytes')?.pass).toBe(true);
  });

  it('treats a segment with too few samples as inconclusive, not a pass', async () => {
    const tiny = plan({
      knownOnset: { cycles: 1, minDurationMs: 100 },
      horizon: { cycles: 4, minDurationMs: 400 },
      provenance: { kind: 'smoke', detail: 'fewer cycles than minSamplesPerSegment' },
    });
    const { report } = await run({ plan: tiny, msPerCycle: 1_000 });
    expect(report.checks.find((check) => check.id === 'series-heapUsedBytes')?.pass).toBe(false);
    expect(report.qualification).toBe('invalid');
  });

  it('rejects dropped traffic beyond tolerance and accounting gaps (NEG3-18)', async () => {
    const dropping: SoakWorkload = {
      runCycle: () => Promise.resolve({ attempted: 100, completed: 80, dropped: 20, timeouts: 0 }),
    };
    const dropped = await run({ plan: smallPlan(), workload: dropping, msPerCycle: 1_000 });
    expect(dropped.report.checks.find((check) => check.id === 'workload-accounted')?.pass).toBe(false);
    expect(dropped.report.qualification).toBe('invalid');

    const gapped: SoakWorkload = {
      runCycle: () => Promise.resolve({ attempted: 100, completed: 90, dropped: 0, timeouts: 0 }),
    };
    const gap = await run({ plan: smallPlan(), workload: gapped, msPerCycle: 1_000 });
    expect(gap.report.checks.find((check) => check.id === 'workload-accounted')?.pass).toBe(false);
  });

  it('treats an uncalibrated profiler as inconclusive, never a pass (NEG3-18)', async () => {
    const { report } = await run({
      plan: smallPlan(),
      profiler: { overheadCalibrated: false, calibrationRef: 'none' },
      msPerCycle: 1_000,
    });
    expect(report.checks.find((check) => check.id === 'profiler-calibrated')?.pass).toBe(false);
    expect(report.qualification).toBe('invalid');
  });
});

describe('soak restart policy', () => {
  function smallPlan(): SoakPlan {
    return plan({
      knownOnset: { cycles: 5, minDurationMs: 1_000 },
      horizon: { cycles: 10, minDurationMs: 5_000 },
    });
  }

  it('invalidates a restart when the policy forbids it', async () => {
    const restarter = strictRestarter();
    // A restarter is wired but the policy forbids restarts: the supervisor
    // must never call it; any recorded restart is foreign to this plan.
    const frozen = smallPlan();
    expect(restarter.calls).toBe(0);
    const { report } = await run({ plan: frozen, restarter, msPerCycle: 1_000 });
    expect(restarter.calls).toBe(0);
    expect(report.checks.find((check) => check.id === 'restart-policy')?.pass).toBe(true);
    expect(report.qualification).toBe('qualified');
  });

  it('invalidates a restart the threshold cannot explain', async () => {
    const allowed = plan({
      knownOnset: { cycles: 5, minDurationMs: 1_000 },
      horizon: { cycles: 10, minDurationMs: 5_000 },
      restartPolicy: { kind: 'on-threshold', metric: 'heapUsedBytes', threshold: BASE_HEAP + 1_000_000 },
    });
    // Plateau samples never reach the threshold, so no restart may happen.
    const restarter = strictRestarter();
    const { receipt, report } = await run({ plan: allowed, restarter, msPerCycle: 1_000 });
    expect(restarter.calls).toBe(0);
    expect(report.checks.find((check) => check.id === 'restart-policy')?.pass).toBe(true);
    // A restart recorded below the threshold is unexplained: it hides, not heals.
    const forged = reduceSoak({
      plan: allowed,
      receipt: {
        ...receipt,
        restarts: [
          {
            cycleIndex: 3,
            metric: 'heapUsedBytes',
            observed: BASE_HEAP,
            threshold: BASE_HEAP + 1_000_000,
            restarted: true,
          },
        ],
      },
    });
    expect(forged.checks.find((check) => check.id === 'restart-policy')?.pass).toBe(false);
    expect(forged.qualification).toBe('invalid');
  });

  it('still catches a leak inside segments after an explained restart', async () => {
    const allowed = plan({
      knownOnset: { cycles: 5, minDurationMs: 1_000 },
      horizon: { cycles: 20, minDurationMs: 5_000 },
      restartPolicy: { kind: 'on-threshold', metric: 'heapUsedBytes', threshold: BASE_HEAP + 5_000 },
      minSamplesPerSegment: 4,
      slopeBounds: { heapUsedBytes: 10, rssBytes: 20 },
    });
    // Heap grows past the threshold, the restart resets the sampler baseline,
    // then growth continues: both segments must be evaluated, not averaged.
    let baseline = BASE_HEAP;
    const sampler: SoakSampler = {
      sample: (cycleIndex) =>
        Promise.resolve({
          heapUsedBytes: baseline + 1_000 * cycleIndex,
          rssBytes: plateau(cycleIndex, BASE_RSS),
        }),
    };
    const restarter: SoakRestarter = {
      restart: () => {
        baseline = BASE_HEAP;
        return Promise.resolve({ restartedAt: NOW, restarted: true });
      },
    };
    const { report } = await run({ plan: allowed, sampler, restarter, msPerCycle: 1_000 });
    expect(report.checks.find((check) => check.id === 'restart-policy')?.pass).toBe(true);
    expect(report.checks.find((check) => check.id === 'series-heapUsedBytes')?.pass).toBe(false);
    expect(report.qualification).toBe('invalid');
  });

  it('rejects a receipt that restarts without calling the policy path', async () => {
    const frozen = smallPlan();
    const { receipt } = await run({ plan: frozen, msPerCycle: 1_000 });
    const forged = {
      ...receipt,
      restarts: [
        { cycleIndex: 3, metric: 'heapUsedBytes' as const, observed: BASE_HEAP, threshold: null, restarted: true },
      ],
    };
    const report = reduceSoak({ plan: frozen, receipt: forged });
    expect(report.checks.find((check) => check.id === 'restart-policy')?.pass).toBe(false);
    expect(report.qualification).toBe('invalid');
  });
});
