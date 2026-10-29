import { z } from 'zod';

import { SemanticViolationError } from '../../errors/index.js';
import { CountsSchema, IdSchema, NonEmptyStringSchema, ProofScopeSchema, Sha256Schema, SubjectRefSchema } from '../primitives.js';
import { DimensionSchema, DimensionResultSchema, TargetOutcomeSchema } from '../vocabulary.js';
import { PolicyVersionSchema } from '../primitives.js';

/**
 * Outcome contracts: how a verdict is stated, and what it is allowed to claim.
 *
 * The central rule (AGENTS.md §3 rule 1) is that these are produced by
 * deterministic policy over verifier evidence. A model may populate free-text
 * fields, but no field here lets model output decide the outcome.
 */

export const TargetAssessmentSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    subject: SubjectRefSchema,
    outcome: TargetOutcomeSchema,
    proofScope: ProofScopeSchema,
    /** Policy version this verdict was produced under. A verdict is not portable across versions. */
    policyVersion: PolicyVersionSchema,
    reasons: z.array(NonEmptyStringSchema).default([]),
    /** Evidence the verdict rests on. A positive outcome without evidence is a bug, not a verdict. */
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
    coverage: z
      .strictObject({
        requiredTargets: z.number().int().nonnegative(),
        provenTargets: z.number().int().nonnegative(),
        unresolvedEdges: z.number().int().nonnegative(),
      })
      .optional(),
    risk: z.array(NonEmptyStringSchema).default([]),
    assessedAt: z.string().min(1).optional(),
  })
  .superRefine((assessment, ctx) => {
    if (
      (assessment.outcome === 'fixed' || assessment.outcome === 'no_impact_verified') &&
      assessment.evidenceRefs.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceRefs'],
        message: `Outcome "${assessment.outcome}" requires evidence references. A positive claim with no evidence is not a verdict.`,
      });
    }
  })
  .describe('One subject verdict plus the scope it covers');
export type TargetAssessment = z.infer<typeof TargetAssessmentSchema>;

export const BundleAssessmentSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    state: z.enum(['verified', 'incomplete', 'blocked', 'invalid']),
    /** Binds every member of the bundle, including required targets with no patch. */
    candidateBundleDigest: Sha256Schema,
    requiredTargets: z.array(SubjectRefSchema).min(1),
    /** Required edges and invariants that had to hold, not just the targets. */
    requiredEdges: z.array(IdSchema).default([]),
    requiredInvariants: z.array(IdSchema).default([]),
    intentFulfilled: z.boolean().optional(),
    mixedVersionChecksPassed: z.boolean().optional(),
    identitiesFresh: z.boolean().optional(),
    blockingReasons: z.array(NonEmptyStringSchema).default([]),
    reasons: z.array(NonEmptyStringSchema).default([]),
    policyVersion: PolicyVersionSchema,
  })
  .superRefine((bundle, ctx) => {
    if (bundle.requiredTargets.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredTargets'],
        message: 'A bundle with no required target has an empty denominator and cannot be assessed (FR3-06).',
      });
    }

    if (bundle.state === 'verified') {
      if (bundle.intentFulfilled !== true) {
        ctx.addIssue({
          code: 'custom',
          path: ['intentFulfilled'],
          message: 'A `verified` bundle requires the intent to be fulfilled (FR3-16).',
        });
      }
      if (bundle.mixedVersionChecksPassed !== true) {
        ctx.addIssue({
          code: 'custom',
          path: ['mixedVersionChecksPassed'],
          message: 'A `verified` bundle requires all required mixed-version checks to pass (FR3-17).',
        });
      }
      if (bundle.identitiesFresh !== true) {
        ctx.addIssue({
          code: 'custom',
          path: ['identitiesFresh'],
          message: 'A `verified` bundle requires fresh identities; reused proof cannot verify a changed candidate.',
        });
      }
      if (bundle.blockingReasons.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['blockingReasons'],
          message: 'A `verified` bundle cannot also carry blocking reasons.',
        });
      }
    }

    if (bundle.state === 'blocked' && bundle.blockingReasons.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockingReasons'],
        message: 'A `blocked` bundle must name the known barrier.',
      });
    }
  })
  .describe('Bundle-level assessment; not a consumer outcome');
export type BundleAssessment = z.infer<typeof BundleAssessmentSchema>;

/** Bundle evaluation order (FR3-16). Earlier states take precedence over later ones. */
export const BUNDLE_EVALUATION_ORDER = ['invalid', 'blocked', 'incomplete', 'verified'] as const;

export const MeasurementValiditySchema = z.enum(['valid', 'invalid', 'inconclusive']);
export type MeasurementValidity = z.infer<typeof MeasurementValiditySchema>;

export const DimensionAssessmentSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    dimension: DimensionSchema,
    required: z.boolean(),
    metricIds: z.array(IdSchema).min(1),
    result: DimensionResultSchema,
    /** Raw observations behind the reducer. Evidence is referenced, never summarised away. */
    rawRefs: z.array(NonEmptyStringSchema),
    /** Digest of the deterministic reducer algorithm + config that produced this result. */
    reducerDigest: Sha256Schema.optional(),
    measurementValidity: MeasurementValiditySchema.optional(),
    /** Required when the dimension is declared not applicable. */
    notApplicableJustification: NonEmptyStringSchema.optional(),
    uncertainty: NonEmptyStringSchema.optional(),
    claimLimits: NonEmptyStringSchema.optional(),
    /** Which algorithm/config produced the numbers; averaging is never implicit. */
    algorithm: NonEmptyStringSchema.optional(),
  })
  .superRefine((dimension, ctx) => {
    if (dimension.result === 'not_applicable') {
      if (dimension.notApplicableJustification === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['notApplicableJustification'],
          message:
            '`not_applicable` must be approved and justified before the run, never chosen after a ' +
            'failure to make the run look clean (FR3-27).',
        });
      }
    } else if (dimension.rawRefs.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['rawRefs'],
        message: 'A dimension result other than `not_applicable` must reference its raw observations.',
      });
    }

    if (dimension.result === 'pass' && dimension.measurementValidity === 'invalid') {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message:
          'An observation set whose measurement validity failed cannot be recorded as a pass. ' +
          'Dropped traffic or removed timeouts must not read as an improvement (NEG3-18).',
      });
    }
  })
  .describe('One of the four independently assessed dimensions');
export type DimensionAssessment = z.infer<typeof DimensionAssessmentSchema>;

/** Assemble all four dimensions, refusing an incomplete or contradictory set. */
export function assertDimensionSetComplete(assessments: readonly DimensionAssessment[]): void {
  const seen = new Set<string>();
  for (const assessment of assessments) {
    if (seen.has(assessment.dimension)) {
      throw new SemanticViolationError(
        'dimension.duplicate',
        `Dimension "${assessment.dimension}" was assessed more than once.`,
        { dimension: assessment.dimension },
      );
    }
    seen.add(assessment.dimension);
  }
}

export const CountsReconciliationSchema = CountsSchema;
