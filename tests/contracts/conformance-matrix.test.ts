import { describe, expect, it } from 'vitest';

import {
  ArtifactAccessGrantSchema,
  BundleAssessmentSchema,
  BundleStateSchema,
  CandidateBundleSchema,
  CanonicalObjectHash,
  ChangeIntentSchema,
  CheckResultValueSchema,
  DataLifecycleRecordSchema,
  DimensionAssessmentSchema,
  DimensionResultSchema,
  DimensionSchema,
  ECOSYSTEMS,
  EdgeKindSchema,
  EdgeResolutionSchema,
  EnvironmentProfileRevisionSchema,
  EvaluationArmSchema,
  EvidenceClassSchema,
  EvidenceValiditySchema,
  ExecutionBudgetSchema,
  ExecutionModeSchema,
  ExperimentPlanSchema,
  HostedRunRequestSchema,
  HostedServiceProfileSchema,
  HypothesisRecordSchema,
  ImpactSchema,
  IncidentEvidenceSchema,
  InterventionManifestSchema,
  InvariantProposalSchema,
  JobLeaseSchema,
  MeasurementValiditySchema,
  NodeKindSchema,
  OriginSchema,
  OutcomeValidationSchema,
  PreparationReuseRecordSchema,
  ProjectInventorySchema,
  ProposalModeSchema,
  ProvenLevelSchema,
  RawByteHash,
  ReadinessAssessmentSchema,
  RepairPlanSchema,
  RepositoryConnectionSchema,
  RunForecastSchema,
  RunStateSchema,
  SupportLevelSchema,
  SystemGraphSchema,
  TargetAssessmentSchema,
  TargetOutcomeSchema,
  TaskStatusSchema,
  TenantContextSchema,
  TrialReceiptSchema,
  UsageLedgerEntrySchema,
  VerificationPlanSchema,
  VerificationStageSchema,
  VerifyResultSchema,
  identitiesMatch,
} from '../../src/core/index.js';

/**
 * T-04 / T1-1 — contract conformance matrix.
 *
 * Each row maps to a test below; no row is closed on inspection alone.
 * Existing coverage lives in version-and-identity, semantic-validation,
 * outcome-and-budget, vocabulary-and-capability. This file closes the gaps:
 * every versioned schema family gets a positive case plus the negative rows
 * the task names (dangling refs, closed enums, unknown schemaVersion,
 * raw-byte vs canonical identity).
 */

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const GIT_A = 'a'.repeat(40);
const GIT_B = 'b'.repeat(40);
const ISO = '2026-10-30T00:00:00.000Z';

function changeIntent() {
  return {
    schemaVersion: '1' as const,
    intentId: 'intent-1',
    desiredBehavior: 'restore checkout total',
    preservedInvariants: ['order-total-invariant'],
    permittedSurfaces: ['orders-api'],
  };
}

describe('closed enums reject synonyms', () => {
  it('rejects values outside every fixed vocabulary', () => {
    expect(() => OriginSchema.parse('organic')).toThrow();
    expect(() => ExecutionModeSchema.parse('live')).toThrow();
    expect(() => ProposalModeSchema.parse('ai')).toThrow();
    expect(() => TargetOutcomeSchema.parse('verified')).toThrow();
    expect(() => BundleStateSchema.parse('done')).toThrow();
    expect(() => RunStateSchema.parse('finished')).toThrow();
    expect(() => EdgeResolutionSchema.parse('proved')).toThrow();
    expect(() => DimensionSchema.parse('security')).toThrow();
    expect(() => DimensionResultSchema.parse('passed')).toThrow();
    expect(() => SupportLevelSchema.parse('L0')).toThrow();
    expect(() => ProvenLevelSchema.parse('L4')).toThrow();
    expect(() => TaskStatusSchema.parse('complete')).toThrow();
    expect(() => NodeKindSchema.parse('service')).toThrow();
    expect(() => EdgeKindSchema.parse('invokes')).toThrow();
    expect(() => EvidenceClassSchema.parse('proved')).toThrow();
    expect(() => VerificationStageSchema.parse('final')).toThrow();
    expect(() => CheckResultValueSchema.parse('ok')).toThrow();
    expect(() => EvidenceValiditySchema.parse('good')).toThrow();
    expect(() => MeasurementValiditySchema.parse('ok')).toThrow();
  });

  it('declares exactly five ecosystems after the owner-directed JVM removal', () => {
    expect([...ECOSYSTEMS].sort()).toEqual(['dotnet', 'go', 'php', 'python', 'typescript']);
    expect(ECOSYSTEMS).not.toContain('jvm' as never);
  });
});

