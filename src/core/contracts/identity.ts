import { createHash } from 'node:crypto';

import { SemanticViolationError } from '../errors/index.js';

/**
 * Identity domains.
 *
 * AGENTS.md §5 and the phase-1 playbook require a raw-byte hash to stay
 * distinct from a canonical structured identity. They answer different
 * questions:
 *
 *   raw_byte         "are these the exact same bytes?"
 *   canonical_object "is this the same *structure*, independent of key order,
 *                     formatting and platform line endings?"
 *
 * Collapsing them lets a candidate that was reformatted reuse proof computed
 * for a different one — the identity-drift failure NEG3-07 names.
 *
 * They are distinct object types, not bare strings, so the type system rejects
 * passing one where the other is expected. A branded string would be erased at
 * runtime and the two would compare equal.
 */
export type IdentityDomain = 'raw_byte' | 'canonical_object';

export interface RawByteHashValue {
  readonly domain: 'raw_byte';
  readonly digest: string;
}

export interface CanonicalObjectHashValue {
  readonly domain: 'canonical_object';
  readonly digest: string;
}

export type StructuredIdentity = RawByteHashValue | CanonicalObjectHashValue;

const SHA256_HEX = /^[0-9a-f]{64}$/;

function assertSha256(value: string, label: string): string {
  if (!SHA256_HEX.test(value)) {
    throw new SemanticViolationError(
      'identity.digest.malformed',
      `${label} must be 64 lowercase hex characters, received ${JSON.stringify(value)}.`,
      { label, value },
    );
  }
  return value;
}

function parseRawByteHash(value: unknown): RawByteHashValue {
  if (typeof value !== 'string') {
    throw new SemanticViolationError('identity.raw_byte.type', 'A raw-byte hash must be a string.', {
      received: typeof value,
    });
  }
  return { domain: 'raw_byte', digest: assertSha256(value, 'raw-byte digest') };
}

function parseCanonicalObjectHash(value: unknown): CanonicalObjectHashValue {
  if (typeof value !== 'string') {
    throw new SemanticViolationError(
      'identity.canonical_object.type',
      'A canonical object hash must be a string.',
      { received: typeof value },
    );
  }
  return { domain: 'canonical_object', digest: assertSha256(value, 'canonical object digest') };
}

export const RawByteHash = {
  parse: parseRawByteHash,
  /** Hash exact bytes. No normalisation of any kind. */
  ofBytes(bytes: Uint8Array | string): RawByteHashValue {
    const hash = createHash('sha256');
    hash.update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes);
    return { domain: 'raw_byte', digest: hash.digest('hex') };
  },
} as const;

export const CanonicalObjectHash = {
  parse: parseCanonicalObjectHash,
  /**
   * Hash a value's canonical serialisation, so key order and formatting do not
   * change the identity. Two structurally equal values hash equal; two values
   * differing in any canonical detail do not.
   */
  of(value: unknown): CanonicalObjectHashValue {
    return { domain: 'canonical_object', digest: canonicalDigest(value) };
  },
} as const;

/**
 * Canonical serialisation: object keys sorted, no insignificant whitespace,
 * numbers written in their shortest round-trippable form. Arrays keep order —
 * order is meaningful, so it is preserved rather than normalised away.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

export function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) {
      out[key] = sortDeep(entry);
    }
  }
  return out;
}

/**
 * True when two identities are interchangeable — same domain *and* same digest.
 *
 * A raw-byte hash and a canonical-object hash of the same bytes are **not**
 * interchangeable: that is precisely the drift this guards.
 */
export function identitiesMatch(left: StructuredIdentity, right: StructuredIdentity): boolean {
  return left.domain === right.domain && left.digest === right.digest;
}

export function describeIdentity(identity: StructuredIdentity): string {
  return `${identity.domain}:${identity.digest}`;
}
