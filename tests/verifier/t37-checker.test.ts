import { describe, expect, it } from 'vitest';

import type { FiniteModel } from '../../src/core/index.js';
import {
  exploreModel,
  freezeFiniteModel,
  validateCounterexamples,
  verifyFiniteModel,
} from '../../src/modules/verifier/checker.js';

/**
 * WP3-33 / T-37 — finite schedule/model checker failure-path tests (NEG3-40).
 *
 * Written before the implementation. A trusted finite model pins states,
 * transitions, invariants, and bounds; every schedule within the registered
 * bound is explored, counterexamples are validated against the actual
 * system, and no claim generalizes beyond the declared model. An
 * unexhausted bound never reports holds, and a refuted counterexample
 * invalidates the model instead of passing it.
 */

const NOW = '2026-11-02T00:00:00.000Z';

function mutexModel(overrides: Partial<Parameters<typeof freezeFiniteModel>[0]> = {}): FiniteModel {
  return freezeFiniteModel({
    modelId: 'mutex-buggy-v1',
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
    frozenAt: NOW,
    ...overrides,
  });
}

function neverBoth(state: string): string[] {
  return state === 'both' ? ['never-both'] : [];
}

describe('finite models freeze with declared bounds', () => {
  it('rejects dangling states and transitions', () => {
    expect(() => mutexModel({ initial: 'elsewhere' })).toThrow(/initial/i);
    expect(() =>
      mutexModel({ transitions: [{ from: 'idle', op: 'acquire-a', to: 'elsewhere' }] }),
    ).toThrow(/transition/i);
  });

  it('invalidates proof on model drift', () => {
    const model = mutexModel();
    expect(() =>
      verifyFiniteModel({ ...model, bound: { maxDepth: 9, maxSchedules: 500 } }),
    ).toThrow(/drift|digest/i);
  });
});

describe('exploration stays inside the registered bound', () => {
  it('finds the mutex violation with its schedule', () => {
    const receipt = exploreModel(mutexModel(), { check: (state) => neverBoth(state) }, NOW);
    expect(receipt.boundExhausted).toBe(true);
    expect(receipt.counterexamples.length).toBeGreaterThan(0);
    expect(receipt.counterexamples[0]?.invariant).toBe('never-both');
    expect(receipt.counterexamples[0]?.schedule).toEqual(['acquire-a', 'acquire-b']);
  });

  it('reports holds only when the bound is exhausted with no counterexample', () => {
    const fixed = mutexModel({
      modelId: 'mutex-fixed-v1',
      states: ['idle', 'locked-a', 'locked-b'],
      initial: 'idle',
      transitions: [
        { from: 'idle', op: 'acquire-a', to: 'locked-a' },
        { from: 'idle', op: 'acquire-b', to: 'locked-b' },
        { from: 'locked-a', op: 'release-a', to: 'idle' },
        { from: 'locked-b', op: 'release-b', to: 'idle' },
      ],
    });
    const full = validateCounterexamples(
      fixed,
      exploreModel(fixed, { check: (state) => neverBoth(state) }, NOW),
      { replay: () => ({ endState: 'idle', violated: [] }) },
      NOW,
    );
    expect(full.verdict).toBe('holds_within_bound');

    const capped = mutexModel({ bound: { maxDepth: 3, maxSchedules: 2 } });
    const partial = validateCounterexamples(
      capped,
      exploreModel(capped, { check: () => [] }, NOW),
      { replay: () => ({ endState: 'idle', violated: [] }) },
      NOW,
    );
    expect(partial.verdict).toBe('bound_incomplete');
  });
});

describe('counterexamples are validated on the actual system', () => {
  it('confirms a violation the replayer reproduces', () => {
    const model = mutexModel();
    const report = validateCounterexamples(model, exploreModel(model, { check: (state) => neverBoth(state) }, NOW), {
      replay: (schedule) => {
        const last = schedule[schedule.length - 1];
        const both = schedule.includes('acquire-a') && schedule.includes('acquire-b') && last !== 'release-a' && last !== 'release-b';
        return both ? { endState: 'both', violated: ['never-both'] } : { endState: 'idle', violated: [] };
      },
    }, NOW);
    expect(report.verdict).toBe('violated');
    expect(report.confirmed).toHaveLength(2);
    expect(report.confirmed[0]?.schedule).toEqual(['acquire-a', 'acquire-b']);
    expect(report.claimScope.modelId).toBe('mutex-buggy-v1');
  });

  it('invalidates the model when the replayer refutes every counterexample', () => {
    const model = mutexModel();
    const report = validateCounterexamples(model, exploreModel(model, { check: (state) => neverBoth(state) }, NOW), {
      replay: () => ({ endState: 'idle', violated: [] }),
    }, NOW);
    expect(report.verdict).toBe('model_invalid');
  });
});
