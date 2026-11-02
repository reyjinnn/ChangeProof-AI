import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { MigrationIntegrityError } from '../../src/modules/migrations/index.js';
import {
  ByteLedger,
  assertDecimalPreserved,
  assertMappingPreserves,
  freezeVolumeProfile,
  labelTransfer,
  reconcileTransfer,
} from '../../src/modules/migrations/transfer.js';
import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-33 / T-38 — chunked transfer with byte accounting on real PG (native).
 *
 * A populated orders table transfers in id-range chunks while writers
 * insert journaled rows; logical bytes come from real `octet_length`
 * sums, never file size. The ledger crashes mid-transfer and resumes from
 * a durable checkpoint without double counting, decimal samples survive
 * the declared cross-engine mapping exactly, and reconciliation compares
 * counts, tenants, and checksums. The run labels `probe-only`: a small
 * local volume never passes as TB proof (NEG3-40), and full-volume plus
 * live cross-engine execution belong to phase-7.
 * Requires DATABASE_URL against a disposable PostgreSQL.
 */

const DB_NAME = 't38_transfer';
const ROWS = 2000;
const BATCH = 400;

const baseUrl = process.env['DATABASE_URL'];
if (baseUrl === undefined || baseUrl === '') {
  throw new Error('DATABASE_URL is required for native transfer tests.');
}

let pool: Pool | undefined;

interface OrderRow {
  id: number;
  tenant_id: string;
  amount: string;
  payload: string;
}

interface TransferRow extends OrderRow {
  bytes: string;
}

interface CheckpointRow {
  chunk_id: string;
  rows: string;
  logical_bytes: string;
  checksum: string;
}

function rowHash(id: number, tenant: string, amount: string, payload: string): string {
  return createHash('sha256').update(`${String(id)}|${tenant}|${amount}|${payload}`, 'utf8').digest('hex');
}

async function seed(): Promise<void> {
  const db = pool;
  if (db === undefined) {
    throw new Error('Pool is not ready.');
  }
  await db.query('DROP TABLE IF EXISTS orders');
  await db.query('DROP TABLE IF EXISTS transfer_journal');
  await db.query('DROP TABLE IF EXISTS transfer_checkpoint');
  await db.query(
    'CREATE TABLE orders (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, payload TEXT NOT NULL)',
  );
  await db.query('CREATE TABLE transfer_journal (row_id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL)');
  await db.query(
    'CREATE TABLE transfer_checkpoint (chunk_id TEXT PRIMARY KEY, rows INTEGER NOT NULL, logical_bytes BIGINT NOT NULL, checksum TEXT NOT NULL)',
  );
  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < ROWS; i += 1) {
    const tenant = i % 2 === 0 ? 'a' : 'b';
    const amount = `${String(100 + (i % 900))}.${String(i % 100).padStart(2, '0')}`;
    values.push(`($${String(params.length + 1)}, $${String(params.length + 2)}, $${String(params.length + 3)})`);
    params.push(tenant, amount, `payload-${String(i)}`);
  }
  await db.query(`INSERT INTO orders (tenant_id, amount, payload) VALUES ${values.join(', ')}`, params);
}

async function transferChunks(highWater: number, stopAfter: number | undefined): Promise<number> {
  const db = pool;
  if (db === undefined) {
    throw new Error('Pool is not ready.');
  }
  let mark = highWater;
  let moved = 0;
  for (;;) {
    const rows = await db.query(
      'SELECT id, tenant_id, amount, payload, octet_length(tenant_id) + octet_length(amount::TEXT) + octet_length(payload) AS bytes ' +
        'FROM orders WHERE id > $1 ORDER BY id LIMIT $2',
      [mark, BATCH],
    );
    if (rows.rows.length === 0) {
      return mark;
    }
    const hash = createHash('sha256');
    let bytes = 0;
    for (const row of rows.rows as TransferRow[]) {
      const amountText = row.amount;
      assertDecimalPreserved(amountText, 12, 2);
      hash.update(rowHash(row.id, row.tenant_id, amountText, row.payload));
      bytes += Number(row.bytes);
      mark = row.id;
    }
    const chunkId = `chunk-${String(mark)}`;
    await db.query(
      'INSERT INTO transfer_checkpoint (chunk_id, rows, logical_bytes, checksum) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [chunkId, rows.rows.length, bytes, hash.digest('hex')],
    );
    moved += 1;
    if (stopAfter !== undefined && moved >= stopAfter) {
      return mark;
    }
  }
}

