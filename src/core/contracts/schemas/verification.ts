import { z } from 'zod';

import { Sha256Schema } from '../primitives.js';
import { ExecutionModeSchema } from '../vocabulary.js';

/**
 * VerifyResult — what an independent verification stage observed (FR3-15).
 *
 * Two properties are enforced here because both are false-assurance traps:
 *
 *  1. The oracle digest must still equal the frozen digest. A changed oracle
 *     invalidates proof, and a different full pass must not rescue it (NEG3-03).
 *  2. A skipped check is not a pass. A run carrying a skipped *required* check
 *     cannot claim its evidence is valid (.claude/AGENTS.md §4, "skipped check ≠ pass").
 */

export const VerificationStageSchema = z.enum([
  'baseline_old',
  'baseline_new',
  'attempt_fast',
  'post_fix_full',
]);
export type VerificationStage = z.infer<typeof VerificationStageSchema>;

export const CheckResultValueSchema = z.enum(['pass', 'fail', 'skipped', 'error']);
export type CheckResultValue = z.infer<typeof CheckResultValueSchema>;

export const CheckObservationSchema = z
  .strictObject({
    checkId: z.string().min(1),
    result: CheckResultValueSchema,
    /** A check outside the required set may be skipped without invalidating a run. */
    required: z.boolean().default(true),
    /** Required whenever the result is not `pass`, so a skip is never blank. */
    detail: z.string().min(1).optional(),
    durationMs: z.number().nonnegative().optional(),
    evidenceRef: z.string().min(1).optional(),
  })
  .superRefine((check, ctx) => {
    if (check.result === 'skipped' && check.detail === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['detail'],
        message: 'A skipped check must record why it was skipped, so a skip cannot read as a pass.',
      });
    }
  })
  .describe('One check observation');
export type CheckObservation = z.infer<typeof CheckObservationSchema>;

export const EvidenceValiditySchema = z.enum(['valid', 'invalid', 'inconclusive']);
export type EvidenceValidity = z.infer<typeof EvidenceValiditySchema>;

export const VerifyResultSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    stage: VerificationStageSchema,
    mode: ExecutionModeSchema,
    runnerIdentity: z.string().min(1),
    /** Digest of the oracle actually used in this run. */
    oracleDigest: Sha256Schema,
    /** Digest of the oracle frozen before the run. Must match to be valid. */
    frozenOracleDigest: Sha256Schema,
    checks: z.array(CheckObservationSchema).min(1),
    validity: EvidenceValiditySchema,
    validityReason: z.string().min(1).optional(),
    /** Identities bound to this run: source, dependency, dataset, topology. */
    boundIdentities: z.record(z.string(), Sha256Schema).default({}),
    rawLogRef: z.string().min(1).optional(),
  })
  .superRefine((result, ctx) => {
    if (result.validity !== 'valid' && result.validityReason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['validityReason'],
        message: `Validity "${result.validity}" must state a reason, so an invalid run is actionable.`,
      });
    }

    if (result.validity === 'valid' && result.oracleDigest !== result.frozenOracleDigest) {
      ctx.addIssue({
        code: 'custom',
        path: ['oracleDigest'],
        message:
          'The oracle digest drifted from the frozen digest. A changed oracle invalidates the ' +
          'proof; other full passes must not rescue it (NEG3-03).',
      });
    }

    if (result.validity === 'valid') {
      const skippedRequired = result.checks.filter((check) => check.required && check.result === 'skipped');
      if (skippedRequired.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['validity'],
          message:
            `Cannot claim valid evidence: ${skippedRequired.length} required check(s) were skipped ` +
            `(${skippedRequired.map((check) => check.checkId).join(', ')}). A skipped check is not a pass.`,
        });
      }
    }
  })
  .describe('Outcome of one verification stage');
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

/** True only when a run's evidence may be used to support a positive claim. */
export function supportsPositiveClaim(result: VerifyResult): boolean {
  if (result.validity !== 'valid') return false;
  if (result.oracleDigest !== result.frozenOracleDigest) return false;
  return !result.checks.some((check) => check.required && check.result !== 'pass');
}
