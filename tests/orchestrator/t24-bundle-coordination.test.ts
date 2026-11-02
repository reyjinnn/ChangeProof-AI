import { describe, expect, it } from 'vitest';

import type { SubjectRef, TargetAssessment } from '../../src/core/index.js';
import {
  SubjectRefSchema,
  subjectKey,
  TargetAssessmentSchema,
} from '../../src/core/index.js';
import { createHypothesisLedger } from '../../src/modules/agent/index.js';
import type { CoordinateBundleInput } from '../../src/orchestrator/bundle.js';
import {
  coordinateBundle,
  coordinateRecovery,
} from '../../src/orchestrator/bundle.js';

const POLICY_VERSION = '1';

function subject(kind: 'producer' | 'worker', id: string, repository: string): SubjectRef {
  return SubjectRefSchema.parse({ kind, id, repository });
}

function assessment(
  target: SubjectRef,
  outcome: TargetAssessment['outcome'],
  reasons: string[] = [],
): TargetAssessment {
  return TargetAssessmentSchema.parse({
    schemaVersion: '1',
    subject: target,
    outcome,
    proofScope: {
      targets: [target],
      edges: [],
      invariants: ['contract-holds'],
      unsupportedSurfaces: [],
    },
    policyVersion: POLICY_VERSION,
    reasons,
    evidenceRefs: [`ev-${target.id}`],
  });
}

function digest(tag: string): string {
  return tag.repeat(64).slice(0, 64);
}

const api = subject('producer', 'checkout-api', 'shop-api');
const worker = subject('worker', 'order-worker', 'shop-worker');

function baseBundleInput(): CoordinateBundleInput {
  return {
    candidateBundleDigest: digest('b'),
    requiredTargets: [api, worker],
    targetOutcomes: [assessment(api, 'fixed'), assessment(worker, 'fixed')],
    targetDigests: {
      [subjectKey(api)]: { candidate: digest('a'), verified: digest('a') },
      [subjectKey(worker)]: { candidate: digest('w'), verified: digest('w') },
    },
    edges: [
      {
        from: api,
        to: worker,
        status: 'proven' as const,
        checkRef: 'chk-edge-order-created',
      },
    ],
    invariants: [{ ref: 'inv-effect-once', holds: true, checkRef: 'chk-effect-once' }],
    mixedVersion: {
      requiredPairs: ['api-v2+worker-v1', 'api-v2+worker-v2'],
      coveredPairs: ['api-v2+worker-v1', 'api-v2+worker-v2'],
      allCampaignsComplete: true,
    },
    intentFulfilled: true,
    guardAllowed: true,
    policyVersion: POLICY_VERSION,
  };
}

function baseAttempt() {
  return {
    candidateDigest: digest('c'),
    patchDigest: digest('p'),
    failureSignature: 'TypeError: cannot read properties of null',
    failureKind: 'runtime',
    checkRefs: ['chk-1'],
    snapshotRefs: ['snap-1'],
    newEvidenceRefs: ['ev-new-1'],
    strategyChange: 'added null-guard probe chk-1',
  };
}

