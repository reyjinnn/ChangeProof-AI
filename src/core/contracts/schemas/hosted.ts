import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';
import { ExecutionModeSchema } from '../vocabulary.js';

/**
 * Hosted contracts (PRD §16). These define authority and effect identities;
 * they do not implement persistence or establish hosted readiness.
 *
 * Opaque IDs are references, not permissions. Every side effect checks current
 * grants and fencing state at effect time, not only when the request is admitted.
 */

export const TenantContextSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    tenantId: IdSchema,
    userId: IdSchema,
    sessionId: IdSchema,
    role: z.enum(['owner', 'admin', 'member', 'viewer', 'operator']),
    projectGrants: z.array(IdSchema),
    repositoryGrants: z.array(IdSchema),
    grantVersion: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime({ offset: true }),
    /** Must be derived server-side; not accepted from a browser or job payload. */
    authoritySource: z.literal('server'),
  })
  .describe('Server-derived tenant, actor and current grant context');
export type TenantContext = z.infer<typeof TenantContextSchema>;

export const RepositoryConnectionSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    connectionId: IdSchema,
    tenantId: IdSchema,
    installationId: IdSchema,
    provider: z.enum(['github', 'gitlab', 'bitbucket']),
    repositoryAllowlist: z.array(IdSchema).min(1),
    permissionMatrix: z.record(z.string(), z.boolean()),
    status: z.enum(['active', 'revoked', 'pending_validation']),
    revocationVersion: z.number().int().nonnegative(),
    lastValidatedAt: z.iso.datetime({ offset: true }).optional(),
    /** Credentials are refs only; no token may be in the contract. */
    credentialRef: IdSchema,
  })
  .describe('Repository access with scoped permissions and revocation version');
export type RepositoryConnection = z.infer<typeof RepositoryConnectionSchema>;

export const HostedRunRequestSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    requestId: IdSchema,
    tenantId: IdSchema,
    actorId: IdSchema,
    projectId: IdSchema,
    repositoryIds: z.array(IdSchema).min(1),
    sourceRefs: z.array(NonEmptyStringSchema).min(1),
    intentRef: IdSchema,
    executionMode: ExecutionModeSchema,
    invariantRefs: z.array(IdSchema).min(1),
    verificationPlanRef: IdSchema,
    budgetProfileId: IdSchema,
    reservationId: IdSchema,
    publicationConsent: z.boolean(),
    /** Stable identity for deduplicating an at-least-once request. */
    idempotencyKey: Sha256Schema,
    expectedGrantVersion: z.number().int().nonnegative(),
  })
  .describe('Authorized request to create a hosted run');
export type HostedRunRequest = z.infer<typeof HostedRunRequestSchema>;

export const LeaseStateSchema = z.enum(['active', 'expired', 'revoked', 'completed']);
export type LeaseState = z.infer<typeof LeaseStateSchema>;

export const JobLeaseSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    tenantId: IdSchema,
    runId: IdSchema,
    jobId: IdSchema,
    imageDigest: Sha256Schema,
    candidateDigest: Sha256Schema,
    planDigest: Sha256Schema,
    /** Monotonic fencing epoch — stale workers cannot write. */
    epoch: z.number().int().gt(0),
    ownerId: IdSchema,
    heartbeatAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    state: LeaseStateSchema,
    retryCount: z.number().int().nonnegative(),
    cancelRequested: z.boolean(),
    /** Compare-and-swap version; every mutation names the version it read. */
    version: z.number().int().nonnegative(),
    grantVersion: z.number().int().nonnegative(),
  })
  .describe('Fenced job lease; stale epochs are not write authority');
export type JobLease = z.infer<typeof JobLeaseSchema>;

export const UsageLedgerEntrySchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    tenantId: IdSchema,
    runId: IdSchema,
    reservationId: IdSchema,
    providerReceiptRef: IdSchema.optional(),
    /** Globally unique id for deduplication across retries. */
    effectId: Sha256Schema,
    provider: z.string().min(1),
    measuredUnits: z.number().nonnegative(),
    unitName: z.string().min(1),
    rateVersion: IdSchema,
    periodId: IdSchema,
    event: z.enum(['reserve', 'consume', 'settle', 'reverse', 'release']),
    consumedAmount: z.number().nonnegative(),
    reservedAmount: z.number().nonnegative(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .describe('Idempotent usage event with measured units and frozen rate identity');
export type UsageLedgerEntry = z.infer<typeof UsageLedgerEntrySchema>;

export const ArtifactAccessGrantSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    tenantId: IdSchema,
    repositoryGrantIds: z.array(IdSchema).min(1),
    subjectId: IdSchema,
    artifactDigest: Sha256Schema,
    purpose: z.enum(['review', 'reproduction', 'support', 'export']),
    expiresAt: z.iso.datetime({ offset: true }),
    revocationVersion: z.number().int().nonnegative(),
    /** Receipt from the authenticated proxy, not a permanent public URL. */
    proxyReceiptRef: IdSchema.optional(),
  })
  .describe('Time- and purpose-bound artifact access; never a public link');
export type ArtifactAccessGrant = z.infer<typeof ArtifactAccessGrantSchema>;

export const DataLifecycleRecordSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    tenantId: IdSchema,
    artifactId: IdSchema,
    retentionVersion: IdSchema,
    categories: z.array(NonEmptyStringSchema).min(1),
    locations: z.array(NonEmptyStringSchema).min(1),
    fenceId: IdSchema.optional(),
    tombstoneId: IdSchema.optional(),
    purgeProgress: z.enum(['not_started', 'in_progress', 'complete', 'failed']),
    backupExpiry: z.iso.datetime({ offset: true }).optional(),
    auditMinimumUntil: z.iso.datetime({ offset: true }).optional(),
    completionEvidenceRefs: z.array(NonEmptyStringSchema).default([]),
  })
  .describe('Retention/deletion state with tombstone and purge receipts');
export type DataLifecycleRecord = z.infer<typeof DataLifecycleRecordSchema>;

export const HostedServiceProfileSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    profileId: IdSchema,
    environment: z.string().min(1),
    maxTenants: z.number().int().gt(0),
    maxConcurrentRuns: z.number().int().gt(0),
    maxQueueDepth: z.number().int().gt(0),
    maxRunsPerTenant: z.number().int().gt(0),
    queueWaitMs: z.number().int().gt(0),
    fairnessWindowMs: z.number().int().gt(0),
    costOvershootUsd: z.number().nonnegative(),
    sloAvailability: z.number().gt(0).lte(1),
    rpoMs: z.number().int().nonnegative(),
    rtoMs: z.number().int().gt(0),
    retentionDays: z.number().int().gt(0),
    deletionSloMs: z.number().int().gt(0),
    /** Versioned method used to qualify this profile; values are frozen before acceptance. */
    campaignMethod: IdSchema,
    frozenAt: z.iso.datetime({ offset: true }).optional(),
  })
  .describe('Finite hosted service limits; missing numeric values block release readiness');
export type HostedServiceProfile = z.infer<typeof HostedServiceProfileSchema>;