describe('unknown schemaVersion is rejected per family', () => {
  it('rejects a wrong literal version on representative schemas', () => {
    expect(() => ChangeIntentSchema.parse({ ...changeIntent(), schemaVersion: '99' })).toThrow();
    expect(() => ProjectInventorySchema.parse({ ...inventory(), schemaVersion: '2' })).toThrow();
    expect(() => SystemGraphSchema.parse({ ...graph(), schemaVersion: '2' })).toThrow();
    expect(() => TargetAssessmentSchema.parse({ ...target(), schemaVersion: '2' })).toThrow();
    expect(() => BundleAssessmentSchema.parse({ ...bundle(), schemaVersion: '2' })).toThrow();
    expect(() => DimensionAssessmentSchema.parse({ ...dimension(), schemaVersion: '2' })).toThrow();
    expect(() => ExecutionBudgetSchema.parse({ ...budget(), schemaVersion: '2' })).toThrow();
    expect(() => ExperimentPlanSchema.parse({ ...plan(), schemaVersion: '2' })).toThrow();
    expect(() => TrialReceiptSchema.parse({ ...receipt(), schemaVersion: '2' })).toThrow();
    expect(() => VerifyResultSchema.parse({ ...verify(), schemaVersion: '2' })).toThrow();
    expect(() => TenantContextSchema.parse({ ...tenant(), schemaVersion: '2' })).toThrow();
    expect(() => ReadinessAssessmentSchema.parse({ ...readiness(), schemaVersion: '2' })).toThrow();
    expect(() => ImpactSchema.parse({ ...impact(), schemaVersion: '1' })).toThrow();
  });
});

function inventory() {
  return {
    schemaVersion: '1' as const,
    inventoryId: 'inv-1',
    repository: 'repo-1',
    commit: GIT_A,
    components: [
      {
        id: 'comp-1',
        ecosystem: 'typescript' as const,
        language: 'typescript',
        framework: 'next',
        frameworkVersion: '15.0.0',
        componentKind: 'frontend' as const,
        projectPath: 'apps/store',
      },
    ],
  };
}

function graph() {
  return {
    schemaVersion: '1' as const,
    snapshot: 'snap-1',
    nodes: [{ id: 'a', kind: 'symbol' as const, locator: 'src/a.ts', snapshot: 'snap-1' }],
    edges: [],
  };
}

function target() {
  return {
    schemaVersion: '1' as const,
    subject: { kind: 'consumer' as const, id: 'consumer-a' },
    outcome: 'unverified' as const,
    proofScope: {
      targets: [{ kind: 'consumer' as const, id: 'consumer-a' }],
      edges: [],
      invariants: ['order-total-invariant'],
    },
    policyVersion: '1',
  };
}

function bundle() {
  return {
    schemaVersion: '1' as const,
    state: 'incomplete' as const,
    candidateBundleDigest: SHA_A,
    requiredTargets: [{ kind: 'consumer' as const, id: 'consumer-a' }],
    policyVersion: '1',
  };
}

function dimension() {
  return {
    schemaVersion: '1' as const,
    dimension: 'correctness' as const,
    required: true,
    metricIds: ['business-invariant-1'],
    result: 'inconclusive' as const,
    rawRefs: ['runs/run-1/observations.json'],
  };
}

function budget() {
  return {
    schemaVersion: '1' as const,
    profileId: 'profile-default',
    profileConfigDigest: SHA_A,
    limits: { modelCostUsd: 10, modelRequests: 100, wallTimeMs: 600000, cpuMs: 1000000, maxPids: 128, diskBytes: 1000000000 },
    reserve: { modelCostUsd: 2, wallTimeMs: 60000 },
    usage: { modelCostUsd: 1, modelRequests: 5, wallTimeMs: 1000, cpuMs: 5000, peakPids: 12, diskBytes: 1000 },
  };
}