describe('coordinateBundle (WP3-11)', () => {
  it('verifies an SC3-01-shaped bundle: all fixed, edges proven, mixed-version complete', () => {
    const result = coordinateBundle(baseBundleInput());
    expect(result.assessment.state).toBe('verified');
    expect(result.assessment.reasons).toEqual([]);
    expect(result.facts.requiredEdgesPassed).toBe(true);
    expect(result.facts.mixedVersionChecksPassed).toBe(true);
    expect(result.facts.identitiesFresh).toBe(true);
    expect(result.bindings).toHaveLength(2);
    expect(result.coverageGaps).toEqual([]);
  });

  it('NEG3-06: local pass with an unresolved edge blocks the bundle', () => {
    const input = baseBundleInput();
    input.edges = [{ from: api, to: worker, status: 'unresolved', checkRef: 'chk-edge-order-created' }];
    const result = coordinateBundle(input);
    expect(result.assessment.state).toBe('blocked');
    expect(result.assessment.blockingReasons).toContain('required edge failed');
    expect(result.unresolvedEdges).toHaveLength(1);
  });

  it('NEG3-06: local pass with an incomplete mixed-version campaign blocks the bundle', () => {
    const input = baseBundleInput();
    input.mixedVersion = {
      requiredPairs: ['api-v2+worker-v1', 'api-v2+worker-v2'],
      coveredPairs: ['api-v2+worker-v1'],
      allCampaignsComplete: false,
    };
    const result = coordinateBundle(input);
    expect(result.assessment.state).toBe('blocked');
    expect(result.assessment.blockingReasons).toContain('mixed-version checks failed');
  });

  it('NEG3-06: candidate/verified digest drift blocks the bundle', () => {
    const input = baseBundleInput();
    input.targetDigests[subjectKey(worker)] = { candidate: digest('x'), verified: digest('w') };
    const result = coordinateBundle(input);
    expect(result.assessment.state).toBe('blocked');
    expect(result.assessment.blockingReasons).toContain('identity drift');
  });

  it('a guard violation blocks the bundle and withholds publication', () => {
    const input = baseBundleInput();
    input.guardAllowed = false;
    const result = coordinateBundle(input);
    expect(result.assessment.state).toBe('blocked');
    expect(result.assessment.blockingReasons.some((r) => r.includes('guard'))).toBe(true);
  });

  it('SC3-04-shaped: a violated cross-cutting invariant blocks the bundle', () => {
    const input = baseBundleInput();
    input.invariants = [{ ref: 'inv-effect-once', holds: false, checkRef: 'chk-effect-once' }];
    const result = coordinateBundle(input);
    expect(result.assessment.state).toBe('blocked');
    expect(result.assessment.blockingReasons).toContain('required invariant failed');
  });

  it('a missing target assessment leaves the bundle incomplete and names the gap', () => {
    const input = baseBundleInput();
    input.targetOutcomes = [assessment(api, 'fixed')];
    const result = coordinateBundle(input);
    expect(result.assessment.state).toBe('incomplete');
    expect(result.coverageGaps).toEqual([subjectKey(worker)]);
  });

  it('a failed target keeps the bundle incomplete without claiming bundle proof', () => {
    const input = baseBundleInput();
    input.targetOutcomes = [assessment(api, 'fixed'), assessment(worker, 'failed', ['no_progress'])];
    const result = coordinateBundle(input);
    expect(result.assessment.state).toBe('incomplete');
  });

  it('invalid target evidence takes precedence and invalidates the bundle', () => {
    const input = baseBundleInput();
    input.targetOutcomes = [
      assessment(api, 'unverified', ['evidence_invalid']),
      assessment(worker, 'fixed'),
    ];
    const result = coordinateBundle(input);
    expect(result.assessment.state).toBe('invalid');
  });

  it('fails closed on malformed coordination input', () => {
    expect(() => coordinateBundle({ ...baseBundleInput(), requiredTargets: [] })).toThrow();
    expect(() => coordinateBundle({ ...baseBundleInput(), candidateBundleDigest: '' })).toThrow();
    expect(() =>
      coordinateBundle({
        ...baseBundleInput(),
        edges: [{ from: api, to: worker, status: 'proven', checkRef: '' }],
      }),
    ).toThrow();
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      ref: `inv-${i}`,
      holds: true,
      checkRef: `chk-${i}`,
    }));
    expect(() => coordinateBundle({ ...baseBundleInput(), invariants: tooMany })).toThrow();
  });
});

