import { subjectKey } from '../core/index.js';
import type { BundleAssessment, SubjectRef, TargetAssessment } from '../core/index.js';
import type { HypothesisLedger } from '../modules/agent/index.js';
import { assessBundle } from '../modules/policy/index.js';
import type { BundleFacts } from '../modules/policy/index.js';

import { BundleCoordinationError } from './errors.js';

/**
 * Bundle coordination (WP3-11): assemble bundle facts from per-target
 * assessments plus cross-target evidence, then hand them to policy.
 *
 * The coordinator never votes, averages, or decides a verdict. It checks
 * coverage (every required target assessed), binds candidate digests to the
 * digests the verifier actually ran, folds edge/invariant/mixed-version/guard
 * evidence into facts, and lets `assessBundle` apply the normative order.
 */

const MAX_COORDINATION_ITEMS = 500;

export type BundleEdgeStatus = 'proven' | 'inferred' | 'unresolved';

const EDGE_STATUSES: readonly BundleEdgeStatus[] = ['proven', 'inferred', 'unresolved'];

export interface BundleEdgeEvidence {
  from: SubjectRef;
  to: SubjectRef;
  status: BundleEdgeStatus;
  checkRef: string;
}

export interface BundleInvariantEvidence {
  ref: string;
  holds: boolean;
  checkRef: string;
}

export interface TargetDigestBinding {
  candidate: string;
  verified: string;
}

export interface MixedVersionEvidence {
  requiredPairs: string[];
  coveredPairs: string[];
  allCampaignsComplete: boolean;
}

export interface CoordinateBundleInput {
  candidateBundleDigest: string;
  requiredTargets: SubjectRef[];
  targetOutcomes: TargetAssessment[];
  targetDigests: Record<string, TargetDigestBinding>;
  edges: BundleEdgeEvidence[];
  invariants: BundleInvariantEvidence[];
  mixedVersion: MixedVersionEvidence;
  intentFulfilled: boolean;
  guardAllowed: boolean;
  policyVersion: string;
  runState?: 'active' | 'stale' | 'cancelled' | 'completed';
}

export interface CoordinatedBundle {
  readonly assessment: BundleAssessment;
  readonly facts: BundleFacts;
  readonly bindings: readonly { subject: SubjectRef; candidate: string; verified: string }[];
  readonly coverageGaps: readonly string[];
  readonly unresolvedEdges: readonly BundleEdgeEvidence[];
}

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0) {
    throw new BundleCoordinationError(`${field} must not be empty.`);
  }
}

function requireBounded(length: number, field: string): void {
  if (length > MAX_COORDINATION_ITEMS) {
    throw new BundleCoordinationError(
      `${field} has ${length} entries, above the cap of ${MAX_COORDINATION_ITEMS}.`,
    );
  }
}

