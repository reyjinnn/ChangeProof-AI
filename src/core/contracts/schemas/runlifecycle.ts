import { z } from 'zod';

import { CanonicalObjectHash } from '../identity.js';
import { IdSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';
import { HostedRunRequestSchema } from './hosted.js';

/**
 * Run-lifecycle contracts (FR3-31/35, WP3-25).
 *
 * Draft revisions version the run inputs (intent plus opaque engine refs for
 * environment, readiness, and profile); the submit extends the hosted run
 * request with the draft ref and the requested budget. The submit digest is
 * the SHA-256 of the canonical submit: retries reference the same immutable
 * bytes, and a changed submit is a new digest. Run states and event kinds are
 * closed enums — unknown values fail closed, never flow into a verdict.
 */

export const DraftBodySchema = z
  .strictObject({
    intent: NonEmptyStringSchema,
    environmentRevision: NonEmptyStringSchema.optional(),
    readinessRef: IdSchema.optional(),
    profileRef: IdSchema.optional(),
    budgetCap: z.number().positive().optional(),
    notes: z.string().optional(),
  })
  .describe('Versioned run inputs; engine artifacts stay behind opaque refs');
export type DraftBody = z.infer<typeof DraftBodySchema>;

export const DraftRevisionSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  draftId: IdSchema,
  tenantId: IdSchema,
  projectId: IdSchema,
  revision: z.number().int().positive(),
  body: DraftBodySchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type DraftRevision = z.infer<typeof DraftRevisionSchema>;

export const LifecycleSubmitSchema = HostedRunRequestSchema.omit({ reservationId: true }).extend({
  draftId: IdSchema,
  draftRevision: z.number().int().positive(),
  requestedBudget: z.number().positive(),
});
export type LifecycleSubmit = z.infer<typeof LifecycleSubmitSchema>;

/** Deterministic digest over the normalized submit (retries reuse it). */
export function submitDigestFor(submit: LifecycleSubmit): string {
  return CanonicalObjectHash.of(normalizeSubmit(submit)).digest;
}

function normalizeSubmit(submit: LifecycleSubmit): Record<string, unknown> {
  // Request identity (requestId, idempotencyKey) is excluded: a retry is a new
  // request for the same immutable meaning, so it keeps the same digest.
  return {
    actorId: submit.actorId,
    budgetProfileId: submit.budgetProfileId,
    draftId: submit.draftId,
    draftRevision: submit.draftRevision,
    executionMode: submit.executionMode,
    expectedGrantVersion: submit.expectedGrantVersion,
    intentRef: submit.intentRef,
    invariantRefs: [...submit.invariantRefs].sort(),
    projectId: submit.projectId,
    publicationConsent: submit.publicationConsent,
    repositoryIds: [...submit.repositoryIds].sort(),
    requestedBudget: submit.requestedBudget,
    sourceRefs: [...submit.sourceRefs].sort(),
    tenantId: submit.tenantId,
    verificationPlanRef: submit.verificationPlanRef,
  };
}

export const LifecycleRunStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type LifecycleRunState = z.infer<typeof LifecycleRunStateSchema>;

export const LifecycleRunSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  runId: IdSchema,
  tenantId: IdSchema,
  projectId: IdSchema,
  draftId: IdSchema,
  draftRevision: z.number().int().positive(),
  idempotencyKey: Sha256Schema,
  state: LifecycleRunStateSchema,
  version: z.number().int().nonnegative(),
  jobId: IdSchema.optional(),
  reservationId: IdSchema.optional(),
  submitDigest: Sha256Schema,
  repositoryIds: z.array(IdSchema).min(1),
  createdAt: z.iso.datetime({ offset: true }),
});
export type LifecycleRun = z.infer<typeof LifecycleRunSchema>;

export const RunEventKindSchema = z.enum([
  'submitted',
  'started',
  'progress',
  'artifact',
  'succeeded',
  'failed',
  'cancelled',
  'revoked',
  'retried',
]);
export type RunEventKind = z.infer<typeof RunEventKindSchema>;

export const RunEventSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  runId: IdSchema,
  seq: z.number().int().positive(),
  kind: RunEventKindSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true }),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunCursorSchema = z.strictObject({
  afterSeq: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
});
export type RunCursor = z.infer<typeof RunCursorSchema>;
