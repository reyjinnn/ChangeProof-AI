import { describe, expect, it } from 'vitest';

import { MigrationIntegrityError } from '../../src/modules/migrations/index.js';
import {
  ByteLedger,
  assertDecimalPreserved,
  assertMappingPreserves,
  freezeVolumeProfile,
  labelTransfer,
  reconcileTransfer,
  verifyVolumeProfile,
} from '../../src/modules/migrations/transfer.js';

/**
 * WP3-33 / T-38 — TB-scale / cross-engine migration failure-path tests
 * (NEG3-05, NEG3-40).
 *
 * Written before the implementation. Logical bytes are counted from actual
 * chunk payloads — a small dataset never passes as TB proof, and sparse or
 * apparent file size never enters the ledger. Cross-engine type mappings
 * must preserve precision exactly, and reconciliation compares row counts,
 * per-tenant splits, and checksums: any mismatch records a data-integrity
 * failure instead of a fix.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const TB = 1_000_000_000_000;
const SHA = 'e'.repeat(64);

function profile(overrides: Record<string, unknown> = {}) {
  return freezeVolumeProfile({
    profileId: 'tb-postgres-to-spanner',
    declaredLogicalBytes: TB,
    sourceEngine: 'postgresql',
    sourceVersion: '16.4',
    targetEngine: 'spanner',
    targetVersion: '2026-09',
    crossEngine: true,
    activeWriters: { writers: 8, opsPerWriter: 500 },
    frozenAt: NOW,
    ...overrides,
  });
}

describe('volume profiles pin declared bytes and engine pairs', () => {
  it('refuses a cross-engine profile whose engines do not differ', () => {
    expect(() =>
      profile({ targetEngine: 'postgresql', targetVersion: '16.4' }),
    ).toThrow(/cross-engine|differ/i);
  });

  it('invalidates proof on profile drift', () => {
    const frozen = profile();
    expect(() =>
      verifyVolumeProfile({ ...frozen, declaredLogicalBytes: 10 }),
    ).toThrow(/drift|digest/i);
  });
});

describe('byte ledger counts actual payload bytes only', () => {
  it('throws when a small dataset claims the declared TB volume', () => {
    const ledger = new ByteLedger(profile());
    ledger.recordChunk({ chunkId: 'c0', rows: 2000, logicalBytes: 512_000, checksum: SHA });
    expect(() => {
      ledger.assertDeclaredVolume();
    }).toThrow(/declared|volume/i);
    expect(ledger.total().totalLogicalBytes).toBe(512_000);
  });

  it('accepts a ledger that actually reaches the declared volume', () => {
    const small = profile({ profileId: 'small-smoke', declaredLogicalBytes: 1_000_000 });
    const ledger = new ByteLedger(small);
    ledger.recordChunk({ chunkId: 'c0', rows: 2000, logicalBytes: 512_000, checksum: SHA });
    ledger.recordChunk({ chunkId: 'c1', rows: 2000, logicalBytes: 512_000, checksum: SHA });
    expect(() => {
      ledger.assertDeclaredVolume();
    }).not.toThrow();
    expect(ledger.total().totalRows).toBe(4000);
  });

  it('rejects chunks that miscount bytes', () => {
    const ledger = new ByteLedger(profile());
    expect(() => {
      ledger.recordChunk({ chunkId: 'c0', rows: 10, logicalBytes: -1, checksum: SHA });
    }).toThrow();
    expect(() => {
      ledger.recordChunk({ chunkId: 'c0', rows: 10, logicalBytes: 100, checksum: 'short' });
    }).toThrow();
  });
});

describe('cross-engine mappings preserve precision exactly', () => {
  it('keeps exact decimals and refuses overflow', () => {
    expect(assertDecimalPreserved('123.45', 12, 2)).toBe('123.45');
    expect(() => assertDecimalPreserved('123.456', 12, 2)).toThrow(/scale|precision/i);
    expect(() => assertDecimalPreserved('1234567890123.45', 12, 2)).toThrow(/precision/i);
    expect(() => assertDecimalPreserved('not-a-number', 12, 2)).toThrow(/decimal/i);
  });

  it('refuses narrowing mappings and validates samples', () => {
    expect(() => {
      assertMappingPreserves(
        { sourceType: 'NUMERIC(12,2)', targetType: 'NUMERIC(10,2)', rule: { kind: 'exact-decimal', sourcePrecision: 12, sourceScale: 2, targetPrecision: 10, targetScale: 2 } },
        ['123.45'],
      );
    }).toThrow(/narrow|precision/i);
    expect(() => {
      assertMappingPreserves(
        { sourceType: 'NUMERIC(12,2)', targetType: 'NUMERIC(12,2)', rule: { kind: 'exact-decimal', sourcePrecision: 12, sourceScale: 2, targetPrecision: 12, targetScale: 2 } },
        ['123.456'],
      );
    }).toThrow(/scale|precision/i);
    expect(() => {
      assertMappingPreserves(
        { sourceType: 'NUMERIC(12,2)', targetType: 'NUMERIC(14,2)', rule: { kind: 'exact-decimal', sourcePrecision: 12, sourceScale: 2, targetPrecision: 14, targetScale: 2 } },
        ['123.45'],
      );
    }).not.toThrow();
  });
});

describe('reconciliation fails closed on any mismatch', () => {
  it('records data-integrity failure on tenant or checksum drift', () => {
    const source = { total: 4000, byTenant: { a: 2000, b: 2000 }, checksum: SHA };
    expect(() =>
      reconcileTransfer('tb-1', source, { total: 4000, byTenant: { a: 2001, b: 1999 }, checksum: SHA }),
    ).toThrow(MigrationIntegrityError);
    expect(() =>
      reconcileTransfer('tb-1', source, { total: 4000, byTenant: { a: 2000, b: 2000 }, checksum: 'f'.repeat(64) }),
    ).toThrow(MigrationIntegrityError);
    const report = reconcileTransfer('tb-1', source, { ...source, byTenant: { ...source.byTenant } });
    expect(report.passed).toBe(true);
  });

  it('labels qualified only with declared volume, reconciliation, and independent proof', () => {
    const frozen = profile();
    expect(labelTransfer(frozen, TB, true, true)).toBe('qualified');
    expect(labelTransfer(frozen, TB - 1, true, true)).toBe('probe-only');
    expect(labelTransfer(frozen, TB, false, true)).toBe('probe-only');
    expect(labelTransfer(frozen, TB, true, false)).toBe('probe-only');
  });
});
