import { describe, expect, it } from 'vitest';

import { createHypothesisLedger } from '../../src/modules/agent/index.js';

/**
 * WP3-07 / T-19 — hypothesis ledger, candidate revision, no-progress stopper
 * (FR3-08, NEG3-01/04/19/20).
 *
 * Written before the implementation. The ledger records claims, evidence,
 * pre-registered probes, and attempts; promotion to a supported cause needs
 * a mechanism plus a distinguishing probe; repetition without new evidence
 * stops the branch; cosmetic retries are rejected; infrastructure failures
 * never become causes; scope growth needs a granted revision; and the ledger
 * carries no oracle field anywhere.
 */

function attemptInput(overrides: Record<string, unknown> = {}) {
  return {
    hypothesisId: 'hyp-1',
    candidateDigest: 'c'.repeat(64),
    patchDigest: 'p'.repeat(64),
    failureSignature: 'check-null-deref:fail:null-at-line-9',
    failureKind: 'runtime',
    checkRefs: ['check-null-deref'],
    snapshotRefs: ['snap-1'],
    newEvidenceRefs: [],
    ...overrides,
  } as {
    hypothesisId: string;
    candidateDigest: string;
    patchDigest: string;
    failureSignature?: string;
    failureKind: string;
    checkRefs: string[];
    snapshotRefs: string[];
    newEvidenceRefs: string[];
  };
}

describe('hypotheses, evidence, and probes (FR3-08)', () => {
  it('creates a symptom hypothesis and attaches supporting evidence', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { id } = ledger.createHypothesis({ claim: 'Null deref on profile load.' });
    ledger.attachEvidence({ hypothesisId: id, direction: 'supporting', ref: 'trace-1', summary: 'Stack at line 9.' });

    const snapshot = ledger.snapshot();
    expect(snapshot.hypotheses[0]?.status).toBe('symptom');
    expect(snapshot.hypotheses[0]?.supporting).toHaveLength(1);
  });

  it('requires a full probe declaration before any outcome is recorded', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { id } = ledger.createHypothesis({ claim: 'Race on cache fill.' });
    expect(() =>
      ledger.registerProbe({
        hypothesisId: id,
        predictedObservation: '',
        competingExplanation: 'Single-threaded path.',
        costCap: 100,
        safetyScope: 'disposable guest',
        stopRule: 'stop after 3 trials',
      }),
    ).toThrow(/predicted/i);
    expect(() => { ledger.recordProbeOutcome({ probeId: 'probe-ghost', observation: 'x', supportsClaim: true, costSpent: 1 }); },
    ).toThrow(/unknown probe/i);
  });

  it('retains negative outcomes and flags cost overruns without losing them', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { id } = ledger.createHypothesis({ claim: 'Race on cache fill.' });
    const { probeId } = ledger.registerProbe({
      hypothesisId: id,
      predictedObservation: 'Interleaving reproduces.',
      competingExplanation: 'Deterministic path.',
      costCap: 10,
      safetyScope: 'disposable guest',
      stopRule: 'stop after 3 trials',
    });
    ledger.recordProbeOutcome({ probeId, observation: 'No interleaving in 50 trials.', supportsClaim: false, costSpent: 25 });

    const snapshot = ledger.snapshot();
    expect(snapshot.probes[0]?.supportsClaim).toBe(false);
    expect(snapshot.probes[0]?.overrun).toBe(true);
    expect(() => { ledger.recordProbeOutcome({ probeId, observation: 'again', supportsClaim: true, costSpent: 1 }); },
    ).toThrow(/already recorded/i);
  });
});

