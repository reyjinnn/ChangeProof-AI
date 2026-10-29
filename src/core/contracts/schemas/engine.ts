import { z } from 'zod';

import {
  GitShaSchema,
  GraphEntityIdSchema,
  IdSchema,
  NonEmptyStringSchema,
  Sha256Schema,
  SubjectRefSchema,
} from '../primitives.js';
import { ChangeCategorySchema, ComponentKindSchema, EcosystemSchema } from './capability.js';
import { ExecutionModeSchema, OriginSchema, ProposalModeSchema } from '../vocabulary.js';

/**
 * Engine contracts (PRD §8).
 *
 * These describe what the product is working on: the intent, the change, the
 * inventory, the plan, the candidate and the observed result. They are data
 * only — no behaviour, no verdict authority.
 */

export const ChangeIntentSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    intentId: IdSchema,
    /** The behaviour the customer asked for. */
    desiredBehavior: z.string().min(1),
    /** Invariants that must survive the change, stated independently of the patch. */
    preservedInvariants: z.array(NonEmptyStringSchema).min(1),
    /** Surfaces the change is allowed to touch. Anything else is out of scope by construction. */
    permittedSurfaces: z.array(NonEmptyStringSchema).min(1),
    targetVersions: z.record(z.string(), z.string().min(1)).default({}),
    constraints: z.array(NonEmptyStringSchema).default([]),
    /** Who accepts the outcome. A general approval is not acceptance of every invariant. */
    ownerAcceptanceRefs: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('What the customer asked for, and what must not break');
export type ChangeIntent = z.infer<typeof ChangeIntentSchema>;

export const InterventionManifestSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    interventionId: IdSchema,
    origin: OriginSchema,
    /** The exact before/after delta. No unexplained drift. */
    sourceBefore: z.strictObject({ commit: GitShaSchema, digest: Sha256Schema }),
    sourceAfter: z.strictObject({ commit: GitShaSchema, digest: Sha256Schema }),
    dependencyBefore: z.array(Sha256Schema).default([]),
    dependencyAfter: z.array(Sha256Schema).default([]),
    dataStateBefore: Sha256Schema.optional(),
    dataStateAfter: Sha256Schema.optional(),
    eventSchemaBefore: Sha256Schema.optional(),
    eventSchemaAfter: Sha256Schema.optional(),
    configBefore: Sha256Schema.optional(),
    configAfter: Sha256Schema.optional(),
    /** Anything that differs between the two states but is not accounted for above. */
    unexplainedDifferences: z.array(NonEmptyStringSchema).default([]),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.unexplainedDifferences.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['unexplainedDifferences'],
        message:
          'The intervention carries unexplained environment differences. A comparison with an ' +
          'unexplained delta cannot attribute an outcome to the change (FR3-15).',
      });
    }
    if (manifest.sourceBefore.commit === manifest.sourceAfter.commit && manifest.sourceBefore.digest === manifest.sourceAfter.digest) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceAfter'],
        message:
          'The intervention records no source delta. Without a delta there is nothing to attribute ' +
          'a regression to (FR3-04).',
      });
    }
  })
  .describe('The exact input delta the run compared');
export type InterventionManifest = z.infer<typeof InterventionManifestSchema>;

export const ComponentSchema = z
  .strictObject({
    id: IdSchema,
    ecosystem: EcosystemSchema,
    language: z.string().min(1),
    framework: z.string().min(1),
    frameworkVersion: z.string().min(1),
    componentKind: ComponentKindSchema,
    projectPath: z.string().min(1),
    manifestDigest: Sha256Schema.optional(),
    lockfileDigest: Sha256Schema.optional(),
    buildTool: z.string().min(1).optional(),
  })
  .describe('One detected project inside a repository');
export type Component = z.infer<typeof ComponentSchema>;

export const ProjectInventorySchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    inventoryId: IdSchema,
    repository: IdSchema,
    commit: GitShaSchema,
    /** True when the working tree was not a clean commit; the snapshot is still pinned. */
    dirtySnapshot: z.boolean().default(false),
    components: z.array(ComponentSchema).min(1),
    /** Facts the extractor read, kept distinct from what it inferred. */
    detectedFacts: z.array(NonEmptyStringSchema).default([]),
    /** Conflicts and unknowns the owner must see before remediation. */
    findings: z.array(NonEmptyStringSchema).default([]),
    unsupportedSurfaces: z.array(NonEmptyStringSchema).default([]),
    ownerScope: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('What is in the repository, and what could not be read');
