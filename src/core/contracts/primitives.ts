import { z } from 'zod';

import { SemanticViolationError } from '../errors/index.js';

/**
 * Structural primitives shared by every contract.
 *
 * These encode the shapes the specification names repeatedly: opaque
 * identifiers, digests, locators, entity refs. Defining them once is what makes
 * "no dangling reference" checkable rather than aspirational.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const NonEmptyStringSchema = z.string().min(1);
export type NonEmptyString = z.infer<typeof NonEmptyStringSchema>;

/**
 * Opaque identifier. Deliberately not permission — .claude/AGENTS.md §3 rule 10.
 *
 * Used for tenant, job, run and artifact identities, where the token must not
 * look like a path or a URL. Graph node and edge identifiers use the wider
 * `GraphEntityId` below, because a graph identity legitimately contains a
 * module path and a symbol separator.
 */
export const IdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:@+-]*$/, 'identifier must be an opaque, non-path-safe token');
export type Id = z.infer<typeof IdSchema>;

/**
 * Identity for a graph entity or relation.
 *
 * Graph identities are structural, not opaque tokens: a node is addressed by
 * its kind and location (`symbol:src/api/client.ts#fetchOrder`). They are still
 * bounded and cannot contain a traversal segment.
 */
export const GraphEntityIdSchema = z
  .string()
  .min(1)
  .max(400)
  .refine((value) => !value.includes('..'), { message: 'graph identity must not contain a traversal segment' })
  .refine((value) => !value.startsWith('/'), { message: 'graph identity must be relative' });
export type GraphEntityId = z.infer<typeof GraphEntityIdSchema>;

/** Version string for a contract. Verified against the registry, not just shaped. */
export const SchemaVersionStringSchema = z.string().regex(/^[0-9]+(?:\.[0-9]+)*$/, 'schemaVersion must be numeric');

export const PolicyVersionSchema = z.string().regex(/^[0-9]+(?:\.[0-9]+)*$/);
export const AdapterContractVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const Sha256Schema = z.string().regex(SHA256_HEX, 'expected a 64-character lowercase hex SHA-256');
export type Sha256 = z.infer<typeof Sha256Schema>;

/** Digest of a container image or runner identity. */
export const RunnerIdentitySchema = z
  .string()
  .regex(/^[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/, 'runner identity must be pinned by digest');
export type RunnerIdentity = z.infer<typeof RunnerIdentitySchema>;

/** A path inside a snapshot, always POSIX-style and never escaping the root. */
export const RelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/'), { message: 'path must be relative' })
  .refine((value) => !value.split('/').includes('..'), { message: 'path must not traverse upward' })
  .refine((value) => !value.includes('\\'), { message: 'path must use POSIX separators' });
export type RelativePath = z.infer<typeof RelativePathSchema>;

/** `path:line` or `path` locator for a piece of evidence. */
export const EvidenceLocatorSchema = z
  .string()
  .min(1)
  .refine((value) => !value.split(':')[0]?.startsWith('/'), { message: 'locator must be relative' });
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;

/** Commit identity for a source snapshot. */
export const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'expected a 40-character git SHA');
export type GitSha = z.infer<typeof GitShaSchema>;

/**
 * What a proof is about. A conclusion that names no subject cannot be checked,
 * so the subject is required wherever an outcome is stated.
 */
export const SubjectKindSchema = z.enum([
  'consumer',
  'producer',
  'frontend',
  'worker',
  'migration',
  'dependency',
  'event',
  'cache',
  'repository',
]);
export type SubjectKind = z.infer<typeof SubjectKindSchema>;

export const SubjectRefSchema = z
  .object({
    kind: SubjectKindSchema,
    id: IdSchema,
    /** Optional repository scope for multi-repo subjects. */
    repository: IdSchema.optional(),
  })
  .strict();
export type SubjectRef = z.infer<typeof SubjectRefSchema>;

export function subjectKey(subject: SubjectRef): string {
  return subject.repository === undefined
    ? `${subject.kind}:${subject.id}`
    : `${subject.kind}:${subject.repository}:${subject.id}`;
}

/**
 * The scope a proof actually covers. FR3-06: an unmapped target must not
 * disappear from the denominator, so this is recorded, not inferred.
 */
export const ProofScopeSchema = z
  .object({
    targets: z.array(SubjectRefSchema).min(1),
    edges: z.array(IdSchema),
    invariants: z.array(IdSchema).min(1),
    /** Explicitly out-of-scope surfaces, visible to the owner rather than hidden. */
    unsupportedSurfaces: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();
export type ProofScope = z.infer<typeof ProofScopeSchema>;

/** A reference to an immutable artifact, always content-addressed. */
export const ArtifactRefSchema = z
  .object({
    id: IdSchema,
    digest: Sha256Schema,
    kind: NonEmptyStringSchema,
    locator: NonEmptyStringSchema,
    sizeBytes: z.number().int().nonnegative().optional(),
    /** Redaction provenance: what was removed before this artifact was stored. */
    redactions: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const CountsSchema = z
  .object({
    planned: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    censored: z.number().int().nonnegative(),
    notRun: z.number().int().nonnegative(),
  })
  .strict();
export type Counts = z.infer<typeof CountsSchema>;

/** Assert the trial counts account for every planned trial. No silent dropout. */
export function assertCountsReconcile(counts: Counts, context: string): void {
  const accounted = counts.completed + counts.failed + counts.invalid + counts.censored + counts.notRun;
  if (accounted !== counts.planned) {
    throw new SemanticViolationError(
      'counts.unreconciled',
      `${context}: planned=${counts.planned} but accounted=${accounted} ` +
        `(completed=${counts.completed}, failed=${counts.failed}, invalid=${counts.invalid}, ` +
        `censored=${counts.censored}, notRun=${counts.notRun}). Every planned trial must be classified.`,
      { ...counts, accounted },
    );
  }
}

/** UTC instant, stored as an ISO-8601 string so it survives serialisation. */
export const InstantSchema = z.iso.datetime({ offset: true });
export type Instant = z.infer<typeof InstantSchema>;