describe('promotion needs mechanism plus distinguishing probe (FR3-08.6)', () => {
  it('promotes to supported cause only with mechanism and probe refs', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { id } = ledger.createHypothesis({ claim: 'Missing null check.', initialStatus: 'suspected_cause' });
    const { probeId } = ledger.registerProbe({
      hypothesisId: id,
      predictedObservation: 'Guard fixes the deref.',
      competingExplanation: 'Caller never passes null.',
      costCap: 100,
      safetyScope: 'disposable guest',
      stopRule: 'one trial',
    });
    expect(() => { ledger.transitionHypothesis({ hypothesisId: id, to: 'supported_cause', rationale: 'Looks right.' }); })
      .toThrow(/mechanism/i);
    ledger.recordProbeOutcome({ probeId, observation: 'Guard fixes it; removal revives it.', supportsClaim: true, costSpent: 5 });
    ledger.transitionHypothesis({
      hypothesisId: id,
      to: 'supported_cause',
      rationale: 'Intervention distinguishes the alternatives.',
      mechanismRef: 'src/profile.ts:9',
      distinguishingProbeId: probeId,
    });
    expect(ledger.snapshot().hypotheses[0]?.status).toBe('supported_cause');
  });

  it('refutes only on contradicting evidence and then stays terminal', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { id } = ledger.createHypothesis({ claim: 'Wrong theory.' });
    expect(() => { ledger.transitionHypothesis({ hypothesisId: id, to: 'refuted_hypothesis', rationale: 'Nope.' }); })
      .toThrow(/contradict/i);
    ledger.attachEvidence({ hypothesisId: id, direction: 'contradicting', ref: 'trace-2', summary: 'Path not taken.' });
    ledger.transitionHypothesis({ hypothesisId: id, to: 'refuted_hypothesis', rationale: 'Path not taken.' });
    expect(() => { ledger.transitionHypothesis({ hypothesisId: id, to: 'suspected_cause', rationale: 'Reopen.' }); })
      .toThrow(/terminal/i);
  });

  it('lets several supported causes coexist without forcing one (FR3-08.7)', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    for (const claim of ['Cause A.', 'Cause B.']) {
      const { id } = ledger.createHypothesis({ claim, initialStatus: 'suspected_cause' });
      const { probeId } = ledger.registerProbe({
        hypothesisId: id,
        predictedObservation: 'Fix works.',
        competingExplanation: 'Other cause.',
        costCap: 10,
        safetyScope: 'guest',
        stopRule: 'once',
      });
      ledger.recordProbeOutcome({ probeId, observation: 'Fix works.', supportsClaim: true, costSpent: 1 });
      ledger.transitionHypothesis({
        hypothesisId: id,
        to: 'supported_cause',
        rationale: 'Distinguished.',
        mechanismRef: 'src/x.ts:1',
        distinguishingProbeId: probeId,
      });
    }
    expect(ledger.snapshot().hypotheses.filter((entry) => entry.status === 'supported_cause')).toHaveLength(2);
  });
});

describe('attempts, budget, and cosmetic retries (NEG3-20)', () => {
  it('exhausts the attempt budget without any reset path', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 1 });
    ledger.createHypothesis({ id: 'hyp-1', claim: 'C.' });
    ledger.recordAttempt(attemptInput());
    expect(() => ledger.recordAttempt(attemptInput({ patchDigest: 'q'.repeat(64) }))).toThrow(/exhausted/i);
  });

  it('rejects a cosmetic retry that brings nothing new', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    ledger.createHypothesis({ id: 'hyp-1', claim: 'C.' });
    const first = attemptInput();
    ledger.recordAttempt(first);
    expect(() => ledger.recordAttempt({ ...first, priorCandidateDigest: 'c'.repeat(64) })).toThrow(/cosmetic/i);
    expect(() =>
      ledger.recordAttempt({ ...first, priorCandidateDigest: 'c'.repeat(64), newEvidenceRefs: ['trace-9'] }),
    ).not.toThrow();
  });

  it('records guard rejections without burning the execution budget (NEG3-04)', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 1 });
    ledger.createHypothesis({ id: 'hyp-1', claim: 'C.' });
    ledger.recordAttempt(attemptInput({ guardVerdict: 'rejected' }));
    // The rejected candidate never ran, so the budget still holds one execution.
    expect(() => ledger.recordAttempt(attemptInput({ patchDigest: 'q'.repeat(64) }))).not.toThrow();
  });
});

describe('no-progress stopper (FR3-08.8)', () => {
  it('stops the branch after two identical attempts with nothing new', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    ledger.createHypothesis({ id: 'hyp-1', claim: 'C.' });
    ledger.recordAttempt(attemptInput());
    const repeated = ledger.recordAttempt(attemptInput());
    expect(repeated.repetition).toBe(true);
    const assessment = ledger.assessBranch();
    expect(assessment.verdict).toBe('stop-branch');
    expect(assessment.reason).toMatch(/no-progress|repetition/i);
    expect(assessment.blocker?.length).toBeGreaterThan(0);
  });

  it('continues when the latest attempt brings new evidence', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    ledger.createHypothesis({ id: 'hyp-1', claim: 'C.' });
    ledger.recordAttempt(attemptInput());
    ledger.recordAttempt(attemptInput({ newEvidenceRefs: ['trace-fresh'] }));
    expect(ledger.assessBranch().verdict).toBe('continue');
  });

  it('continues when an untried distinguishing probe remains within budget', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { id } = ledger.createHypothesis({ claim: 'C.' });
    ledger.registerProbe({
      hypothesisId: id,
      predictedObservation: 'Distinguishes.',
      competingExplanation: 'Alternative.',
      costCap: 10,
      safetyScope: 'guest',
      stopRule: 'once',
    });
    ledger.recordAttempt(attemptInput({ hypothesisId: id }));
    ledger.recordAttempt(attemptInput({ hypothesisId: id }));
    const assessment = ledger.assessBranch();
    expect(assessment.verdict).toBe('continue');
    expect(assessment.reason).toMatch(/untried probe/i);
  });
});

