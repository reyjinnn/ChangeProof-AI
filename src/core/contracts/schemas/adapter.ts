import { createHash } from 'node:crypto';

import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';

/**
 * Adapter fix contracts (FR3-02, FR3-09).
 *
 * These describe what an adapter planned, never whether the plan is correct:
 * the guard reviews the patch, the verifier runs the checks, and policy owns
 * the verdict. The adapter is the framework expert; it is not the judge.
 *
 * The patch digest is carried on the patch and re-verified at apply time, so
 * a candidate that changed after review cannot reuse the review (NEG3-07).
 */

export const AdapterFixChangeKindSchema = z.enum(['field_rename', 'route_path_change']);
export type AdapterFixChangeKind = z.infer<typeof AdapterFixChangeKindSchema>;

export const AdapterFixRequestSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    requestId: IdSchema,
    changeKind: AdapterFixChangeKindSchema,
    /** Module-qualified entity carrying the change, e.g. `app.models.OrderOut`. */
    entity: NonEmptyStringSchema,
    before: NonEmptyStringSchema,
    after: NonEmptyStringSchema,
    intentRef: NonEmptyStringSchema,
    /** Snapshot-relative roots the fix may touch. */
    scope: z.array(NonEmptyStringSchema).min(1),
  })
  .superRefine((request, ctx) => {
    if (request.before === request.after) {
      ctx.addIssue({
        code: 'custom',
        path: ['after'],
        message: 'A fix request with identical before/after states nothing to change.',
      });
    }
  })
  .describe('One typed change an adapter is asked to remediate');
export type AdapterFixRequest = z.infer<typeof AdapterFixRequestSchema>;

export const AdapterPatchOperationSchema = z
  .strictObject({
    operation: z.literal('write'),
    /** Snapshot-relative path. Authorization happens through the typed gateway. */
    path: NonEmptyStringSchema,
    content: z.string(),
    /** Graph edge/node ids this edit follows. Every edit maps to impact (FR3-09). */
    impactRefs: z.array(NonEmptyStringSchema).min(1),
  })
  .describe('One adapter-planned file write');
export type AdapterPatchOperation = z.infer<typeof AdapterPatchOperationSchema>;

export const AdapterPatchSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    patchId: IdSchema,
    intentRefs: z.array(NonEmptyStringSchema).min(1),
    operations: z.array(AdapterPatchOperationSchema).min(1),
    /** Digest over the canonical operation set. Re-verified before anything applies. */
    patchDigest: Sha256Schema,
  })
  .describe('A candidate patch planned by an adapter');
export type AdapterPatch = z.infer<typeof AdapterPatchSchema>;

function canonicalPatchPayload(patch: Pick<AdapterPatch, 'intentRefs' | 'operations'>): string {
  const operations = [...patch.operations]
    .map((operation) => ({
      operation: operation.operation,
      path: operation.path,
      content: operation.content,
      impactRefs: [...operation.impactRefs].sort(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return JSON.stringify({ intentRefs: [...patch.intentRefs].sort(), operations });
}

/** Digest of the canonical operation set: same edits, same digest, any key order. */
export function digestAdapterPatch(patch: Pick<AdapterPatch, 'intentRefs' | 'operations'>): string {
  return createHash('sha256').update(canonicalPatchPayload(patch), 'utf8').digest('hex');
}

export const AdapterCheckKindSchema = z.enum(['build', 'test', 'http', 'browser']);
export type AdapterCheckKind = z.infer<typeof AdapterCheckKindSchema>;

export const AdapterCheckSchema = z
  .strictObject({
    checkId: NonEmptyStringSchema,
    kind: AdapterCheckKindSchema,
    /** Executable name resolved through PATH. Argv only, never a shell line. */
    command: NonEmptyStringSchema,
    args: z.array(z.string()).default([]),
    /** Absolute working directory. Checks never run in an ambient cwd. */
    cwd: NonEmptyStringSchema,
    timeoutMs: z.number().int().positive(),
    required: z.boolean().default(true),
  })
  .describe('One executable check in an adapter check plan');
export type AdapterCheck = z.infer<typeof AdapterCheckSchema>;

export const AdapterCheckPlanSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planId: IdSchema,
    /** The exact patch this plan verifies. A changed candidate needs a new plan. */
    patchDigest: Sha256Schema,
    checks: z.array(AdapterCheckSchema).min(1),
    runnerIdentity: NonEmptyStringSchema,
  })
  .describe('Executable checks for one adapter patch, run by the verifier');
export type AdapterCheckPlan = z.infer<typeof AdapterCheckPlanSchema>;

export const AdapterFixStatusSchema = z.enum(['ok', 'unsupported', 'no_impact', 'failed']);
export type AdapterFixStatus = z.infer<typeof AdapterFixStatusSchema>;
