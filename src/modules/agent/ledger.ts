import {
  ChangeProofError,
  IdSchema,
  NonEmptyStringSchema,
} from '../../core/index.js';

/**
 * Hypothesis ledger, candidate revision, and the no-progress stopper
 * (WP3-07, FR3-08).
 *
 * The planner's working memory: claims with supporting and contradicting
 * evidence, probes declared before execution (predicted observation,
 * competing explanation, cost cap, safety scope, stop rule), and every
 * candidate attempt with its failure signature. Promotion to a supported
 * cause needs a mechanism plus a distinguishing probe with a recorded
 * outcome; several supported causes may coexist — the ledger never forces
 * one. Repetition is detected on hypothesis/candidate/failure signatures
 * plus new evidence, never on token or line counts: two consecutive
 * identical attempts with nothing new stop the branch unless an untried
 * distinguishing probe remains within budget. Infrastructure failures are
 * recorded as blockers and can never support a cause. Scope growth needs a
 * revision granted by someone other than the requester. Attempt and token
 * budgets have no reset path. The ledger records diagnoses; verdicts stay
 * with policy over verifier evidence.
 */

export type HypothesisStatus = 'symptom' | 'suspected_cause' | 'supported_cause' | 'refuted_hypothesis';
export type FailureKind = 'compile' | 'runtime' | 'data' | 'environment' | 'unknown';
export type BranchVerdict = 'continue' | 'stop-branch' | 'blocked';

const TERMINAL_STATUS: ReadonlySet<HypothesisStatus> = new Set(['supported_cause', 'refuted_hypothesis']);
const FAILURE_KINDS: ReadonlySet<string> = new Set(['compile', 'runtime', 'data', 'environment', 'unknown']);

export interface EvidenceRef {
  readonly ref: string;
  readonly summary: string;
}

export interface HypothesisRecord {
  readonly id: string;
  readonly claim: string;
  readonly status: HypothesisStatus;
  readonly supporting: readonly EvidenceRef[];
  readonly contradicting: readonly EvidenceRef[];
  readonly decisionChanges: readonly { from: HypothesisStatus; to: HypothesisStatus; rationale: string }[];
  readonly supersedes: string | null;
}

export interface ProbeRecord {
  readonly probeId: string;
  readonly hypothesisId: string;
  readonly predictedObservation: string;
  readonly competingExplanation: string;
  readonly costCap: number;
  readonly safetyScope: string;
  readonly stopRule: string;
  readonly observation: string | null;
  readonly supportsClaim: boolean | null;
  readonly costSpent: number | null;
  readonly overrun: boolean;
}

export interface AttemptRecord {
  readonly attemptId: string;
  readonly hypothesisId: string;
  readonly candidateDigest: string;
  readonly patchDigest: string;
  readonly failureSignature: string | null;
  readonly failureKind: FailureKind;
  readonly checkRefs: readonly string[];
  readonly snapshotRefs: readonly string[];
  readonly newEvidenceRefs: readonly string[];
  readonly strategyChange: string | null;
  readonly executed: boolean;
  readonly repetition: boolean;
}

export interface ScopeRevisionRecord {
  readonly revisionId: string;
  readonly targets: readonly string[];
  readonly writeSurfaces: readonly string[];
  readonly rationale: string;
  readonly requester: string;
  readonly status: 'pending' | 'granted';
  readonly granter: string | null;
}

export interface BranchAssessment {
  readonly verdict: BranchVerdict;
  readonly reason: string;
  readonly blocker: string | null;
}

interface MutableHypothesis {
  id: string;
  claim: string;
  status: HypothesisStatus;
  supporting: EvidenceRef[];
  contradicting: EvidenceRef[];
  decisionChanges: { from: HypothesisStatus; to: HypothesisStatus; rationale: string }[];
  supersedes: string | null;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ChangeProofError(`${name} must be a finite positive number; refusing.`);
  }
}

function requiredText(value: string, name: string): string {
  if (value.length === 0) {
    throw new ChangeProofError(`${name} is required; refusing.`);
  }
  return NonEmptyStringSchema.parse(value);
}

function assertNonEmptyList(values: readonly string[], name: string): void {
  if (values.length === 0) {
    throw new ChangeProofError(`${name} must name at least one entry; refusing.`);
  }
  for (const value of values) {
    NonEmptyStringSchema.parse(value);
  }
}

