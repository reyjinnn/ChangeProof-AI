import {
  TargetAssessmentSchema,
  type BundleAssessment,
  type DimensionAssessment,
  type TargetAssessment,
  type TargetOutcome,
} from '../../core/index.js';

/**
 * Pure, deterministic policy (FR3-16).
 *
 * The policy does **not** read I/O, model output, clock, environment, or
 * framework. It receives facts the verifier has already checked, and applies
 * the single ordering that yields a verdict. There is no framework switch and
 * no place for a model-confidence value to enter.
 *
 * Precedence (FR3-16):
 *   1. stale/cancelled → withhold
 *   2. invalid/missing evidence, identity drift, blocking risk, unexplained
 *      infra/flakiness → unverified
 *   3. no regression → no_impact_verified (only with coverage + checks)
 *   4. attributed regression + exact patch + protected proof + intent + scope +
 *      guard + fresh identities + every required dimension → fixed
 *   5. valid comparable progress → partial
 *   6. valid investigation with no progress → failed
 *
 * This module contains only the reducer. It cannot make an I/O observation or
 * manufacture an evidence fact; those belong to verifier/coordinator ports.
 */

export interface TargetFacts {
  readonly subject: TargetAssessment['subject'];
  readonly runState: 'active' | 'stale' | 'cancelled' | 'completed';
  readonly evidenceValidity: 'valid' | 'invalid' | 'inconclusive';
  readonly oracleMatchesFrozen: boolean;
  readonly regressionAttributed: boolean;
  readonly exactPatchApplied: boolean;
  readonly protectedProofComplete: boolean;
  readonly intentPreserved: boolean;
  readonly scopeFrozen: boolean;
  readonly guardPassed: boolean;
  readonly identitiesFresh: boolean;
  readonly requiredDimensions: readonly DimensionAssessment[];
  readonly unresolvedRequiredEdges: readonly string[];
  readonly skippedRequiredChecks: readonly string[];
  readonly coverageSufficient: boolean;
  readonly hasProgress: boolean;
}

export interface PolicyTargetAssessment extends Omit<TargetAssessment, 'schemaVersion'> {
  readonly schemaVersion: '1';
}

const REASONS = {
  stale: 'run_stale',
  cancelled: 'run_cancelled',
  invalidEvidence: 'evidence_invalid',
  inconclusiveEvidence: 'evidence_inconclusive',
  oracleChanged: 'oracle_invalid',
  identityMismatch: 'identity_drift',
  regressionNotAttributed: 'causality_unproven',
  patchNotApplied: 'patch_not_applied',
  proofIncomplete: 'proof_incomplete',
  intentNotPreserved: 'intent_not_preserved',
  scopeNotFrozen: 'scope_not_frozen',
  guardRejected: 'guard_rejected',
  staleIdentity: 'identity_drift',
  dimensionInconclusive: 'dimension_inconclusive',
  dimensionFailed: 'dimension_failed',
  coverageInsufficient: 'coverage_insufficient',
  unresolvedEdge: 'coverage_gap_unresolved',
  skippedCheck: 'required_check_skipped',
  noProgress: 'no_progress',
} as const satisfies Record<string, string>;

function result(
  facts: TargetFacts,
  outcome: TargetOutcome,
  reasons: readonly string[],
  coverage: TargetAssessment['coverage'],
): PolicyTargetAssessment {
  const evidenceRefs = [
    ...facts.requiredDimensions.flatMap((d) => d.rawRefs),
  ];

  return TargetAssessmentSchema.parse({
    schemaVersion: '1',
    subject: facts.subject,
    outcome,
    proofScope: {
      targets: [facts.subject],
      edges: [...facts.unresolvedRequiredEdges],
      invariants: ['policy-input-invariants'],
      unsupportedSurfaces: [],
    },
    policyVersion: '1',
    reasons: [...reasons],
    evidenceRefs,
    ...(coverage === undefined ? {} : { coverage }),
    risk: [...facts.unresolvedRequiredEdges],
  });
}

function coverageFacts(facts: TargetFacts): NonNullable<TargetAssessment['coverage']> {
  return {
    requiredTargets: 1,
    provenTargets: facts.coverageSufficient && facts.unresolvedRequiredEdges.length === 0 ? 1 : 0,
    unresolvedEdges: facts.unresolvedRequiredEdges.length,
  };
}