export function coordinateBundle(input: CoordinateBundleInput): CoordinatedBundle {
  requireNonEmpty(input.candidateBundleDigest, 'candidateBundleDigest');
  requireNonEmpty(input.policyVersion, 'policyVersion');
  if (input.requiredTargets.length === 0) {
    throw new BundleCoordinationError('requiredTargets must list at least one target.');
  }
  requireBounded(input.requiredTargets.length, 'requiredTargets');
  requireBounded(input.targetOutcomes.length, 'targetOutcomes');
  requireBounded(input.edges.length, 'edges');
  requireBounded(input.invariants.length, 'invariants');
  requireBounded(input.mixedVersion.requiredPairs.length, 'mixedVersion.requiredPairs');
  requireBounded(input.mixedVersion.coveredPairs.length, 'mixedVersion.coveredPairs');

  for (const edge of input.edges) {
    if (!EDGE_STATUSES.includes(edge.status)) {
      const status = (edge as { status: unknown }).status;
      throw new BundleCoordinationError(`edge status ${String(status)} is unknown.`);
    }
    requireNonEmpty(edge.checkRef, 'edge.checkRef');
  }
  for (const invariant of input.invariants) {
    requireNonEmpty(invariant.ref, 'invariant.ref');
    requireNonEmpty(invariant.checkRef, 'invariant.checkRef');
  }
  for (const pair of input.mixedVersion.requiredPairs) {
    requireNonEmpty(pair, 'mixedVersion.requiredPairs[]');
  }

  const targetMap = new Map<string, TargetAssessment>();
  for (const outcome of input.targetOutcomes) {
    targetMap.set(subjectKey(outcome.subject), outcome);
  }
  const coverageGaps = input.requiredTargets
    .map((target) => subjectKey(target))
    .filter((key) => !targetMap.has(key));

  const bindings = input.requiredTargets.flatMap((subject) => {
    const binding = input.targetDigests[subjectKey(subject)];
    return binding === undefined ? [] : [{ subject, candidate: binding.candidate, verified: binding.verified }];
  });
  // Freshness is purely the candidate/verified binding. A missing assessment is a
  // coverage gap (policy yields incomplete); it must not flip this flag and
  // force blocked, which would disagree with the normative order.
  const identitiesFresh = input.requiredTargets.every((target) => {
      const binding = input.targetDigests[subjectKey(target)];
      return (
        binding !== undefined &&
        binding.candidate.length > 0 &&
        binding.candidate === binding.verified
      );
    });

  const unresolvedEdges = input.edges.filter((edge) => edge.status !== 'proven');
  const coveredPairs = new Set(input.mixedVersion.coveredPairs);
  const facts: BundleFacts = {
    schemaVersion: '1',
    candidateBundleDigest: input.candidateBundleDigest,
    requiredTargets: [...input.requiredTargets],
    policyVersion: input.policyVersion,
    targetOutcomes: [...input.targetOutcomes],
    requiredEdgesPassed: unresolvedEdges.length === 0,
    requiredInvariantsPassed: input.invariants.every((invariant) => invariant.holds),
    mixedVersionChecksPassed:
      input.mixedVersion.allCampaignsComplete &&
      input.mixedVersion.requiredPairs.every((pair) => coveredPairs.has(pair)),
    intentFulfilled: input.intentFulfilled,
    identitiesFresh,
    blockingReasons: input.guardAllowed ? [] : ['guard violation withholds publication'],
    ...(input.runState === undefined ? {} : { runState: input.runState }),
  };

  return {
    assessment: assessBundle(facts),
    facts,
    bindings,
    coverageGaps,
    unresolvedEdges,
  };
}

/**
 * Recovery coordination (WP3-11, SC3-05): record the just-executed attempt in
 * the hypothesis ledger and decide retry / stop / blocked.
 *
 * Retry requires real evidence progress: a verifier-reported contradiction
 * (which refutes the current hypothesis and opens a superseding one), new
 * evidence refs, or a declared strategy change. Anything else stops the
 * branch instead of burning budget on a cosmetic retry.
 */

export interface RecoveryContradiction {
  hypothesisId: string;
  ref: string;
  summary: string;
}

export interface RecoveryAttempt {
  candidateDigest: string;
  patchDigest: string;
  failureSignature?: string;
  failureKind: string;
  checkRefs: string[];
  snapshotRefs: string[];
  newEvidenceRefs: string[];
  strategyChange?: string;
  guardVerdict?: 'accepted' | 'rejected';
}

export interface CoordinateRecoveryInput {
  ledger: HypothesisLedger;
  currentHypothesisId: string;
  attempt: RecoveryAttempt;
  contradictions?: RecoveryContradiction[];
  newHypothesisClaim?: string;
  intentConflict?: { between: string[]; description: string };
}

export type RecoveryDecision =
  | { readonly decision: 'retry'; readonly hypothesisId: string; readonly attemptId: string; readonly reason: string }
  | {
      readonly decision: 'stop';
      readonly terminalOutcome: 'failed';
      readonly reason: string;
      readonly blocker: string | null;
    }
  | { readonly decision: 'blocked'; readonly reason: string; readonly blocker: string | null };

