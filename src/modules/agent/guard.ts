import { z } from 'zod';

import { ChangeProofError } from '../../core/index.js';

import { authorizeMutation, type MutationAuthorization } from './gateway.js';

/**
 * Patch guard, report-only (WP3-07, FR3-09).
 *
 * Reviews a candidate patch before anything applies it: every operation
 * passes the typed gateway, deletions of tests/checks are rejected, and
 * edits outside the approved intent scope need a scope revision instead of
 * a silent pass. The guard applies nothing and edits nothing — it returns
 * every violation it found. Malformed guard input (not patch problems) is
 * the only thing that throws.
 */

/** `[DERIVED]` default test-path markers; composition may override. */
export const DEFAULT_TEST_MARKERS: readonly string[] = ['tests/', '.test.', '.spec.', '__tests__'];

export interface PatchOperation {
  readonly operation: string;
  readonly path: string;
  readonly sizeBytes?: number;
}

export interface PatchReviewInput {
  readonly operations: readonly PatchOperation[];
  readonly writableRoots: readonly string[];
  readonly protectedRoots: readonly string[];
  readonly allowedOperations: readonly string[];
  readonly maxSizeBytes?: number;
  readonly approvedScope: readonly string[];
  readonly testMarkers?: readonly string[];
}

export interface PatchReview {
  readonly accepted: boolean;
  readonly violations: readonly string[];
}

function inScope(path: string, scope: readonly string[]): boolean {
  return scope.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

function touchesTests(path: string, markers: readonly string[]): boolean {
  return markers.some((marker) => path.includes(marker));
}

const GuardOperationSchema = z.object({
  operation: z.string(),
  path: z.string(),
  sizeBytes: z.number().optional(),
});

export function reviewPatch(input: PatchReviewInput): PatchReview {
  // Runtime validation for untrusted callers; zod keeps the types exact.
  const operations = z.array(GuardOperationSchema).safeParse(input.operations);
  if (!operations.success) {
    throw new ChangeProofError('Patch operations are malformed; refusing to review.');
  }
  const scope = z.array(z.string()).safeParse(input.approvedScope);
  if (!scope.success) {
    throw new ChangeProofError('Approved scope is malformed; refusing to review.');
  }
  const markers = input.testMarkers ?? DEFAULT_TEST_MARKERS;
  const violations: string[] = [];
  for (const operation of operations.data) {
    let normalized: string;
    try {
      const request: MutationAuthorization = {
        operation: operation.operation,
        path: operation.path,
        writableRoots: input.writableRoots,
        protectedRoots: input.protectedRoots,
        allowedOperations: input.allowedOperations,
        ...(operation.sizeBytes === undefined ? {} : { sizeBytes: operation.sizeBytes }),
        ...(input.maxSizeBytes === undefined ? {} : { maxSizeBytes: input.maxSizeBytes }),
      };
      const authorized = authorizeMutation(request);
      normalized = authorized.root.length === 0 ? authorized.relativePath : `${authorized.root}/${authorized.relativePath}`;
    } catch (error) {
      violations.push(error instanceof Error ? error.message : 'Mutation refused.');
      continue;
    }
    if (!inScope(normalized, scope.data)) {
      violations.push(
        `Patch edits "${operation.path}" outside the approved scope; open a scope revision instead.`,
      );
      continue;
    }
    if (operation.operation === 'delete_file' && touchesTests(normalized, markers)) {
      violations.push(`Patch deletes tests at "${operation.path}"; the guard rejects weakened checks.`);
    }
  }
  return { accepted: violations.length === 0, violations };
}
