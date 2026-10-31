import { describe, expect, it, vi } from 'vitest';

import {
  BundleAssessmentSchema,
  DimensionAssessmentSchema,
  TargetAssessmentSchema,
  type BundleAssessment,
  type DimensionAssessment,
} from '../../src/core/index.js';
import {
  assessBundle,
  assessTarget,
  type TargetFacts,
} from '../../src/modules/policy/index.js';

/**
 * WP3-01 / T1-2 — policy precedence rows (FR3-16).
 *
 * Written before the implementation. The rows below are the specification's
 * own examples of what must and must not be true:
 *
 *   stale + pass                       -> no verdict is taken effect
 *   full pass + unknown                -> not `fixed`
 *   partial + invalid oracle           -> invalid evidence wins
 *   target pass + edge fail             -> not `fixed`
 *   mixed candidates                    -> not a bundle pass
 *   dimension inconclusive + functional pass -> assurance withheld
 *
 * Every case is a **pure** decision: same input, same output, no clock, no
 * environment, no model.
 */

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

const unsupportedDecisionInputs: readonly { field: string; value: unknown }[] = [
  { field: 'averaging', value: { aggregateScore: 1 } },
  { field: 'votes', value: ['fixed', 'fixed', 'fixed'] },
  { field: 'modelConfidence', value: 1 },
];

function dimension(overrides: Partial<DimensionAssessment> = {}): DimensionAssessment {
  return DimensionAssessmentSchema.parse({
    schemaVersion: '1',
    dimension: 'correctness',
    required: true,
    metricIds: ['order-total'],
    result: 'pass',
    rawRefs: ['runs/r1/dim.json'],
    ...overrides,
  });
}

