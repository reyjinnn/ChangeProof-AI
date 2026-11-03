import { createHash } from 'node:crypto';

import { ChangeProofError } from '../../core/index.js';

/**
 * Canonical JSON for frozen digests (WP3-13).
 *
 * Keys sort recursively so the same value always hashes the same way; any
 * non-JSON value (undefined, functions, symbols, bigint) is refused instead
 * of being silently dropped or coerced — a digest must mean exactly the
 * bytes it was computed over.
 */

function canonicalValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const kind = typeof value;
  if (kind === 'string') {
    return JSON.stringify(value);
  }
  if (kind === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new ChangeProofError('Cannot canonicalize a non-finite number; refusing.');
    }
    return JSON.stringify(value);
  }
  if (kind === 'boolean') {
    return value === true ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalValue(entry)).join(',')}]`;
  }
  if (kind === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalValue(entry)}`).join(',')}}`;
  }
  throw new ChangeProofError('Cannot canonicalize a non-JSON value; refusing.');
}

export function canonicalize(value: unknown): string {
  return canonicalValue(value);
}

export function sha256Hex(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}