function plan() {
  return {
    schemaVersion: '1' as const,
    planVersion: 1,
    planHash: SHA_A,
    subjects: [{ kind: 'consumer' as const, id: 'consumer-a' }],
    workload: { arrivalDistribution: 'steady' as const, concurrency: 4, dataSkew: 'none' as const },
    resetSemantics: 'fresh-database-per-trial' as const,
    seeds: [1],
    intendedSchedules: [{ id: 'schedule-1', faultStartMs: 1000, faultDurationMs: 500, faultTarget: 'orders-api:handler' }],
    observations: ['latency'],
    trialUnit: 'trial' as const,
    n: 10,
    warmupTrials: 2,
    measurementWindow: { kind: 'fixed' as const, durationMs: 5000 },
    thresholds: [{ metricId: 'latency', statistic: 'p95' as const, comparison: 'lte' as const, value: 200, unit: 'ms' }],
    stopRules: [{ kind: 'censor' as const, afterTrials: 20 }],
    forecast: { estimatedCostUsd: 5, estimatedWallTimeMs: 600000 },
  };
}

function receipt() {
  return {
    schemaVersion: '1' as const,
    planHash: SHA_A,
    candidateBundleDigest: SHA_B,
    environmentIdentity: 'image@sha256:' + 'f'.repeat(64),
    actualSeed: 1,
    actualSchedule: { id: 'schedule-1', appliedAtMs: 1000, removedAtMs: 1500 },
    faultApplied: true,
    faultRemoved: true,
    counts: { planned: 10, completed: 10, failed: 0, invalid: 0, censored: 0, notRun: 0 },
    result: 'pass' as const,
    telemetryRefs: ['runs/run-1/telemetry.json'],
  };
}

function verify() {
  return {
    schemaVersion: '1' as const,
    stage: 'post_fix_full' as const,
    mode: 'real_runtime' as const,
    runnerIdentity: 'runner@sha256:' + 'a'.repeat(64),
    oracleDigest: SHA_B,
    frozenOracleDigest: SHA_B,
    checks: [{ checkId: 'check-1', result: 'pass' as const }],
    validity: 'valid' as const,
  };
}

function tenant() {
  return {
    schemaVersion: '1' as const,
    tenantId: 'tenant-1',
    userId: 'user-1',
    sessionId: 'session-1',
    role: 'owner' as const,
    projectGrants: [],
    repositoryGrants: [],
    grantVersion: 0,
    expiresAt: ISO,
    authoritySource: 'server' as const,
  };
}

function readiness() {
  return {
    schemaVersion: '1' as const,
    tenantId: 'tenant-1',
    projectId: 'project-1',
    runDraftRevision: 0,
    safeNextAction: 'provide missing toolchain',
    grantVersion: 0,
  };
}

function impact() {
  return {
    id: 'impact-1',
    changeId: 'change-1',
    subjectId: 'consumer-a',
    subjectKind: 'consumer',
    resolution: 'inferred' as const,
    severity: 'medium' as const,
  };
}

