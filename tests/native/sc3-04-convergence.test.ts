import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CanonicalObjectHash,
  ExperimentPlanSchema,
  TrialReceiptSchema,
  type ExperimentPlan,
  type TrialReceipt,
} from '../../src/core/index.js';
import { summarizeCampaign } from '../../src/modules/verifier/index.js';

import { databaseUrlFor, redisUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-18 / T-26 — SC3-04 partial failure, retry storm, and convergence.
 *
 * Real PostgreSQL 16 + real Redis 7 (disposable containers). The producer
 * commits orders through a real outbox (at-least-once, duplicates possible);
 * the consumer fixture applies each op exactly once via op_log and checkpoints
 * in the same transaction. Frozen bounds: Amax=5 attempts/op, Qmax=100
 * backlog, Tdrain=30s, Tconverge=60s. The partition fault is a real SIGKILL of
 * the consumer (worker→broker edge down, stream retains the backlog); heal is
 * a real restart. Receipts land in runs/sc3-18/.
 */

const A_MAX = 5;
const Q_MAX = 100;
const T_DRAIN_MS = 30_000;
const T_CONVERGE_MS = 60_000;

function requireEnv(): { databaseUrl: string; redisUrl: string } {
  const db = process.env['DATABASE_URL'];
  const rd = process.env['REDIS_URL'];
  if (db === undefined || db.length === 0) {
    throw new Error('DATABASE_URL is required; start the disposable PostgreSQL container first.');
  }
  if (rd === undefined || rd.length === 0) {
    throw new Error('REDIS_URL is required; start the disposable Redis container first.');
  }
  return { databaseUrl: db, redisUrl: rd };
}

const { databaseUrl, redisUrl } = requireEnv();
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const consumerPath = join(rootDir, 'fixtures', 'sc3-convergence', 'consumer.mjs');

const fileDbUrl = databaseUrlFor(databaseUrl, 't_sc3_04');
const fileRedisUrl = redisUrlFor(redisUrl, 11);
const admin = new Pool({ connectionString: fileDbUrl });
const redis = createClient({ url: fileRedisUrl });

const CANDIDATE = 'e'.repeat(64);
const ENVIRONMENT = 'disposable:postgres:16-alpine+redis:7-alpine:t_sc3_04';

const SCHEMA = `
DROP TABLE IF EXISTS convergence_orders;
DROP TABLE IF EXISTS producer_outbox;
DROP TABLE IF EXISTS op_log;
DROP TABLE IF EXISTS consumer_checkpoint;
CREATE TABLE convergence_orders(
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fulfill_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE producer_outbox(
  op_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE op_log(
  op_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE consumer_checkpoint(
  stream TEXT PRIMARY KEY,
  last_id TEXT NOT NULL
);`;

interface ConsumerRun {
  proc: ChildProcess;
  lines: string[];
  done: Promise<{ code: number | null; signal: string | null }>;
}

function startConsumer(stream: string, name: string, extraArgs: readonly string[] = []): ConsumerRun {
  const lines: string[] = [];
  const proc = spawn(
    process.execPath,
    [
      consumerPath,
      '--database-url',
      fileDbUrl,
      '--redis-url',
      fileRedisUrl,
      '--stream',
      stream,
      '--consumer',
      name,
      '--idle-ms',
      '1500',
      ...extraArgs,
    ],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let buffer = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      if (part.length > 0) lines.push(part);
    }
  });
  const done = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    proc.on('exit', (code, signal) => {
      if (buffer.length > 0) lines.push(buffer);
      resolve({ code, signal });
    });
  });
  return { proc, lines, done };
}

async function stopConsumer(run: ConsumerRun): Promise<void> {
  if (run.proc.exitCode === null && run.proc.signalCode === null) {
    run.proc.kill('SIGTERM');
    await run.done;
  }
}

/** Producer attempt: business commit + outbox in one txn; publish afterwards. */
async function placeOrder(opId: string, orderId: string, tenant: string, amount: number): Promise<{ duplicate: boolean }> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query(
      'INSERT INTO convergence_orders(id, tenant, amount_cents) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [orderId, tenant, amount],
    );
    await client.query(
      'INSERT INTO producer_outbox(op_id, order_id, payload) VALUES ($1, $2, $3) ON CONFLICT (op_id) DO NOTHING',
      [opId, orderId, JSON.stringify({ amount_cents: amount, tenant })],
    );
    await client.query('COMMIT');
    const duplicate = (order.rowCount ?? 0) === 0;
    await publishOutbox();
    return { duplicate };
  } finally {
    client.release();
  }
}