function facts(overrides: Partial<TargetFacts> = {}): TargetFacts {
  return {
    subject: { kind: 'consumer', id: 'consumer-a' },
    runState: 'active',
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

function outcomeOf(input: TargetFacts): string {
  return assessTarget(input).outcome;
}

describe('policy precedence — stale and cancelled withhold a verdict', () => {
  it('does not report a fix for a stale run', () => {
    const assessment = assessTarget(facts({ runState: 'stale' }));
    expect(assessment.outcome).toBe('unverified');
    expect(assessment.reasons).toEqual(['run_stale']);
  });

  it('does not report a fix for a cancelled run', () => {
    expect(outcomeOf(facts({ runState: 'cancelled' }))).toBe('unverified');
  });

  it('withholds the verdict even when everything else passes', () => {
    const assessment = assessTarget(facts({ runState: 'stale' }));
    expect(assessment.outcome).not.toBe('fixed');
    expect(assessment.reasons.length).toBeGreaterThan(0);
  });
});

describe('policy precedence — invalid evidence outranks a pass', () => {
  it('reports unverified when evidence is invalid', () => {
    expect(outcomeOf(facts({ evidenceValidity: 'invalid' }))).toBe('unverified');
  });

  it('reports unverified when the oracle changed after the freeze (NEG3-03)', () => {
    expect(outcomeOf(facts({ oracleMatchesFrozen: false }))).toBe('unverified');
  });

  it('does not let a full pass rescue an invalid oracle', () => {
    const assessment = assessTarget(facts({ oracleMatchesFrozen: false }));
    expect(assessment.outcome).not.toBe('fixed');
  });

  it('does not let otherwise partial progress rescue an invalid oracle (NEG3-03)', () => {
    const progress = facts({ exactPatchApplied: false, hasProgress: true });
    expect(assessTarget(progress).outcome).toBe('partial');

    const assessment = assessTarget({ ...progress, oracleMatchesFrozen: false });
    expect(assessment.outcome).toBe('unverified');
    expect(assessment.reasons).toEqual(['oracle_invalid']);
  });

  it('reports unverified on inconclusive evidence', () => {
    expect(outcomeOf(facts({ evidenceValidity: 'inconclusive' }))).toBe('unverified');
  });
});

describe('policy precedence — a fixed verdict requires every precondition', () => {
  it('reports fixed when every precondition holds', () => {
    expect(outcomeOf(facts())).toBe('fixed');
  });

  it('withholds fixed when the regression was not attributed', () => {
    expect(outcomeOf(facts({ regressionAttributed: false }))).not.toBe('fixed');
  });

  it('withholds fixed when the protected proof is incomplete', () => {
    expect(outcomeOf(facts({ protectedProofComplete: false }))).not.toBe('fixed');
  });

  it('withholds fixed when the intent was not preserved (NEG3-04)', () => {
    expect(outcomeOf(facts({ intentPreserved: false }))).not.toBe('fixed');
  });

  it('withholds fixed when the guard rejected the change', () => {
    expect(outcomeOf(facts({ guardPassed: false }))).not.toBe('fixed');
  });

  it('withholds fixed when identities are stale (NEG3-07)', () => {
    expect(outcomeOf(facts({ identitiesFresh: false }))).not.toBe('fixed');
  });
});

describe('policy precedence — required edges and skipped checks are coverage gaps', () => {
  it('does not report fixed when a required edge is unresolved (NEG3-06)', () => {
    // A target that passes locally while a required cross-system edge is
    // unresolved is exactly the "local pass + edge fail" row.
    const assessment = assessTarget(facts({ unresolvedRequiredEdges: ['edge-1'] }));
    expect(assessment.outcome).toBe('unverified');
    expect(assessment.reasons).toEqual(['coverage_gap_unresolved']);
    expect(assessment.coverage?.unresolvedEdges).toBe(1);
  });

  it('does not report fixed when a required check was skipped', () => {
    expect(outcomeOf(facts({ skippedRequiredChecks: ['check-1'] }))).not.toBe('fixed');
  });

  it('treats a skipped required check as a gap, never as a pass', () => {
    const assessment = assessTarget(facts({ skippedRequiredChecks: ['check-1'] }));
    expect(assessment.outcome).not.toBe('fixed');
    expect(assessment.coverage?.unresolvedEdges ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe('policy precedence — dimensions are assessed separately, never averaged', () => {
  it('withholds assurance when a required dimension is inconclusive', () => {
    // Functional checks are green, but the performance dimension could not be
    // measured. The result must not read as a success.
    const assessment = assessTarget(
      facts({
        requiredDimensions: [
          dimension(),
          dimension({ dimension: 'performance', result: 'inconclusive' }),
        ],
      }),
    );
    expect(assessment.outcome).toBe('unverified');
    expect(assessment.reasons).toEqual(['dimension_inconclusive']);
  });

  it('withholds assurance when a required dimension failed', () => {
    const assessment = assessTarget(
      facts({
        requiredDimensions: [
          dimension(),
          dimension({ dimension: 'data_integrity', result: 'fail' }),
        ],
      }),
    );
    expect(assessment.outcome).not.toBe('fixed');
  });

  it('ignores a not_applicable dimension that carries no required flag', () => {
    const assessment = assessTarget(
      facts({
        requiredDimensions: [
          dimension(),
          dimension({
            dimension: 'resilience',
            required: false,
            result: 'not_applicable',
            notApplicableJustification: 'no fault envelope in scope',
            rawRefs: [],
          }),
        ],
      }),
    );
    expect(assessment.outcome).toBe('fixed');
  });

  it('does not average a failed dimension away with a passing one', () => {
    const assessment = assessTarget(
      facts({
        requiredDimensions: [
          dimension({ dimension: 'correctness', result: 'pass' }),
          dimension({ dimension: 'resilience', result: 'fail' }),
        ],
      }),
    );
    expect(assessment.outcome).not.toBe('fixed');
  });
});

describe('policy precedence — no-impact requires coverage and relevant checks', () => {
  it('reports no_impact_verified when there is no regression and coverage is sufficient', () => {
    const assessment = assessTarget(
      facts({ regressionAttributed: false, hasProgress: false, coverageSufficient: true }),
    );
    expect(assessment.outcome).toBe('no_impact_verified');
  });

  it('does not report no_impact_verified without coverage', () => {
    const assessment = assessTarget(
      facts({ regressionAttributed: false, hasProgress: false, coverageSufficient: false }),
    );
    expect(assessment.outcome).not.toBe('no_impact_verified');
  });

  it('does not report no_impact_verified when a required check was skipped', () => {
    const assessment = assessTarget(
      facts({
        regressionAttributed: false,
        hasProgress: false,
        coverageSufficient: true,
        skippedRequiredChecks: ['check-1'],
      }),
    );
    expect(assessment.outcome).not.toBe('no_impact_verified');
  });

  it('does not report no_impact_verified while an edge is unresolved', () => {
    const assessment = assessTarget(
      facts({
        regressionAttributed: false,
        hasProgress: false,
        coverageSufficient: true,
        unresolvedRequiredEdges: ['edge-1'],
      }),
    );
    expect(assessment.outcome).not.toBe('no_impact_verified');
  });
});

describe('policy precedence — partial and failed', () => {
  it('reports partial for valid evidence of comparable progress without a new regression', () => {
    const assessment = assessTarget(facts({ exactPatchApplied: false, hasProgress: true }));
    expect(assessment.outcome).toBe('partial');
  });

  it('reports failed for a valid investigation with no progress', () => {
    const assessment = assessTarget(
      facts({ regressionAttributed: false, hasProgress: false, coverageSufficient: false }),
    );
    expect(assessment.outcome).toBe('failed');
  });
});

describe('policy is deterministic and model-free', () => {
  it('produces the same verdict for the same input', () => {
    const input = facts();
    const before = structuredClone(input);
    const first = assessTarget(input);
    const second = assessTarget(input);
    expect(first.outcome).toBe(second.outcome);
    expect(first.reasons).toEqual(second.reasons);
    expect(first).toEqual(second);
    expect(input).toEqual(before);
  });

  it('does not read the clock while reducing supported facts', () => {
    const inputs = [
      facts(),
      facts({ runState: 'stale' }),
      facts({ exactPatchApplied: false }),
    ];
    const clock = vi.spyOn(Date, 'now');
    try {
      const outcomes = inputs.map((input) => assessTarget(input).outcome);
      const clockReads = clock.mock.calls.length;
      expect(clockReads).toBe(0);
      expect(outcomes).toEqual(['fixed', 'unverified', 'partial']);
    } finally {
      clock.mockRestore();
    }
  });

  it.each(unsupportedDecisionInputs)('rejects $field at the target policy boundary', ({ field, value }) => {
    // A structurally assignable variable can carry extra runtime fields even
    // though TargetFacts does not declare them. TypeScript alone cannot reject it.
    const input = { ...facts(), [field]: value };
    expect(() => assessTarget(input)).toThrow();
  });
});

describe('bundle assessment precedence', () => {
  const base = {
    schemaVersion: '1' as const,
    candidateBundleDigest: digest('c'),
    requiredTargets: [{ kind: 'consumer' as const, id: 'consumer-a' }],
    policyVersion: '1',
  };

  it('reports invalid when evidence is invalid, ahead of every other state', () => {
    const result = assessBundle({
      ...base,
      targetOutcomes: [assessTarget(facts({ evidenceValidity: 'invalid' }))],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
    });

    expect(result.state).toBe('invalid');
  });

  it('reports blocked when a required check failed', () => {
    const result = assessBundle({
      ...base,
      targetOutcomes: [assessTarget(facts({ exactPatchApplied: false }))],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: ['required check post_fix_full failed'],
    });

    expect(result.state).toBe('blocked');
  });

  it('reports incomplete when a target has no positive claim yet', () => {
    const result = assessBundle({
      ...base,
      targetOutcomes: [
        assessTarget(facts({ exactPatchApplied: false, hasProgress: false, coverageSufficient: false })),
      ],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
    });

    expect(result.state).toBe('incomplete');
  });

  it('reports verified only when every target is fixed and every requirement holds', () => {
    const result = assessBundle({
      ...base,
      targetOutcomes: [assessTarget(facts())],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
    });

    expect(result.state).toBe('verified');
  });

  it('does not verify a bundle when one target passed and another did not', () => {
    const result = assessBundle({
      ...base,
      requiredTargets: [
        { kind: 'consumer' as const, id: 'consumer-a' },
        { kind: 'consumer' as const, id: 'consumer-b' },
      ],
      targetOutcomes: [
        assessTarget(facts()),
        assessTarget(facts({ subject: { kind: 'consumer', id: 'consumer-b' }, exactPatchApplied: false })),
      ],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
    });

    expect(result.state).not.toBe('verified');
  });

  it('invalidates bundle proof when a member has a mismatched candidate identity', () => {
    // Policy consumes the coordinator's identity facts, not raw commits.
    const mismatchedMember = assessTarget(facts({
      subject: { kind: 'consumer', id: 'consumer-b' },
      identitiesFresh: false,
    }));
    expect(mismatchedMember.outcome).toBe('unverified');
    expect(mismatchedMember.reasons).toEqual(['identity_drift']);

    const result = assessBundle({
      ...base,
      requiredTargets: [
        ...base.requiredTargets,
        { kind: 'consumer', id: 'consumer-b' },
      ],
      targetOutcomes: [assessTarget(facts()), mismatchedMember],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
    });
    expect(result.state).toBe('invalid');
  });

  it('does not verify a bundle whose required edge failed', () => {
    const result = assessBundle({
      ...base,
      targetOutcomes: [assessTarget(facts())],
      requiredEdgesPassed: false,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
    });

    expect(result.state).toBe('blocked');
    expect(result.blockingReasons).toContain('required edge failed');
  });

  it.each(unsupportedDecisionInputs)('rejects $field at the bundle policy boundary', ({ field, value }) => {
    const input = {
      ...base,
      targetOutcomes: [assessTarget(facts())],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
      [field]: value,
    };
    expect(() => assessBundle(input)).toThrow();
  });

  it('does not verify a bundle with stale identities', () => {
    const result = assessBundle({
      ...base,
      targetOutcomes: [assessTarget(facts())],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: false,
      blockingReasons: [],
    });

    expect(result.state).not.toBe('verified');
  });

  it('produces a schema-valid bundle assessment', () => {
    const result = assessBundle({
      ...base,
      targetOutcomes: [assessTarget(facts())],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
    });

    expect(() => BundleAssessmentSchema.parse(result)).not.toThrow();
  });

  it('produces a schema-valid target assessment', () => {
    expect(() => TargetAssessmentSchema.parse(assessTarget(facts()))).not.toThrow();
  });
});

describe('bundle assessment type', () => {
  it('is a bundle state, not a consumer outcome', () => {
    const result: BundleAssessment = assessBundle({
      schemaVersion: '1',
      candidateBundleDigest: digest('c'),
      requiredTargets: [{ kind: 'consumer', id: 'consumer-a' }],
      policyVersion: '1',
      targetOutcomes: [assessTarget(facts())],
      requiredEdgesPassed: true,
      requiredInvariantsPassed: true,
      mixedVersionChecksPassed: true,
      intentFulfilled: true,
      identitiesFresh: true,
      blockingReasons: [],
    });

    expect(['verified', 'incomplete', 'blocked', 'invalid']).toContain(result.state);
  });
});