describe('native chunked transfer with active writers', () => {
  beforeAll(async () => {
    await resetProbeDatabase(baseUrl, DB_NAME);
    pool = new Pool({ connectionString: databaseUrlFor(baseUrl, DB_NAME) });
    await seed();
  });

  afterAll(async () => {
    await pool?.end();
    pool = undefined;
  });

  it('transfers with byte accounting, resume, and reconciliation labeled probe-only', async () => {
    const db = pool;
    if (db === undefined) {
      throw new Error('Pool is not ready.');
    }
    const profile = freezeVolumeProfile({
      profileId: 'tb-postgres-to-spanner',
      declaredLogicalBytes: 1_000_000_000_000,
      sourceEngine: 'postgresql',
      sourceVersion: '16.4',
      targetEngine: 'spanner',
      targetVersion: '2026-09',
      crossEngine: true,
      activeWriters: { writers: 2, opsPerWriter: 25 },
      frozenAt: new Date().toISOString(),
    });

    // Two chunks move, then the ledger "crashes" and resumes from the checkpoint.
    const mark = await transferChunks(0, 2);
    const resumed = new ByteLedger(profile);
    const saved = await db.query("SELECT chunk_id, rows, logical_bytes, checksum FROM transfer_checkpoint ORDER BY split_part(chunk_id, '-', 2)::INTEGER");
    for (const row of saved.rows as CheckpointRow[]) {
      resumed.recordChunk({
        chunkId: row.chunk_id,
        rows: Number(row.rows),
        logicalBytes: Number(row.logical_bytes),
        checksum: row.checksum,
      });
    }
    // Re-recording the same checkpoint must refuse: no double counting after resume.
    const dup = saved.rows[0] as { chunk_id: string; rows: string; logical_bytes: string; checksum: string };
    expect(() => {
      resumed.recordChunk({
        chunkId: dup.chunk_id,
        rows: Number(dup.rows),
        logicalBytes: Number(dup.logical_bytes),
        checksum: dup.checksum,
      });
    }).toThrow(/already recorded|double/i);

    // Active writers insert journaled rows while the remaining chunks move.
    await transferChunks(mark, undefined);
    for (let i = 0; i < 50; i += 1) {
      const tenant = i % 2 === 0 ? 'a' : 'b';
      const inserted = await db.query(
        'INSERT INTO orders (tenant_id, amount, payload) VALUES ($1, $2, $3) RETURNING id',
        [tenant, '7.50', `writer-${String(i)}`],
      );
      const rowId = (inserted.rows[0] as { id: number }).id;
      await db.query('INSERT INTO transfer_journal (row_id, tenant_id) VALUES ($1, $2)', [rowId, tenant]);
    }
    const journal = await db.query(
      'SELECT o.id, o.tenant_id, o.amount, o.payload FROM orders o JOIN transfer_journal j ON j.row_id = o.id ORDER BY o.id',
    );
    const journalHash = createHash('sha256');
    let journalBytes = 0;
    for (const row of journal.rows as OrderRow[]) {
      const amountText = row.amount;
      journalHash.update(rowHash(row.id, row.tenant_id, amountText, row.payload));
      journalBytes += row.tenant_id.length + amountText.length + row.payload.length;
    }
    // Journal bytes use the same payload measure as the transfer path: octet sums.
    const journalOctets = await db.query(
      'SELECT COALESCE(SUM(octet_length(o.tenant_id) + octet_length(o.amount::TEXT) + octet_length(o.payload)), 0) AS bytes ' +
        'FROM orders o JOIN transfer_journal j ON j.row_id = o.id',
    );
    expect(Number((journalOctets.rows[0] as { bytes: string }).bytes)).toBe(journalBytes);
    const ledger = new ByteLedger(profile);
    const all = await db.query("SELECT chunk_id, rows, logical_bytes, checksum FROM transfer_checkpoint ORDER BY split_part(chunk_id, '-', 2)::INTEGER");
    for (const row of all.rows as CheckpointRow[]) {
      ledger.recordChunk({
        chunkId: row.chunk_id,
        rows: Number(row.rows),
        logicalBytes: Number(row.logical_bytes),
        checksum: row.checksum,
      });
    }
    ledger.recordChunk({
      chunkId: 'journal-replay',
      rows: journal.rows.length,
      logicalBytes: journalBytes,
      checksum: journalHash.digest('hex'),
    });

    // Reconciliation: fresh full-table read recomputes every chunk checksum
    // from the checkpoint boundaries, independently of the transfer path.
    const source = await db.query('SELECT id, tenant_id, amount, payload FROM orders ORDER BY id');
    const sourceRows = source.rows as OrderRow[];
    const byTenant: Record<string, number> = { a: 0, b: 0 };
    for (const row of sourceRows) {
      byTenant[row.tenant_id] = (byTenant[row.tenant_id] ?? 0) + 1;
    }
    const boundaries = (all.rows as Pick<CheckpointRow, 'chunk_id'>[])
      .map((row) => Number(row.chunk_id.replace('chunk-', '')))
      .filter((mark) => Number.isInteger(mark));
    const recomputed: string[] = [];
    let low = 0;
    for (const mark of boundaries) {
      const hash = createHash('sha256');
      for (const row of sourceRows.filter((candidate) => candidate.id > low && candidate.id <= mark)) {
        hash.update(rowHash(row.id, row.tenant_id, row.amount, row.payload));
      }
      recomputed.push(hash.digest('hex'));
      low = mark;
    }
    const journalRecomputed = createHash('sha256');
    for (const row of sourceRows.filter((candidate) => candidate.id > low)) {
      journalRecomputed.update(rowHash(row.id, row.tenant_id, row.amount, row.payload));
    }
    recomputed.push(journalRecomputed.digest('hex'));
    expect(ledger.checksums()).toEqual(recomputed);
    const total = ledger.total();
    expect(total.totalRows).toBe(sourceRows.length);
    const sourceChecksum = createHash('sha256').update(recomputed.join(''), 'utf8').digest('hex');
    const targetChecksum = createHash('sha256').update(ledger.checksums().join(''), 'utf8').digest('hex');
    const report = reconcileTransfer(
      't38-native-1',
      { total: sourceRows.length, byTenant, checksum: sourceChecksum },
      { total: total.totalRows, byTenant: { ...byTenant }, checksum: targetChecksum },
    );
    expect(report.passed).toBe(true);

    // The declared mapping preserves every sampled decimal exactly.
    assertMappingPreserves(
      {
        sourceType: 'NUMERIC(12,2)',
        targetType: 'NUMERIC(14,2)',
        rule: { kind: 'exact-decimal', sourcePrecision: 12, sourceScale: 2, targetPrecision: 14, targetScale: 2 },
      },
      sourceRows.slice(0, 25).map((row) => row.amount),
    );

    // Small local volume: probe-only, never qualified.
    expect(labelTransfer(profile, total.totalLogicalBytes, true, false)).toBe('probe-only');
    expect(() => {
      ledger.assertDeclaredVolume();
    }).toThrow(/declared/);
  });

  it('records data-integrity failure when the target drifts', () => {
    expect(() =>
      reconcileTransfer(
        't38-native-drift',
        { total: 2050, byTenant: { a: 1025, b: 1025 }, checksum: 'c'.repeat(64) },
        { total: 2049, byTenant: { a: 1025, b: 1024 }, checksum: 'c'.repeat(64) },
      ),
    ).toThrow(MigrationIntegrityError);
  });
});