/**
 * Assess one target from precomputed evidence facts.
 *
 * Stable output order is part of the contract: reasons are emitted in
 * precedence order and never contain time-dependent values.
 */
export function assessTarget(facts: TargetFacts): PolicyTargetAssessment {
  const coverage = coverageFacts(facts);

  // 1. Run state withholds a verdict. State is intentionally not an outcome.
  if (facts.runState === 'stale') {
    return result(facts, 'unverified', [REASONS.stale], coverage);
  }
  if (facts.runState === 'cancelled') {
    return result(facts, 'unverified', [REASONS.cancelled], coverage);
  }

  // 2. Invalid or incomplete evidence has precedence over any positive fact.
  if (facts.evidenceValidity === 'invalid') {
    return result(facts, 'unverified', [REASONS.invalidEvidence], coverage);
  }
  if (facts.evidenceValidity === 'inconclusive') {
    return result(facts, 'unverified', [REASONS.inconclusiveEvidence], coverage);
  }
  if (!facts.oracleMatchesFrozen) {
    return result(facts, 'unverified', [REASONS.oracleChanged], coverage);
  }
  if (!facts.identitiesFresh) {
    return result(facts, 'unverified', [REASONS.identityMismatch], coverage);
  }

  // An unresolved required edge or skipped required check is not evidence of
  // non-impact. It is a specific coverage gap that blocks a positive outcome.
  if (facts.unresolvedRequiredEdges.length > 0) {
    return result(facts, 'unverified', [REASONS.unresolvedEdge], coverage);
  }
  if (facts.skippedRequiredChecks.length > 0) {
    return result(facts, 'unverified', [REASONS.skippedCheck], coverage);
  }

  // A required dimension is never averaged away by the functional result.
  const requiredDimensions = facts.requiredDimensions.filter((d) => d.required);
  const inconclusive = requiredDimensions.filter((d) => d.result === 'inconclusive');
  if (inconclusive.length > 0) {
    return result(facts, 'unverified', [REASONS.dimensionInconclusive], coverage);
  }
  const failed = requiredDimensions.filter((d) => d.result === 'fail');
  if (failed.length > 0) {
    // Valid failure evidence can only support partial/failed progress, never fixed.
    if (facts.hasProgress && !facts.regressionAttributed) {
      return result(facts, 'partial', [REASONS.dimensionFailed], coverage);
    }
    return result(facts, 'failed', [REASONS.dimensionFailed], coverage);
  }

  // 3. No regression needs coverage and relevant checks; absence of evidence
  // cannot become evidence of absence.
  if (!facts.regressionAttributed) {
    if (!facts.coverageSufficient) {
      if (facts.hasProgress) {
        return result(facts, 'partial', [REASONS.coverageInsufficient], coverage);
      }
      return result(facts, 'failed', [REASONS.coverageInsufficient, REASONS.noProgress], coverage);
    }
    return result(facts, 'no_impact_verified', [], coverage);
  }

  // 4. Fixed requires every independently-proven precondition. No one condition
  // can compensate for another.
  const fixedPreconditions: readonly [boolean, string][] = [
    [facts.regressionAttributed, REASONS.regressionNotAttributed],
    [facts.exactPatchApplied, REASONS.patchNotApplied],
    [facts.protectedProofComplete, REASONS.proofIncomplete],
    [facts.intentPreserved, REASONS.intentNotPreserved],
    [facts.scopeFrozen, REASONS.scopeNotFrozen],
    [facts.guardPassed, REASONS.guardRejected],
    [facts.identitiesFresh, REASONS.staleIdentity],
  ];
  const missing = fixedPreconditions.filter(([satisfied]) => !satisfied).map(([, reason]) => reason);
  if (missing.length === 0) {
    return result(facts, 'fixed', [], coverage);
  }

  // 5. Comparable progress without a new protected regression is partial.
  if (facts.hasProgress) {
    return result(facts, 'partial', missing, coverage);
  }

  // 6. Valid investigation without progress.
  return result(facts, 'failed', [...missing, REASONS.noProgress], coverage);
}

