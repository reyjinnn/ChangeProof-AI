import { z } from 'zod';

import { Sha256Schema } from '../primitives.js';
import { EvidenceClassSchema } from './graph.js';

/**
 * Readiness, reuse, forecast and evaluation contracts (PRD §20).
 *
 * Each of these exists so that a *plan or a suggestion* can never be mistaken
 * for a *result*:
 *
 *  - `ReadinessAssessment` is explicitly not a product verdict.
 *  - `InvariantProposal` records who proposed what, and that a fixer can never
 *    be the approver.
 *  - `PreparationReuseRecord` carries a hit/miss with a reason, and confers no
 *    proof authority on its own.
 *  - `RunForecast` is an estimate kept separate from the actual cap and usage.
 *  - `EvaluationArmManifest` freezes an arm before any outcome is observed.
 */

export const ReadinessAssessmentSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    runDraftRevision: z.number().int().nonnegative(),
    sourceRefs: z.array(z.string().min(1)).default([]),
    ciRefs: z.array(z.string().min(1)).default([]),
    referenceDigests: z.array(Sha256Schema).default([]),
    prerequisites: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          label: z.string().min(1),
          satisfied: z.boolean(),
          evidenceRefs: z.array(z.string().min(1)).default([]),
        }),
      )
      .default([]),
    gaps: z.array(z.string().min(1)).default([]),
    /** The action that is currently withheld. Named, not implied. */
    blockedAction: z.string().min(1).optional(),
    responsibleOwner: z.string().min(1).optional(),
    safeNextAction: z.string().min(1),
    grantVersion: z.number().int().nonnegative(),
  })
  .superRefine((assessment, ctx) => {
    const unsatisfied = assessment.prerequisites.filter((p) => !p.satisfied);
    if (unsatisfied.length > 0 && assessment.blockedAction === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockedAction'],
        message:
          'Unsatisfied prerequisites exist, so the blocked action must be named. An unexplained ' +
          'gap is not a readiness assessment.',
      });
    }
  })
  .describe('Readiness facts and gaps. Not a product verdict.');
export type ReadinessAssessment = z.infer<typeof ReadinessAssessmentSchema>;

export const InvariantProposalSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    proposalId: z.string().min(1),
    provenance: z.array(z.string().min(1)).min(1),
    desiredBehavior: z.string().min(1),
    positiveExamples: z.array(z.string().min(1)).default([]),
    negativeExamples: z.array(z.string().min(1)).default([]),
    unknowns: z.array(z.string().min(1)).default([]),
    conflicts: z.array(z.string().min(1)).default([]),
    proposingActor: z.strictObject({
      kind: z.enum(['human', 'model', 'derived']),
      id: z.string().min(1),
    }),
    /** Domain approval with an explicit scope and revision. */
    domainApproval: z.strictObject({
      identity: z.string().min(1),
      scope: z.string().min(1),
      revision: z.number().int().nonnegative(),
      revokedAt: z.string().optional(),
    }),
    /** The independent oracle author. Never the party that also produces the patch. */
    oracleAuthorReceipt: z.string().min(1),
    evidenceClass: EvidenceClassSchema,
  })
  .superRefine((proposal, ctx) => {
    // A fixer must not approve its own invariant. This is the independence
    // requirement, expressed where the data is assembled.
    if (proposal.proposingActor.kind === 'human' && proposal.oracleAuthorReceipt === proposal.proposingActor.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['oracleAuthorReceipt'],
        message:
          'The proposing actor cannot also be the independent oracle author. Approval cannot be ' +
          'self-granted.',
      });
    }
  })
  .describe('A proposed invariant with its authorship and approval chain');
export type InvariantProposal = z.infer<typeof InvariantProposalSchema>;

