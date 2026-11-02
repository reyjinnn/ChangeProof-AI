import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import {
  BundleStateSchema,
  ChangeProofError,
  PolicyVersionSchema,
  Sha256Schema,
  SubjectRefSchema,
  TargetAssessmentSchema,
} from '../../core/index.js';
import type { BundleState, SubjectRef, TargetAssessment } from '../../core/index.js';

/**
 * Immutable evidence store (WP3-12): canonical rendering, content addressing,
 * secret redaction, and bundle manifests.
 *
 * A leaf module: core contracts plus node stdlib only. Bytes are addressed by
 * their SHA-256 digest; there is no update, delete, or enumeration API. The
 * hosted authority backend (Postgres + private object storage) arrives with
 * WP3-21; the memory and file-dir backends here prove the semantics for real.
 */

export class EvidenceNotFoundError extends ChangeProofError {
  readonly digest: string;

  constructor(digest: string) {
    super(`Evidence artifact ${digest} was not found in this store.`);
    this.digest = digest;
  }
}

export class EvidenceIntegrityError extends ChangeProofError {
  readonly digest: string;

  constructor(digest: string, detail: string) {
    super(`Evidence artifact ${digest} failed integrity verification: ${detail}`);
    this.digest = digest;
  }
}

export class EvidenceSerializationError extends ChangeProofError {
  constructor(detail: string) {
    super(`Evidence serialization refused: ${detail}`);
  }
}

export const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_ANNOTATIONS = 20;
const MAX_ANNOTATION_CHARS = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value: unknown, path: Set<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EvidenceSerializationError('non-finite numbers have no canonical form.');
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (path.has(value)) throw new EvidenceSerializationError('circular structure has no canonical form.');
    path.add(value);
    const out = value.map((entry) => {
      if (entry === undefined) throw new EvidenceSerializationError('undefined has no canonical form.');
      return canonicalize(entry, path);
    });
    path.delete(value);
    return out;
  }
  if (isPlainObject(value)) {
    if (path.has(value)) throw new EvidenceSerializationError('circular structure has no canonical form.');
    path.add(value);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) continue;
      out[key] = canonicalize(entry, path);
    }
    path.delete(value);
    return out;
  }
  throw new EvidenceSerializationError(`value of type ${typeof value} has no canonical form.`);
}

/** Deterministic JSON: sorted keys, no whitespace. Same value, same bytes. */
export function renderCanonical(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

const CREDENTIAL_KEY_PATTERN =
  /(secret|token|passw|pwd|apikey|api_key|access_key|private_key|signing_key|client_secret|bearer|credential|authorization|auth_header|cookie|session_key|dsn|connection_string|webhook_secret|hmac|refresh_token)/i;

/**
 * Replace values under credential-bearing keys with `[redacted]`, recursively.
 * Key-name based by design: a value scan cannot know what is secret. Bare
 * `auth` is deliberately absent so `author`-style keys survive; the full
 * `authorization` word still matches.
 */
export function redactSecrets(value: unknown): unknown {
  return redactValue(value, new Set());
}

function redactValue(value: unknown, path: Set<object>): unknown {
  if (Array.isArray(value)) {
    if (path.has(value)) throw new EvidenceSerializationError('circular structure cannot be redacted.');
    path.add(value);
    const out = value.map((entry) => redactValue(entry, path));
    path.delete(value);
    return out;
  }
  if (isPlainObject(value)) {
    if (path.has(value)) throw new EvidenceSerializationError('circular structure cannot be redacted.');
    path.add(value);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = CREDENTIAL_KEY_PATTERN.test(key) ? '[redacted]' : redactValue(value[key], path);
    }
    path.delete(value);
    return out;
  }
  return value;
}

export interface EvidenceStore {
  put(bytes: string | Uint8Array): { digest: string };
  get(digest: string): Uint8Array;
  has(digest: string): boolean;
}

function toBytes(bytes: string | Uint8Array): Uint8Array {
  const out = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  if (out.length > MAX_EVIDENCE_BYTES) {
    throw new EvidenceSerializationError(
      `artifact is ${out.length} bytes, above the cap of ${MAX_EVIDENCE_BYTES}.`,
    );
  }
  return out;
}

function parseDigest(digest: string): string {
  const parsed = Sha256Schema.safeParse(digest);
  if (!parsed.success) {
    throw new EvidenceSerializationError('expected a 64-character lowercase hex SHA-256 digest.');
  }
  return parsed.data;
}

export function createMemoryEvidenceStore(): EvidenceStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    put(bytes: string | Uint8Array): { digest: string } {
      const stored = toBytes(bytes);
      const digest = sha256Hex(stored);
      blobs.set(digest, stored);
      return { digest };
    },
    get(digest: string): Uint8Array {
      const key = parseDigest(digest);
      const found = blobs.get(key);
      if (found === undefined) throw new EvidenceNotFoundError(key);
      return Buffer.from(found);
    },
    has(digest: string): boolean {
      return Sha256Schema.safeParse(digest).success && blobs.has(digest);
    },
  };
}

