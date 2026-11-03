import { describe, expect, it } from 'vitest';

import {
  assertLegacyRepairAllowed,
  diagnoseLegacy,
  freezeLegacyCorpus,
  freezeLegacyIntent,
  recordLegacyBaseline,
  verifyLegacyCorpus,
} from '../../src/modules/fixtures/legacy.js';

/**
 * WP3-20 / T-36 — qualified legacy recovery failure-path tests (NEG3-19).
 *
 * Written before the implementation. Observed legacy output without owner
 * validation never becomes an oracle: it stays a behavioral hypothesis and
 * the result is diagnosis-only (`behavior_contract_unknown`, no mutation).
 * The runtime agent cannot stamp its own characterization as correct, and
 * repair opens only behind owner-approved intent plus an independent
 * known-valid baseline.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const CONTENT = 'c'.repeat(64);
const OBSERVED = 'd'.repeat(64);

function corpus() {
  return freezeLegacyCorpus({
    corpusId: 'legacy-ledger-v1',
    contentDigest: CONTENT,
    sanitization: 'customer PII redacted; account numbers tokenized',
    inventory: [
      { kind: 'entrypoint', ref: 'ledgerd/main.cob' },
      { kind: 'job', ref: 'nightly-post' },
      { kind: 'dynamic_sql', ref: 'queries.cob:post_tx' },
    ],
    pinnedAt: NOW,
    pinnedBy: 'trusted-author-1',
  });
}

function intentFor(pinned = corpus()) {
  return freezeLegacyIntent({
    intentId: 'intent-legacy-1',
    corpus: pinned,
    invariants: ['ledger balances per tenant per day'],
    characterizedBy: 'runtime-agent-run-7',
    ownerApproval: {
      ownerId: 'domain-owner-ledger',
      approvedAt: NOW,
      statement: 'posting must preserve per-tenant daily balance',
    },
    frozenAt: NOW,
  });
}

describe('observed behavior never becomes an oracle without owner validation', () => {
  it('keeps unapproved characterization as diagnosis-only with no mutation', () => {
    const diagnosis = diagnoseLegacy({
      diagnosisId: 'diag-1',
      corpus: corpus(),
      knownFacts: ['nightly-post writes ledger.postings'],
      competingHypotheses: ['rounding to cents', 'rounding to minor units with bankers rule'],
      uncertainty: 'rounding rule unconfirmed; no owner statement',
      blockedCapabilities: ['legacy-repair'],
      nextEvidence: 'owner-approved rounding invariant',
      decisionOwner: 'domain-owner-ledger',
      nextSafeProbe: 'read-only replay of nightly-post on a sanitized clone',
      diagnosedAt: NOW,
    });
    expect(diagnosis.reason).toBe('behavior_contract_unknown');
    expect(diagnosis.mutations).toBe('none');
    expect(diagnosis.blockedCapabilities).toContain('legacy-repair');
  });

  it('refuses a self-stamped intent where the owner is the characterizing agent', () => {
    expect(() =>
      freezeLegacyIntent({
        intentId: 'intent-self-stamp',
        corpus: corpus(),
        invariants: ['observed output matches'],
        characterizedBy: 'runtime-agent-run-7',
        ownerApproval: {
          ownerId: 'runtime-agent-run-7',
          approvedAt: NOW,
          statement: 'looks correct to me',
        },
        frozenAt: NOW,
      }),
    ).toThrow(/self-stamp|independent/i);
  });

  it('refuses a baseline validated by the characterizing agent', () => {
    expect(() =>
      recordLegacyBaseline({
        baselineId: 'base-self',
        intent: intentFor(),
        observationsDigest: OBSERVED,
        validatorId: 'runtime-agent-run-7',
        validatedAt: NOW,
      }),
    ).toThrow(/independent/i);
  });
});

describe('repair gate opens only behind owner intent plus independent baseline', () => {
  it('allows repair with approved intent and an independent known-valid baseline', () => {
    const intent = intentFor();
    const baseline = recordLegacyBaseline({
      baselineId: 'base-1',
      intent,
      observationsDigest: OBSERVED,
      validatorId: 'independent-validator-2',
      validatedAt: NOW,
    });
    expect(() => {
      assertLegacyRepairAllowed(intent, baseline);
    }).not.toThrow();
  });

  it('withholds repair when the baseline belongs to a different intent', () => {
    const intent = intentFor();
    const other = freezeLegacyIntent({
      intentId: 'intent-legacy-2',
      corpus: corpus(),
      invariants: ['other invariant'],
      characterizedBy: 'runtime-agent-run-7',
      ownerApproval: { ownerId: 'domain-owner-ledger', approvedAt: NOW, statement: 'other' },
      frozenAt: NOW,
    });
    const baseline = recordLegacyBaseline({
      baselineId: 'base-2',
      intent: other,
      observationsDigest: OBSERVED,
      validatorId: 'independent-validator-2',
      validatedAt: NOW,
    });
    expect(() => {
      assertLegacyRepairAllowed(intent, baseline);
    }).toThrow(/intent/i);
  });

  it('invalidates proof on corpus drift', () => {
    const pinned = corpus();
    expect(() => verifyLegacyCorpus({ ...pinned, sanitization: 'rewritten after freeze' })).toThrow(
      /drift|digest/i,
    );
  });
});