describe('engine contracts carry semantic checks', () => {
  it('accepts a minimal ChangeIntent and rejects empty behavior or invariants', () => {
    expect(ChangeIntentSchema.parse(changeIntent()).intentId).toBe('intent-1');
    expect(() => ChangeIntentSchema.parse({ ...changeIntent(), desiredBehavior: '' })).toThrow();
    expect(() => ChangeIntentSchema.parse({ ...changeIntent(), preservedInvariants: [] })).toThrow();
    expect(() => ChangeIntentSchema.parse({ ...changeIntent(), permittedSurfaces: [] })).toThrow();
  });

  it('rejects an intervention with unexplained differences or no source delta', () => {
    const base = {
      schemaVersion: '1' as const,
      interventionId: 'iv-1',
      origin: 'controlled_change' as const,
      sourceBefore: { commit: GIT_A, digest: SHA_A },
      sourceAfter: { commit: GIT_B, digest: SHA_B },
    };
    expect(InterventionManifestSchema.parse(base).interventionId).toBe('iv-1');
    expect(() =>
      InterventionManifestSchema.parse({ ...base, unexplainedDifferences: ['clock skew'] }),
    ).toThrow();
    expect(() =>
      InterventionManifestSchema.parse({
        ...base,
        sourceAfter: { commit: GIT_A, digest: SHA_A },
      }),
    ).toThrow();
  });

  it('accepts an inventory and rejects an empty component list', () => {
    expect(ProjectInventorySchema.parse(inventory()).components).toHaveLength(1);
    expect(() => ProjectInventorySchema.parse({ ...inventory(), components: [] })).toThrow();
  });

  it('accepts plans and bundles and rejects empty required sets', () => {
    const verification = {
      schemaVersion: '1' as const,
      planId: 'plan-1',
      intent: changeIntent(),
      requiredTargets: [{ kind: 'consumer' as const, id: 'consumer-a' }],
      requiredChecks: ['check-1'],
      protectedSuite: { id: 'suite-1', digest: SHA_A, frozenAt: ISO, oracleDigest: SHA_B },
      scopeDigest: SHA_A,
    };
    expect(VerificationPlanSchema.parse(verification).planId).toBe('plan-1');
    expect(() => VerificationPlanSchema.parse({ ...verification, requiredTargets: [] })).toThrow();
    expect(() => VerificationPlanSchema.parse({ ...verification, requiredChecks: [] })).toThrow();

    const repair = {
      schemaVersion: '1' as const,
      planId: 'repair-1',
      intentId: 'intent-1',
      steps: [{ id: 'step-1', target: { kind: 'consumer' as const, id: 'consumer-a' }, operation: 'patch file' }],
    };
    expect(RepairPlanSchema.parse(repair).planId).toBe('repair-1');
    expect(() => RepairPlanSchema.parse({ ...repair, steps: [] })).toThrow();

    const candidate = {
      schemaVersion: '1' as const,
      bundleId: 'bundle-1',
      members: [{ target: { kind: 'consumer' as const, id: 'consumer-a' }, baseCommit: GIT_A, patchDigest: SHA_A }],
      graphRevision: 'graph-1',
      intentRevision: 'intent-1',
      planRevision: 'plan-1',
      bundleDigest: SHA_A,
    };
    expect(CandidateBundleSchema.parse(candidate).bundleId).toBe('bundle-1');
    expect(() => CandidateBundleSchema.parse({ ...candidate, members: [] })).toThrow();
  });

  it('accepts hypothesis, incident and validation records and rejects empty subjects', () => {
    expect(
      HypothesisRecordSchema.parse({ schemaVersion: '1', hypothesisId: 'h-1', symptom: 'total mismatch', status: 'proposed' }).status,
    ).toBe('proposed');
    expect(() =>
      HypothesisRecordSchema.parse({ schemaVersion: '1', hypothesisId: 'h-1', symptom: '', status: 'proposed' }),
    ).toThrow();
    expect(
      IncidentEvidenceSchema.parse({ schemaVersion: '1', incidentId: 'i-1', sourceIdentity: 'src', deployIdentity: 'dep', configIdentity: 'cfg' }).incidentId,
    ).toBe('i-1');
    expect(() =>
      OutcomeValidationSchema.parse({
        schemaVersion: '1',
        validationId: 'v-1',
        issueOrigin: 'controlled_change',
        owner: 'owner-1',
        environment: 'staging',
        workload: 'steady',
        beforeRefs: [],
        afterRefs: ['run-2'],
        adopted: true,
      }),
    ).toThrow();
  });
});

