import { describe, expect, it } from 'vitest';

import {
  CanonicalObjectHash,
  RawByteHash,
  SCHEMA_VERSIONS,
  SchemaVersionUnknownError,
  identitiesMatch,
  resolveSchemaVersion,
} from '../../src/core/index.js';

/**
 * WP3-01 / T1-1 — contract identity and versioning negatives.
 *
 * These are written before the implementation. Each case corresponds to a
 * failure the specification names explicitly:
 *
 *  - NEG3-07 identity drift: a changed candidate must not silently reuse proof.
 *  - The phase-1 playbook: unknown `schemaVersion` is rejected, enums are closed,
 *    and raw-byte hashes stay distinct from canonical structured identity.
 */
describe('schema versioning', () => {
  it('resolves a known contract version', () => {
    expect(resolveSchemaVersion('BundleAssessment', '1')).toBe('1');
    expect(SCHEMA_VERSIONS.BundleAssessment).toBe('1');
  });

  it('rejects an unknown schemaVersion with a typed error', () => {
    let caught: unknown;
    try {
      resolveSchemaVersion('BundleAssessment', '99');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SchemaVersionUnknownError);
    const error = caught as SchemaVersionUnknownError;
    expect(error.contract).toBe('BundleAssessment');
    expect(error.received).toBe('99');
    expect(error.known).toEqual(['1']);
  });

  it('rejects an unknown contract name outright, without a silent default', () => {
    expect(() => resolveSchemaVersion('NotAContract', '1')).toThrow(SchemaVersionUnknownError);
  });
});

describe('identity separation', () => {
  it('keeps a raw-byte hash distinct from a canonical structured hash', () => {
    // Same digest text, two different identity domains. Collapsing them would
    // let a byte-identical but structurally different candidate reuse old proof.
    const raw = RawByteHash.parse('a'.repeat(64));
    const canonical = CanonicalObjectHash.parse('a'.repeat(64));

    expect(raw.domain).toBe('raw_byte');
    expect(canonical.domain).toBe('canonical_object');
    expect(raw.digest).toBe(canonical.digest);
    expect(identitiesMatch(raw, canonical)).toBe(false);
  });

  it('rejects a malformed digest instead of coercing it', () => {
    expect(() => RawByteHash.parse('not-a-hash')).toThrow();
    expect(() => CanonicalObjectHash.parse('ABC')).toThrow();
    expect(() => CanonicalObjectHash.parse('a'.repeat(63))).toThrow();
    expect(() => CanonicalObjectHash.parse('a'.repeat(65))).toThrow();
    expect(() => CanonicalObjectHash.parse('g'.repeat(64))).toThrow();
  });

  it('rejects a non-string digest', () => {
    expect(() => RawByteHash.parse(123)).toThrow();
    expect(() => CanonicalObjectHash.parse(null)).toThrow();
  });

  it('flags identity drift between two different domains (NEG3-07)', () => {
    const left = { domain: 'raw_byte' as const, digest: 'b'.repeat(64) };
    const right = { domain: 'canonical_object' as const, digest: 'b'.repeat(64) };

    expect(identitiesMatch(left, right)).toBe(false);
  });

  it('treats identical domain and digest as the same identity', () => {
    const left = { domain: 'raw_byte' as const, digest: 'b'.repeat(64) };
    const same = { domain: 'raw_byte' as const, digest: 'b'.repeat(64) };

    expect(identitiesMatch(left, same)).toBe(true);
  });

  it('produces a stable raw-byte digest for the same bytes', () => {
    const first = RawByteHash.ofBytes('const a = 1;');
    const second = RawByteHash.ofBytes('const a = 1;');
    const other = RawByteHash.ofBytes('const a = 2;');

    expect(first.digest).toBe(second.digest);
    expect(first.digest).not.toBe(other.digest);
  });

  it('produces the same canonical digest for structurally equal objects with different key order', () => {
    const first = CanonicalObjectHash.of({ b: 2, a: 1 });
    const second = CanonicalObjectHash.of({ a: 1, b: 2 });

    expect(first.digest).toBe(second.digest);
  });

  it('produces a different canonical digest when a value differs', () => {
    expect(CanonicalObjectHash.of({ a: 1 }).digest).not.toBe(CanonicalObjectHash.of({ a: 2 }).digest);
  });
});
