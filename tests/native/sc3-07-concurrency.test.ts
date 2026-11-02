import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CanonicalObjectHash,
  ExperimentPlanSchema,
  TrialReceiptSchema,
  type ExperimentPlan,
  type TrialReceipt,
} from '../../src/core/index.js';
import { summarizeCampaign } from '../../src/modules/verifier/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-18 / T-26 — SC3-07 race, lost update, deadlock, and double processing.
 *
 * Real PostgreSQL 16 (disposable container) with two overlapping transactions
 * driven in exact statement order, so every mandatory schedule is deterministic:
 * read/read/write/write lost update, conflicting lock order, and duplicate
 * operations arriving before and after commit. Pre-fix schedules reproduce the
 * violation in ≥2 reset trials; fixed schedules (SELECT FOR UPDATE, ordered
 * locking, op-id dedup) show zero lost/duplicate effects. Receipts carry the
 * journal histories and land in runs/sc3-18/.
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

const fileDbUrl = databaseUrlFor(databaseUrl, 't_sc3_07');
const admin = new Pool({ connectionString: fileDbUrl });
const pool = new Pool({ connectionString: fileDbUrl });

const CANDIDATE = 'f'.repeat(64);
const ENVIRONMENT = 'disposable:postgres:16-alpine:t_sc3_07';

const SCHEMA = `
DROP TABLE IF EXISTS stock;
DROP TABLE IF EXISTS op_journal;
CREATE TABLE stock(
  sku TEXT PRIMARY KEY,
  qty INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE op_journal(
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  op_id TEXT UNIQUE NOT NULL,
  sku TEXT NOT NULL,
  delta INTEGER NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);`;

async function reset(skus: readonly { sku: string; qty: number }[]): Promise<void> {
  await admin.query(SCHEMA);
  for (const { sku, qty } of skus) {
    await admin.query('INSERT INTO stock(sku, qty) VALUES ($1, $2)', [sku, qty]);
  }
}

function frozenPlan(scenario: string, seeds: readonly number[]): ExperimentPlan {
  const body = {
    schemaVersion: '1' as const,
    planVersion: 1,
    subjects: [{ kind: 'worker' as const, id: 'sc3-07-concurrency' }],
    workload: { arrivalDistribution: 'steady' as const, concurrency: 2, dataSkew: 'high' as const },
    resetSemantics: 'fresh-database-per-trial' as const,
    seeds: [...seeds],
    intendedSchedules: [{ id: 'sched-race', faultStartMs: 0, faultDurationMs: 0, faultTarget: 'none' }],
    observations: ['invocation-history', 'commit-history', 'lock-evidence'],
    trialUnit: 'trial' as const,
    n: 1,
    warmupTrials: 0,
    measurementWindow: { kind: 'fixed' as const, durationMs: 120_000 },
    thresholds: [
      { metricId: 'lost-effects', statistic: 'count' as const, comparison: 'eq' as const, value: 0, unit: 'ops' },
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
    actualSchedule: { id: 'sched-race', appliedAtMs: 0, removedAtMs: 0 },
    faultApplied: false,
    faultRemoved: false,
    counts: { planned: 1, completed: 1, failed: 0, invalid: 0, censored: 0, notRun: 0 },
    result: 'pass',
    telemetryRefs: [`runs/sc3-18/sc3-07-seed-${seed}.json`],
    ...extra,
  });
}

function writeReceipts(name: string, payload: unknown): void {
  const runDir = join(rootDir, 'runs', 'sc3-18', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, name), JSON.stringify(payload, null, 2));
}

async function journal(): Promise<{ op_id: string; sku: string; delta: number; status: string }[]> {
  const result = await admin.query('SELECT op_id, sku, delta, status FROM op_journal ORDER BY seq');
  return result.rows as { op_id: string; sku: string; delta: number; status: string }[];
}

async function qtyOf(sku: string): Promise<number> {
  const result = await admin.query('SELECT qty FROM stock WHERE sku = $1', [sku]);
  return (result.rows[0] as { qty: number }).qty;
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_sc3_07');
}, 30_000);

afterAll(async () => {
  await pool.end();
  await admin.end();
});