describe('hosted contracts check authority, not just shape', () => {
  it('requires a server-derived tenant context and rejects browser authority', () => {
    expect(TenantContextSchema.parse(tenant()).authoritySource).toBe('server');
    expect(() => TenantContextSchema.parse({ ...tenant(), authoritySource: 'browser' })).toThrow();
    expect(() => TenantContextSchema.parse({ ...tenant(), role: 'superuser' })).toThrow();
  });

  it('accepts repository, run-request, lease, usage, grant, lifecycle and profile records', () => {
    expect(
      RepositoryConnectionSchema.parse({
        schemaVersion: '1',
        connectionId: 'conn-1',
        tenantId: 'tenant-1',
        installationId: 'inst-1',
        provider: 'github',
        repositoryAllowlist: ['repo-1'],
        permissionMatrix: {},
        status: 'active',
        revocationVersion: 0,
        credentialRef: 'cred-1',
      }).provider,
    ).toBe('github');

    const request = {
      schemaVersion: '1' as const,
      requestId: 'req-1',
      tenantId: 'tenant-1',
      actorId: 'user-1',
      projectId: 'project-1',
      repositoryIds: ['repo-1'],
      sourceRefs: ['main'],
      intentRef: 'intent-1',
      executionMode: 'real_runtime' as const,
      invariantRefs: ['inv-1'],
      verificationPlanRef: 'plan-1',
      budgetProfileId: 'profile-1',
      reservationId: 'res-1',
      publicationConsent: false,
      idempotencyKey: SHA_A,
      expectedGrantVersion: 0,
    };
    expect(HostedRunRequestSchema.parse(request).requestId).toBe('req-1');
    expect(() => HostedRunRequestSchema.parse({ ...request, repositoryIds: [] })).toThrow();

    const lease = {
      schemaVersion: '1' as const,
      tenantId: 'tenant-1',
      runId: 'run-1',
      jobId: 'job-1',
      imageDigest: SHA_A,
      candidateDigest: SHA_A,
      planDigest: SHA_A,
      epoch: 1,
      ownerId: 'worker-1',
      heartbeatAt: ISO,
      expiresAt: ISO,
      state: 'active' as const,
      retryCount: 0,
      cancelRequested: false,
      version: 0,
      grantVersion: 0,
    };
    expect(JobLeaseSchema.parse(lease).epoch).toBe(1);
    expect(() => JobLeaseSchema.parse({ ...lease, epoch: 0 })).toThrow();

    expect(
      UsageLedgerEntrySchema.parse({
        schemaVersion: '1',
        tenantId: 'tenant-1',
        runId: 'run-1',
        reservationId: 'res-1',
        effectId: SHA_A,
        provider: 'model',
        measuredUnits: 1,
        unitName: 'token',
        rateVersion: 'rate-1',
        periodId: 'period-1',
        event: 'reserve',
        consumedAmount: 0,
        reservedAmount: 1,
        occurredAt: ISO,
      }).event,
    ).toBe('reserve');

    expect(
      ArtifactAccessGrantSchema.parse({
        schemaVersion: '1',
        tenantId: 'tenant-1',
        repositoryGrantIds: ['repo-1'],
        subjectId: 'user-1',
        artifactDigest: SHA_A,
        purpose: 'review',
        expiresAt: ISO,
        revocationVersion: 0,
      }).purpose,
    ).toBe('review');

    expect(
      DataLifecycleRecordSchema.parse({
        schemaVersion: '1',
        tenantId: 'tenant-1',
        artifactId: 'art-1',
        retentionVersion: 'ret-1',
        categories: ['evidence'],
        locations: ['store-1'],
        purgeProgress: 'not_started',
      }).purgeProgress,
    ).toBe('not_started');

    expect(
      HostedServiceProfileSchema.parse({
        schemaVersion: '1',
        profileId: 'profile-1',
        environment: 'prod',
        maxTenants: 10,
        maxConcurrentRuns: 5,
        maxQueueDepth: 20,
        maxRunsPerTenant: 3,
        queueWaitMs: 1000,
        fairnessWindowMs: 60000,
        costOvershootUsd: 0,
        sloAvailability: 0.99,
        rpoMs: 0,
        rtoMs: 1000,
        retentionDays: 30,
        deletionSloMs: 1000,
        campaignMethod: 'method-1',
      }).maxTenants,
    ).toBe(10);
  });
});