export interface BundleFacts {
  readonly schemaVersion: '1';
  readonly candidateBundleDigest: string;
  readonly requiredTargets: readonly TargetAssessment['subject'][];
  readonly policyVersion: string;
  readonly targetOutcomes: readonly TargetAssessment[];
  readonly requiredEdgesPassed: boolean;
  readonly requiredInvariantsPassed: boolean;
  readonly mixedVersionChecksPassed: boolean;
  readonly intentFulfilled: boolean;
  readonly identitiesFresh: boolean;
  readonly blockingReasons: readonly string[];
  readonly runState?: 'active' | 'stale' | 'cancelled' | 'completed';
}

/**
 * Assess a bundle using the normative order: invalid → blocked → incomplete →
 * verified. Target outcomes never vote or average into a bundle verdict.
 */
export function assessBundle(facts: BundleFacts): BundleAssessment {
  const targetOutcomes = facts.targetOutcomes;
  const invalid = targetOutcomes.some((target) => target.outcome === 'unverified' &&
    target.reasons.some((reason) => reason === 'evidence_invalid' || reason === 'oracle_invalid' || reason === 'identity_drift'));

  let state: BundleAssessment['state'];
  const blockingReasons = [...facts.blockingReasons];

  if (facts.runState === 'stale' || facts.runState === 'cancelled') {
    state = 'incomplete';
    blockingReasons.push(`run_${facts.runState}`);
  } else if (invalid) {
    state = 'invalid';
  } else if (
    blockingReasons.length > 0 ||
    !facts.requiredEdgesPassed ||
    !facts.requiredInvariantsPassed ||
    !facts.mixedVersionChecksPassed ||
    !facts.intentFulfilled ||
    !facts.identitiesFresh
  ) {
    state = 'blocked';
    if (!facts.requiredEdgesPassed) blockingReasons.push('required edge failed');
    if (!facts.requiredInvariantsPassed) blockingReasons.push('required invariant failed');
    if (!facts.mixedVersionChecksPassed) blockingReasons.push('mixed-version checks failed');
    if (!facts.intentFulfilled) blockingReasons.push('intent not fulfilled');
    if (!facts.identitiesFresh) blockingReasons.push('identity drift');
  } else {
    const requiredKeys = new Set(facts.requiredTargets.map((s) => `${s.kind}:${s.id}`));
    const targetMap = new Map(targetOutcomes.map((target) => [`${target.subject.kind}:${target.subject.id}`, target]));
    const allTargetsAccounted = [...requiredKeys].every((key) => targetMap.has(key));
    const allFixed = [...requiredKeys].every((key) => targetMap.get(key)?.outcome === 'fixed');
    const anyPositiveWithoutAll = targetOutcomes.some((target) => target.outcome === 'fixed' || target.outcome === 'no_impact_verified');

    if (!allTargetsAccounted || !allFixed) {
      state = 'incomplete';
      if (anyPositiveWithoutAll) blockingReasons.push('target-level pass does not establish bundle proof');
    } else {
      state = 'verified';
    }
  }

  const bundle = {
    schemaVersion: '1' as const,
    state,
    candidateBundleDigest: facts.candidateBundleDigest,
    requiredTargets: [...facts.requiredTargets],
    requiredEdges: [],
    requiredInvariants: [],
    intentFulfilled: facts.intentFulfilled,
    mixedVersionChecksPassed: facts.mixedVersionChecksPassed,
    identitiesFresh: facts.identitiesFresh,
    blockingReasons: state === 'blocked' ? blockingReasons : [],
    reasons: blockingReasons,
    policyVersion: facts.policyVersion,
  };

  // Runtime validation keeps the policy output at the same contract boundary
  // as untrusted input; no caller can rely on a subtly malformed assessment.
  return importBundleSchemaParse(bundle);
}

function importBundleSchemaParse(bundle: unknown): BundleAssessment {
  // A static import at module scope would be simpler, but keeping the schema
  // among core contracts makes the dependency explicit and cycle-free.
  return BundleAssessmentSchemaLocal.parse(bundle);
}

// Import the schema through a binding above; the alias keeps the pure module's
// public surface small and helps the dependency-cruiser rule see core-only use.
import { BundleAssessmentSchema as BundleAssessmentSchemaLocal } from '../../core/index.js';
