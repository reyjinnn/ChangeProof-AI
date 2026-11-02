import { createHash } from 'node:crypto';

import {
  ChangeProofError,
  InstantSchema,
  LegacyBaselineSchema,
  LegacyCorpusSchema,
  LegacyDiagnosisSchema,
  LegacyIntentSchema,
  LegacyInventoryItemSchema,
  NonEmptyStringSchema,
  Sha256Schema,
  type LegacyBaseline,
  type LegacyCorpus,
  type LegacyDiagnosis,
  type LegacyIntent,
} from '../../core/index.js';

/**
 * Qualified legacy recovery (WP3-20, FR3-28, SC3-09).
 *
 * Trusted authoring pins a sanitized corpus, owner-approved intent, and an
 * independent known-valid baseline — each content-addressed, so drift
 * invalidates the proof. The characterizing agent can neither approve its
 * own intent nor validate its own baseline (NEG3-19). Without owner intent
 * plus an independent baseline, `diagnoseLegacy` is the only exit: a
 * diagnosis-only result with `behavior_contract_unknown` and no mutation.
 * Repair itself reuses the normal pipeline behind `assertLegacyRepairAllowed`.
 */

function digestOf(body: object): string {
  return createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
}

export function freezeLegacyCorpus(input: {
  corpusId: string;
  contentDigest: string;
  sanitization: string;
  inventory: readonly unknown[];
  pinnedAt: string;
  pinnedBy: string;
}): LegacyCorpus {
  const staged = LegacyCorpusSchema.parse({
    schemaVersion: '1',
    corpusId: NonEmptyStringSchema.parse(input.corpusId),
    contentDigest: Sha256Schema.parse(input.contentDigest),
    sanitization: NonEmptyStringSchema.parse(input.sanitization),
    inventory: input.inventory.map((item) => LegacyInventoryItemSchema.parse(item)),
    pinnedAt: InstantSchema.parse(input.pinnedAt),
    pinnedBy: NonEmptyStringSchema.parse(input.pinnedBy),
    digest: '0'.repeat(64),
  });
  const body: Record<string, unknown> = { ...staged };
  delete body['digest'];
  return LegacyCorpusSchema.parse({ ...body, digest: digestOf(body) });
}

export function verifyLegacyCorpus(corpus: unknown): LegacyCorpus {
  const parsed = LegacyCorpusSchema.parse(corpus);
  const { digest, ...body } = parsed;
  if (digestOf(body) !== digest) {
    throw new ChangeProofError('Legacy corpus drifted from its frozen digest; the proof is invalid.');
  }
  return parsed;
}

export function freezeLegacyIntent(input: {
  intentId: string;
  corpus: LegacyCorpus;
  invariants: readonly string[];
  characterizedBy: string;
  ownerApproval: { ownerId: string; approvedAt: string; statement: string };
  frozenAt: string;
}): LegacyIntent {
  verifyLegacyCorpus(input.corpus);
  const staged = LegacyIntentSchema.parse({
    schemaVersion: '1',
    intentId: NonEmptyStringSchema.parse(input.intentId),
    corpusDigest: input.corpus.digest,
    invariants: [...input.invariants],
    characterizedBy: NonEmptyStringSchema.parse(input.characterizedBy),
    ownerApproval: {
      ownerId: NonEmptyStringSchema.parse(input.ownerApproval.ownerId),
      approvedAt: InstantSchema.parse(input.ownerApproval.approvedAt),
      statement: NonEmptyStringSchema.parse(input.ownerApproval.statement),
    },
    frozenAt: InstantSchema.parse(input.frozenAt),
    digest: '0'.repeat(64),
  });
  const body: Record<string, unknown> = { ...staged };
  delete body['digest'];
  return LegacyIntentSchema.parse({ ...body, digest: digestOf(body) });
}

export function recordLegacyBaseline(input: {
  baselineId: string;
  intent: LegacyIntent;
  observationsDigest: string;
  validatorId: string;
  validatedAt: string;
}): LegacyBaseline {
  if (input.validatorId === input.intent.characterizedBy) {
    throw new ChangeProofError(
      'Baseline validator must be independent of the characterizing agent (NEG3-19).',
    );
  }
  const staged = LegacyBaselineSchema.parse({
    schemaVersion: '1',
    baselineId: NonEmptyStringSchema.parse(input.baselineId),
    intentDigest: input.intent.digest,
    observationsDigest: Sha256Schema.parse(input.observationsDigest),
    validatorId: NonEmptyStringSchema.parse(input.validatorId),
    validatedAt: InstantSchema.parse(input.validatedAt),
    knownValid: true,
    digest: '0'.repeat(64),
  });
  const body: Record<string, unknown> = { ...staged };
  delete body['digest'];
  return LegacyBaselineSchema.parse({ ...body, digest: digestOf(body) });
}

export function diagnoseLegacy(input: {
  diagnosisId: string;
  corpus: LegacyCorpus;
  knownFacts: readonly string[];
  competingHypotheses: readonly string[];
  uncertainty: string;
  blockedCapabilities: readonly string[];
  nextEvidence: string;
  decisionOwner: string;
  nextSafeProbe: string;
  diagnosedAt: string;
}): LegacyDiagnosis {
  verifyLegacyCorpus(input.corpus);
  return LegacyDiagnosisSchema.parse({
    schemaVersion: '1',
    diagnosisId: NonEmptyStringSchema.parse(input.diagnosisId),
    corpusDigest: input.corpus.digest,
    reason: 'behavior_contract_unknown',
    knownFacts: [...input.knownFacts],
    competingHypotheses: [...input.competingHypotheses],
    uncertainty: NonEmptyStringSchema.parse(input.uncertainty),
    blockedCapabilities: [...input.blockedCapabilities],
    nextEvidence: NonEmptyStringSchema.parse(input.nextEvidence),
    decisionOwner: NonEmptyStringSchema.parse(input.decisionOwner),
    nextSafeProbe: NonEmptyStringSchema.parse(input.nextSafeProbe),
    mutations: 'none',
    diagnosedAt: InstantSchema.parse(input.diagnosedAt),
  });
}

/** Repair opens only behind approved intent plus an independent valid baseline. */
export function assertLegacyRepairAllowed(intent: LegacyIntent, baseline: LegacyBaseline): void {
  const verifiedIntent = LegacyIntentSchema.parse(intent);
  const { digest: intentDigest, ...intentBody } = verifiedIntent;
  if (digestOf(intentBody) !== intentDigest) {
    throw new ChangeProofError('Legacy intent drifted from its frozen digest; repair is withheld.');
  }
  const verifiedBaseline = LegacyBaselineSchema.parse(baseline);
  const { digest: baselineDigest, ...baselineBody } = verifiedBaseline;
  if (digestOf(baselineBody) !== baselineDigest) {
    throw new ChangeProofError('Legacy baseline drifted from its frozen digest; repair is withheld.');
  }
  if (verifiedBaseline.intentDigest !== intentDigest) {
    throw new ChangeProofError('Baseline belongs to a different intent; repair is withheld.');
  }
  if (verifiedBaseline.validatorId === verifiedIntent.characterizedBy) {
    throw new ChangeProofError('Baseline validator is not independent; repair is withheld (NEG3-19).');
  }
}
