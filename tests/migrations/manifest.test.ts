import { describe, expect, it } from 'vitest';

import {
  HistoryRewriteError,
  MigrationManifestSchema,
  assertHistoryAppendOnly,
  type MigrationManifest,
} from '../../src/modules/migrations/index.js';

/**
 * T-23: migration manifest validation + applied-history protection
 * (WP3-10 slice, FR3-11.8, NEG3-07).
 *
 * The manifest is the frozen, trusted description of a migration. Anything
 * it cannot describe precisely — unvalidated identifiers, a backfill
 * without high-water bounds, a rewritten history — fails before any
 * database is touched.
 */

function manifest(overrides: Record<string, unknown> = {}): MigrationManifest {
  return MigrationManifestSchema.parse({
    schemaVersion: '1',
    migrationId: 'orders-amount-backfill-1',
    table: 'orders',
    idColumn: 'id',
    batchSize: 500,
    expandSql: ['ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_cents INTEGER'],
    backfillSql:
      'UPDATE orders SET amount_cents = total_cents WHERE id > $1 AND id <= $2 AND amount_cents IS NULL',
    remainingSql: 'SELECT COUNT(*)::TEXT AS count FROM orders WHERE amount_cents IS NULL',
    contractSql: ['ALTER TABLE orders DROP COLUMN total_cents'],
    journal: {
      table: 'op_journal',
      seqColumn: 'op_seq',
      idColumn: 'op_id',
      kindColumn: 'op_kind',
      rowColumn: 'row_id',
      tenantColumn: 'tenant_id',
    },
    verify: {
      nullColumns: ['amount_cents'],
      sumChecks: [{ oldColumn: 'total_cents', newColumn: 'amount_cents', factor: 1 }],
      tenantColumn: 'tenant_id',
    },
    ...overrides,
  });
}

describe('MigrationManifestSchema fails closed', () => {
  it('accepts a well-formed manifest', () => {
    expect(manifest().migrationId).toBe('orders-amount-backfill-1');
  });

  it('rejects unknown schema versions and bad identifiers', () => {
    expect(() => manifest({ schemaVersion: '2' })).toThrow();
    expect(() => manifest({ table: 'orders; DROP TABLE orders' })).toThrow();
    expect(() => manifest({ idColumn: 'id DESC' })).toThrow();
    expect(() => manifest({ migrationId: 'Orders Backfill!' })).toThrow();
  });

  it('rejects a backfill without high-water bounds', () => {
    expect(() => manifest({ backfillSql: 'UPDATE orders SET amount_cents = total_cents' })).toThrow();
    expect(() =>
      manifest({ backfillSql: 'UPDATE orders SET amount_cents = 1 WHERE id > $1' }),
    ).toThrow();
  });

  it('rejects absurd batch sizes and empty step lists', () => {
    expect(() => manifest({ batchSize: 0 })).toThrow();
    expect(() => manifest({ batchSize: 1_000_000 })).toThrow();
    expect(() => manifest({ contractSql: [] })).toThrow();
  });

  it('allows an external-only expand only with a pinned history baseline', () => {
    expect(() => manifest({ expandSql: [] })).toThrow();
    expect(() =>
      manifest({
        expandSql: [],
        history: {
          table: '_prisma_migrations',
          versionColumn: 'migration_name',
          checksumColumn: 'checksum',
          baseline: [{ version: '0001_init', checksum: 'abc' }],
        },
      }),
    ).not.toThrow();
  });
});

describe('assertHistoryAppendOnly protects applied history (FR3-11.8)', () => {
  const baseline = [
    { version: '0001_init', checksum: 'aaa' },
    { version: '0002_orders', checksum: 'bbb' },
  ];

  it('accepts appended history', () => {
    expect(() => { assertHistoryAppendOnly(baseline, [...baseline, { version: '0003_items', checksum: 'ccc' }]); },
    ).not.toThrow();
    expect(() => { assertHistoryAppendOnly(baseline, baseline); }).not.toThrow();
  });

  it('rejects a rewritten checksum or a removed version (NEG3-07)', () => {
    expect(() => { assertHistoryAppendOnly(baseline, [
        { version: '0001_init', checksum: 'zzz' },
        { version: '0002_orders', checksum: 'bbb' },
      ]); },
    ).toThrow(HistoryRewriteError);
    expect(() => { assertHistoryAppendOnly(baseline, [{ version: '0002_orders', checksum: 'bbb' }]); }).toThrow(
      HistoryRewriteError,
    );
    try {
      assertHistoryAppendOnly(baseline, [{ version: '0001_init', checksum: 'aaa' }]);
      expect.unreachable('removed version must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HistoryRewriteError);
      expect((error as HistoryRewriteError).versions).toEqual(['0002_orders']);
    }
  });
});