describe('infrastructure failures explain nothing (FR3-08.5)', () => {
  it('refuses promotion while the latest evidence is an environment failure', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { id } = ledger.createHypothesis({ claim: 'C.', initialStatus: 'suspected_cause' });
    const { probeId } = ledger.registerProbe({
      hypothesisId: id,
      predictedObservation: 'x',
      competingExplanation: 'y',
      costCap: 10,
      safetyScope: 'guest',
      stopRule: 'once',
    });
    ledger.recordProbeOutcome({ probeId, observation: 'ok', supportsClaim: true, costSpent: 1 });
    ledger.recordAttempt(
      attemptInput({ hypothesisId: id, failureKind: 'environment', failureSignature: 'guest-oom:fail' }),
    );
    expect(() => { ledger.transitionHypothesis({
        hypothesisId: id,
        to: 'supported_cause',
        rationale: 'Probe passed.',
        mechanismRef: 'src/x.ts:1',
        distinguishingProbeId: probeId,
      }); },
    ).toThrow(/infrastructure/i);
  });

  it('reports an infrastructure blocker instead of a fix stop', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    ledger.createHypothesis({ id: 'hyp-1', claim: 'C.' });
    ledger.recordAttempt(attemptInput({ failureKind: 'environment', failureSignature: 'guest-oom:fail' }));
    const assessment = ledger.assessBranch();
    expect(assessment.verdict).toBe('blocked');
    expect(assessment.blocker).toMatch(/infrastructure/i);
  });
});

describe('scope revisions need a different granter', () => {
  it('requests and grants a revision for new targets', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { revisionId } = ledger.requestScopeRevision({
      targets: ['svc-billing'],
      writeSurfaces: ['src/billing/'],
      rationale: 'Impact crosses services.',
      requester: 'agent-loop-1',
    });
    ledger.grantScopeRevision({ revisionId, granter: 'owner-reyn', rationale: 'Approved after review.' });
    expect(ledger.snapshot().scopeRevisions[0]?.status).toBe('granted');
  });

  it('refuses self-grants and unknown revisions', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { revisionId } = ledger.requestScopeRevision({
      targets: ['svc-x'],
      writeSurfaces: [],
      rationale: 'Need more.',
      requester: 'agent-loop-1',
    });
    expect(() => { ledger.grantScopeRevision({ revisionId, granter: 'agent-loop-1', rationale: 'Trust me.' }); }).toThrow(
      /granter/i,
    );
    expect(() => { ledger.grantScopeRevision({ revisionId: 'rev-ghost', granter: 'owner-reyn', rationale: 'x' }); }).toThrow(
      /unknown revision/i,
    );
  });
});

describe('conflicts and ledger honesty (NEG3-01/19)', () => {
  it('blocks the branch on conflicting intent instead of inventing an API', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    ledger.recordConflict({ between: ['keep-old-behavior', 'ship-new-behavior'], description: 'Intent clash.' });
    const assessment = ledger.assessBranch();
    expect(assessment.verdict).toBe('blocked');
    expect(assessment.blocker).toMatch(/conflict/i);
  });

  it('carries no oracle field anywhere in the ledger', () => {
    const ledger = createHypothesisLedger({ maxAttempts: 5 });
    const { id } = ledger.createHypothesis({ claim: 'C.' });
    ledger.attachEvidence({ hypothesisId: id, direction: 'supporting', ref: 'trace-1', summary: 'Observed.' });
    ledger.recordAttempt(attemptInput({ hypothesisId: id }));
    expect(JSON.stringify(ledger.snapshot())).not.toMatch(/oracle/i);
  });
});
