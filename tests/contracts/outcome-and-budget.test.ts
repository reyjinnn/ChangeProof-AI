import { describe, expect, it } from 'vitest';

import {
  BundleAssessmentSchema,
  DimensionAssessmentSchema,
  ExecutionBudgetSchema,
  ExperimentPlanSchema,
  TargetAssessmentSchema,
  TrialReceiptSchema,
  parseExecutionBudget,
} from '../../src/core/index.js';

/**
 * WP3-01 / T1-1 — outcome, dimension and budget negatives.
 *
 * NEG3-13  budget is never reset by retry/resume/cancel.
 * NEG3-15  one green run is not campaign completion.
 * NEG3-18  an invalid measurement neither passes nor fails a dimension.
 * NEG3-20  a cosmetic retry is not progress.
 */
describe('TargetOutcome is a closed enum', () => {
  const base = {
    schemaVersion: '1' as const,
    subject: { kind: 'consumer' as const, id: 'consumer-a' },
    proofScope: {
      targets: [{ kind: 'consumer' as const, id: 'consumer-a' }],
      edges: [],
      invariants: ['order-total-invariant'],
    },
    policyVersion: '1',
    // A positive outcome must cite the evidence it rests on.
    evidenceRefs: ['runs/run-1/evidence.json'],
  };

  it('accepts every declared outcome', () => {
    for (const outcome of ['fixed', 'no_impact_verified', 'unverified', 'partial', 'failed'] as const) {
      expect(TargetAssessmentSchema.parse({ ...base, outcome }).outcome).toBe(outcome);
    }
  });

  it('rejects a positive outcome that cites no evidence', () => {
    for (const outcome of ['fixed', 'no_impact_verified'] as const) {
      expect(() =>
        TargetAssessmentSchema.parse({ ...base, outcome, evidenceRefs: [] }),
      ).toThrow();
    }
  });

  it('rejects an outcome outside the declared set', () => {
    expect(() => TargetAssessmentSchema.parse({ ...base, outcome: 'probably_fixed' })).toThrow();
    expect(() => TargetAssessmentSchema.parse({ ...base, outcome: 'verified' })).toThrow();
  });
});

describe('BundleAssessment evaluation order is expressible, not averaged', () => {
  const bundle = (state: string, extras: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const,
    state,
    candidateBundleDigest: 'c'.repeat(64),
    requiredTargets: [{ kind: 'consumer' as const, id: 'consumer-a' }],
    ...extras,
  });

  it('accepts each declared state when its own invariants hold', () => {
    const validInputs = [
      bundle('verified', {
        intentFulfilled: true,
        mixedVersionChecksPassed: true,
        identitiesFresh: true,
        policyVersion: '1',
      }),
      bundle('incomplete', { policyVersion: '1' }),
      bundle('blocked', { blockingReasons: ['required check failed'], policyVersion: '1' }),
      bundle('invalid', { policyVersion: '1' }),
    ];

    for (const input of validInputs) {
      expect(BundleAssessmentSchema.parse(input).state).toBe(input.state);
    }
  });

  it('rejects a bundle state that is not one of the four', () => {
    expect(() => BundleAssessmentSchema.parse(bundle('mostly_verified'))).toThrow();
    expect(() => BundleAssessmentSchema.parse(bundle('stale'))).toThrow();
  });

  it('rejects a bundle with no required target: an empty denominator is not proof (FR3-06)', () => {
    expect(() =>
      BundleAssessmentSchema.parse({ ...bundle('verified'), requiredTargets: [] }),
    ).toThrow();
  });
});

