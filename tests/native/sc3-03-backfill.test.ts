import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CanonicalObjectHash,
  ExperimentPlanSchema,
  TrialReceiptSchema,
  type ExperimentPlan,
  type TrialReceipt,
} from '../../src/core/index.js';
import {
  MigrationRunner,
  type MigrationDb,
  type MigrationManifest,
} from '../../src/modules/migrations/index.js';
import { summarizeCampaign } from '../../src/modules/verifier/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-18 / T-26 — SC3-03 active backfill with crash and writer conflict.
 *
 * Real PostgreSQL 16 (disposable container), real concurrent writers, a real
 * terminated backend for the crash window. The backfill commits chunk rows and
 * progress atomically, so crash-before-commit rolls back cleanly and resume
 * continues from the durable checkpoint; every chunk asserts the merged
 * window (no unbackfilled row at or below the high-water mark). Writers use
 * expand-phase dual writes plus an acknowledged journal; skipping either is
 * caught by semantic reconciliation. Receipts land in runs/sc3-18/.
 */

function requireDb(): string {
  const db = process.env['DATABASE_URL'];
  if (db === undefined || db.length === 0) {
    throw new Error('DATABASE_URL is required; start the disposable PostgreSQL container first.');
  }
  return db;
}

const databaseUrl = requireDb();
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');

const fileDbUrl = databaseUrlFor(databaseUrl, 't_sc3_03');
const admin = new Pool({ connectionString: fileDbUrl });
const pool = new Pool({ connectionString: fileDbUrl });
pool.on('error', () => undefined);

const CANDIDATE = 'd'.repeat(64);
const ENVIRONMENT = 'disposable:postgres:16-alpine:t_sc3_03';

function migrationDb(): MigrationDb {
  return {
    query: (text, params) =>
      pool.query(text, [...(params ?? [])]).then((r) => ({
        rows: r.rows as Record<string, unknown>[],
        rowCount: r.rowCount,
      })),
    connect: async () => {
      const client = await pool.connect();
      // The crash trial terminates a backend on purpose; the socket error is
      // expected and asserted via the rejected chunk, never uncaught.
      client.on('error', () => undefined);
      return {
        query: (text, params) =>
          client.query(text, [...(params ?? [])]).then((r) => ({
            rows: r.rows as Record<string, unknown>[],
            rowCount: r.rowCount,
          })),
        release: () => {
          client.release();
        },
      };
    },
  };
}

const SCHEMA = `
DROP TABLE IF EXISTS backfill_orders;
DROP TABLE IF EXISTS op_journal;
DROP TABLE IF EXISTS changeproof_migration_progress;
CREATE TABLE backfill_orders(
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE op_journal(
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  row_data JSONB NOT NULL DEFAULT '{}',
  tenant TEXT NOT NULL
);`;

function manifest(backfillSql: string): MigrationManifest {
  return {
    schemaVersion: '1',
    migrationId: 'sc3-03-backfill',
    table: 'backfill_orders',
    idColumn: 'id',
    batchSize: 25,
    expandSql: ['ALTER TABLE backfill_orders ADD COLUMN IF NOT EXISTS amount_minor INTEGER'],
    backfillSql,
    remainingSql: 'SELECT COUNT(*) FROM backfill_orders WHERE amount_minor IS NULL AND deleted = FALSE',
    contractSql: ['ALTER TABLE backfill_orders ALTER COLUMN amount_minor SET NOT NULL'],
    journal: {
      table: 'op_journal',
      seqColumn: 'seq',
      idColumn: 'order_id',
      kindColumn: 'kind',
      rowColumn: 'order_id',
      tenantColumn: 'tenant',
    },
    verify: {
      nullColumns: ['amount_minor'],
      sumChecks: [{ oldColumn: 'amount_cents', newColumn: 'amount_minor', factor: 1 }],
      tenantColumn: 'tenant',
    },
  };
}

const BACKFILL =
  'UPDATE backfill_orders SET amount_minor = amount_cents ' +
  'WHERE id > $1 AND id <= $2 AND amount_minor IS NULL AND deleted = FALSE';