async function publishOutbox(): Promise<void> {
  const pending = await admin.query('SELECT op_id, order_id, payload FROM producer_outbox WHERE published = FALSE ORDER BY op_id');
  for (const row of pending.rows as { op_id: string; order_id: string; payload: { amount_cents: number } }[]) {
    await redis.xAdd('conv-stream', '*', {
      op_id: row.op_id,
      order_id: row.order_id,
      amount: String(row.payload.amount_cents),
    });
    await admin.query('UPDATE producer_outbox SET published = TRUE WHERE op_id = $1', [row.op_id]);
  }
}

function frozenPlan(scenario: string, seeds: readonly number[]): ExperimentPlan {
  const body = {
    schemaVersion: '1' as const,
    planVersion: 1,
    subjects: [{ kind: 'consumer' as const, id: 'sc3-04-convergence' }],
    workload: { arrivalDistribution: 'steady' as const, concurrency: 2, dataSkew: 'none' as const },
    resetSemantics: 'fresh-database-per-trial' as const,
    seeds: [...seeds],
    intendedSchedules: [{ id: 'sched-conv', faultStartMs: 0, faultDurationMs: 0, faultTarget: 'worker→broker' }],
    observations: ['attempt-tree', 'backlog', 'recovery-curve'],
    trialUnit: 'trial' as const,
    n: 1,
    warmupTrials: 0,
    measurementWindow: { kind: 'fixed' as const, durationMs: T_CONVERGE_MS },
    thresholds: [
      { metricId: 'backlog-depth', statistic: 'max' as const, comparison: 'lte' as const, value: Q_MAX, unit: 'messages' },
    ],
    stopRules: [{ kind: 'stop' as const, afterTrials: 1 }],
    forecast: { estimatedCostUsd: 0, estimatedWallTimeMs: T_CONVERGE_MS },
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
    actualSchedule: { id: 'sched-conv', appliedAtMs: 0, removedAtMs: 0 },
    faultApplied: false,
    faultRemoved: false,
    counts: { planned: 1, completed: 1, failed: 0, invalid: 0, censored: 0, notRun: 0 },
    result: 'pass',
    telemetryRefs: [`runs/sc3-18/sc3-04-seed-${seed}.json`],
    ...extra,
  });
}

function writeReceipts(name: string, payload: unknown): void {
  const runDir = join(rootDir, 'runs', 'sc3-18', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, name), JSON.stringify(payload, null, 2));
}

function deliveryCounts(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    if (record['event'] !== 'delivery') continue;
    const opField = record['op_id'];
    const opId = typeof opField === 'string' ? opField : '';
    counts.set(opId, (counts.get(opId) ?? 0) + 1);
  }
  return counts;
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_sc3_04');
  await redis.connect();
  await redis.flushDb();
}, 30_000);

afterAll(async () => {
  await redis.quit().catch(() => undefined);
  await admin.end();
});