export interface HypothesisLedger {
  createHypothesis(input: {
    id?: string;
    claim: string;
    initialStatus?: HypothesisStatus;
    supersedes?: string;
  }): { id: string };
  attachEvidence(input: {
    hypothesisId: string;
    direction: 'supporting' | 'contradicting';
    ref: string;
    summary: string;
  }): void;
  registerProbe(input: {
    hypothesisId: string;
    probeId?: string;
    predictedObservation: string;
    competingExplanation: string;
    costCap: number;
    safetyScope: string;
    stopRule: string;
  }): { probeId: string };
  recordProbeOutcome(input: {
    probeId: string;
    observation: string;
    supportsClaim: boolean;
    costSpent: number;
  }): void;
  transitionHypothesis(input: {
    hypothesisId: string;
    to: HypothesisStatus;
    rationale: string;
    mechanismRef?: string;
    distinguishingProbeId?: string;
  }): void;
  recordAttempt(input: {
    hypothesisId: string;
    candidateDigest: string;
    patchDigest: string;
    failureSignature?: string;
    failureKind: string;
    checkRefs: readonly string[];
    snapshotRefs: readonly string[];
    newEvidenceRefs: readonly string[];
    strategyChange?: string;
    priorCandidateDigest?: string;
    guardVerdict?: 'accepted' | 'rejected';
  }): { attemptId: string; repetition: boolean };
  requestScopeRevision(input: {
    targets: readonly string[];
    writeSurfaces: readonly string[];
    rationale: string;
    requester: string;
  }): { revisionId: string };
  grantScopeRevision(input: { revisionId: string; granter: string; rationale: string }): void;
  recordConflict(input: { between: readonly string[]; description: string }): void;
  assessBranch(): BranchAssessment;
  snapshot(): {
    hypotheses: readonly HypothesisRecord[];
    probes: readonly ProbeRecord[];
    attempts: readonly AttemptRecord[];
    scopeRevisions: readonly ScopeRevisionRecord[];
    conflicts: readonly { between: readonly string[]; description: string }[];
  };
}