export type ProjectInventory = z.infer<typeof ProjectInventorySchema>;

export const ChangeKindSchema = z.enum([
  'api_contract',
  'data_schema',
  'event_schema',
  'dependency',
  'configuration',
  'behavior',
]);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

export const ChangeProvenanceSchema = z
  .strictObject({
    snapshot: IdSchema,
    locator: z.string().min(1),
    method: z.string().min(1),
    rawDigest: Sha256Schema.optional(),
  })
  .describe('Where a change was observed');
export type ChangeProvenance = z.infer<typeof ChangeProvenanceSchema>;

export const NormalizedChangeSchema = z
  .strictObject({
    id: IdSchema,
    kind: ChangeKindSchema,
    category: ChangeCategorySchema,
    beforeRef: z.string().min(1).optional(),
    afterRef: z.string().min(1).optional(),
    /** Semantic intent of the change, as read from the source. */
    semanticIntent: z.string().min(1).optional(),
    provenance: z.array(ChangeProvenanceSchema).min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    /** Whether the change could be fully understood. Unknowns stay visible. */
    understood: z.boolean().default(true),
    unknowns: z.array(NonEmptyStringSchema).default([]),
    relatedEntityIds: z.array(GraphEntityIdSchema).default([]),
    rawEvidenceRefs: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('One normalised change with its raw evidence retained');
export type NormalizedChange = z.infer<typeof NormalizedChangeSchema>;

export const ChangeSetSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    changeSetId: IdSchema,
    snapshot: IdSchema,
    changes: z.array(NormalizedChangeSchema).min(1),
    /** Hypotheses about what a change means. Never presented as proof. */
    hypotheses: z.array(NonEmptyStringSchema).default([]),
    unknowns: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('The normalised change set for one snapshot');
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export const VerificationPlanSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planId: IdSchema,
    intent: ChangeIntentSchema,
    requiredTargets: z.array(SubjectRefSchema).min(1),
    requiredEdges: z.array(IdSchema).default([]),
    requiredChecks: z.array(NonEmptyStringSchema).min(1),
    /** The protected suite. Authored and frozen by a trusted author, never the fixer. */
    protectedSuite: z
      .strictObject({
        id: IdSchema,
        digest: Sha256Schema,
        frozenAt: z.string().min(1),
        oracleDigest: Sha256Schema,
      })
      .describe('The frozen, protected assertion set'),
    combinationMatrix: z.array(NonEmptyStringSchema).default([]),
    workload: z.string().min(1).optional(),
    expectedAssertions: z.array(NonEmptyStringSchema).default([]),
    /** Digest over the frozen scope; a scope change produces a new revision. */
    scopeDigest: Sha256Schema,
    /** Which coverage-selection rule produced this scope. */
    coverageSelectionRuleId: NonEmptyStringSchema.optional(),
  })
  .describe('The frozen scope of what must be proven');
export type VerificationPlan = z.infer<typeof VerificationPlanSchema>;

export const RepairPlanSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planId: IdSchema,
    intentId: IdSchema,
    /** Steps linked to the evidence that motivated them. */
    steps: z
      .array(
        z.strictObject({
          id: IdSchema,
          target: SubjectRefSchema,
          operation: NonEmptyStringSchema,
          evidenceRefs: z.array(NonEmptyStringSchema).default([]),
          dependencies: z.array(IdSchema).default([]),
        }),
      )
      .min(1),
    requiredCapabilities: z.array(z.record(z.string(), z.string())).default([]),
    deploymentPrerequisites: z.array(NonEmptyStringSchema).default([]),
    recoveryPrerequisites: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('Evidence-linked repair steps');
export type RepairPlan = z.infer<typeof RepairPlanSchema>;

export const CandidateBundleSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    bundleId: IdSchema,
    members: z
      .array(
        z.strictObject({
          target: SubjectRefSchema,
          baseCommit: GitShaSchema,
          /** Digest of the patch bytes. A changed candidate has a changed digest. */
          patchDigest: Sha256Schema,
          lockfileDigest: Sha256Schema.optional(),
          dataRef: z.string().min(1).optional(),
          /** A member with no patch is still required, and still part of the digest. */
          hasPatch: z.boolean().default(true),
        }),
      )
      .min(1),
    graphRevision: IdSchema,
    intentRevision: IdSchema,
    planRevision: IdSchema,
    /** Digest over every member, including required members without a patch. */
    bundleDigest: Sha256Schema,
  })
  .describe('The coordinated set of candidates under evaluation');
export type CandidateBundle = z.infer<typeof CandidateBundleSchema>;

