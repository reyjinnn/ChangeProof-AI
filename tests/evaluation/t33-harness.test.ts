import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { CaseOutcome, EvalManifest, EvaluationArm } from '../../src/core/index.js';
import {
  createFileCaseStore,
  freezeManifest,
  reduceComparison,
  runArm,
  verifyManifest,
  type EvalCaseRunner,
} from '../../src/modules/evaluation/index.js';

/**
 * WP3-13 / T-33 — harness integration over real files (no live services).
 *
 * Written before the implementation. Freezing writes content-addressed case
 * bytes; arms run case by case with trials enforcement and abort stops;
 * runner crashes land as incomplete with infra accounting; and the shipped
 * dev suite files freeze through the same path the reports will use.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const here = dirname(fileURLToPath(import.meta.url));
const benchDir = join(here, '..', '..', 'bench', 'suites');

function arm(armId: string, modelIdentity: string): EvaluationArm {
  return {
    evaluationVersion: 'eval-1',
    datasetVersion: 'dev-1',
    armId,
    modelIdentity,
    configDigest: 'c'.repeat(64),
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
  };
}

function freezeFour(): { manifest: EvalManifest; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'changeproof-eval-run-'));
  const store = createFileCaseStore(dir);
  const manifest = freezeManifest({
    manifestId: 'manifest-run',
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
      {
        caseId: 'dev-flaky',
        dataset: 'dev',
        pack: 'functionality',
        suite: 'core',
        origin: 'controlled_change',
        intermittent: true,
        campaign: { n: 3, schedule: 'hourly' },
        predictors: [],
        inputText: 'flaky input',
        oracleRef: 'oracle-1',
        fixability: 'unknown',
      },
    ],
    arms: [arm('B0', 'model-baseline-1'), arm('Full', 'model-candidate-2')],
    abortPolicy: { maxConsecutiveInfraFailures: 2, maxCostOverrunRatio: 2 },
    releaseCriteria: [],
    createdAt: NOW,
    store,
  });
  return { manifest, dir };
}

function scripted(outcomes: Readonly<Record<string, CaseOutcome>>): EvalCaseRunner {
  return {
    runCase: (input) => {
      const outcome = outcomes[input.case.caseId] ?? 'unresolved';
      return Promise.resolve({
        outcome,
        costUnits: 1,
        regressed: false,
        trialsCompleted: input.trialsRequired,
      });
    },
  };
}

describe('harness run (integration)', () => {
  it('runs arms case by case and reduces with denominators', async () => {
    const { manifest, dir } = freezeFour();
    const store = createFileCaseStore(dir);
    const b0 = await runArm({
      manifest,
      armId: 'B0',
      role: 'proposer',
      runner: scripted({ 'dev-1': 'resolved', 'dev-2': 'refused', 'dev-flaky': 'resolved' }),
      store,
      nowIso: () => NOW,
    });
    expect(b0.aborted).toBe(false);
    expect(b0.caseResults).toHaveLength(3);
    const flaky = b0.caseResults.find((row) => row.caseId === 'dev-flaky');
    expect(flaky).toMatchObject({ trialsCompleted: 3, trialsRequired: 3 });
    const full = await runArm({
      manifest,
      armId: 'Full',
      role: 'proposer',
      runner: scripted({ 'dev-1': 'resolved', 'dev-2': 'resolved', 'dev-flaky': 'unresolved' }),
      store,
      nowIso: () => NOW,
    });
    const comparison = reduceComparison({ manifest, results: [b0, full] });
    expect(comparison.comparable).toBe(true);
    expect(comparison.arms.find((row) => row.armId === 'Full')).toMatchObject({
      denominator: 3,
      resolvedRate: 2 / 3,
    });
  });

  it('lands runner crashes as incomplete and aborts runaway arms', async () => {
    const { manifest, dir } = freezeFour();
    const store = createFileCaseStore(dir);
    const crashing: EvalCaseRunner = {
      runCase: () => Promise.reject(new Error('runner exploded')),
    };
    const result = await runArm({
      manifest,
      armId: 'B0',
      role: 'proposer',
      runner: crashing,
      store,
      nowIso: () => NOW,
    });
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toMatch(/infra/);
    expect(result.caseResults.every((row) => row.outcome === 'incomplete')).toBe(true);
    const comparison = reduceComparison({
      manifest,
      results: [
        result,
        await runArm({
          manifest,
          armId: 'Full',
          role: 'proposer',
          runner: scripted({}),
          store,
          nowIso: () => NOW,
        }),
      ],
    });
    expect(comparison.comparable).toBe(false);
  });

  it('refuses terminal outcomes without their required trials', async () => {
    const { manifest, dir } = freezeFour();
    const store = createFileCaseStore(dir);
    const cheating: EvalCaseRunner = {
      runCase: () =>
        Promise.resolve({ outcome: 'resolved', costUnits: 1, regressed: false, trialsCompleted: 1 }),
    };
    await expect(
      runArm({ manifest, armId: 'B0', role: 'proposer', runner: cheating, store, nowIso: () => NOW }),
    ).rejects.toThrow(/trials/);
  });

  it('freezes the shipped dev suites through the same path', () => {
    for (const suite of ['dev-functionality.json', 'dev-refusal.json']) {
      const raw = JSON.parse(readFileSync(join(benchDir, suite), 'utf8')) as unknown;
      expect(Array.isArray(raw)).toBe(true);
      const dir = mkdtempSync(join(tmpdir(), 'changeproof-eval-suite-'));
      const store = createFileCaseStore(dir);
      const frozen = freezeManifest({
        manifestId: `manifest-${suite}`,
        cases: raw as Parameters<typeof freezeManifest>[0]['cases'],
        arms: [arm('B0', 'model-baseline-1')],
        abortPolicy: { maxConsecutiveInfraFailures: 3, maxCostOverrunRatio: 1.5 },
        releaseCriteria: [],
        createdAt: NOW,
        store,
      });
      expect(verifyManifest(frozen, store).digest).toBe(frozen.digest);
    }
  });
});