function toBranchDecision(
  branch: { verdict: 'continue' | 'stop-branch' | 'blocked'; reason: string; blocker: string | null },
  retry: { hypothesisId: string; attemptId: string },
): RecoveryDecision {
  if (branch.verdict === 'blocked') {
    return { decision: 'blocked', reason: branch.reason, blocker: branch.blocker };
  }
  if (branch.verdict === 'stop-branch') {
    return { decision: 'stop', terminalOutcome: 'failed', reason: branch.reason, blocker: branch.blocker };
  }
  return { decision: 'retry', hypothesisId: retry.hypothesisId, attemptId: retry.attemptId, reason: branch.reason };
}

export function coordinateRecovery(input: CoordinateRecoveryInput): RecoveryDecision {
  requireNonEmpty(input.currentHypothesisId, 'currentHypothesisId');
  requireNonEmpty(input.attempt.candidateDigest, 'attempt.candidateDigest');
  requireNonEmpty(input.attempt.patchDigest, 'attempt.patchDigest');
  const contradictions = input.contradictions ?? [];
  for (const contradiction of contradictions) {
    requireNonEmpty(contradiction.hypothesisId, 'contradictions[].hypothesisId');
    requireNonEmpty(contradiction.ref, 'contradictions[].ref');
    requireNonEmpty(contradiction.summary, 'contradictions[].summary');
    if (contradiction.hypothesisId !== input.currentHypothesisId) {
      throw new BundleCoordinationError(
        `contradiction targets ${contradiction.hypothesisId} but the current hypothesis is ${input.currentHypothesisId}; refusing to refute the wrong hypothesis.`,
      );
    }
  }

  if (input.intentConflict !== undefined) {
    requireNonEmpty(input.intentConflict.description, 'intentConflict.description');
    if (input.intentConflict.between.length === 0) {
      throw new BundleCoordinationError('intentConflict.between must name the conflicting parties.');
    }
    input.ledger.recordConflict({
      between: [...input.intentConflict.between],
      description: input.intentConflict.description,
    });
    const branch = input.ledger.assessBranch();
    return { decision: 'blocked', reason: branch.reason, blocker: branch.blocker };
  }

  if (contradictions.length > 0) {
    if (input.newHypothesisClaim === undefined || input.newHypothesisClaim.length === 0) {
      throw new BundleCoordinationError(
        'a contradiction requires newHypothesisClaim; the branch cannot retry on a refuted hypothesis.',
      );
    }
    for (const contradiction of contradictions) {
      input.ledger.attachEvidence({
        hypothesisId: contradiction.hypothesisId,
        direction: 'contradicting',
        ref: contradiction.ref,
        summary: contradiction.summary,
      });
    }
    input.ledger.transitionHypothesis({
      hypothesisId: input.currentHypothesisId,
      to: 'refuted_hypothesis',
      rationale: `Contradicted by ${contradictions.map((c) => c.ref).join(', ')}.`,
    });
    const next = input.ledger.createHypothesis({
      claim: input.newHypothesisClaim,
      initialStatus: 'suspected_cause',
      supersedes: input.currentHypothesisId,
    });
    const recorded = input.ledger.recordAttempt({ hypothesisId: next.id, ...input.attempt });
    return toBranchDecision(input.ledger.assessBranch(), { hypothesisId: next.id, attemptId: recorded.attemptId });
  }

  const recorded = input.ledger.recordAttempt({ hypothesisId: input.currentHypothesisId, ...input.attempt });
  const branch = input.ledger.assessBranch();
  if (branch.verdict !== 'continue') {
    return toBranchDecision(branch, { hypothesisId: input.currentHypothesisId, attemptId: recorded.attemptId });
  }
  const hasProgress =
    input.attempt.newEvidenceRefs.length > 0 ||
    (input.attempt.strategyChange !== undefined && input.attempt.strategyChange.length > 0);
  if (!hasProgress) {
    return {
      decision: 'stop',
      terminalOutcome: 'failed',
      reason: 'No new evidence and no strategy change; refusing a cosmetic retry.',
      blocker: 'Next: owner proposes a new distinguishing probe or closes the branch.',
    };
  }
  return {
    decision: 'retry',
    hypothesisId: input.currentHypothesisId,
    attemptId: recorded.attemptId,
    reason: branch.reason,
  };
}