export const StageResultSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    stage: z.enum(['baseline_old', 'baseline_new', 'attempt_fast', 'post_fix_full']),
    mode: ExecutionModeSchema,
    proposalMode: ProposalModeSchema,
    bundleDigest: Sha256Schema,
    snapshot: IdSchema,
    topologyIdentity: z.string().min(1),
    runnerIdentity: z.string().min(1),
    checkObservations: z.array(z.record(z.string(), z.unknown())).default([]),
    rawLogRefs: z.array(NonEmptyStringSchema).default([]),
    startedAt: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    validity: z.enum(['valid', 'invalid', 'inconclusive']),
    resourceUsage: z.record(z.string(), z.number()).default({}),
  })
  .describe('What one verification stage observed');
export type StageResult = z.infer<typeof StageResultSchema>;

export const HypothesisStatusSchema = z.enum(['proposed', 'supported', 'refuted', 'retired']);
export type HypothesisStatus = z.infer<typeof HypothesisStatusSchema>;

export const HypothesisRecordSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    hypothesisId: IdSchema,
    symptom: z.string().min(1),
    status: HypothesisStatusSchema,
    mechanism: z.string().min(1).optional(),
    supportingRefs: z.array(NonEmptyStringSchema).default([]),
    contradictingRefs: z.array(NonEmptyStringSchema).default([]),
    competingCauses: z.array(NonEmptyStringSchema).default([]),
    predictedProbeOutcome: z.string().min(1).optional(),
    /** Signature of the failure, used to tell a new failure from a repeat. */
    failureSignature: z.string().min(1).optional(),
    stopReason: z.string().min(1).optional(),
  })
  .describe('A causal hypothesis. Never self-attested proof.');
export type HypothesisRecord = z.infer<typeof HypothesisRecordSchema>;

export const CharacterizationRecordSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    recordId: IdSchema,
    observedBehavior: z.string().min(1),
    /** The owner's or domain's interpretation. Absent means the behaviour is unknown. */
    ownerInterpretation: z.string().min(1).optional(),
    unknowns: z.array(NonEmptyStringSchema).default([]),
    corpusProvenance: z.array(NonEmptyStringSchema).default([]),
    positiveExamples: z.array(NonEmptyStringSchema).default([]),
    negativeExamples: z.array(NonEmptyStringSchema).default([]),
    /** Invariants approved independently of the observed behaviour. */
    approvedInvariantRefs: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('Characterisation of legacy behaviour. Observation is not desired behaviour.');
export type CharacterizationRecord = z.infer<typeof CharacterizationRecordSchema>;

export const IncidentEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    incidentId: IdSchema,
    sourceIdentity: z.string().min(1),
    deployIdentity: z.string().min(1),
    configIdentity: z.string().min(1),
    /** Tenant-safe identifiers only. */
    operationIds: z.array(NonEmptyStringSchema).default([]),
    traceIds: z.array(NonEmptyStringSchema).default([]),
    spanIds: z.array(NonEmptyStringSchema).default([]),
    eventTimestamps: z.array(z.string().min(1)).default([]),
    observedTimestamps: z.array(z.string().min(1)).default([]),
    /** Uncertainty in the clock, so a near-miss is not read as a cause. */
    clockUncertaintyMs: z.number().nonnegative().optional(),
    sampling: z.enum(['none', 'partial', 'unknown']).default('unknown'),
    droppedObservations: z.number().int().nonnegative().default(0),
    redactions: z.array(NonEmptyStringSchema).default([]),
    readScopeReceipts: z.array(NonEmptyStringSchema).default([]),
    rawRefs: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('Telemetry facts with their quality gaps. Facts, not causes.');
export type IncidentEvidence = z.infer<typeof IncidentEvidenceSchema>;

export const OutcomeValidationSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    validationId: IdSchema,
    issueOrigin: OriginSchema,
    owner: z.string().min(1),
    environment: z.string().min(1),
    workload: z.string().min(1),
    beforeRefs: z.array(NonEmptyStringSchema).min(1),
    afterRefs: z.array(NonEmptyStringSchema).min(1),
    /** Whether the owner actually adopted the fix. Distinct from the technical verdict. */
    adopted: z.boolean(),
    humanEditAttribution: z.string().min(1).optional(),
    activeTimeMs: z.number().int().nonnegative().optional(),
    reviewCount: z.number().int().nonnegative().optional(),
    cohortRefs: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('Whether the workflow was actually restored, according to the owner');
export type OutcomeValidation = z.infer<typeof OutcomeValidationSchema>;
