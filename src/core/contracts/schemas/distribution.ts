import { z } from 'zod';

import {
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  Sha256Schema,
} from '../primitives.js';

/**
 * Distribution contracts (FR3-43): BYOK credentials and self-host deployment.
 *
 * A BYOK record carries metadata only — tenant, provider, model, key
 * fingerprint, status. Key material itself lives in the secret broker and is
 * read at call time; it never appears in a contract, a store row, a log, or
 * evidence (NEG3-37). The fingerprint is the SHA-256 of the key, so rotation
 * is observable without ever handling the secret.
 *
 * Deployment profiles pin every artifact a self-host install needs. A profile
 * without a matching qualification record is not installable: the gate fails
 * closed (`blocked`), never with a silent default (NEG3-28, NEG3-37).
 */

export const ByokCredentialSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    refId: IdSchema,
    tenantId: IdSchema,
    provider: NonEmptyStringSchema,
    model: NonEmptyStringSchema,
    fingerprint: Sha256Schema,
    status: z.enum(['active', 'revoked']),
    rotationVersion: z.number().int().gte(1),
    createdAt: InstantSchema,
    rotatedAt: InstantSchema,
    revokedAt: InstantSchema.optional(),
  })
  .describe('BYOK credential metadata; key material stays in the secret broker');
export type ByokCredential = z.infer<typeof ByokCredentialSchema>;

export const DeploymentProfileSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    profileId: IdSchema,
    platform: NonEmptyStringSchema,
    nodePin: NonEmptyStringSchema,
    pnpmPin: NonEmptyStringSchema,
    postgresPin: NonEmptyStringSchema,
    migrationFiles: z.array(NonEmptyStringSchema).min(1),
    maxConcurrentRuns: z.number().int().gt(0),
    diskGb: z.number().int().gt(0),
    qualificationMethod: IdSchema,
  })
  .describe('Pinned self-host deployment profile; every artifact explicit');
export type DeploymentProfile = z.infer<typeof DeploymentProfileSchema>;

export const DeploymentQualificationSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    profileId: IdSchema,
    method: IdSchema,
    receiptRefs: z.array(NonEmptyStringSchema).min(1),
    qualifiedAt: InstantSchema,
  })
  .describe('Proof that a profile was qualified; required before install');
export type DeploymentQualification = z.infer<typeof DeploymentQualificationSchema>;

export const DeploymentStepSchema = z.enum(['install', 'upgrade', 'backup', 'restore', 'teardown']);
export type DeploymentStep = z.infer<typeof DeploymentStepSchema>;

export const DeploymentReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    receiptId: IdSchema,
    profileId: IdSchema,
    step: DeploymentStepSchema,
    artifactDigest: Sha256Schema,
    success: z.boolean(),
    startedAt: InstantSchema,
    finishedAt: InstantSchema,
    detail: z.string().max(2000),
  })
  .describe('Receipt for one deployment step; artifact-bound and timestamped');
export type DeploymentReceipt = z.infer<typeof DeploymentReceiptSchema>;
/**
 * Cloud deployment contracts (FR3-43, WP3-34).
 *
 * A cloud profile pins provider, region, compute type, image digest,
 * runtime pins, and the secret-broker ref prefix — metadata and refs only,
 * never key material (NEG3-37). Every lifecycle step executes through a
 * driver and drift-checks observed reality against the pins; config
 * rendering alone never yields a success receipt (NEG3-40).
 */

export const CloudProviderSchema = z.enum(['aws', 'azure', 'gcp']);
export type CloudProvider = z.infer<typeof CloudProviderSchema>;

export const CloudStepSchema = z.enum([
  'provision',
  'run',
  'upgrade',
  'rollback',
  'snapshot',
  'restore',
  'delete',
  'teardown',
]);
export type CloudStep = z.infer<typeof CloudStepSchema>;

export const CloudProfileSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    profileId: IdSchema,
    provider: CloudProviderSchema,
    region: NonEmptyStringSchema,
    computeType: NonEmptyStringSchema,
    imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/, 'compute image must be pinned by sha256 digest'),
    nodePin: NonEmptyStringSchema,
    pnpmPin: NonEmptyStringSchema,
    postgresPin: NonEmptyStringSchema,
    secretBroker: z.strictObject({ kind: z.literal('broker'), refPrefix: NonEmptyStringSchema }),
    maxConcurrentRuns: z.number().int().gt(0),
    diskGb: z.number().int().gt(0),
    qualificationMethod: IdSchema,
  })
  .describe('Pinned cloud deployment profile; refs only, never key material');
export type CloudProfile = z.infer<typeof CloudProfileSchema>;

export const CloudQualificationSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    profileId: IdSchema,
    method: IdSchema,
    receiptRefs: z.array(NonEmptyStringSchema).min(1),
    qualifiedAt: InstantSchema,
  })
  .describe('Proof that a cloud profile was qualified; required before provision');
export type CloudQualification = z.infer<typeof CloudQualificationSchema>;

export const CloudReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    receiptId: IdSchema,
    profileId: IdSchema,
    provider: CloudProviderSchema,
    region: NonEmptyStringSchema,
    step: CloudStepSchema,
    artifactDigest: Sha256Schema,
    externalId: NonEmptyStringSchema,
    success: z.boolean(),
    startedAt: InstantSchema,
    finishedAt: InstantSchema,
    detail: z.string().max(2000),
  })
  .describe('Receipt for one cloud step; bound to driver-observed reality');
export type CloudReceipt = z.infer<typeof CloudReceiptSchema>;