export function createHypothesisLedger(config: { maxAttempts: number }): HypothesisLedger {
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts <= 0) {
    throw new ChangeProofError('Attempt budget must be a positive integer; refusing.');
  }
  const hypotheses = new Map<string, MutableHypothesis>();
  const probes = new Map<string, ProbeRecord>();
  const attempts: AttemptRecord[] = [];
  const revisions = new Map<string, ScopeRevisionRecord>();
  const conflicts: { between: readonly string[]; description: string }[] = [];
  let hypothesisCounter = 0;
  let probeCounter = 0;
  let attemptCounter = 0;
  let revisionCounter = 0;

  function getHypothesis(id: string): MutableHypothesis {
    const found = hypotheses.get(id);
    if (found === undefined) {
      throw new ChangeProofError(`Unknown hypothesis "${id}"; refusing.`);
    }
    return found;
  }

  function executedCount(): number {
    return attempts.filter((attempt) => attempt.executed).length;
  }

  return {
    createHypothesis(input: {
      id?: string;
      claim: string;
      initialStatus?: HypothesisStatus;
      supersedes?: string;
    }): { id: string } {
      const claim = NonEmptyStringSchema.parse(input.claim);
      const status = input.initialStatus ?? 'symptom';
      if (status !== 'symptom' && status !== 'suspected_cause') {
        throw new ChangeProofError('A hypothesis opens as a symptom or suspected cause; promotion is earned.');
      }
      hypothesisCounter += 1;
      const id = input.id === undefined ? `hyp-${hypothesisCounter}` : IdSchema.parse(input.id);
      if (hypotheses.has(id)) {
        throw new ChangeProofError(`Hypothesis "${id}" already exists; refusing a duplicate.`);
      }
      let supersedes: string | null = null;
      if (input.supersedes !== undefined) {
        supersedes = IdSchema.parse(input.supersedes);
        getHypothesis(supersedes);
      }
      hypotheses.set(id, {
        id,
        claim,
        status,
        supporting: [],
        contradicting: [],
        decisionChanges: [],
        supersedes,
      });
      return { id };
    },

    attachEvidence(input: {
      hypothesisId: string;
      direction: 'supporting' | 'contradicting';
      ref: string;
      summary: string;
    }): void {
      const hypothesis = getHypothesis(IdSchema.parse(input.hypothesisId));
      if (!(['supporting', 'contradicting'] as readonly string[]).includes(input.direction)) {
        throw new ChangeProofError('Evidence direction is unknown; refusing.');
      }
      const entry = { ref: NonEmptyStringSchema.parse(input.ref), summary: NonEmptyStringSchema.parse(input.summary) };
      if (input.direction === 'supporting') {
        hypothesis.supporting.push(entry);
      } else {
        hypothesis.contradicting.push(entry);
      }
    },

    registerProbe(input: {
      hypothesisId: string;
      probeId?: string;
      predictedObservation: string;
      competingExplanation: string;
      costCap: number;
      safetyScope: string;
      stopRule: string;
    }): { probeId: string } {
      const hypothesis = getHypothesis(IdSchema.parse(input.hypothesisId));
      const predictedObservation = requiredText(input.predictedObservation, 'Predicted observation');
      const competingExplanation = requiredText(input.competingExplanation, 'Competing explanation');
      assertPositiveFinite(input.costCap, 'Probe cost cap');
      const safetyScope = requiredText(input.safetyScope, 'Safety scope');
      const stopRule = requiredText(input.stopRule, 'Stop rule');
      probeCounter += 1;
      const probeId = input.probeId === undefined ? `probe-${probeCounter}` : IdSchema.parse(input.probeId);
      if (probes.has(probeId)) {
        throw new ChangeProofError(`Probe "${probeId}" is already registered; refusing a duplicate.`);
      }
      probes.set(probeId, {
        probeId,
        hypothesisId: hypothesis.id,
        predictedObservation,
        competingExplanation,
        costCap: input.costCap,
        safetyScope,
        stopRule,
        observation: null,
        supportsClaim: null,
        costSpent: null,
        overrun: false,
      });
      return { probeId };
    },

    recordProbeOutcome(input: {
      probeId: string;
      observation: string;
      supportsClaim: boolean;
      costSpent: number;
    }): void {
      const probeId = IdSchema.parse(input.probeId);
      const probe = probes.get(probeId);
      if (probe === undefined) {
        throw new ChangeProofError(`Unknown probe "${probeId}"; declare it before recording an outcome.`);
      }
      if (probe.observation !== null) {
        throw new ChangeProofError(`Probe "${probeId}" already recorded its outcome; outcomes are retained, not rewritten.`);
      }
      if (typeof input.supportsClaim !== 'boolean') {
        throw new ChangeProofError('Probe outcome must state whether it supports the claim; refusing.');
      }
      if (!Number.isFinite(input.costSpent) || input.costSpent < 0) {
        throw new ChangeProofError('Probe spend is unreadable; refusing.');
      }
      probes.set(probeId, {
        ...probe,
        observation: NonEmptyStringSchema.parse(input.observation),
        supportsClaim: input.supportsClaim,
        costSpent: input.costSpent,
        overrun: input.costSpent > probe.costCap,
      });
    },

    transitionHypothesis(input: {
      hypothesisId: string;
      to: HypothesisStatus;
      rationale: string;
      mechanismRef?: string;
      distinguishingProbeId?: string;
    }): void {
      const hypothesis = getHypothesis(IdSchema.parse(input.hypothesisId));
      const rationale = NonEmptyStringSchema.parse(input.rationale);
      if (TERMINAL_STATUS.has(hypothesis.status)) {
        throw new ChangeProofError(
          `Hypothesis is terminally ${hypothesis.status}; open a new hypothesis that supersedes it instead.`,
        );
      }
      if (input.to === 'supported_cause') {
        if (input.mechanismRef === undefined || input.mechanismRef.length === 0) {
          throw new ChangeProofError('A supported cause needs a mechanism in source or runtime; refusing.');
        }
        if (input.distinguishingProbeId === undefined) {
          throw new ChangeProofError('A supported cause needs a distinguishing probe; correlation is not enough.');
        }
        const probe = probes.get(input.distinguishingProbeId);
        if (probe === undefined || probe.observation === null) {
          throw new ChangeProofError('The distinguishing probe has no recorded outcome; refusing.');
        }
        const latest = [...attempts].reverse().find((attempt) => attempt.hypothesisId === hypothesis.id);
        if (latest?.failureKind === 'environment') {
          throw new ChangeProofError(
            'Latest evidence is an infrastructure failure; resolve it before claiming a cause.',
          );
        }
      }
      if (input.to === 'refuted_hypothesis' && hypothesis.contradicting.length === 0) {
        throw new ChangeProofError('Refutation needs contradicting evidence; refusing.');
      }
      hypothesis.decisionChanges.push({ from: hypothesis.status, to: input.to, rationale });
      hypothesis.status = input.to;
    },

    recordAttempt(input: {
      hypothesisId: string;
      candidateDigest: string;
      patchDigest: string;
      failureSignature?: string;
      failureKind: string;
      checkRefs: readonly string[];
      snapshotRefs: readonly string[];
      newEvidenceRefs: readonly string[];
      strategyChange?: string;
      priorCandidateDigest?: string;
      guardVerdict?: 'accepted' | 'rejected';
    }): { attemptId: string; repetition: boolean } {
      const hypothesis = getHypothesis(IdSchema.parse(input.hypothesisId));
      if (!FAILURE_KINDS.has(input.failureKind)) {
        throw new ChangeProofError('Failure kind is unknown; refusing.');
      }
      const candidateDigest = NonEmptyStringSchema.parse(input.candidateDigest);
      const patchDigest = NonEmptyStringSchema.parse(input.patchDigest);
      for (const refs of [input.checkRefs, input.snapshotRefs, input.newEvidenceRefs]) {
        if (!Array.isArray(refs)) {
          throw new ChangeProofError('Attempt refs must be arrays; refusing.');
        }
        for (const ref of refs) {
          NonEmptyStringSchema.parse(ref);
        }
      }
      const executed = input.guardVerdict !== 'rejected';
      if (executed && executedCount() >= config.maxAttempts) {
        throw new ChangeProofError('Attempt budget exhausted; the branch stops here.');
      }
      if (input.priorCandidateDigest !== undefined) {
        const prior = attempts.find((attempt) => attempt.candidateDigest === input.priorCandidateDigest);
        if (prior === undefined) {
          throw new ChangeProofError('Prior candidate is unknown; refusing.');
        }
        const strategyChange = input.strategyChange === undefined ? null : NonEmptyStringSchema.parse(input.strategyChange);
        if (patchDigest === prior.patchDigest && input.newEvidenceRefs.length === 0 && strategyChange === null) {
          throw new ChangeProofError(
            'Cosmetic retry: same patch, no new evidence, no explained strategy change. The branch makes no progress.',
          );
        }
      }
      const failureSignature =
        input.failureSignature === undefined ? null : NonEmptyStringSchema.parse(input.failureSignature);
      const previous = attempts.length === 0 ? undefined : attempts[attempts.length - 1];
      const repetition =
        previous?.hypothesisId === hypothesis.id &&
        previous.patchDigest === patchDigest &&
        previous.failureSignature !== null &&
        previous.failureSignature === failureSignature;
      attemptCounter += 1;
      attempts.push({
        attemptId: `att-${attemptCounter}`,
        hypothesisId: hypothesis.id,
        candidateDigest,
        patchDigest,
        failureSignature,
        failureKind: input.failureKind as FailureKind,
        checkRefs: [...input.checkRefs],
        snapshotRefs: [...input.snapshotRefs],
        newEvidenceRefs: [...input.newEvidenceRefs],
        strategyChange: input.strategyChange ?? null,
        executed,
        repetition,
      });
      return { attemptId: `att-${attemptCounter}`, repetition };
    },

    requestScopeRevision(input: {
      targets: readonly string[];
      writeSurfaces: readonly string[];
      rationale: string;
      requester: string;
    }): { revisionId: string } {
      assertNonEmptyList(input.targets, 'Scope revision targets');
      for (const surface of input.writeSurfaces) {
        NonEmptyStringSchema.parse(surface);
      }
      revisionCounter += 1;
      const revisionId = `rev-${revisionCounter}`;
      revisions.set(revisionId, {
        revisionId,
        targets: [...input.targets],
        writeSurfaces: [...input.writeSurfaces],
        rationale: NonEmptyStringSchema.parse(input.rationale),
        requester: NonEmptyStringSchema.parse(input.requester),
        status: 'pending',
        granter: null,
      });
      return { revisionId };
    },

    grantScopeRevision(input: { revisionId: string; granter: string; rationale: string }): void {
      const revision = revisions.get(IdSchema.parse(input.revisionId));
      if (revision === undefined) {
        throw new ChangeProofError(`Unknown revision "${input.revisionId}"; refusing.`);
      }
      if (revision.status === 'granted') {
        throw new ChangeProofError(`Revision "${revision.revisionId}" is already granted; refusing a double grant.`);
      }
      const granter = NonEmptyStringSchema.parse(input.granter);
      if (granter === revision.requester) {
        throw new ChangeProofError('Granter must differ from the requester; the agent never grants its own scope.');
      }
      revisions.set(revision.revisionId, {
        ...revision,
        status: 'granted',
        granter,
      });
      NonEmptyStringSchema.parse(input.rationale);
    },

    recordConflict(input: { between: readonly string[]; description: string }): void {
      if (input.between.length < 2) {
        throw new ChangeProofError('A conflict needs at least two sides; refusing.');
      }
      for (const side of input.between) {
        NonEmptyStringSchema.parse(side);
      }
      conflicts.push({ between: [...input.between], description: NonEmptyStringSchema.parse(input.description) });
    },

    assessBranch(): BranchAssessment {
      if (conflicts.length > 0) {
        const latestConflict = conflicts[conflicts.length - 1];
        return {
          verdict: 'blocked',
          reason: 'Conflicting intent is recorded; the owner must resolve it.',
          blocker: `Intent conflict (${latestConflict?.between.join(' vs ') ?? 'unknown'}): ${latestConflict?.description ?? ''} Next: owner resolves the conflict; the agent invents no API meanwhile.`,
        };
      }
      const latest = attempts.length === 0 ? undefined : attempts[attempts.length - 1];
      if (latest?.failureKind === 'environment') {
        return {
          verdict: 'blocked',
          reason: 'Latest evidence is an infrastructure failure.',
          blocker: `Infrastructure failure unresolved (${latest.failureSignature ?? 'no signature'}). Next: probe the runtime/guest with a fresh trial; business behavior stays untouched.`,
        };
      }
      if (executedCount() >= config.maxAttempts) {
        return {
          verdict: 'stop-branch',
          reason: 'Attempt budget exhausted.',
          blocker: `Budget of ${config.maxAttempts} executed attempts is spent. Next: owner opens a new budgeted run with a fresh distinguishing probe.`,
        };
      }
      if (latest !== undefined && latest.repetition && latest.newEvidenceRefs.length === 0) {
        const untried = [...probes.values()].find((probe) => probe.observation === null);
        if (untried !== undefined) {
          return {
            verdict: 'continue',
            reason: `Untried probe ${untried.probeId} remains within budget.`,
            blocker: null,
          };
        }
        return {
          verdict: 'stop-branch',
          reason: 'No-progress repetition: two consecutive attempts share hypothesis, patch, and failure with no new evidence.',
          blocker:
            `No-progress on ${latest.hypothesisId} (patch ${latest.patchDigest.slice(0, 12)}…, ` +
            `failure ${latest.failureSignature ?? 'none'}). ` +
            'Next: owner proposes a new distinguishing probe or closes the branch; token and line counts never count as progress.',
        };
      }
      if (latest !== undefined && latest.newEvidenceRefs.length > 0) {
        return { verdict: 'continue', reason: 'Latest attempt brings new evidence.', blocker: null };
      }
      return { verdict: 'continue', reason: 'Branch open.', blocker: null };
    },

    snapshot(): {
      hypotheses: readonly HypothesisRecord[];
      probes: readonly ProbeRecord[];
      attempts: readonly AttemptRecord[];
      scopeRevisions: readonly ScopeRevisionRecord[];
      conflicts: readonly { between: readonly string[]; description: string }[];
    } {
      return {
        hypotheses: [...hypotheses.values()],
        probes: [...probes.values()],
        attempts: [...attempts],
        scopeRevisions: [...revisions.values()],
        conflicts: [...conflicts],
      };
    },
  };
}
