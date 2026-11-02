import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import {
  MigrationIntegrityError,
  MigrationManifestSchema,
  MigrationRunner,
  type MigrationDb,
  type MigrationManifest,
} from '../../src/modules/migrations/index.js';
import { databaseUrlFor, pick, resetProbeDatabase } from './db.js';

/**
 * T-23 native: populated online migration with active writers (SC3-03)
 * and integrity-failure recording (NEG3-05).
 *
 * A 2000-row orders table migrates total_cents/price_cents to
 * amount_cents/price while writers dual-write and journal every op.
 * The runner crashes between chunks (instance dropped, new runner
 * resumes from the durable checkpoint) and the test proves no lost
 * acknowledged write, exact precision, and preserved tenant mapping.
 * Requires DATABASE_URL against a disposable PostgreSQL.
 */

const DB_NAME = 't23_online';

const baseUrl = process.env['DATABASE_URL'];
if (baseUrl === undefined || baseUrl === '') {
  throw new Error('DATABASE_URL is required for native migration tests.');
}

let pool: Pool | undefined;
let db: MigrationDb;

function manifest(
  table = 'orders',
  journalTable = 'op_journal',
  migrationId = 't23-orders-backfill-1',
): MigrationManifest {
  return MigrationManifestSchema.parse({
    schemaVersion: '1',
    migrationId,
    table,
    idColumn: 'id',
    batchSize: 400,
    expandSql: [
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS amount_cents INTEGER`,
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS price NUMERIC(12,2)`,
    ],
    backfillSql:
      `UPDATE ${table} SET amount_cents = total_cents, price = price_cents / 100.0 ` +
      'WHERE id > $1 AND id <= $2 AND (amount_cents IS NULL OR price IS NULL)',
    remainingSql: `SELECT COUNT(*)::TEXT AS count FROM ${table} WHERE amount_cents IS NULL OR price IS NULL`,
    contractSql: [`ALTER TABLE ${table} DROP COLUMN total_cents`, `ALTER TABLE ${table} DROP COLUMN price_cents`],
    journal: {
      table: journalTable,
      seqColumn: 'op_seq',
      idColumn: 'op_id',
      kindColumn: 'op_kind',
      rowColumn: 'row_id',
      tenantColumn: 'tenant_id',
    },
    verify: {
      nullColumns: ['amount_cents', 'price'],
      sumChecks: [
        { oldColumn: 'total_cents', newColumn: 'amount_cents', factor: 1 },
        { oldColumn: 'price_cents', newColumn: 'price', factor: 100 },
      ],
      tenantColumn: 'tenant_id',
    },
  });
}

async function setupTables(target: Pool, table: string, journalTable: string, rows: number): Promise<void> {
  await target.query(`DROP TABLE IF EXISTS ${table}`);
  await target.query(`DROP TABLE IF EXISTS ${journalTable}`);
  await target.query(
    `CREATE TABLE ${table} (id BIGSERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, total_cents INTEGER NOT NULL, price_cents INTEGER NOT NULL, name TEXT NOT NULL)`,
  );
  await target.query(
    `CREATE TABLE ${journalTable} (op_seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, op_id TEXT UNIQUE NOT NULL, op_kind TEXT NOT NULL, row_id BIGINT NOT NULL, tenant_id TEXT NOT NULL)`,
  );
  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < rows; i++) {
    const tenant = pick(['acme', 'globex', 'initech'] as const, i);
    const total = pick([0, 1, 99, 10_000, 999_999] as const, i);
    const price = pick([0, 5, 250, 49_99, 12_00] as const, i);
    const name = pick([`order-${i}`, `ünïcodé-${i}`, `  padded ${i}  `] as const, i);
    values.push(`($${params.length + 1}, $${params.length + 2}, $${params.length + 3}, $${params.length + 4})`);
    params.push(tenant, total, price, name);
  }
  await target.query(`INSERT INTO ${table} (tenant_id, total_cents, price_cents, name) VALUES ${values.join(',')}`, params);
}

let opCounter = 0;

