import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvalCaseSchema, type EvaluationArm } from '../../src/core/index.js';
import {
  createFileCaseStore,
  freezeManifest,
  verifyManifest,
} from '../../src/modules/evaluation/index.js';

/**
 * WP3-13 / T-33 — manifest freeze failure-path tests (NEG3-07).
 *
 * Written before the implementation. Freezing is deterministic over
 * canonical bytes; any drift in cases, arms, or policy changes the digest
 * and fails verification; intermittent packs without a pre-registered
 * campaign are refused; and arms from different evaluations never share a
 * manifest.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const ARM_B0 = 'b'.repeat(64);

function arm(overrides: Partial<EvaluationArm> = {}): EvaluationArm {
  return {
    evaluationVersion: 'eval-1',
    datasetVersion: 'dev-1',
    armId: 'B0',
    modelIdentity: 'model-baseline-1',
    configDigest: ARM_B0,
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
    ...overrides,
  };
}

function freezeInput(overrides: {
  cases?: Parameters<typeof freezeManifest>[0]['cases'];
  arms?: EvaluationArm[];
} = {}) {
  return {
    manifestId: 'manifest-1',
    cases: overrides.cases ?? [
      {
        caseId: 'dev-1',
        dataset: 'dev' as const,
        pack: 'functionality' as const,
        suite: 'core',
        origin: 'controlled_change' as const,
        intermittent: false,
        predictors: ['predictor-a'],
        inputText: 'case input one',
        oracleRef: 'oracle-1',
        fixability: 'fixable' as const,
      },
    ],
    arms: overrides.arms ?? [arm()],
    abortPolicy: { maxConsecutiveInfraFailures: 3, maxCostOverrunRatio: 1.5 },
    releaseCriteria: [],
    createdAt: NOW,
    store: createFileCaseStore(mkdtempSync(join(tmpdir(), 'changeproof-eval-'))),
  };
}

describe('manifest freeze (NEG3-07)', () => {
  it('freezes deterministically over canonical bytes', () => {
    const input = freezeInput();
    const first = freezeManifest(input);
    const second = freezeManifest(freezeInput());
    expect(first.digest).toBe(second.digest);
    expect(first.datasetDigest).toBe(second.datasetDigest);
    expect(verifyManifest(first, input.store)).toEqual(first);
  });

  it('fails verification on any drift in cases, arms, or policy', () => {
    const frozen = freezeManifest(freezeInput());
    const store = freezeInput().store;
    expect(() => verifyManifest({ ...frozen, digest: '0'.repeat(64) }, store)).toThrow(/digest/);
    const firstCase = frozen.cases[0];
    if (firstCase === undefined) {
      throw new Error('fixture is empty');
    }
    const drifted = { ...frozen, cases: [{ ...firstCase, fixability: 'unfixable' as const }] };
    expect(() => verifyManifest(drifted, store)).toThrow(/drift|digest/);
    const driftedArms = {
      ...frozen,
      arms: [{ ...frozen.arms[0], modelIdentity: 'model-other' }],
    };
    expect(() => verifyManifest(driftedArms, store)).toThrow(/drift|digest/);
  });

  it('refuses verification when case bytes are missing from the store', () => {
    const frozen = freezeManifest(freezeInput());
    const empty = createFileCaseStore(mkdtempSync(join(tmpdir(), 'changeproof-eval-empty-')));
    expect(() => verifyManifest(frozen, empty)).toThrow(/missing/);
  });

  it('refuses intermittent cases without a pre-registered campaign', () => {
    expect(() =>
      freezeManifest(
        freezeInput({
          cases: [
            {
              caseId: 'dev-flaky',
              dataset: 'dev',
              pack: 'functionality',
              suite: 'core',
              origin: 'controlled_change',
              intermittent: true,
              predictors: [],
              inputText: 'flaky input',
              oracleRef: 'oracle-1',
              fixability: 'unknown',
            },
          ],
        }),
      ),
    ).toThrow(/campaign/);
  });

  it('refuses arms from different evaluations and duplicate case ids', () => {
    expect(() =>
      freezeManifest(freezeInput({ arms: [arm(), arm({ armId: 'B1', evaluationVersion: 'eval-2' })] })),
    ).toThrow(/evaluation/);
    const one = freezeInput().cases[0];
    if (one === undefined) {
      throw new Error('fixture is empty');
    }
    expect(() => freezeManifest(freezeInput({ cases: [one, { ...one }] }))).toThrow(/[Dd]uplicate/);
  });

  it('rejects unknown schema versions instead of reinterpreting', () => {
    const frozen = freezeManifest(freezeInput());
    expect(() => EvalCaseSchema.parse({ ...frozen.cases[0], schemaVersion: '2' })).toThrow();
  });
});