describe('coordinateRecovery (WP3-11, SC3-05)', () => {
  it('retries on real contradiction with a new superseding hypothesis', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 3 });
    const first = ledger.createHypothesis({ claim: 'null guard missing in checkout' });
    const decision = coordinateRecovery({
      ledger,
      currentHypothesisId: first.id,
      attempt: baseAttempt(),
      contradictions: [{ hypothesisId: first.id, ref: 'ev-contra-1', summary: 'worker log contradicts api cause' }],
      newHypothesisClaim: 'event payload missing order id from producer',
    });
    expect(decision.decision).toBe('retry');
    if (decision.decision !== 'retry') throw new Error('unreachable');
    expect(decision.hypothesisId).not.toBe(first.id);
    const snap = ledger.snapshot();
    expect(snap.hypotheses.find((h) => h.id === first.id)?.status).toBe('refuted_hypothesis');
    expect(snap.hypotheses.find((h) => h.id === decision.hypothesisId)?.supersedes).toBe(first.id);
    expect(snap.attempts).toHaveLength(1);
  });

  it('refuses a contradiction without a new hypothesis (no cosmetic path)', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 3 });
    const first = ledger.createHypothesis({ claim: 'null guard missing in checkout' });
    expect(() =>
      coordinateRecovery({
        ledger,
        currentHypothesisId: first.id,
        attempt: baseAttempt(),
        contradictions: [{ hypothesisId: first.id, ref: 'ev-contra-1', summary: 'contradicted' }],
      }),
    ).toThrow();
  });

  it('refuses a contradiction routed at the wrong hypothesis', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 3 });
    const first = ledger.createHypothesis({ claim: 'null guard missing in checkout' });
    expect(() =>
      coordinateRecovery({
        ledger,
        currentHypothesisId: first.id,
        attempt: baseAttempt(),
        contradictions: [{ hypothesisId: 'hyp-other', ref: 'ev-contra-9', summary: 'misrouted' }],
        newHypothesisClaim: 'unrelated claim',
      }),
    ).toThrow(/wrong hypothesis/);
    expect(ledger.snapshot().attempts).toHaveLength(0);
  });

  it('stops on no-progress repetition instead of retrying forever', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const first = ledger.createHypothesis({ claim: 'null guard missing in checkout' });
    const again = coordinateRecovery({
      ledger,
      currentHypothesisId: first.id,
      attempt: baseAttempt(),
    });
    expect(again.decision).toBe('retry');
    const stop = coordinateRecovery({
      ledger,
      currentHypothesisId: first.id,
      attempt: { ...baseAttempt(), newEvidenceRefs: [] },
    });
    expect(stop.decision).toBe('stop');
    if (stop.decision !== 'stop') throw new Error('unreachable');
    expect(stop.terminalOutcome).toBe('failed');
  });

  it('stops when the attempt adds no new evidence and no strategy change', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 3 });
    const first = ledger.createHypothesis({ claim: 'null guard missing in checkout' });
    const { strategyChange: _ignored, ...bare } = baseAttempt();
    expect(_ignored).toBeDefined();
    const stop = coordinateRecovery({
      ledger,
      currentHypothesisId: first.id,
      attempt: { ...bare, newEvidenceRefs: [] },
    });
    expect(stop.decision).toBe('stop');
  });

  it('stops failed when the attempt budget is spent', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 1 });
    const first = ledger.createHypothesis({ claim: 'null guard missing in checkout' });
    const stop = coordinateRecovery({
      ledger,
      currentHypothesisId: first.id,
      attempt: baseAttempt(),
    });
    expect(stop.decision).toBe('stop');
  });

  it('routes an intent conflict to the owner as blocked, not failed', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 3 });
    const first = ledger.createHypothesis({ claim: 'null guard missing in checkout' });
    const blocked = coordinateRecovery({
      ledger,
      currentHypothesisId: first.id,
      attempt: baseAttempt(),
      intentConflict: { between: ['owner-a', 'owner-b'], description: 'disagree on rollback' },
    });
    expect(blocked.decision).toBe('blocked');
    expect(ledger.snapshot().conflicts).toHaveLength(1);
  });

  it('routes an infrastructure failure to blocked with the failure signature', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 3 });
    const first = ledger.createHypothesis({ claim: 'null guard missing in checkout' });
    const blocked = coordinateRecovery({
      ledger,
      currentHypothesisId: first.id,
      attempt: { ...baseAttempt(), failureKind: 'environment', failureSignature: 'runner lost' },
    });
    expect(blocked.decision).toBe('blocked');
  });
});