describe('SC3-04 dropped response after commit converges exactly once', () => {
  it('dedups the retry without a duplicate effect', async () => {
    const plan = frozenPlan('SC3-04 dropped-response retry', [401]);
    await admin.query(SCHEMA);
    await redis.del('conv-stream');

    const first = await placeOrder('op-401-a', 'order-401-a', 'tenant-a', 1200);
    expect(first.duplicate).toBe(false);
    const retry = await placeOrder('op-401-a', 'order-401-a', 'tenant-a', 1200);
    expect(retry.duplicate).toBe(true);

    const run = startConsumer('conv-stream', 'c401');
    const exit = await run.done;
    expect(exit.code).toBe(0);

    const orders = await admin.query('SELECT COUNT(*)::TEXT AS count FROM convergence_orders WHERE id = $1', ['order-401-a']);
    expect((orders.rows[0] as { count: string }).count).toBe('1');
    const applied = await admin.query('SELECT fulfill_count FROM convergence_orders WHERE id = $1', ['order-401-a']);
    expect((applied.rows[0] as { fulfill_count: number }).fulfill_count).toBe(1);
    const attempts = deliveryCounts(run.lines).get('op-401-a') ?? 0;
    expect(attempts).toBeLessThanOrEqual(A_MAX);
    expect(attempts).toBeGreaterThanOrEqual(1);

    const receipts = [trialReceipt(plan, 401)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-04-retry.json', { planHash: plan.planHash, receipts, attempts });
  }, 120_000);
});

describe('SC3-04 out-of-order duplicates converge without double effects', () => {
  it('absorbs reversed redelivery with backlog inside Qmax', async () => {
    const plan = frozenPlan('SC3-04 out-of-order duplicates', [402]);
    await admin.query(SCHEMA);
    await redis.del('conv-stream');

    await placeOrder('op-402-a', 'order-402-a', 'tenant-a', 500);
    await placeOrder('op-402-b', 'order-402-b', 'tenant-b', 700);
    // Reversed redelivery straight at the stream, as a redelivering broker would.
    await redis.xAdd('conv-stream', '*', { op_id: 'op-402-b', order_id: 'order-402-b', amount: '700' });
    await redis.xAdd('conv-stream', '*', { op_id: 'op-402-a', order_id: 'order-402-a', amount: '500' });
    const backlog = await redis.xLen('conv-stream');
    expect(backlog).toBeLessThanOrEqual(Q_MAX);

    const run = startConsumer('conv-stream', 'c402');
    const exit = await run.done;
    expect(exit.code).toBe(0);

    const counts = await admin.query('SELECT id, fulfill_count FROM convergence_orders ORDER BY id');
    expect(counts.rows).toHaveLength(2);
    for (const row of counts.rows as { fulfill_count: number }[]) {
      expect(row.fulfill_count).toBe(1);
    }
    for (const [, deliveries] of deliveryCounts(run.lines)) {
      expect(deliveries).toBeLessThanOrEqual(A_MAX);
    }

    const receipts = [trialReceipt(plan, 402)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-04-reorder.json', { planHash: plan.planHash, receipts, backlog });
  }, 120_000);
});

describe('SC3-04 partition heals and the backlog drains inside Tdrain', () => {
  it('kills the consumer, holds backlog, restarts, and converges', async () => {
    const plan = frozenPlan('SC3-04 kill partition + heal + drain', [403]);
    await admin.query(SCHEMA);
    await redis.del('conv-stream');

    for (let i = 0; i < 30; i++) {
      await placeOrder(`op-403-${i}`, `order-403-${i}`, i % 2 === 0 ? 'tenant-a' : 'tenant-b', 100 + i);
    }
    const run = startConsumer('conv-stream', 'c403', ['--pace-ms', '150']);
    // Let the consumer apply a few, then partition the worker→broker edge.
    const deadline = Date.now() + 15_000;
    for (;;) {
      const applied = await admin.query('SELECT COUNT(*)::TEXT AS count FROM op_log');
      if (Number((applied.rows[0] as { count: string }).count) >= 5) break;
      if (Date.now() > deadline) throw new Error('Consumer never started applying; refusing a fake partition.');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    run.proc.kill('SIGKILL');
    const killed = await run.done;
    expect(killed.signal).toBe('SIGKILL');

    const held = await admin.query('SELECT COUNT(*)::TEXT AS count FROM op_log');
    const heldCount = Number((held.rows[0] as { count: string }).count);
    expect(heldCount).toBeLessThan(30);
    const streamLen = await redis.xLen('conv-stream');
    expect(streamLen - heldCount).toBeGreaterThan(0);
    expect(streamLen).toBeLessThanOrEqual(Q_MAX);

    const healStart = Date.now();
    const healed = startConsumer('conv-stream', 'c403-healed', ['--pace-ms', '150']);
    const healedExit = await healed.done;
    expect(healedExit.code).toBe(0);
    const drainMs = Date.now() - healStart;
    expect(drainMs).toBeLessThanOrEqual(T_DRAIN_MS);

    const final = await admin.query('SELECT COUNT(*)::TEXT AS count, SUM(fulfill_count)::TEXT AS effects FROM convergence_orders');
    const finalRow = final.rows[0] as { count: string; effects: string };
    expect(finalRow.count).toBe('30');
    expect(finalRow.effects).toBe('30');
    const allLines = [...run.lines, ...healed.lines];
    for (const [, deliveries] of deliveryCounts(allLines)) {
      expect(deliveries).toBeLessThanOrEqual(A_MAX);
    }

    const receipts = [
      trialReceipt(plan, 403, {
        faultApplied: true,
        faultRemoved: true,
        actualSchedule: { id: 'sched-conv', appliedAtMs: 0, removedAtMs: drainMs },
      }),
    ];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-04-partition.json', { planHash: plan.planHash, receipts, drainMs, heldCount });
    await stopConsumer(healed);
  }, 120_000);
});

describe('SC3-04 negative: duplicates without idempotency double-apply (NEG3-11)', () => {
  it('fails the behavioral check while transport stays green', async () => {
    const plan = frozenPlan('SC3-04 negative: no dedup', [404]);
    await admin.query(SCHEMA);
    await redis.del('conv-stream');

    await placeOrder('op-404-a', 'order-404-a', 'tenant-a', 900);
    await redis.xAdd('conv-stream', '*', { op_id: 'op-404-a', order_id: 'order-404-a', amount: '900' });

    const run = startConsumer('conv-stream', 'c404', ['--no-dedup']);
    const exit = await run.done;
    expect(exit.code).toBe(0);

    const applied = await admin.query('SELECT fulfill_count FROM convergence_orders WHERE id = $1', ['order-404-a']);
    expect((applied.rows[0] as { fulfill_count: number }).fulfill_count).toBe(2);

    const receipts = [trialReceipt(plan, 404, { result: 'fail' })];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-04-negative.json', { planHash: plan.planHash, receipts, doubleEffect: true });
    await stopConsumer(run);
  }, 120_000);
});