const BACKFILL_SLOW =
  'UPDATE backfill_orders SET amount_minor = amount_cents FROM (SELECT pg_sleep(3)) AS pace ' +
  'WHERE id > $1 AND id <= $2 AND amount_minor IS NULL AND deleted = FALSE';

function frozenPlan(scenario: string, seeds: readonly number[]): ExperimentPlan {
  const body = {
    schemaVersion: '1' as const,
    planVersion: 1,
    subjects: [{ kind: 'migration' as const, id: 'sc3-03-backfill' }],
    workload: { arrivalDistribution: 'steady' as const, concurrency: 4, dataSkew: 'low' as const },
    resetSemantics: 'fresh-database-per-trial' as const,
    seeds: [...seeds],
    intendedSchedules: [{ id: 'sched-backfill', faultStartMs: 0, faultDurationMs: 0, faultTarget: 'none' }],
    observations: ['journal-reconciliation', 'chunk-progress'],
    trialUnit: 'trial' as const,
    n: 1,
    warmupTrials: 0,
    measurementWindow: { kind: 'fixed' as const, durationMs: 120_000 },
    thresholds: [
      { metricId: 'backfill-chunk-commit-ms', statistic: 'max' as const, comparison: 'lt' as const, value: 60000, unit: 'ms' },
    ],
    stopRules: [{ kind: 'stop' as const, afterTrials: 1 }],
    forecast: { estimatedCostUsd: 0, estimatedWallTimeMs: 120_000 },
    claimEnvelope: scenario,
  };
  return ExperimentPlanSchema.parse({ ...body, planHash: CanonicalObjectHash.of(body).digest });
}

function trialReceipt(plan: ExperimentPlan, seed: number, extra: Partial<TrialReceipt> = {}): TrialReceipt {
  return TrialReceiptSchema.parse({
    schemaVersion: '1',
    planHash: plan.planHash,
    candidateBundleDigest: CANDIDATE,
    environmentIdentity: ENVIRONMENT,
    actualSeed: seed,
    actualSchedule: { id: 'sched-backfill', appliedAtMs: 0, removedAtMs: 0 },
    faultApplied: false,
    faultRemoved: false,
    counts: { planned: 1, completed: 1, failed: 0, invalid: 0, censored: 0, notRun: 0 },
    result: 'pass',
    telemetryRefs: [`runs/sc3-18/sc3-03-seed-${seed}.json`],
    ...extra,
  });
}

function writeReceipts(name: string, payload: unknown): void {
  const runDir = join(rootDir, 'runs', 'sc3-18', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, name), JSON.stringify(payload, null, 2));
}