describe('DimensionAssessment (NEG3-18)', () => {
  const dimension = (overrides: Record<string, unknown>) => ({
    schemaVersion: '1' as const,
    dimension: 'correctness',
    required: true,
    metricIds: ['business-invariant-1'],
    result: 'pass',
    rawRefs: ['runs/run-1/observations.json'],
    ...overrides,
  });

  it('accepts each declared result when its own invariants hold', () => {
    const inputs = [
      dimension({ result: 'pass' }),
      dimension({ result: 'fail' }),
      dimension({ result: 'inconclusive' }),
      dimension({ result: 'not_applicable', notApplicableJustification: 'no throughput contract in scope' }),
    ];

    for (const input of inputs) {
      expect(DimensionAssessmentSchema.parse(input).result).toBe(input.result);
    }
  });

  it('requires a justification when a dimension is declared not_applicable', () => {
    // FR3-27: not_applicable must be approved and justified before the run,
    // never chosen after a failure to make the run look clean.
    expect(() =>
      DimensionAssessmentSchema.parse(dimension({ result: 'not_applicable' })),
    ).toThrow();
    expect(
      DimensionAssessmentSchema.parse(
        dimension({ result: 'not_applicable', notApplicableJustification: 'no throughput contract in scope' }),
      ).result,
    ).toBe('not_applicable');
  });

  it('forbids an invalid measurement from being recorded as a pass', () => {
    // An observation set that failed measurement validity is inconclusive by
    // construction; accepting `pass` here would let dropped traffic read as an
    // improvement (NEG3-18).
    expect(() =>
      DimensionAssessmentSchema.parse(
        dimension({ result: 'pass', measurementValidity: 'invalid' }),
      ),
    ).toThrow();
  });

  it('requires at least one raw reference for a non-not_applicable result', () => {
    expect(() => DimensionAssessmentSchema.parse(dimension({ rawRefs: [] }))).toThrow();
  });
});

describe('ExecutionBudget is monotonic (NEG3-13)', () => {
  const budget = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const,
    profileId: 'profile-default',
    profileConfigDigest: 'd'.repeat(64),
    limits: {
      modelCostUsd: 10,
      modelRequests: 100,
      wallTimeMs: 600_000,
      cpuMs: 1_000_000,
      maxPids: 128,
      diskBytes: 1_000_000_000,
    },
    reserve: { modelCostUsd: 2, wallTimeMs: 60_000 },
    usage: {
      modelCostUsd: 1,
      modelRequests: 5,
      wallTimeMs: 1000,
      cpuMs: 5000,
      peakPids: 12,
      diskBytes: 1000,
    },
    ...overrides,
  });

  it('accepts a finite, consistent budget', () => {
    expect(ExecutionBudgetSchema.parse(budget()).limits.modelCostUsd).toBe(10);
  });

  it('rejects an unlimited budget: every limit is finite (FR3-14)', () => {
    expect(() =>
      ExecutionBudgetSchema.parse({
        ...budget(),
        limits: { ...budget().limits, modelCostUsd: Number.POSITIVE_INFINITY },
      }),
    ).toThrow();

    expect(() =>
      ExecutionBudgetSchema.parse({
        ...budget(),
        limits: { ...budget().limits, wallTimeMs: -1 },
      }),
    ).toThrow();
  });

  it('rejects usage that exceeded the limit — that is a resource blocker, not a reset', () => {
    expect(() =>
      ExecutionBudgetSchema.parse({
        ...budget(),
        usage: { ...budget().usage, modelCostUsd: 11 },
      }),
    ).toThrow();
  });

  it('refuses to carry usage backwards across a resume (no silent reset)', () => {
    const previous = ExecutionBudgetSchema.parse(budget());
    const resumed = { ...budget(), usage: { ...budget().usage, modelCostUsd: 0 } };

    expect(() => parseExecutionBudget(resumed, { priorUsage: previous.usage })).toThrow();
  });

  it('allows a resume that preserves or increases usage', () => {
    const previous = ExecutionBudgetSchema.parse(budget());
    const advanced = { ...budget(), usage: { ...budget().usage, modelCostUsd: 3 } };

    expect(
      parseExecutionBudget(advanced, { priorUsage: previous.usage }).usage.modelCostUsd,
    ).toBe(3);
  });
});

