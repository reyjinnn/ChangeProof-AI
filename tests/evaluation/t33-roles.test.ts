import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EvalManifest } from '../../src/core/index.js';
import {
  createFileCaseStore,
  evaluatorCases,
  freezeManifest,
  proposerCases,
  reduceComparison,
} from '../../src/modules/evaluation/index.js';

/**
 * WP3-13 / T-33 — role separation failure-path tests (NEG3-03).
 *
 * Written before the implementation. Proposers see dev cases only, without
 * oracle or reference bindings; holdout bytes refuse proposer reads even by
 * digest; and comparison records carry aggregates only — serializing one
 * must never reveal case content, oracle text, or reference solutions.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const DEV_SECRET = 'dev-case-secret-alpha';
const HOLDOUT_SECRET = 'holdout-case-secret-omega';

function frozen(): { manifest: EvalManifest; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'changeproof-eval-roles-'));
  const store = createFileCaseStore(dir);
  const manifest = freezeManifest({
    manifestId: 'manifest-roles',
    cases: [
      {
        caseId: 'dev-1',
        dataset: 'dev',
        pack: 'functionality',
        suite: 'core',
        origin: 'controlled_change',
        intermittent: false,
        predictors: [],
        inputText: DEV_SECRET,
        oracleRef: 'oracle-dev-1',
        referenceDigest: 'a'.repeat(64),
        fixability: 'fixable',
      },
      {
        caseId: 'hold-1',
        dataset: 'holdout',
        pack: 'functionality',
        suite: 'core',
        origin: 'current_organic',
        intermittent: false,
        predictors: [],
        inputText: HOLDOUT_SECRET,
        oracleRef: 'oracle-hold-1',
        fixability: 'unknown',
      },
    ],
    arms: [
      {
        evaluationVersion: 'eval-1',
        datasetVersion: 'dev-1',
        armId: 'B0',
        modelIdentity: 'model-1',
        configDigest: 'b'.repeat(64),
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
  return { manifest, dir };
}

describe('role separation (NEG3-03)', () => {
  it('projects dev cases to proposers without oracle or reference bindings', () => {
    const { manifest } = frozen();
    const projected = proposerCases(manifest);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ caseId: 'dev-1' });
    expect(JSON.stringify(projected)).not.toContain('oracle-dev-1');
    expect(JSON.stringify(projected)).not.toContain('a'.repeat(64));
    expect(JSON.stringify(projected)).not.toContain(DEV_SECRET);
  });

  it('refuses proposer reads of holdout bytes even by digest', () => {
    const { manifest, dir } = frozen();
    const store = createFileCaseStore(dir);
    const holdout = manifest.cases.find((c) => c.caseId === 'hold-1');
    const dev = manifest.cases.find((c) => c.caseId === 'dev-1');
    if (holdout === undefined || dev === undefined) {
      throw new Error('fixture is empty');
    }
    expect(() => store.get(holdout.inputDigest, 'proposer', manifest)).toThrow(/[Hh]oldout/);
    expect(store.get(dev.inputDigest, 'proposer', manifest)).toBe(DEV_SECRET);
    expect(store.get(holdout.inputDigest, 'evaluator', manifest)).toBe(HOLDOUT_SECRET);
    expect(() => store.get('0'.repeat(64), 'evaluator', manifest)).toThrow(/unknown/);
  });

  it('shows evaluators every case with bindings intact', () => {
    const { manifest } = frozen();
    expect(evaluatorCases(manifest)).toHaveLength(2);
  });

  it('keeps case content out of comparison records', () => {
    const { manifest } = frozen();
    const comparison = reduceComparison({
      manifest,
      results: [
        {
          schemaVersion: '1',
          manifestDigest: manifest.digest,
          armId: 'B0',
          caseResults: [
            {
              caseId: 'dev-1',
              outcome: 'resolved',
              costUnits: 1,
              regressed: false,
              trialsCompleted: 1,
              trialsRequired: 1,
            },
            {
              caseId: 'hold-1',
              outcome: 'unresolved',
              costUnits: 1,
              regressed: false,
              trialsCompleted: 1,
              trialsRequired: 1,
            },
          ],
          aborted: false,
          startedAt: NOW,
          finishedAt: NOW,
        },
      ],
    });
    const serialized = JSON.stringify(comparison);
    expect(serialized).not.toContain(DEV_SECRET);
    expect(serialized).not.toContain(HOLDOUT_SECRET);
    expect(serialized).not.toContain('oracle-dev-1');
    expect(serialized).not.toContain('oracle-hold-1');
  });
});