async function seedCorpus(rows: number): Promise<void> {
  await admin.query(SCHEMA);
  for (let i = 0; i < rows; i++) {
    const tenant = i % 2 === 0 ? 'tenant-a' : 'tenant-b';
    const amount = i % 10 === 0 ? 0 : (i * 37 + 11) % 100000;
    await admin.query('INSERT INTO backfill_orders(tenant, amount_cents) VALUES ($1, $2)', [tenant, amount]);
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function progressChunks(): Promise<{ chunks: number; highWater: number }> {
  const result = await admin.query(
    'SELECT chunks_completed AS chunks, high_water_mark AS hwm FROM changeproof_migration_progress WHERE migration_id = $1',
    ['sc3-03-backfill'],
  );
  const row = result.rows[0] as { chunks: string; hwm: string } | undefined;
  if (row === undefined) return { chunks: 0, highWater: 0 };
  return { chunks: Number(row.chunks), highWater: Number(row.hwm) };
}

async function assertMergedWindow(highWater: number): Promise<void> {
  const result = await admin.query(
    'SELECT COUNT(*)::TEXT AS count FROM backfill_orders WHERE id <= $1 AND amount_minor IS NULL AND deleted = FALSE',
    [highWater],
  );
  const count = (result.rows[0] as { count: string }).count;
  expect(count).toBe('0');
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_sc3_03');
}, 30_000);

afterAll(async () => {
  await pool.end();
  await admin.end();
});

describe('SC3-03 crash windows and durable resume (real terminated backend)', () => {
  it('rolls back a crash-before-commit and resumes to verified completion', async () => {
    const plan = frozenPlan('SC3-03 crash-before-commit + resume', [301]);
    await seedCorpus(120);
    const db = migrationDb();
    await new MigrationRunner(db, manifest(BACKFILL)).expand();
    await new MigrationRunner(db, manifest(BACKFILL)).runNextChunk();
    expect((await progressChunks()).chunks).toBe(1);

    const crashing = new MigrationRunner(db, manifest(BACKFILL_SLOW)).runNextChunk();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const victim = await admin.query(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%pg_sleep(3)%' AND pid <> pg_backend_pid()",
    );
    const pid = (victim.rows[0] as { pid: number } | undefined)?.pid;
    expect(pid).toBeDefined();
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await expect(crashing).rejects.toThrow();

    expect((await progressChunks()).chunks).toBe(1);
    const resumed = await new MigrationRunner(db, manifest(BACKFILL)).runToCompletion();
    expect(resumed.completed).toBe(true);
    const { highWater } = await progressChunks();
    await assertMergedWindow(highWater);
    const report = await new MigrationRunner(db, manifest(BACKFILL)).verifyIntegrity();
    expect(report.passed).toBe(true);
    await new MigrationRunner(db, manifest(BACKFILL)).contract();

    const receipts = [trialReceipt(plan, 301)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-03-crash.json', { planHash: plan.planHash, receipts, report });
  }, 120_000);
});

describe('SC3-03 concurrent update/delete conflict on backfill rows', () => {
  it('reconciles acknowledged writes against the migrated table', async () => {
    const plan = frozenPlan('SC3-03 concurrent writers + journal reconciliation', [302]);
    await seedCorpus(120);
    const db = migrationDb();
    const runner = new MigrationRunner(db, manifest(BACKFILL));
    await runner.expand();
    const random = mulberry32(302);
    const deleted = new Set<number>();

    for (let round = 0; round < 5; round++) {
      for (let op = 0; op < 6; op++) {
        const pick = random();
        if (pick < 0.4) {
          const tenant = random() < 0.5 ? 'tenant-a' : 'tenant-b';
          const amount = Math.floor(random() * 50000);
          const inserted = await admin.query(
            'INSERT INTO backfill_orders(tenant, amount_cents, amount_minor) VALUES ($1, $2, $2) RETURNING id',
            [tenant, amount],
          );
          const id = (inserted.rows[0] as { id: number }).id;
          await admin.query(
            "INSERT INTO op_journal(order_id, kind, row_data, tenant) VALUES ($1, 'insert', $2, $3)",
            [id, JSON.stringify({ amount_cents: amount }), tenant],
          );
        } else if (pick < 0.75) {
          const id = 1 + Math.floor(random() * 130);
          if (deleted.has(id)) continue;
          const amount = Math.floor(random() * 50000);
          const updated = await admin.query(
            'UPDATE backfill_orders SET amount_cents = $1, amount_minor = $1 WHERE id = $2 AND deleted = FALSE',
            [amount, id],
          );
          if ((updated.rowCount ?? 0) === 0) continue;
          const tenantRow = await admin.query('SELECT tenant FROM backfill_orders WHERE id = $1', [id]);
          const tenant = (tenantRow.rows[0] as { tenant: string } | undefined)?.tenant ?? 'tenant-a';
          await admin.query(
            "INSERT INTO op_journal(order_id, kind, row_data, tenant) VALUES ($1, 'update', $2, $3)",
            [id, JSON.stringify({ amount_cents: amount }), tenant],
          );
        } else {
          const id = 1 + Math.floor(random() * 130);
          if (deleted.has(id)) continue;
          const doomed = await admin.query('SELECT tenant FROM backfill_orders WHERE id = $1', [id]);
          const doomedTenant = (doomed.rows[0] as { tenant: string } | undefined)?.tenant;
          if (doomedTenant === undefined) continue;
          const removed = await admin.query('DELETE FROM backfill_orders WHERE id = $1', [id]);
          if ((removed.rowCount ?? 0) === 0) continue;
          deleted.add(id);
          await admin.query("INSERT INTO op_journal(order_id, kind, row_data, tenant) VALUES ($1, 'delete', $2, $3)", [
            id,
            JSON.stringify({}),
            doomedTenant,
          ]);
        }
      }
      const chunk = await new MigrationRunner(db, manifest(BACKFILL)).runNextChunk();
      await assertMergedWindow(chunk.highWaterMark);
    }

    const resumed = await new MigrationRunner(db, manifest(BACKFILL)).runToCompletion();
    expect(resumed.completed).toBe(true);
    const report = await new MigrationRunner(db, manifest(BACKFILL)).verifyIntegrity();
    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
    expect(report.passed).toBe(true);

    const receipts = [trialReceipt(plan, 302)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-03-writers.json', { planHash: plan.planHash, receipts, report });
  }, 120_000);

  it('fails integrity when a writer skips the dual write', async () => {
    const plan = frozenPlan('SC3-03 negative: skipped dual write', [303]);
    await seedCorpus(60);
    const db = migrationDb();
    await new MigrationRunner(db, manifest(BACKFILL)).expand();
    await new MigrationRunner(db, manifest(BACKFILL)).runNextChunk();
    const victim = await admin.query(
      'SELECT id, tenant FROM backfill_orders WHERE amount_minor IS NOT NULL LIMIT 1',
    );
    const row = victim.rows[0] as { id: number; tenant: string };
    await admin.query('UPDATE backfill_orders SET amount_cents = amount_cents + 500 WHERE id = $1', [row.id]);
    await admin.query("INSERT INTO op_journal(order_id, kind, row_data, tenant) VALUES ($1, 'update', $2, $3)", [
      row.id,
      JSON.stringify({}),
      row.tenant,
    ]);
    await new MigrationRunner(db, manifest(BACKFILL)).runToCompletion();

    const report = await new MigrationRunner(db, manifest(BACKFILL)).verifyIntegrity();
    expect(report.passed).toBe(false);
    expect(report.checks.filter((check) => !check.passed).map((check) => check.name)).toContain(
      'exact_sum:amount_cents->amount_minor',
    );
    await expect(new MigrationRunner(db, manifest(BACKFILL)).contract()).rejects.toThrow(/integrity/i);

    const receipts = [trialReceipt(plan, 303)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-03-negative-dualwrite.json', { planHash: plan.planHash, receipts, report });
  }, 120_000);

  it('fails integrity when the journal loses an acknowledged write', async () => {
    const plan = frozenPlan('SC3-03 negative: incomplete journal', [304]);
    await seedCorpus(60);
    const db = migrationDb();
    await new MigrationRunner(db, manifest(BACKFILL)).expand();
    // Capture the baseline first so the acknowledged write below is a delta.
    await new MigrationRunner(db, manifest(BACKFILL)).runNextChunk();
    const inserted = await admin.query(
      'INSERT INTO backfill_orders(tenant, amount_cents, amount_minor) VALUES ($1, $2, $2) RETURNING id',
      ['tenant-a', 777],
    );
    const id = (inserted.rows[0] as { id: number }).id;
    await admin.query("INSERT INTO op_journal(order_id, kind, row_data, tenant) VALUES ($1, 'insert', $2, $3)", [
      id,
      JSON.stringify({ amount_cents: 777 }),
      'tenant-a',
    ]);
    await new MigrationRunner(db, manifest(BACKFILL)).runToCompletion();
    await admin.query("DELETE FROM op_journal WHERE kind = 'insert' AND order_id = $1", [id]);

    const report = await new MigrationRunner(db, manifest(BACKFILL)).verifyIntegrity();
    expect(report.passed).toBe(false);
    expect(report.checks.filter((check) => !check.passed).map((check) => check.name)).toContain('row_counts');

    const receipts = [trialReceipt(plan, 304)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-03-negative-journal.json', { planHash: plan.planHash, receipts, report });
  }, 120_000);
});
