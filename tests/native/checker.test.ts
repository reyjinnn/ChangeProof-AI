import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  exploreModel,
  freezeFiniteModel,
  validateCounterexamples,
} from '../../src/modules/verifier/index.js';

/**
 * WP3-33 / T-37 — counterexample validation against a real target (native).
 *
 * A frozen mutex model is explored, and every counterexample schedule is
 * replayed through a real target process. Against the buggy target the
 * violation is confirmed (`violated`); against the fixed target every
 * counterexample is refuted and the model reports `model_invalid` — a
 * model that disagrees with reality never passes (NEG3-40).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, 'checker-target.mjs');

function model() {
  return freezeFiniteModel({
    modelId: 'mutex-buggy-native',
    states: ['idle', 'locked-a', 'locked-b', 'both'],
    initial: 'idle',
    transitions: [
      { from: 'idle', op: 'acquire-a', to: 'locked-a' },
      { from: 'idle', op: 'acquire-b', to: 'locked-b' },
      { from: 'locked-a', op: 'acquire-b', to: 'both' },
      { from: 'locked-b', op: 'acquire-a', to: 'both' },
      { from: 'locked-a', op: 'release-a', to: 'idle' },
      { from: 'locked-b', op: 'release-b', to: 'idle' },
      { from: 'both', op: 'release-a', to: 'locked-b' },
      { from: 'both', op: 'release-b', to: 'locked-a' },
    ],
    invariants: ['never-both'],
    bound: { maxDepth: 3, maxSchedules: 500 },
    frozenAt: new Date().toISOString(),
  });
}

function replay(mode: 'buggy' | 'fixed', schedule: readonly string[]): { endState: string; violated: string[] } {
  const output = execFileSync(process.execPath, [TARGET, mode, ...schedule], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const parsed = JSON.parse(output.trim()) as { endState: string; violated: string[] };
  if (typeof parsed.endState !== 'string' || !Array.isArray(parsed.violated)) {
    throw new Error('Target emitted an unreadable replay; refusing.');
  }
  return parsed;
}

describe('native counterexample replay', () => {
  it('confirms the violation on the buggy target', () => {
    const frozen = model();
    const now = new Date().toISOString();
    const receipt = exploreModel(
      frozen,
      { check: (state) => (state === 'both' ? ['never-both'] : []) },
      now,
    );
    expect(receipt.boundExhausted).toBe(true);
    expect(receipt.counterexamples.length).toBeGreaterThan(0);
    const report = validateCounterexamples(
      frozen,
      receipt,
      { replay: (schedule) => replay('buggy', schedule) },
      now,
    );
    expect(report.verdict).toBe('violated');
    expect(report.confirmed.length).toBeGreaterThan(0);
  });

  it('invalidates the model on the fixed target', () => {
    const frozen = model();
    const now = new Date().toISOString();
    const receipt = exploreModel(
      frozen,
      { check: (state) => (state === 'both' ? ['never-both'] : []) },
      now,
    );
    const report = validateCounterexamples(
      frozen,
      receipt,
      { replay: (schedule) => replay('fixed', schedule) },
      now,
    );
    expect(report.verdict).toBe('model_invalid');
  });
});
