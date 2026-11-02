import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DimensionAssessmentSchema,
  ExperimentPlanSchema,
  TrialReceiptSchema,
  type DimensionAssessment,
  type ExperimentPlan,
  type TrialReceipt,
} from '../../src/core/index.js';
import { createHypothesisLedger } from '../../src/modules/agent/index.js';
import { assessTarget, type TargetFacts } from '../../src/modules/policy/index.js';
import {
  GuestRunner,
  reduceMatchedWindows,
  summarizeCampaign,
} from '../../src/modules/verifier/index.js';

/**
 * WP3-18 / T-26 — suite-level negative pins (NEG3-08/15/17/18/20).
 *
 * Written before the native scenario campaigns. Each pin restates the suite
 * contract in one place: a single green run is `campaign_incomplete`, a dead
 * injector is `experiment_invalid`, lost traffic is never a performance pass,
 * an outage/timeout is `unverified` with cleanup, and a cosmetic retry stops
 * the branch with usage retained. The native files prove the same contracts
 * against real PostgreSQL/Redis.
 */

const digest = (seed: string): string => createHash('sha256').update(seed).digest('hex');

function plan(overrides: Partial<ExperimentPlan> = {}): ExperimentPlan {
  return ExperimentPlanSchema.parse({
    schemaVersion: '1',
    planVersion: 1,
    planHash: digest('t26-plan'),
    subjects: [{ kind: 'consumer', id: 'sc3-suite' }],
    workload: { arrivalDistribution: 'steady', concurrency: 2, dataSkew: 'none' },
    resetSemantics: 'fresh-database-per-trial',
    seeds: [41, 42, 43],
    intendedSchedules: [
      { id: 'sched-1', faultStartMs: 1000, faultDurationMs: 500, faultTarget: 'edge:orders-api' },
    ],
    observations: ['op-latency'],
    trialUnit: 'trial',
    n: 3,
    warmupTrials: 0,
    measurementWindow: { kind: 'matched', matchedTo: 'baseline-block-a' },
    thresholds: [{ metricId: 'op-latency', statistic: 'p50', comparison: 'lt', value: 200, unit: 'ms' }],
    stopRules: [{ kind: 'censor', afterTrials: 5 }],
    forecast: { estimatedCostUsd: 1.5, estimatedWallTimeMs: 60000 },
    ...overrides,
  });
}

function receipt(overrides: Partial<TrialReceipt> = {}): TrialReceipt {
  return TrialReceiptSchema.parse({
    schemaVersion: '1',
    planHash: digest('t26-plan'),
    candidateBundleDigest: digest('t26-candidate'),
    environmentIdentity: 't26-suite',
    actualSeed: 41,
    actualSchedule: { id: 'sched-1', appliedAtMs: 1000, removedAtMs: 1500 },
    faultApplied: false,
    faultRemoved: false,
    counts: { planned: 1, completed: 1, failed: 0, invalid: 0, censored: 0, notRun: 0 },
    result: 'pass',
    telemetryRefs: ['runs/sc3-18/trial-1.json'],
    ...overrides,
  });
}

function dimension(overrides: Partial<DimensionAssessment> = {}): DimensionAssessment {
  return DimensionAssessmentSchema.parse({
    schemaVersion: '1',
    dimension: 'correctness',
    required: true,
    metricIds: ['suite-metric'],
    result: 'pass',
    rawRefs: ['runs/sc3-18/dim.json'],
    ...overrides,
  });
}

function facts(overrides: Partial<TargetFacts> = {}): TargetFacts {
  return {
    subject: { kind: 'consumer', id: 'sc3-suite' },
    runState: 'completed',
    evidenceValidity: 'valid',
    oracleMatchesFrozen: true,
    regressionAttributed: true,
    exactPatchApplied: true,
    protectedProofComplete: true,
    intentPreserved: true,
    scopeFrozen: true,
    guardPassed: true,
    identitiesFresh: true,
    requiredDimensions: [dimension()],
    unresolvedRequiredEdges: [],
    skippedRequiredChecks: [],
    coverageSufficient: true,
    hasProgress: true,
    ...overrides,
  };
}

describe('one green run is not proof (NEG3-15)', () => {
  it('reports campaign_incomplete for a single green receipt of n=3', () => {
    const summary = summarizeCampaign([receipt()], plan());

    expect(summary.verdict).toBe('campaign_incomplete');
    expect(summary.reasonCode).toBe('campaign_incomplete');
    expect(summary.counts).toMatchObject({ planned: 3, completed: 1, notRun: 2 });
  });

  it('counts repeated seeds as trials, never as exact replay', () => {
    const summary = summarizeCampaign([receipt({ actualSeed: 41 }), receipt({ actualSeed: 41 })], plan());

    expect(summary.verdict).toBe('campaign_incomplete');
    expect(summary.counts.completed).toBe(2);
    expect(summary.counts.notRun).toBe(1);
  });
});

