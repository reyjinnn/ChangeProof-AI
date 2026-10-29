import { describe, expect, it } from 'vitest';

import { composePhase1 } from '../../src/orchestrator/index.js';
import type { TargetFacts } from '../../src/modules/policy/index.js';

/**
 * WP3-02 — composition root wires the pure policy reducer (architecture §3).
 *
 * The orchestrator passes precomputed facts through; it owns no verdict logic.
 * These cases prove the wiring end to end: full facts yield `fixed`, and a
 * stale run withholds the verdict, through the composed surface.
 */
describe('composePhase1', () => {
  const facts = (overrides: Partial<TargetFacts> = {}): TargetFacts => ({
    subject: { kind: 'consumer', id: 'consumer-a' },
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
    requiredDimensions: [
      {
        schemaVersion: '1',
        dimension: 'correctness',
        required: true,
        metricIds: ['order-total'],
        result: 'pass',
        rawRefs: ['runs/r1/dim.json'],
      },
    ],
    unresolvedRequiredEdges: [],
    skippedRequiredChecks: [],
    coverageSufficient: true,
    hasProgress: true,
    ...overrides,
  });

  it('assesses a fully proven target as fixed through the composition', () => {
    const result = composePhase1().assessTarget(facts({ runState: 'completed' }));

    expect(result.outcome).toBe('fixed');
    expect(result.reasons).toHaveLength(0);
  });

  it('withholds a verdict for a stale run through the composition', () => {
    const result = composePhase1().assessTarget(facts({ runState: 'stale' }));

    expect(result.outcome).toBe('unverified');
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