async function writerOp(target: Pool, table: string, journalTable: string, maxId: number): Promise<void> {
  const op = opCounter++;
  const client = await target.connect();
  try {
    await client.query('BEGIN');
    const kind = op % 7;
    if (kind < 4) {
      const tenant = pick(['acme', 'globex', 'initech'] as const, op);
      const total = (op * 37) % 50_000;
      const price = (op * 13) % 9_999;
      const inserted = await client.query(
        `INSERT INTO ${table} (tenant_id, total_cents, price_cents, name, amount_cents, price) VALUES ($1, $2, $3, $4, $2, $5) RETURNING id`,
        [tenant, total, price, `live-${op}`, (price / 100).toString()],
      );
      const id = (inserted.rows[0] as Record<string, unknown>)['id'];
      await client.query(
        `INSERT INTO ${journalTable} (op_id, op_kind, row_id, tenant_id) VALUES ($1, 'insert', $2, $3)`,
        [`op-${op}`, id, tenant],
      );
    } else if (kind < 6) {
      const id = 1 + ((op * 7919) % maxId);
      const existing = await client.query(`SELECT tenant_id AS tenant FROM ${table} WHERE id = $1`, [id]);
      if (existing.rows.length > 0) {
        const total = (op * 101) % 50_000;
        const price = (op * 57) % 9_999;
        await client.query(
          `UPDATE ${table} SET total_cents = $1, amount_cents = $1, price_cents = $2, price = $3 WHERE id = $4`,
          [total, price, (price / 100).toString(), id],
        );
        await client.query(
          `INSERT INTO ${journalTable} (op_id, op_kind, row_id, tenant_id) VALUES ($1, 'update', $2, $3)`,
          [`op-${op}`, id, String((existing.rows[0] as Record<string, unknown>)['tenant'])],
        );
      }
    } else {
      const id = 1 + ((op * 104729) % maxId);
      const row = await client.query(`SELECT tenant_id AS tenant FROM ${table} WHERE id = $1`, [id]);
      if (row.rows.length > 0) {
        await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        await client.query(
          `INSERT INTO ${journalTable} (op_id, op_kind, row_id, tenant_id) VALUES ($1, 'delete', $2, $3)`,
          [`op-${op}`, id, String((row.rows[0] as Record<string, unknown>)['tenant'])],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readerCheck(target: Pool): Promise<void> {
  const rows = await target.query(
    'SELECT total_cents, amount_cents, price_cents, price FROM orders ORDER BY id DESC LIMIT 25',
  );
  for (const row of rows.rows as Record<string, unknown>[]) {
    if (row['amount_cents'] !== null) {
      expect(Number(row['amount_cents'])).toBe(Number(row['total_cents']));
    }
    if (row['price'] !== null) {
      expect(Math.round(Number(row['price']) * 100)).toBe(Number(row['price_cents']));
    }
  }
}

function wrapPool(target: Pool): MigrationDb {
  return {
    query: async (text, params) => {
      const result = await target.query(text, params === undefined ? undefined : [...params]);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount };
    },
    connect: async () => {
      const client = await target.connect();
      return {
        query: async (text: string, params?: readonly unknown[]) => {
          const result = await client.query(text, params === undefined ? undefined : [...params]);
          return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount };
        },
        release: () => { client.release(); },
      };
    },
  };
}

beforeAll(async () => {
  await resetProbeDatabase(baseUrl, DB_NAME);
  pool = new Pool({ connectionString: databaseUrlFor(baseUrl, DB_NAME), max: 4 });
  db = wrapPool(pool);
  await setupTables(pool, 'orders', 'op_journal', 2000);
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe('SC3-03 populated online migration', () => {
  it(
    'migrates with writers, crash-resume, reconciliation, and proven recovery',
    { timeout: 300_000 },
    async () => {
      if (pool === undefined) throw new Error('pool is not ready');
      const live: Pool = pool;
      let runner = new MigrationRunner(db, manifest());
      await runner.expand();
      const maxIdResult = await live.query('SELECT MAX(id)::TEXT AS max FROM orders');
      const maxId = Number((maxIdResult.rows[0] as Record<string, unknown>)['max']);
      for (let round = 0; round < 5; round++) {
        const result = await runner.runNextChunk();
        expect(result.chunksCompleted).toBe(round + 1);
        for (let w = 0; w < 40; w++) {
          await writerOp(live, 'orders', 'op_journal', maxId);
        }
        await readerCheck(live);
        if (round === 1) {
          // Crash between chunks: drop the instance, resume from the checkpoint.
          runner = new MigrationRunner(db, manifest());
        }
        if (result.done) break;
      }
      // Drain with writers still active; dual-written rows never reopen the backlog.
      let completed = false;
      for (let round = 0; round < 30 && !completed; round++) {
        const result = await runner.runNextChunk();
        completed = result.done;
        for (let w = 0; w < 20; w++) {
          await writerOp(live, 'orders', 'op_journal', maxId);
        }
      }
      expect(completed).toBe(true);
      const report = await runner.verifyIntegrity();
      expect(report.passed).toBe(true);
      expect(report.checks.map((check) => check.name).sort()).toEqual(
        [
          'exact_sum:price_cents->price',
          'exact_sum:total_cents->amount_cents',
          'journal_delete_absent',
          'journal_insert_present',
          'journal_kinds',
          'journal_update_present',
          'no_nulls:amount_cents',
          'no_nulls:price',
          'row_counts',
          'tenant_mapping',
        ].sort(),
      );
      await live.query('CREATE TABLE orders_contract_snapshot AS SELECT id, total_cents, price_cents FROM orders');
      const contracted = await runner.contract();
      expect(contracted.passed).toBe(true);
      const columns = await live.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'",
      );
      const names = columns.rows.map((row) => (row as Record<string, unknown>)['column_name']);
      expect(names).not.toContain('total_cents');
      expect(names).not.toContain('price_cents');
      // Recovery: restore the old columns from the snapshot and re-verify.
      await live.query('ALTER TABLE orders ADD COLUMN total_cents INTEGER, ADD COLUMN price_cents INTEGER');
      await live.query(
        'UPDATE orders o SET total_cents = s.total_cents, price_cents = s.price_cents FROM orders_contract_snapshot s WHERE s.id = o.id',
      );
      const recovered = await runner.verifyIntegrity();
      expect(recovered.passed).toBe(true);
    },
  );
});

describe('NEG3-05 integrity failure is recorded, never fixed', () => {
  it('fails verification and refuses contract on tampered data', { timeout: 120_000 }, async () => {
    if (pool === undefined) throw new Error('pool is not ready');
    const live: Pool = pool;
    await setupTables(live, 'orders_neg', 'op_journal_neg', 200);
    const runner = new MigrationRunner(db, manifest('orders_neg', 'op_journal_neg', 't23-orders-neg-1'));
    await runner.expand();
    const done = await runner.runToCompletion();
    expect(done.completed).toBe(true);
    await live.query('DELETE FROM orders_neg WHERE id IN (SELECT id FROM orders_neg ORDER BY id LIMIT 3)');
    await live.query('UPDATE orders_neg SET amount_cents = NULL WHERE id IN (SELECT id FROM orders_neg ORDER BY id LIMIT 2)');
    await live.query("UPDATE orders_neg SET tenant_id = 'acme' WHERE tenant_id = 'globex'");
    const report = await runner.verifyIntegrity();
    expect(report.passed).toBe(false);
    const failing = report.checks.filter((check) => !check.passed).map((check) => check.name);
    expect(failing).toContain('row_counts');
    expect(failing).toContain('no_nulls:amount_cents');
    expect(failing).toContain('tenant_mapping');
    await expect(runner.contract()).rejects.toThrow(MigrationIntegrityError);
    try {
      await runner.contract();
      expect.unreachable('contract must refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationIntegrityError);
      expect((error as MigrationIntegrityError).report.passed).toBe(false);
    }
  });
});