describe('readiness contracts keep plans separate from proof', () => {
  it('names the blocked action when prerequisites are unsatisfied', () => {
    expect(ReadinessAssessmentSchema.parse(readiness()).safeNextAction).toContain('toolchain');
    expect(() =>
      ReadinessAssessmentSchema.parse({
        ...readiness(),
        prerequisites: [{ id: 'p-1', label: 'toolchain', satisfied: false }],
      }),
    ).toThrow();
  });

  it('forbids a fixer from approving its own invariant', () => {
    const proposal = {
      schemaVersion: '1' as const,
      proposalId: 'prop-1',
      provenance: ['telemetry'],
      desiredBehavior: 'total stays correct',
      proposingActor: { kind: 'human' as const, id: 'reyn' },
      domainApproval: { identity: 'owner-1', scope: 'checkout', revision: 1 },
      oracleAuthorReceipt: 'oracle-1',
      evidenceClass: 'inferred' as const,
    };
    expect(InvariantProposalSchema.parse(proposal).proposalId).toBe('prop-1');
    expect(() => InvariantProposalSchema.parse({ ...proposal, oracleAuthorReceipt: 'reyn' })).toThrow();
  });

  it('keeps cache reuse without proof authority and forecasts as estimates', () => {
    const reuse = {
      schemaVersion: '1' as const,
      recordId: 'reuse-1',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      artifactDigest: SHA_A,
      sourceDigest: SHA_A,
      inputDigest: SHA_A,
      lockDigest: SHA_A,
      toolchainDigest: SHA_A,
      imageDigest: SHA_A,
      configDigest: SHA_A,
      dataTemplateDigest: SHA_A,
      origin: 'trusted_build' as const,
      integrityVerified: true,
      authorizationReceipt: 'auth-1',
      deletionFenceChecked: true,
      cleanupReceipt: 'cleanup-1',
      outcome: 'miss' as const,
      rejectionReason: 'digest changed',
      confersProof: false as const,
    };
    expect(PreparationReuseRecordSchema.parse(reuse).outcome).toBe('miss');
    expect(() => PreparationReuseRecordSchema.parse({ ...reuse, rejectionReason: undefined })).toThrow();
    expect(() =>
      PreparationReuseRecordSchema.parse({ ...reuse, outcome: 'hit', integrityVerified: false }),
    ).toThrow();

    expect(
      RunForecastSchema.parse({
        schemaVersion: '1',
        forecastId: 'fc-1',
        planId: 'plan-1',
        profileId: 'profile-1',
        rateVersion: 'rate-1',
        calibrationIdentity: 'cal-1',
        componentEstimates: [{ component: 'verifier', estimate: 5, unit: 'usd' }],
        coldBoundMs: 1000,
        warmBoundMs: 500,
        queueBoundMs: 100,
        grossCostUsd: 5,
        netCostUsd: 5,
        fullProofReserveUsd: 1,
        reproductionReserveUsd: 1,
        cleanupReserveUsd: 1,
        validUntil: ISO,
        isEstimate: true,
      }).isEstimate,
    ).toBe(true);

    expect(
      EvaluationArmSchema.parse({
        evaluationVersion: 'eval-1',
        datasetVersion: 'data-1',
        armId: 'arm-1',
        modelIdentity: 'model-1',
        configDigest: SHA_A,
        feedbackDisclosure: 'none',
        commonBudget: { modelCostUsd: 5, wallTimeMs: 60000 },
        terminalRules: ['stop after n'],
        evaluatorIdentity: 'eval-1',
        oracleIdentity: 'oracle-1',
        caseOrder: 'fixed',
        repetitionPolicy: { repeats: 3, selection: 'pre_registered' },
        frozenAt: ISO,
      }).armId,
    ).toBe('arm-1');

    expect(
      EnvironmentProfileRevisionSchema.parse({
        schemaVersion: '1',
        revisionId: 'rev-1',
        tenantId: 'tenant-1',
        projectId: 'project-1',
        templateVersion: 'tpl-1',
        configDigest: SHA_A,
        intentId: 'intent-1',
        resourceProfileId: 'profile-1',
        updateVersion: 0,
      }).revisionId,
    ).toBe('rev-1');
  });
});

describe('impact and identity stay honest', () => {
  it('accepts an inferred impact and never a proven one', () => {
    expect(ImpactSchema.parse(impact()).resolution).toBe('inferred');
    expect(() => ImpactSchema.parse({ ...impact(), resolution: 'proven' })).toThrow();
    expect(() => ImpactSchema.parse({ ...impact(), id: '' })).toThrow();
  });

  it('keeps raw-byte and canonical identities in separate domains', () => {
    const raw = RawByteHash.parse(SHA_A);
    const canonical = CanonicalObjectHash.parse(SHA_A);
    expect(identitiesMatch(raw, canonical)).toBe(false);
    expect(identitiesMatch(raw, { domain: 'raw_byte', digest: SHA_A })).toBe(true);
  });
});