export const PreparationReuseRecordSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    recordId: z.string().min(1),
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    artifactDigest: Sha256Schema,
    sourceDigest: Sha256Schema,
    inputDigest: Sha256Schema,
    lockDigest: Sha256Schema,
    toolchainDigest: Sha256Schema,
    imageDigest: Sha256Schema,
    configDigest: Sha256Schema,
    dataTemplateDigest: Sha256Schema,
    origin: z.enum(['trusted_build', 'template', 'unknown']),
    integrityVerified: z.boolean(),
    authorizationReceipt: z.string().min(1),
    deletionFenceChecked: z.boolean(),
    cleanupReceipt: z.string().min(1),
    outcome: z.enum(['hit', 'miss']),
    rejectionReason: z.string().min(1).optional(),
    /** A cache hit never carries proof authority on its own. */
    confersProof: z.literal(false),
  })
  .superRefine((record, ctx) => {
    if (record.outcome === 'miss' && record.rejectionReason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rejectionReason'],
        message: 'A cache miss must state why, so the next run does not repeat the same rejection.',
      });
    }
    if (record.outcome === 'hit' && (!record.integrityVerified || !record.deletionFenceChecked)) {
      ctx.addIssue({
        code: 'custom',
        path: ['integrityVerified'],
        message:
          'A cache hit requires integrity verification and a deletion-fence check. Without both, ' +
          'the hit is a rejection.',
      });
    }
  })
  .describe('A preparation-cache decision. Never proof on its own.');
export type PreparationReuseRecord = z.infer<typeof PreparationReuseRecordSchema>;

export const RunForecastSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    forecastId: z.string().min(1),
    planId: z.string().min(1),
    profileId: z.string().min(1),
    rateVersion: z.string().min(1),
    calibrationIdentity: z.string().min(1),
    assumptions: z.array(z.string().min(1)).default([]),
    componentEstimates: z
      .array(
        z.strictObject({
          component: z.string().min(1),
          estimate: z.number().nonnegative(),
          low: z.number().nonnegative().optional(),
          high: z.number().nonnegative().optional(),
          unit: z.string().min(1),
        }),
      )
      .min(1),
    coldBoundMs: z.number().int().nonnegative(),
    warmBoundMs: z.number().int().nonnegative(),
    queueBoundMs: z.number().int().nonnegative(),
    grossCostUsd: z.number().nonnegative(),
    netCostUsd: z.number().nonnegative(),
    fullProofReserveUsd: z.number().nonnegative(),
    reproductionReserveUsd: z.number().nonnegative(),
    cleanupReserveUsd: z.number().nonnegative(),
    validUntil: z.string(),
    /** An estimate is never the cap. Keeping them separate is the point. */
    isEstimate: z.literal(true),
  })
  .describe('Cost/duration estimate, kept separate from the actual cap and usage');
export type RunForecast = z.infer<typeof RunForecastSchema>;

export const EvaluationArmSchema = z
  .strictObject({
    evaluationVersion: z.string().min(1),
    datasetVersion: z.string().min(1),
    armId: z.string().min(1),
    ablationOf: z.string().min(1).optional(),
    modelIdentity: z.string().min(1),
    configDigest: Sha256Schema,
    allowedInputs: z.array(z.string().min(1)).default([]),
    allowedTools: z.array(z.string().min(1)).default([]),
    feedbackDisclosure: z.enum(['none', 'diagnostic', 'full']),
    commonBudget: z.strictObject({
      modelCostUsd: z.number().positive(),
      wallTimeMs: z.number().int().positive(),
    }),
    terminalRules: z.array(z.string().min(1)).min(1),
    evaluatorIdentity: z.string().min(1),
    oracleIdentity: z.string().min(1),
    caseOrder: z.enum(['fixed', 'randomized', 'replayed']),
    repetitionPolicy: z.strictObject({
      repeats: z.number().int().gt(0),
      selection: z.enum(['pre_registered', 'first_pass_only']),
    }),
    frozenAt: z.string(),
  })
  .describe('A pre-registered evaluation arm, frozen before any outcome is observed');
export type EvaluationArm = z.infer<typeof EvaluationArmSchema>;

export const EnvironmentProfileRevisionSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    revisionId: z.string().min(1),
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    templateVersion: z.string().min(1),
    configDigest: Sha256Schema,
    intentId: z.string().min(1),
    targetRefs: z.array(z.string().min(1)).default([]),
    resourceProfileId: z.string().min(1),
    updateVersion: z.number().int().nonnegative(),
    readinessRef: z.string().optional(),
    invariantApprovalRefs: z.array(z.string().min(1)).default([]),
  })
  .describe('A revisioned environment profile; revalidation is required before a frozen run');
export type EnvironmentProfileRevision = z.infer<typeof EnvironmentProfileRevisionSchema>;
