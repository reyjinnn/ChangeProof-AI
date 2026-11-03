import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EvalComparison, EvalManifest } from '../../src/core/index.js';
import {
  checkAbort,
  checkRelease,
  createFileCaseStore,
  freezeManifest,
  reduceComparison,
  reducePredictors,
} from '../../src/modules/evaluation/index.js';

/**
 * WP3-13 / T-33 — comparison, abort, and release failure-path tests (NEG3-13, NEG3-15).
 *
 * Written before the implementation. Arms compare only over the same frozen
 * dataset, evaluator, budget, and oracle; every case lands in exactly one
 * outcome bucket with its cost attributed; exclusions stay visible with
 * reasons; abort stops runaway arms; and release gates report per arm
 * without averaging anything away.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const DIGEST = 'e'.repeat(64);

function manifest(): EvalManifest {
  const store = createFileCaseStore(mkdtempSync(join(tmpdir(), 'changeproof-eval-')));
  return freezeManifest({
    manifestId: 'manifest-1',
    cases: [
      {
        caseId: 'dev-1',
        dataset: 'dev',
        pack: 'functionality',
        suite: 'core',
        origin: 'controlled_change',
        intermittent: false,
        predictors: [],
        inputText: 'input one',
        oracleRef: 'oracle-1',
        fixability: 'fixable',
      },
      {
        caseId: 'dev-2',
        dataset: 'dev',
        pack: 'refusal',
        suite: 'safety',
        origin: 'controlled_change',
        intermittent: false,
        predictors: [],
        inputText: 'input two',
        oracleRef: 'oracle-1',
        fixability: 'fixable',
      },
    ],
    arms: [
      {
        evaluationVersion: 'eval-1',
        datasetVersion: 'dev-1',
        armId: 'B0',
        modelIdentity: 'model-baseline-1',
        configDigest: DIGEST,
        allowedInputs: [],
        allowedTools: [],
        feedbackDisclosure: 'none',
        commonBudget: { modelCostUsd: 10, wallTimeMs: 60_000 },
        terminalRules: ['stop-at-budget'],
        evaluatorIdentity: 'evaluator-1',
        oracleIdentity: 'oracle-1',
        caseOrder: 'fixed',
        repetitionPolicy: { repeats: 1, selection: 'first_pass_only' },
        frozenAt: NOW,
      },
      {
        evaluationVersion: 'eval-1',
        datasetVersion: 'dev-1',
        armId: 'Full',
        ablationOf: 'B0',
        modelIdentity: 'model-candidate-2',
        configDigest: DIGEST,
        allowedInputs: [],
        allowedTools: [],
        feedbackDisclosure: 'none',
        commonBudget: { modelCostUsd: 10, wallTimeMs: 60_000 },
        terminalRules: ['stop-at-budget'],
        evaluatorIdentity: 'evaluator-1',
        oracleIdentity: 'oracle-1',
        caseOrder: 'fixed',
        repetitionPolicy: { repeats: 1, selection: 'first_pass_only' },
        frozenAt: NOW,
      },
    ],
    abortPolicy: { maxConsecutiveInfraFailures: 3, maxCostOverrunRatio: 1.5 },
    releaseCriteria: [],
    createdAt: NOW,
    store,
  });
}

function resultFor(manifestDigest: string, armId: string) {
  return {
    schemaVersion: '1' as const,
    manifestDigest,
    armId,
    caseResults: [
      {
        caseId: 'dev-1',
        outcome: 'resolved' as const,
        costUnits: 3,
        regressed: false,
        trialsCompleted: 1,
        trialsRequired: 1,
      },
      {
        caseId: 'dev-2',
        outcome: 'failed' as const,
        costUnits: 4,
        excludedCost: { units: 2, reason: 'provider outage window, retried cleanly' },
        regressed: true,
        trialsCompleted: 1,
        trialsRequired: 1,
      },
    ],
    aborted: false,
    startedAt: NOW,
    finishedAt: NOW,
  };
}

describe('comparison gates (NEG3-13, NEG3-15)', () => {
  it('compares equal arms with denominators and attributed costs', () => {
    const frozen = manifest();
    const comparison = reduceComparison({
      manifest: frozen,
      results: [resultFor(frozen.digest, 'B0'), resultFor(frozen.digest, 'Full')],
    });
    expect(comparison.comparable).toBe(true);
    expect(comparison.incomparabilityReasons).toEqual([]);
    const full = comparison.arms.find((arm) => arm.armId === 'Full');
    expect(full).toMatchObject({
      resolved: 1,
      failed: 1,
      regressions: 1,
      denominator: 2,
      resolvedRate: 0.5,
      grossCost: 9,
      netCost: 7,
    });
    expect(full?.excluded).toEqual([
      { caseId: 'dev-2', units: 2, reason: 'provider outage window, retried cleanly' },
    ]);
  });

  it('refuses to compare arms with different evaluators, budgets, or datasets', () => {
    const frozen = manifest();
    const tampered = {
      ...frozen,
      arms: frozen.arms.map((arm) =>
        arm.armId === 'Full' ? { ...arm, evaluatorIdentity: 'evaluator-2' } : arm,
      ),
    };
    const comparison = reduceComparison({
      manifest: tampered,
      results: [resultFor(frozen.digest, 'B0'), resultFor(frozen.digest, 'Full')],
    });
    expect(comparison.comparable).toBe(false);
    expect(comparison.incomparabilityReasons.join(' ')).toMatch(/evaluator/);
  });

  it('refuses arms with missing, duplicated, or foreign cases', () => {
    const frozen = manifest();
    const missing = resultFor(frozen.digest, 'Full');
    const firstResult = missing.caseResults[0];
    if (firstResult === undefined) {
      throw new Error('fixture is empty');
    }
    const comparison = reduceComparison({
      manifest: frozen,
      results: [resultFor(frozen.digest, 'B0'), { ...missing, caseResults: [firstResult] }],
    });
    expect(comparison.comparable).toBe(false);
    expect(comparison.incomparabilityReasons.join(' ')).toMatch(/missing/);
  });

  it('marks aborted arms incomparable instead of comparing partial data', () => {
    const frozen = manifest();
    const aborted = { ...resultFor(frozen.digest, 'Full'), aborted: true, abortReason: 'infra failures' };
    const comparison = reduceComparison({
      manifest: frozen,
      results: [resultFor(frozen.digest, 'B0'), aborted],
    });
    expect(comparison.comparable).toBe(false);
    expect(comparison.incomparabilityReasons.join(' ')).toMatch(/aborted/);
  });

  it('reports a null rate over an empty denominator, never zero', () => {
    const frozen = manifest();
    const empty = reduceComparison({
      manifest: frozen,
      results: [
        { ...resultFor(frozen.digest, 'B0'), caseResults: [] },
        resultFor(frozen.digest, 'Full'),
      ],
    });
    const arm = empty.arms.find((row) => row.armId === 'B0');
    expect(arm?.resolvedRate).toBeNull();
    expect(empty.comparable).toBe(false);
  });
});

describe('abort policy', () => {
  const policy = { maxConsecutiveInfraFailures: 3, maxCostOverrunRatio: 1.5 };

  it('aborts on runaway infra failures or cost overrun', () => {
    expect(checkAbort({ consecutiveInfraFailures: 3, spentUnits: 5, budgetUnits: 10 }, policy).abort).toBe(true);
    expect(checkAbort({ consecutiveInfraFailures: 0, spentUnits: 16, budgetUnits: 10 }, policy).abort).toBe(true);
  });

  it('continues inside the frozen bounds', () => {
    expect(checkAbort({ consecutiveInfraFailures: 2, spentUnits: 10, budgetUnits: 10 }, policy).abort).toBe(false);
  });
});

describe('release criteria', () => {
  it('reports per-arm gates without averaging', () => {
    const frozen = manifest();
    const comparison: EvalComparison = reduceComparison({
      manifest: frozen,
      results: [resultFor(frozen.digest, 'B0'), resultFor(frozen.digest, 'Full')],
    });
    const report = checkRelease({
      comparison,
      results: [resultFor(frozen.digest, 'B0'), resultFor(frozen.digest, 'Full')],
      manifest: frozen,
      criteria: [
        { id: 'rate', kind: 'min_resolved_rate', value: 0.5 },
        { id: 'regressions', kind: 'max_regressions', value: 0 },
        { id: 'safety-present', kind: 'suite_present', suite: 'safety', value: 0 },
      ],
    });
    expect(report.overall).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ criterionId: 'rate', armId: 'Full', pass: true }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({ criterionId: 'regressions', armId: 'Full', pass: false }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({ criterionId: 'safety-present', pass: true }),
    );
  });

  it('fails a rate gate over an empty suite instead of passing vacuously', () => {
    const frozen = manifest();
    const comparison = reduceComparison({
      manifest: frozen,
      results: [resultFor(frozen.digest, 'B0'), resultFor(frozen.digest, 'Full')],
    });
    const report = checkRelease({
      comparison,
      results: [resultFor(frozen.digest, 'B0'), resultFor(frozen.digest, 'Full')],
      manifest: frozen,
      criteria: [{ id: 'empty', kind: 'min_resolved_rate', suite: 'no-such-suite', value: 0.5 }],
    });
    expect(report.overall).toBe(false);
  });
});

describe('predictor ranges', () => {
  it('groups empirical outcomes by predictor without inventing samples', () => {
    const ranges = reducePredictors([
      { predictors: ['a'], resolved: true },
      { predictors: ['a', 'b'], resolved: false },
      { predictors: ['b'], resolved: false },
    ]);
    expect(ranges).toContainEqual({ predictor: 'a', resolved: 1, total: 2 });
    expect(ranges).toContainEqual({ predictor: 'b', resolved: 0, total: 2 });
  });
});
