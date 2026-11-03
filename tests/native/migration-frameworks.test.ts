import { writeFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { runNative } from '../../src/modules/adapters/native/process.js';
import { MigrationRunner, type MigrationDb } from '../../src/modules/migrations/index.js';
import { createFixture } from '../adapters/fixtures.js';
import { runPlannedCheck } from '../adapters/native-exec.js';
import { databaseUrlFor, pick, resetProbeDatabase } from './db.js';

/**
 * T-23 native: framework migration capability cases (WP3-10 slice).
 *
 * Real `prisma migrate deploy` and real `alembic upgrade head` expand
 * disposable databases; the module backfills, reconciles, and contracts;
 * real Pydantic strict models validate the migrated rows. Requires
 * DATABASE_URL against a disposable PostgreSQL.
 */

const PRISMA_DB = 't23_prisma';
const ALEMBIC_DB = 't23_alembic';

const baseUrl = process.env['DATABASE_URL'];
if (baseUrl === undefined || baseUrl === '') {
  throw new Error('DATABASE_URL is required for native migration tests.');
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

async function validateRowsStrict(
  cwd: string,
  rowsPath: string,
  model: string,
  negativeValue: string,
): Promise<{ count: number }> {
  const script = [
    'import json, sys',
    'from pydantic import BaseModel, StrictInt, StrictStr, TypeAdapter',
    '',
    '',
    model,
    '',
    'rows = json.load(open(sys.argv[1]))',
    'validated = TypeAdapter(list[Row]).validate_python(rows)',
    'print(len(validated))',
    '',
  ].join('\n');
  const scriptPath = `${cwd}/validate_rows.py`;
  writeFileSync(scriptPath, script, 'utf8');
  const ok = await runNative('python', [scriptPath, rowsPath], {
    cwd,
    timeoutMs: 60_000,
    maxOutputBytes: 16_000,
  });
  expect(ok.exitCode, ok.stderr).toBe(0);
  const badPath = `${cwd}/rows_bad.json`;
  writeFileSync(badPath, negativeValue, 'utf8');
  const bad = await runNative('python', [scriptPath, badPath], {
    cwd,
    timeoutMs: 60_000,
    maxOutputBytes: 16_000,
  });
  expect(bad.exitCode).not.toBe(0);
  expect(bad.stderr).toContain('ValidationError');
  return { count: Number(ok.stdout.trim()) };
}

describe('prisma expand + module backfill + pydantic validation', () => {
  let pool: Pool | undefined;

  beforeAll(async () => {
    await resetProbeDatabase(baseUrl, PRISMA_DB);
    pool = new Pool({ connectionString: databaseUrlFor(baseUrl, PRISMA_DB), max: 2 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it(
    'deploys a real prisma migration, backfills, contracts, validates strictly',
    { timeout: 300_000 },
    async () => {
      if (pool === undefined) throw new Error('pool is not ready');
      const live: Pool = pool;
      const dbUrl = databaseUrlFor(baseUrl, PRISMA_DB);
      const fixture = createFixture({
        'prisma/schema.prisma': [
          'datasource db {',
          '  provider = "postgresql"',
          `  url      = "${dbUrl}"`,
          '}',
          '',
          'generator client {',
          '  provider = "prisma-client-js"',
          '}',
          '',
          'model Item {',
          '  id       BigInt @id @default(autoincrement())',
          '  tenantId String @map("tenant_id")',
          '  sku      String',
          '  qty      Int    @map("qty")',
          '  quantity Int?',
          '  @@map("items")',
          '}',
          '',
        ].join('\n'),
        'prisma/migrations/0001_init/migration.sql': [
          'CREATE TABLE items (id BIGSERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, sku TEXT NOT NULL, qty INTEGER NOT NULL, quantity INTEGER NULL);',
          '',
        ].join('\n'),
      });
      try {
        const deployed = await runPlannedCheck({
          command: 'prisma',
          args: ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
          cwd: fixture.root,
        });
        expect(deployed.exitCode, deployed.stdout + deployed.stderr).toBe(0);
        const history = await live.query(
          'SELECT migration_name AS version, checksum FROM _prisma_migrations ORDER BY migration_name',
        );
        expect(history.rows).toHaveLength(1);
        const baseline = history.rows.map((row) => ({
          version: String((row as Record<string, unknown>)['version']),
          checksum: String((row as Record<string, unknown>)['checksum']),
        }));
        await live.query(
          `CREATE TABLE op_journal (op_seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, op_id TEXT UNIQUE NOT NULL, op_kind TEXT NOT NULL, row_id BIGINT NOT NULL, tenant_id TEXT NOT NULL)`,
        );
        const values: string[] = [];
        const params: unknown[] = [];
        for (let i = 0; i < 500; i++) {
          values.push(`($${params.length + 1}, $${params.length + 2}, $${params.length + 3})`);
          params.push(pick(['acme', 'globex'] as const, i), `sku-${i}`, (i * 7) % 1000);
        }
        await live.query(`INSERT INTO items (tenant_id, sku, qty) VALUES ${values.join(',')}`, params);
        const runner = new MigrationRunner(wrapPool(live), {
          schemaVersion: '1',
          migrationId: 't23-prisma-items-1',
          table: 'items',
          idColumn: 'id',
          batchSize: 200,
          expandSql: [],
          backfillSql: 'UPDATE items SET quantity = qty WHERE id > $1 AND id <= $2 AND quantity IS NULL',
          remainingSql: 'SELECT COUNT(*)::TEXT AS count FROM items WHERE quantity IS NULL',
          contractSql: ['ALTER TABLE items DROP COLUMN qty'],
          journal: {
            table: 'op_journal',
            seqColumn: 'op_seq',
            idColumn: 'op_id',
            kindColumn: 'op_kind',
            rowColumn: 'row_id',
            tenantColumn: 'tenant_id',
          },
          verify: {
            nullColumns: ['quantity'],
            sumChecks: [{ oldColumn: 'qty', newColumn: 'quantity', factor: 1 }],
            tenantColumn: 'tenant_id',
          },
          history: {
            table: '_prisma_migrations',
            versionColumn: 'migration_name',
            checksumColumn: 'checksum',
            baseline,
          },
        });
        await runner.expand();
        const done = await runner.runToCompletion();
        expect(done.completed).toBe(true);
        const report = await runner.verifyIntegrity();
        expect(report.passed).toBe(true);
        const contracted = await runner.contract();
        expect(contracted.passed).toBe(true);
        const dumped = await live.query(
          'SELECT id::INTEGER AS id, tenant_id, sku, quantity FROM items ORDER BY id',
        );
        const rowsPath = `${fixture.root}/items.json`;
        writeFileSync(rowsPath, JSON.stringify(dumped.rows), 'utf8');
        const validated = await validateRowsStrict(
          fixture.root,
          rowsPath,
          'class Row(BaseModel):\n    id: StrictInt\n    tenant_id: StrictStr\n    sku: StrictStr\n    quantity: StrictInt',
          JSON.stringify([{ id: 'not-an-int', tenant_id: 'acme', sku: 'x', quantity: 1 }]),
        );
        expect(validated.count).toBe(500);
      } finally {
        fixture.cleanup();
      }
    },
  );
});

describe('alembic expand + module backfill + pydantic validation', () => {
  let pool: Pool | undefined;

  beforeAll(async () => {
    await resetProbeDatabase(baseUrl, ALEMBIC_DB);
    pool = new Pool({ connectionString: databaseUrlFor(baseUrl, ALEMBIC_DB), max: 2 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it(
    'upgrades a real alembic revision, backfills, contracts, validates strictly',
    { timeout: 300_000 },
    async () => {
      if (pool === undefined) throw new Error('pool is not ready');
      const live: Pool = pool;
      const dbUrl = databaseUrlFor(baseUrl, ALEMBIC_DB);
      const fixture = createFixture({
        'alembic_ws/alembic.ini': [
          '[alembic]',
          'script_location = %(here)s',
          `sqlalchemy.url = ${dbUrl}`,
          '',
        ].join('\n'),
        'alembic_ws/env.py': [
          'from alembic import context',
          'from sqlalchemy import create_engine',
          '',
          'config = context.config',
          'engine = create_engine(config.get_main_option("sqlalchemy.url"))',
          'with engine.connect() as connection:',
          '    context.configure(connection=connection, target_metadata=None)',
          '    with context.begin_transaction():',
          '        context.run_migrations()',
          '',
        ].join('\n'),
        'alembic_ws/versions/0001_create_widgets.py': [
          "revision = '0001'",
          'down_revision = None',
          '',
          'from alembic import op',
          'import sqlalchemy as sa',
          '',
          '',
          'def upgrade():',
          "    op.create_table('widgets',",
          '        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),',
          '        sa.Column("tenant_id", sa.Text(), nullable=False),',
          '        sa.Column("cost_cents", sa.Integer(), nullable=False))',
          '',
          '',
          'def downgrade():',
          "    op.drop_table('widgets')",
          '',
        ].join('\n'),
      });
      try {
        const upgraded = await runNative('python', ['-m', 'alembic', '-c', 'alembic_ws/alembic.ini', 'upgrade', 'head'], {
          cwd: fixture.root,
          timeoutMs: 120_000,
          maxOutputBytes: 32_000,
        });
        expect(upgraded.exitCode, upgraded.stdout + upgraded.stderr).toBe(0);
        const version = await live.query('SELECT version_num AS version FROM alembic_version');
        expect(version.rows).toHaveLength(1);
        expect((version.rows[0] as Record<string, unknown>)['version']).toBe('0001');
        // Framework recovery: downgrade removes, upgrade restores.
        const down = await runNative('python', ['-m', 'alembic', '-c', 'alembic_ws/alembic.ini', 'downgrade', '-1'], {
          cwd: fixture.root,
          timeoutMs: 120_000,
          maxOutputBytes: 32_000,
        });
        expect(down.exitCode, down.stdout + down.stderr).toBe(0);
        const up = await runNative('python', ['-m', 'alembic', '-c', 'alembic_ws/alembic.ini', 'upgrade', 'head'], {
          cwd: fixture.root,
          timeoutMs: 120_000,
          maxOutputBytes: 32_000,
        });
        expect(up.exitCode, up.stdout + up.stderr).toBe(0);
        await live.query(
          `CREATE TABLE op_journal (op_seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, op_id TEXT UNIQUE NOT NULL, op_kind TEXT NOT NULL, row_id BIGINT NOT NULL, tenant_id TEXT NOT NULL)`,
        );
        const values: string[] = [];
        const params: unknown[] = [];
        for (let i = 0; i < 300; i++) {
          values.push(`($${params.length + 1}, $${params.length + 2})`);
          params.push(pick(['acme', 'globex'] as const, i), (i * 11) % 5000);
        }
        await live.query(`INSERT INTO widgets (tenant_id, cost_cents) VALUES ${values.join(',')}`, params);
        const runner = new MigrationRunner(wrapPool(live), {
          schemaVersion: '1',
          migrationId: 't23-alembic-widgets-1',
          table: 'widgets',
          idColumn: 'id',
          batchSize: 200,
          expandSql: ['ALTER TABLE widgets ADD COLUMN IF NOT EXISTS amount_cents INTEGER'],
          backfillSql: 'UPDATE widgets SET amount_cents = cost_cents WHERE id > $1 AND id <= $2 AND amount_cents IS NULL',
          remainingSql: 'SELECT COUNT(*)::TEXT AS count FROM widgets WHERE amount_cents IS NULL',
          contractSql: ['ALTER TABLE widgets DROP COLUMN cost_cents'],
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
            sumChecks: [{ oldColumn: 'cost_cents', newColumn: 'amount_cents', factor: 1 }],
            tenantColumn: 'tenant_id',
          },
        });
        await runner.expand();
        const done = await runner.runToCompletion();
        expect(done.completed).toBe(true);
        const report = await runner.verifyIntegrity();
        expect(report.passed).toBe(true);
        const contracted = await runner.contract();
        expect(contracted.passed).toBe(true);
        const dumped = await live.query(
          'SELECT id::INTEGER AS id, tenant_id, amount_cents FROM widgets ORDER BY id',
        );
        const rowsPath = `${fixture.root}/widgets.json`;
        writeFileSync(rowsPath, JSON.stringify(dumped.rows), 'utf8');
        const validated = await validateRowsStrict(
          fixture.root,
          rowsPath,
          'class Row(BaseModel):\n    id: StrictInt\n    tenant_id: StrictStr\n    amount_cents: StrictInt',
          JSON.stringify([{ id: 1, tenant_id: 'acme' }]),
        );
        expect(validated.count).toBe(300);
      } finally {
        fixture.cleanup();
      }
    },
  );
});
