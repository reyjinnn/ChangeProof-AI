import { z } from 'zod';

import { InstantSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';

/**
 * Qualified legacy recovery contracts (WP3-20, FR3-28, SC3-09).
 *
 * A sanitized corpus is pinned, owner/domain intent is frozen with an
 * independent approval, and a known-valid baseline is recorded by an
 * independent validator. Observed output is a behavioral hypothesis — it
 * never becomes an oracle without owner validation (NEG3-19). Without
 * sufficient invariants/baseline, results are diagnosis-only with
 * `behavior_contract_unknown` and explicitly no mutation.
 */

export const LegacyInventoryKindSchema = z.enum([
  'entrypoint',
  'job',
  'config',
  'di_reflection',
  'dynamic_sql',
  'dependency',
  'existing_test',
  'telemetry',
]);
export type LegacyInventoryKind = z.infer<typeof LegacyInventoryKindSchema>;

export const LegacyInventoryItemSchema = z.strictObject({
  kind: LegacyInventoryKindSchema,
  ref: NonEmptyStringSchema,
});
export type LegacyInventoryItem = z.infer<typeof LegacyInventoryItemSchema>;

export const LegacyCorpusSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  corpusId: NonEmptyStringSchema,
  contentDigest: Sha256Schema,
  sanitization: NonEmptyStringSchema,
  inventory: z.array(LegacyInventoryItemSchema).min(1),
  pinnedAt: InstantSchema,
  pinnedBy: NonEmptyStringSchema,
  digest: Sha256Schema,
});
export type LegacyCorpus = z.infer<typeof LegacyCorpusSchema>;

export const LegacyIntentSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    intentId: NonEmptyStringSchema,
    corpusDigest: Sha256Schema,
    invariants: z.array(NonEmptyStringSchema).min(1),
    characterizedBy: NonEmptyStringSchema,
    ownerApproval: z.strictObject({
      ownerId: NonEmptyStringSchema,
      approvedAt: InstantSchema,
      statement: NonEmptyStringSchema,
    }),
    frozenAt: InstantSchema,
    digest: Sha256Schema,
  })
  .superRefine((intent, ctx) => {
    if (intent.ownerApproval.ownerId === intent.characterizedBy) {
      ctx.addIssue({
        code: 'custom',
        path: ['ownerApproval', 'ownerId'],
        message:
          'Owner approval must be independent: the characterizing agent cannot self-stamp its own intent (NEG3-19).',
      });
    }
  });
export type LegacyIntent = z.infer<typeof LegacyIntentSchema>;

export const LegacyBaselineSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  baselineId: NonEmptyStringSchema,
  intentDigest: Sha256Schema,
  observationsDigest: Sha256Schema,
  validatorId: NonEmptyStringSchema,
  validatedAt: InstantSchema,
  knownValid: z.literal(true),
  digest: Sha256Schema,
});
export type LegacyBaseline = z.infer<typeof LegacyBaselineSchema>;

export const LegacyDiagnosisSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  diagnosisId: NonEmptyStringSchema,
  corpusDigest: Sha256Schema,
  reason: z.literal('behavior_contract_unknown'),
  knownFacts: z.array(NonEmptyStringSchema),
  competingHypotheses: z.array(NonEmptyStringSchema).min(1),
  uncertainty: NonEmptyStringSchema,
  blockedCapabilities: z.array(NonEmptyStringSchema).min(1),
  nextEvidence: NonEmptyStringSchema,
  decisionOwner: NonEmptyStringSchema,
  nextSafeProbe: NonEmptyStringSchema,
  mutations: z.literal('none'),
  diagnosedAt: InstantSchema,
});
export type LegacyDiagnosis = z.infer<typeof LegacyDiagnosisSchema>;