describe('SC3-07 lost update: read/read/write/write', () => {
  async function lostUpdateTrial(opBase: string): Promise<{ finalQty: number; decrements: number }> {
    await reset([{ sku: 'hot-key', qty: 10 }]);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await b.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const readA = await a.query('SELECT qty FROM stock WHERE sku = $1', ['hot-key']);
      const readB = await b.query('SELECT qty FROM stock WHERE sku = $1', ['hot-key']);
      const qtyA = (readA.rows[0] as { qty: number }).qty;
      const qtyB = (readB.rows[0] as { qty: number }).qty;
      await a.query('UPDATE stock SET qty = $1 WHERE sku = $2', [qtyA - 1, 'hot-key']);
      await a.query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ($1, 'hot-key', -1, 'applied')", [
        `${opBase}-a`,
      ]);
      await a.query('COMMIT');
      await b.query('UPDATE stock SET qty = $1 WHERE sku = $2', [qtyB - 1, 'hot-key']);
      await b.query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ($1, 'hot-key', -1, 'applied')", [
        `${opBase}-b`,
      ]);
      await b.query('COMMIT');
      return { finalQty: await qtyOf('hot-key'), decrements: 2 };
    } finally {
      a.release();
      b.release();
    }
  }

  it('reproduces the lost update in two reset trials (pre-fix)', async () => {
    const plan = frozenPlan('SC3-07 pre-fix lost update x2', [701]);
    const first = await lostUpdateTrial('op-701-1');
    expect(first.finalQty).toBe(9);
    expect(first.decrements).toBe(2);
    const second = await lostUpdateTrial('op-701-2');
    expect(second.finalQty).toBe(9);
    expect(second.decrements).toBe(2);

    const receipts = [trialReceipt(plan, 701, { result: 'fail' })];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-07-lost-update-prefix.json', { planHash: plan.planHash, receipts, history: await journal() });
  }, 120_000);

  it('applies both decrements with row locks (fixed)', async () => {
    const plan = frozenPlan('SC3-07 fixed lost update', [702]);
    await reset([{ sku: 'hot-key', qty: 10 }]);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await b.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const readA = await a.query('SELECT qty FROM stock WHERE sku = $1 FOR UPDATE', ['hot-key']);
      const blockedRead = b.query('SELECT qty FROM stock WHERE sku = $1 FOR UPDATE', ['hot-key']);
      const qtyA = (readA.rows[0] as { qty: number }).qty;
      await a.query('UPDATE stock SET qty = $1 WHERE sku = $2', [qtyA - 1, 'hot-key']);
      await a.query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ('op-702-a', 'hot-key', -1, 'applied')");
      await a.query('COMMIT');
      const readB = await blockedRead;
      const qtyB = (readB.rows[0] as { qty: number }).qty;
      expect(qtyB).toBe(qtyA - 1);
      await b.query('UPDATE stock SET qty = $1 WHERE sku = $2', [qtyB - 1, 'hot-key']);
      await b.query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ('op-702-b', 'hot-key', -1, 'applied')");
      await b.query('COMMIT');
    } finally {
      a.release();
      b.release();
    }

    expect(await qtyOf('hot-key')).toBe(8);
    const receipts = [trialReceipt(plan, 702)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-07-lost-update-fixed.json', { planHash: plan.planHash, receipts, history: await journal() });
  }, 120_000);
});

