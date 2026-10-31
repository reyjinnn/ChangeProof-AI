import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ExperimentPlanSchema,
  TrialReceiptSchema,
  type ExperimentPlan,
  type TrialReceipt,
} from '../../src/core/index.js';
import {
  summarizeCampaign,
  validateFaultTarget,
} from '../../src/modules/verifier/index.js';

/**
 * WP3-16 / T2-2 — campaign failure-path tests (NEG3-15, NEG3-17, FR3-26).
 *
 * Written before the implementation. A campaign is a pre-registered plan with
 * all-trial receipts: one green run out of n is `campaign_incomplete`, never a
 * pass, and a fault that was applied but never removed makes the experiment
 * invalid — never the application recovered. Fault authority stays in the
 * supervisor: only allowlisted targets are accepted, never raw network or
 * process-kill input.
 */

const digest = (seed: string): string => createHash('sha256').update(seed).digest('hex');

function plan(overrides: Partial<ExperimentPlan> = {}): ExperimentPlan {
  return ExperimentPlanSchema.parse({
    schemaVersion: '1',
    planVersion: 1,
    planHash: digest('p'),
    subjects: [{ kind: 'consumer', id: 'consumer-a' }],
    workload: { arrivalDistribution: 'steady', concurrency: 2, dataSkew: 'none' },
    resetSemantics: 'fresh-database-per-trial',
    seeds: [1, 2, 3],
    intendedSchedules: [
      { id: 'sched-1', faultStartMs: 1000, faultDurationMs: 500, faultTarget: 'edge:payments-api' },
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
    planHash: digest('p'),
    candidateBundleDigest: digest('c'),
    environmentIdentity: 'env-1',
    actualSeed: 1,
    actualSchedule: { id: 'sched-1', appliedAtMs: 1000, removedAtMs: 1500 },
    faultApplied: true,
    faultRemoved: true,
    counts: { planned: 1, completed: 1, failed: 0, invalid: 0, censored: 0, notRun: 0 },
    result: 'pass',
    telemetryRefs: ['telemetry/trial-1.json'],
    ...overrides,
  });
}

describe('campaign completeness is all-trial accounting (NEG3-15)', () => {
  it('reports campaign_incomplete when fewer trials ran than planned', () => {
    const summary = summarizeCampaign([receipt(), receipt()], plan());

    expect(summary.verdict).toBe('campaign_incomplete');
    expect(summary.reasonCode).toBe('campaign_incomplete');
    expect(summary.counts.notRun).toBe(1);
  });

  it('reports campaign_incomplete when the campaign never started', () => {
    const summary = summarizeCampaign([], plan());

    expect(summary.verdict).toBe('campaign_incomplete');
    expect(summary.counts.notRun).toBe(3);
  });

  it('reports campaign_complete only when every planned trial has a receipt', () => {
    const summary = summarizeCampaign([receipt(), receipt(), receipt()], plan());

    expect(summary.verdict).toBe('campaign_complete');
    expect(summary.counts.notRun).toBe(0);
  });

  it('refuses more receipts than the plan allows instead of counting a rerun as progress', () => {
    expect(() => summarizeCampaign([receipt(), receipt(), receipt(), receipt()], plan())).toThrow(
      /more receipts than planned/,
    );
  });
});

describe('a fault that never heals invalidates the experiment (NEG3-17)', () => {
  it('reports experiment_invalid when the fault was applied but never removed', () => {
    // The schema itself forbids `pass` for a stuck fault, so the receipt
    // carries `fail`; accounting still classifies it as invalid, not failed.
    const stuck = receipt({ faultApplied: true, faultRemoved: false, result: 'fail' });

    const summary = summarizeCampaign([stuck, receipt(), receipt()], plan());

    expect(summary.verdict).toBe('experiment_invalid');
    expect(summary.reasonCode).toBe('experiment_invalid');
  });

  it('reports experiment_invalid when receipts drift to another plan hash', () => {
    const drifted = receipt({ planHash: digest('q') });

    const summary = summarizeCampaign([drifted, receipt(), receipt()], plan());

    expect(summary.verdict).toBe('experiment_invalid');
  });

  it('fails closed on a malformed receipt instead of accounting around it', () => {
    const malformed = { ...receipt(), counts: { planned: 1 } };

    expect(() => summarizeCampaign([malformed as TrialReceipt], plan({ n: 1 }))).toThrow();
  });
});

describe('fault authority stays in the supervisor (FR3-26)', () => {
  const allowlist = ['edge:payments-api', 'process:worker-1'] as const;

  it('accepts an allowlisted edge target', () => {
    expect(validateFaultTarget('edge:payments-api', allowlist)).toBe('edge:payments-api');
  });

  it('rejects a target that is not allowlisted, even when it looks plausible', () => {
    expect(() => validateFaultTarget('edge:billing-api', allowlist)).toThrow(/allowlist/);
  });

  it('rejects raw network input that would widen the blast radius', () => {
    expect(() => validateFaultTarget('0.0.0.0/0', allowlist)).toThrow();
  });

  it('rejects shell input outright', () => {
    expect(() => validateFaultTarget('edge:payments-api; rm -rf /', allowlist)).toThrow();
  });

  it('rejects an empty target instead of defaulting to a fault', () => {
    expect(() => validateFaultTarget('', allowlist)).toThrow();
  });
});
