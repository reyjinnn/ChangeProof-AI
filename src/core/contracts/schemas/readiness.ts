import { z } from 'zod';

import { NonEmptyStringSchema, Sha256Schema } from '../primitives.js';
import { EvidenceClassSchema } from './graph.js';
import { OriginSchema } from '../vocabulary.js';

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

export const EvalPackSchema = z.enum([
  'functionality',
  'statistical',
  'refusal',
  'security',
  'regression',
  'ablation',
]);
export type EvalPack = z.infer<typeof EvalPackSchema>;

export const EvalDatasetSchema = z.enum(['dev', 'holdout']);
export type EvalDataset = z.infer<typeof EvalDatasetSchema>;

export const EvalCaseSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    caseId: NonEmptyStringSchema,
    dataset: EvalDatasetSchema,
    pack: EvalPackSchema,
    suite: NonEmptyStringSchema,
    origin: OriginSchema,
    intermittent: z.boolean(),
    campaign: z
      .strictObject({ n: z.number().int().gt(0), schedule: NonEmptyStringSchema })
      .optional(),
    predictors: z.array(NonEmptyStringSchema).default([]),
    /** Digest of the case input bytes; content lives in the case store, never here. */
    inputDigest: Sha256Schema,
    /** Oracle identity only — oracle content never enters a case record. */
    oracleRef: NonEmptyStringSchema,
    referenceDigest: Sha256Schema.optional(),
    fixability: z.enum(['fixable', 'unfixable', 'unknown']),
  })
  .superRefine((c, ctx) => {
    if (c.intermittent && c.campaign === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['campaign'],
        message: 'Intermittent cases need a pre-registered campaign (n, schedule); one green result is not proof.',
      });
    }
  })
  .describe('One frozen evaluation case; content-addressed, oracle by reference');
export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** What a proposer may see: dev cases without oracle or reference bindings. */
export const ProposerCaseSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    caseId: NonEmptyStringSchema,
    pack: EvalPackSchema,
    suite: NonEmptyStringSchema,
    intermittent: z.boolean(),
    inputDigest: Sha256Schema,
  })
  .describe('Proposer-visible case projection; holdout never projects');
export type ProposerCase = z.infer<typeof ProposerCaseSchema>;

export const EvalAbortPolicySchema = z
  .strictObject({
    maxConsecutiveInfraFailures: z.number().int().gt(0),
    maxCostOverrunRatio: z.number().gt(0),
  })
  .describe('Frozen stop rules; an aborted arm compares as aborted, never as data');
export type EvalAbortPolicy = z.infer<typeof EvalAbortPolicySchema>;

export const ReleaseCriterionSchema = z
  .strictObject({
    id: NonEmptyStringSchema,
    kind: z.enum(['min_resolved_rate', 'max_regressions', 'suite_present']),
    suite: NonEmptyStringSchema.optional(),
    value: z.number().nonnegative(),
  })
  .describe('One release gate; owner-supplied thresholds, evaluated without averaging dimensions');
export type ReleaseCriterion = z.infer<typeof ReleaseCriterionSchema>;

export const EvalManifestSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    manifestId: NonEmptyStringSchema,
    createdAt: z.iso.datetime({ offset: true }),
    datasetDigest: Sha256Schema,
    cases: z.array(EvalCaseSchema).min(1),
    arms: z.array(EvaluationArmSchema).min(1),
    abortPolicy: EvalAbortPolicySchema,
    releaseCriteria: z.array(ReleaseCriterionSchema),
    /** Digest over the canonical manifest bytes excluding this field. */
    digest: Sha256Schema,
  })
  .describe('Frozen evaluation package: cases, arms, stop rules, and release gates');
export type EvalManifest = z.infer<typeof EvalManifestSchema>;

export const CaseOutcomeSchema = z.enum(['resolved', 'unresolved', 'failed', 'incomplete', 'refused']);
export type CaseOutcome = z.infer<typeof CaseOutcomeSchema>;

export const EvalCaseResultSchema = z
  .strictObject({
    caseId: NonEmptyStringSchema,
    outcome: CaseOutcomeSchema,
    costUnits: z.number().nonnegative(),
    excludedCost: z
      .strictObject({ units: z.number().nonnegative(), reason: NonEmptyStringSchema })
      .optional(),
    regressed: z.boolean(),
    trialsCompleted: z.number().int().nonnegative(),
    trialsRequired: z.number().int().gt(0),
  })
  .describe('One case outcome with attributed cost; exclusions stay visible with reasons');
export type EvalCaseResult = z.infer<typeof EvalCaseResultSchema>;

export const EvalArmResultSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    manifestDigest: Sha256Schema,
    armId: NonEmptyStringSchema,
    caseResults: z.array(EvalCaseResultSchema),
    aborted: z.boolean(),
    abortReason: NonEmptyStringSchema.optional(),
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }),
  })
  .describe('One arm execution record; aborted arms are explicit, never silent');
export type EvalArmResult = z.infer<typeof EvalArmResultSchema>;

export const EvalArmSummarySchema = z
  .strictObject({
    armId: NonEmptyStringSchema,
    resolved: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    incomplete: z.number().int().nonnegative(),
    refused: z.number().int().nonnegative(),
    regressions: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    /** Null when the denominator is zero — a rate over nothing is not zero, it is absent. */
    resolvedRate: z.number().min(0).max(1).nullable(),
    grossCost: z.number().nonnegative(),
    netCost: z.number().nonnegative(),
    excluded: z.array(
      z.strictObject({
        caseId: NonEmptyStringSchema,
        units: z.number().nonnegative(),
        reason: NonEmptyStringSchema,
      }),
    ),
  })
  .describe('Per-arm counts with denominators; omitted failures stay impossible');
export type EvalArmSummary = z.infer<typeof EvalArmSummarySchema>;

export const EvalComparisonSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    manifestDigest: Sha256Schema,
    comparable: z.boolean(),
    incomparabilityReasons: z.array(NonEmptyStringSchema),
    arms: z.array(EvalArmSummarySchema),
  })
  .describe('Compared arms with explicit comparability; aggregates only, never case content');
export type EvalComparison = z.infer<typeof EvalComparisonSchema>;

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