describe('SC3-07 conflicting lock order', () => {
  async function deadlockTrial(opBase: string): Promise<{ victim: string; survivor: string }> {
    await reset([
      { sku: 'sku-1', qty: 10 },
      { sku: 'sku-2', qty: 10 },
    ]);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await a.query('UPDATE stock SET qty = qty - 1 WHERE sku = $1', ['sku-1']);
      await b.query('UPDATE stock SET qty = qty - 1 WHERE sku = $1', ['sku-2']);
      const aSecond = a.query('UPDATE stock SET qty = qty - 1 WHERE sku = $1', ['sku-2']);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const bSecond = b.query('UPDATE stock SET qty = qty - 1 WHERE sku = $1', ['sku-1']);
      const [aOutcome, bOutcome] = await Promise.allSettled([aSecond, bSecond]);
      const aDeadlocked =
        aOutcome.status === 'rejected' && String((aOutcome.reason as { code?: string }).code) === '40P01';
      const bDeadlocked =
        bOutcome.status === 'rejected' && String((bOutcome.reason as { code?: string }).code) === '40P01';
      expect(aDeadlocked !== bDeadlocked).toBe(true);
      if (aOutcome.status === 'fulfilled') {
        await a.query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ($1, 'sku-1+2', -2, 'applied')", [
          `${opBase}-a`,
        ]);
        await a.query('COMMIT');
        await b.query('ROLLBACK');
        return { victim: 'b', survivor: 'a' };
      }
      await b.query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ($1, 'sku-1+2', -2, 'applied')", [
        `${opBase}-b`,
      ]);
      await b.query('COMMIT');
      await a.query('ROLLBACK');
      return { victim: 'a', survivor: 'b' };
    } finally {
      a.release();
      b.release();
    }
  }

  it('deadlocks on conflicting order in two reset trials (pre-fix)', async () => {
    const plan = frozenPlan('SC3-07 pre-fix deadlock x2', [703]);
    const first = await deadlockTrial('op-703-1');
    const second = await deadlockTrial('op-703-2');

    const receipts = [trialReceipt(plan, 703, { result: 'fail' })];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-07-deadlock-prefix.json', {
      planHash: plan.planHash,
      receipts,
      first,
      second,
      history: await journal(),
    });
  }, 120_000);

  it('commits both sides with ordered locking (fixed)', async () => {
    const plan = frozenPlan('SC3-07 fixed ordered locking', [704]);
    await reset([
      { sku: 'sku-1', qty: 10 },
      { sku: 'sku-2', qty: 10 },
    ]);
    async function ordered(client: PoolClient, opId: string): Promise<void> {
      await client.query('BEGIN');
      try {
        for (const sku of ['sku-1', 'sku-2']) {
          await client.query('SELECT qty FROM stock WHERE sku = $1 FOR UPDATE', [sku]);
        }
        await client.query('UPDATE stock SET qty = qty - 1 WHERE sku IN ($1, $2)', ['sku-1', 'sku-2']);
        await client.query('INSERT INTO op_journal(op_id, sku, delta, status) VALUES ($1, $2, -2, $3)', [
          opId,
          'sku-1+2',
          'applied',
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await Promise.all([ordered(a, 'op-704-a'), ordered(b, 'op-704-b')]);
    } finally {
      a.release();
      b.release();
    }

    expect(await qtyOf('sku-1')).toBe(8);
    expect(await qtyOf('sku-2')).toBe(8);
    const receipts = [trialReceipt(plan, 704)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-07-deadlock-fixed.json', { planHash: plan.planHash, receipts, history: await journal() });
  }, 120_000);
});

describe('SC3-07 duplicate operation before and after commit', () => {
  it('applies the op once and dedups both redeliveries', async () => {
    const plan = frozenPlan('SC3-07 duplicate before/after commit', [705]);
    await reset([{ sku: 'hot-key', qty: 10 }]);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ('op-705', 'hot-key', -1, 'applied')");
      await a.query('UPDATE stock SET qty = qty - 1 WHERE sku = $1', ['hot-key']);
      const racing = b.query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ('op-705', 'hot-key', -1, 'applied')");
      await new Promise((resolve) => setTimeout(resolve, 300));
      await a.query('COMMIT');
      const classify = (error: unknown): 'inserted' | 'deduped' => {
        if (typeof error === 'object' && error !== null && 'code' in error) {
          const code: unknown = error.code;
          return (typeof code === 'string' ? code : String(code)) === '23505' ? 'deduped' : 'inserted';
        }
        return 'inserted';
      };
      const raceOutcome = await racing.then(
        () => 'inserted' as const,
        (error: unknown) => classify(error),
      );
      expect(raceOutcome).toBe('deduped');
      const lateOutcome = await b
        .query("INSERT INTO op_journal(op_id, sku, delta, status) VALUES ('op-705', 'hot-key', -1, 'applied')")
        .then(
          () => 'inserted' as const,
          (error: unknown) => classify(error),
        );
      expect(lateOutcome).toBe('deduped');
    } finally {
      a.release();
      b.release();
    }

    expect(await qtyOf('hot-key')).toBe(9);
    expect(await journal()).toHaveLength(1);
    const receipts = [trialReceipt(plan, 705)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-07-duplicate.json', { planHash: plan.planHash, receipts, history: await journal() });
  }, 120_000);
});