describe('a dead injector invalidates the experiment (NEG3-17)', () => {
  it('reports experiment_invalid when the fault never reached the target', () => {
    const summary = summarizeCampaign(
      [receipt({ result: 'excluded', exclusionReason: 'injector noop: no fault delivered' })],
      plan({ n: 1, seeds: [41] }),
    );

    expect(summary.verdict).toBe('experiment_invalid');
    expect(summary.reasonCode).toBe('experiment_invalid');
  });

  it('reports experiment_invalid when the fault was applied but never removed', () => {
    const summary = summarizeCampaign(
      [receipt({ faultApplied: true, faultRemoved: false, result: 'excluded', exclusionReason: 'heal failed' })],
      plan({ n: 1, seeds: [41] }),
    );

    expect(summary.verdict).toBe('experiment_invalid');
  });
});

describe('lost traffic is never an improvement (NEG3-18)', () => {
  it('marks the dimension invalid when observations were dropped', () => {
    const assessment = reduceMatchedWindows({
      dimension: 'performance',
      metricId: 'op-latency',
      algorithm: 'pooled-lower-median',
      config: { version: 1 },
      threshold: { comparison: 'lt', value: 200 },
      windows: [{ windowId: 'w1', observations: [10, 12, 11], droppedObservations: 40 }],
      rawRefs: ['runs/sc3-18/sc3-08-w1.json'],
    });

    expect(assessment.result).toBe('inconclusive');
    expect(assessment.measurementValidity).toBe('invalid');
  });

  it('marks the dimension invalid when timeouts were removed', () => {
    const assessment = reduceMatchedWindows({
      dimension: 'performance',
      metricId: 'op-latency',
      algorithm: 'pooled-lower-median',
      config: { version: 1 },
      threshold: { comparison: 'lt', value: 200 },
      windows: [{ windowId: 'w1', observations: [10, 12, 11], timeoutsRemoved: 3 }],
      rawRefs: ['runs/sc3-18/sc3-08-w1.json'],
    });

    expect(assessment.result).toBe('inconclusive');
    expect(assessment.measurementValidity).toBe('invalid');
  });
});

describe('outage and timeout withhold the verdict and force cleanup (NEG3-08)', () => {
  it('assesses unverified when the verifier timed out mid-campaign', () => {
    const assessment = assessTarget(facts({ evidenceValidity: 'inconclusive', hasProgress: false }));

    expect(assessment.outcome).toBe('unverified');
  });

  it('quarantines the environment when cleanup left survivors', () => {
    const runner = new GuestRunner();

    expect(() =>
      runner.recordCleanup({
        schemaVersion: '1',
        runId: 't26-timeout-run',
        completedAt: '2026-11-02T00:00:00.000Z',
        targets: [
          { kind: 'container', id: 'c1', removed: true },
          { kind: 'network', id: 'n1', removed: false },
        ],
        environmentReusable: false,
      }),
    ).toThrow(/quarantined/i);
    expect(runner.isQuarantined('t26-timeout-run')).toBe(true);
  });
});

describe('cosmetic retries stop the branch with usage retained (NEG3-20)', () => {
  function attemptInput(overrides: Record<string, unknown> = {}) {
    return {
      hypothesisId: 'hyp-1',
      candidateDigest: 'c'.repeat(64),
      patchDigest: 'p'.repeat(64),
      failureSignature: 'sc3-suite:fail',
      failureKind: 'runtime',
      checkRefs: ['sc3-check'],
      snapshotRefs: ['snap-1'],
      newEvidenceRefs: [],
      ...overrides,
    } as {
      hypothesisId: string;
      candidateDigest: string;
      patchDigest: string;
      failureSignature?: string;
      failureKind: string;
      checkRefs: string[];
      snapshotRefs: string[];
      newEvidenceRefs: string[];
    };
  }

  it('stops after two no-information attempts and keeps the spent usage', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    ledger.createHypothesis({ id: 'hyp-1', claim: 'Suite cause.' });
    const { probeId } = ledger.registerProbe({
      hypothesisId: 'hyp-1',
      predictedObservation: 'Distinguishes.',
      competingExplanation: 'Alternative.',
      costCap: 10,
      safetyScope: 'guest',
      stopRule: 'once',
    });
    ledger.recordProbeOutcome({ probeId, observation: 'nothing new', supportsClaim: false, costSpent: 4 });
    ledger.recordAttempt(attemptInput());
    ledger.recordAttempt(attemptInput());

    const assessment = ledger.assessBranch();
    expect(assessment.verdict).toBe('stop-branch');
    expect(assessment.blocker?.length).toBeGreaterThan(0);
    const snapshot = ledger.snapshot();
    const probe = snapshot.probes.find((entry) => entry.probeId === probeId);
    expect(probe?.costSpent).toBe(4);
  });
});