export function createFileEvidenceStore(dir: string): EvidenceStore {
  let stat: { isDirectory(): boolean };
  try {
    stat = statSync(dir);
  } catch {
    throw new EvidenceSerializationError(`evidence directory ${dir} does not exist.`);
  }
  if (!stat.isDirectory()) {
    throw new EvidenceSerializationError(`evidence path ${dir} is not a directory.`);
  }
  return {
    put(bytes: string | Uint8Array): { digest: string } {
      const stored = toBytes(bytes);
      const digest = sha256Hex(stored);
      // Atomic publish: temp file plus rename, so a crash never leaves a
      // half-written artifact under a live digest.
      const tmp = join(dir, `.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
      writeFileSync(tmp, stored);
      renameSync(tmp, join(dir, digest));
      return { digest };
    },
    get(digest: string): Uint8Array {
      const key = parseDigest(digest);
      let stored: Buffer;
      try {
        stored = readFileSync(join(dir, key));
      } catch {
        throw new EvidenceNotFoundError(key);
      }
      if (sha256Hex(stored) !== key) {
        throw new EvidenceIntegrityError(key, 'stored bytes do not match their digest.');
      }
      return stored;
    },
    has(digest: string): boolean {
      if (!Sha256Schema.safeParse(digest).success) return false;
      try {
        statSync(join(dir, digest));
        return true;
      } catch {
        return false;
      }
    },
  };
}

const BundleManifestEdgeSchema = z.strictObject({
  from: SubjectRefSchema,
  to: SubjectRefSchema,
  status: z.enum(['proven', 'inferred', 'unresolved']),
  checkRef: z.string().min(1),
});

const BundleManifestInvariantSchema = z.strictObject({
  ref: z.string().min(1),
  holds: z.boolean(),
  checkRef: z.string().min(1),
});

export const BundleManifestSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  policyVersion: PolicyVersionSchema,
  candidateBundleDigest: Sha256Schema,
  state: BundleStateSchema,
  targetOutcomes: z.array(TargetAssessmentSchema).min(1),
  bindings: z
    .array(
      z.strictObject({
        subject: SubjectRefSchema,
        candidate: Sha256Schema,
        verified: Sha256Schema,
      }),
    )
    .min(1),
  edges: z.array(BundleManifestEdgeSchema),
  invariants: z.array(BundleManifestInvariantSchema),
  mixedVersion: z.strictObject({
    requiredPairs: z.array(z.string().min(1)),
    coveredPairs: z.array(z.string().min(1)),
    allCampaignsComplete: z.boolean(),
  }),
  intentFulfilled: z.boolean(),
  runRef: z.string().min(1),
  annotations: z.record(z.string().min(1).max(MAX_ANNOTATION_CHARS), z.string().max(MAX_ANNOTATION_CHARS)).optional(),
});

export type BundleManifest = z.infer<typeof BundleManifestSchema>;

export interface BundleManifestInput {
  policyVersion: string;
  candidateBundleDigest: string;
  state: BundleState;
  targetOutcomes: TargetAssessment[];
  bindings: { subject: SubjectRef; candidate: string; verified: string }[];
  edges: { from: SubjectRef; to: SubjectRef; status: 'proven' | 'inferred' | 'unresolved'; checkRef: string }[];
  invariants: { ref: string; holds: boolean; checkRef: string }[];
  mixedVersion: { requiredPairs: string[]; coveredPairs: string[]; allCampaignsComplete: boolean };
  intentFulfilled: boolean;
  runRef: string;
  annotations?: Record<string, string>;
}

export interface AssembledManifest {
  manifest: BundleManifest;
  bytes: Uint8Array;
  digest: string;
}

export function assembleBundleManifest(input: BundleManifestInput): AssembledManifest {
  if (input.annotations !== undefined && Object.keys(input.annotations).length > MAX_MANIFEST_ANNOTATIONS) {
    throw new EvidenceSerializationError(
      `annotations exceed the cap of ${MAX_MANIFEST_ANNOTATIONS} entries.`,
    );
  }
  const parsed = BundleManifestSchema.safeParse({
    schemaVersion: '1',
    policyVersion: input.policyVersion,
    candidateBundleDigest: input.candidateBundleDigest,
    state: input.state,
    targetOutcomes: input.targetOutcomes,
    bindings: input.bindings,
    edges: input.edges,
    invariants: input.invariants,
    mixedVersion: input.mixedVersion,
    intentFulfilled: input.intentFulfilled,
    runRef: input.runRef,
    ...(input.annotations === undefined ? {} : { annotations: input.annotations }),
  });
  if (!parsed.success) {
    throw new EvidenceSerializationError(parsed.error.issues[0]?.message ?? 'manifest input is malformed.');
  }
  const bytes = Buffer.from(renderCanonical(redactSecrets(parsed.data)), 'utf8');
  return { manifest: parsed.data, bytes, digest: sha256Hex(bytes) };
}

/**
 * Verify a manifest by digest: present, hash-matching, parseable, on-schema.
 * A wrong hash or tampered bytes is an explicit integrity failure (NEG3-14),
 * never a silent pass.
 */
export function verifyBundleManifest(store: EvidenceStore, digest: string): AssembledManifest {
  const key = parseDigest(digest);
  const stored = store.get(key);
  if (sha256Hex(stored) !== key) {
    throw new EvidenceIntegrityError(key, 'stored bytes do not match their digest.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(stored).toString('utf8'));
  } catch {
    throw new EvidenceIntegrityError(key, 'stored bytes are not JSON.');
  }
  const manifest = BundleManifestSchema.safeParse(parsed);
  if (!manifest.success) {
    throw new EvidenceIntegrityError(key, manifest.error.issues[0]?.message ?? 'manifest is off-schema.');
  }
  return { manifest: manifest.data, bytes: Buffer.from(stored), digest: key };
}