describe('campaign completeness (NEG3-15, NEG3-20)', () => {
  const plan = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const,
    planVersion: 1,
    planHash: 'e'.repeat(64),
    subjects: [{ kind: 'consumer' as const, id: 'consumer-a' }],
    workload: { arrivalDistribution: 'steady', concurrency: 4, dataSkew: 'none' },
    resetSemantics: 'fresh-database-per-trial',
    seeds: [1, 2, 3],
    intendedSchedules: [
      {
        id: 'schedule-1',
        faultStartMs: 1000,
        faultDurationMs: 500,
        faultTarget: 'orders-api:checkout-handler',
      },
    ],
    observations: ['latency', 'error-rate'],
    trialUnit: 'trial',
    n: 10,
    warmupTrials: 2,
    measurementWindow: { kind: 'fixed', durationMs: 5000 },
    thresholds: [{ metricId: 'latency', statistic: 'p95', comparison: 'lte', value: 200, unit: 'ms' }],
    stopRules: [{ kind: 'censor', afterTrials: 20 }],
    forecast: { estimatedCostUsd: 5, estimatedWallTimeMs: 600_000 },
    ...overrides,
  });

  it('accepts a fully declared plan', () => {
    expect(ExperimentPlanSchema.parse(plan()).n).toBe(10);
  });

  it('rejects a plan with no trials', () => {
    expect(() => ExperimentPlanSchema.parse(plan({ n: 0 }))).toThrow();
  });

  it('rejects a plan with no threshold to compare against', () => {
    expect(() => ExperimentPlanSchema.parse(plan({ thresholds: [] }))).toThrow();
  });

  it('rejects a plan with no stop or censor rule', () => {
    expect(() => ExperimentPlanSchema.parse(plan({ stopRules: [] }))).toThrow();
  });

  const receipt = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const,
    planHash: 'e'.repeat(64),
    candidateBundleDigest: 'c'.repeat(64),
    environmentIdentity: 'image@sha256:' + 'f'.repeat(64),
    actualSeed: 1,
    actualSchedule: { id: 'schedule-1', appliedAtMs: 1000, removedAtMs: 1500 },
    faultApplied: true,
    faultRemoved: true,
    counts: { planned: 10, completed: 10, failed: 0, invalid: 0, censored: 0, notRun: 0 },
    result: 'pass',
    telemetryRefs: ['runs/run-1/telemetry.json'],
    ...overrides,
  });

  it('accepts a complete receipt whose counts reconcile', () => {
    expect(TrialReceiptSchema.parse(receipt()).counts.completed).toBe(10);
  });

  it('rejects counts that do not account for every planned trial', () => {
    expect(() =>
      TrialReceiptSchema.parse(
        receipt({ counts: { planned: 10, completed: 3, failed: 0, invalid: 0, censored: 0, notRun: 0 } }),
      ),
    ).toThrow();
  });

  it('rejects a receipt that claims success from an incomplete campaign (NEG3-15)', () => {
    expect(() =>
      TrialReceiptSchema.parse(
        receipt({
          counts: { planned: 10, completed: 1, failed: 0, invalid: 0, censored: 0, notRun: 9 },
          result: 'pass',
        }),
      ),
    ).toThrow();
  });

  it('rejects a receipt claiming a fault was removed when it never healed (NEG3-17)', () => {
    expect(() =>
      TrialReceiptSchema.parse(receipt({ faultApplied: true, faultRemoved: false, result: 'pass' })),
    ).toThrow();
  });

  it('requires a stated reason when a trial is excluded', () => {
    expect(() =>
      TrialReceiptSchema.parse(receipt({ result: 'excluded' })),
    ).toThrow();
    expect(
      TrialReceiptSchema.parse(receipt({ result: 'excluded', exclusionReason: 'harness flake' })).result,
    ).toBe('excluded');
  });
});
