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
import { reduceMatchedWindows, summarizeCampaign } from '../../src/modules/verifier/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-18 / T-26 — SC3-08 latency/throughput and pool exhaustion.
 *
 * Real PostgreSQL 16 (disposable container) behind a real size-4 pool with
 * instrumented acquire/release. Paired load blocks (baseline, then candidate
 * with a deterministic error path) share the same offered load: 8 workers × 12
 * ops. Frozen SLO: absolute p50 < 250ms, relative margin +100ms over baseline.
 * The leaky error path forgets release and exhausts the pool; its short sample
 * is rejected as measurement-invalid (NEG3-18), never a pass. The fixed path
 * releases in `finally`, balances every lease after drain, and meets the SLO.
 * Raw distributions land in runs/sc3-18/.
 */

const POOL_MAX = 4;
const WORKERS = 8;
const OPS_PER_WORKER = 12;
const OFFERED = WORKERS * OPS_PER_WORKER;
const ABS_P50_MS = 250;
const REL_MARGIN_MS = 100;
const ACQUIRE_TIMEOUT_MS = 2000;

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

const fileDbUrl = databaseUrlFor(databaseUrl, 't_sc3_08');
const admin = new Pool({ connectionString: fileDbUrl });

const CANDIDATE = '0'.repeat(63) + '8';
const ENVIRONMENT = 'disposable:postgres:16-alpine:t_sc3_08';

interface BlockResult {
  latenciesMs: number[];
  completed: number;
  timedOut: number;
  errored: number;
  maxActive: number;
  outstandingAfterDrain: number;
}

async function runBlock(options: { errors: boolean; leakOnError: boolean }): Promise<BlockResult> {
  const pool = new Pool({ connectionString: fileDbUrl, max: POOL_MAX });
  const checkedOut = new Set<PoolClient>();
  let active = 0;
  let maxActive = 0;
  const latenciesMs: number[] = [];
  let timedOut = 0;
  let errored = 0;

  async function acquire(): Promise<PoolClient | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pool.connect(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            resolve(null);
          }, ACQUIRE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function oneOp(worker: number, op: number): Promise<void> {
    const start = Date.now();
    const client = await acquire();
    if (client === null) {
      timedOut += 1;
      return;
    }
    checkedOut.add(client);
    active += 1;
    maxActive = Math.max(maxActive, active);
    const fails = options.errors && (worker * 31 + op) % 10 === 0;
    try {
      if (fails) {
        await client.query('SELECT * FROM sc3_08_missing_table');
      } else {
        await client.query('SELECT $1::int AS v', [worker * 1000 + op]);
      }
      latenciesMs.push(Date.now() - start);
    } catch {
      errored += 1;
      return;
    } finally {
      if (!options.leakOnError || !fails) {
        checkedOut.delete(client);
        client.release();
        active -= 1;
      }
    }
  }

  try {
    const workers: Promise<void>[] = [];
    for (let worker = 0; worker < WORKERS; worker++) {
      workers.push(
        (async () => {
          for (let op = 0; op < OPS_PER_WORKER; op++) {
            await oneOp(worker, op);
          }
        })(),
      );
    }
    await Promise.all(workers);
    const outstandingAfterDrain = checkedOut.size;
    for (const client of checkedOut) {
      client.release(new Error('sc3-08 teardown destroys the held lease'));
    }
    checkedOut.clear();
    return {
      latenciesMs,
      completed: latenciesMs.length,
      timedOut,
      errored,
      maxActive,
      outstandingAfterDrain,
    };
  } finally {
    await pool.end();
  }
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('No observations; refusing an empty percentile.');
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  const value = sorted[index];
  if (value === undefined) throw new Error('Percentile index out of range; refusing.');
  return value;
}

function frozenPlan(scenario: string, seeds: readonly number[]): ExperimentPlan {
  const body = {
    schemaVersion: '1' as const,
    planVersion: 1,
    subjects: [{ kind: 'worker' as const, id: 'sc3-08-pool' }],
    workload: { arrivalDistribution: 'steady' as const, concurrency: WORKERS, dataSkew: 'none' as const },
    resetSemantics: 'fresh-database-per-trial' as const,
    seeds: [...seeds],
    intendedSchedules: [{ id: 'sched-load', faultStartMs: 0, faultDurationMs: 0, faultTarget: 'none' }],
    observations: ['latency-distribution', 'lease-lifecycle', 'offered-vs-completed'],
    trialUnit: 'trial' as const,
    n: 1,
    warmupTrials: 0,
    measurementWindow: { kind: 'matched' as const, matchedTo: 'baseline-block' },
    thresholds: [
      { metricId: 'op-latency-ms', statistic: 'p50' as const, comparison: 'lt' as const, value: ABS_P50_MS, unit: 'ms' },
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
    actualSchedule: { id: 'sched-load', appliedAtMs: 0, removedAtMs: 0 },
    faultApplied: false,
    faultRemoved: false,
    counts: { planned: 1, completed: 1, failed: 0, invalid: 0, censored: 0, notRun: 0 },
    result: 'pass',
    telemetryRefs: [`runs/sc3-18/sc3-08-seed-${seed}.json`],
    ...extra,
  });
}

function writeReceipts(name: string, payload: unknown): void {
  const runDir = join(rootDir, 'runs', 'sc3-18', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, name), JSON.stringify(payload, null, 2));
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_sc3_08');
}, 30_000);

afterAll(async () => {
  await admin.end();
});

describe('SC3-08 paired load meets the frozen SLO (fixed error path)', () => {
  it('balances every lease and stays inside absolute and relative bounds', async () => {
    const plan = frozenPlan('SC3-08 paired baseline + candidate', [801]);
    const baseline = await runBlock({ errors: false, leakOnError: false });
    const candidate = await runBlock({ errors: true, leakOnError: false });

    expect(baseline.completed).toBe(OFFERED);
    // The fixed path turns injected errors into failed ops, never lost leases.
    expect(candidate.errored).toBeGreaterThan(0);
    expect(candidate.outstandingAfterDrain).toBe(0);
    expect(baseline.outstandingAfterDrain).toBe(0);
    expect(baseline.maxActive).toBeLessThanOrEqual(POOL_MAX);
    expect(candidate.maxActive).toBeLessThanOrEqual(POOL_MAX);

    const baseSorted = [...baseline.latenciesMs].sort((a, b) => a - b);
    const candSorted = [...candidate.latenciesMs].sort((a, b) => a - b);
    const baseP50 = percentile(baseSorted, 50);
    const candP50 = percentile(candSorted, 50);
    expect(candP50).toBeLessThan(ABS_P50_MS);
    expect(candP50 - baseP50).toBeLessThanOrEqual(REL_MARGIN_MS);

    const assessment = reduceMatchedWindows({
      dimension: 'performance',
      metricId: 'op-latency-ms',
      algorithm: 'pooled-lower-median',
      config: { version: 1 },
      threshold: { comparison: 'lt', value: ABS_P50_MS },
      windows: [{ windowId: 'candidate', observations: candidate.latenciesMs }],
      rawRefs: ['runs/sc3-18/sc3-08-fixed.json'],
    });
    expect(assessment.result).toBe('pass');

    const receipts = [trialReceipt(plan, 801)];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-08-fixed.json', {
      planHash: plan.planHash,
      receipts,
      baseline: { completed: baseline.completed, p50: baseP50 },
      candidate: { completed: candidate.completed, errored: candidate.errored, p50: candP50 },
      assessment,
      raw: { baselineMs: baseline.latenciesMs, candidateMs: candidate.latenciesMs },
    });
  }, 180_000);
});

describe('SC3-08 leaky error path exhausts the pool (NEG3-18)', () => {
  it('rejects the short sample as measurement-invalid, never a pass', async () => {
    const plan = frozenPlan('SC3-08 negative: pool exhaustion', [802]);
    const leaky = await runBlock({ errors: true, leakOnError: true });

    expect(leaky.completed).toBeLessThan(OFFERED);
    expect(leaky.timedOut).toBeGreaterThan(0);
    expect(leaky.outstandingAfterDrain).toBeGreaterThan(0);

    const dropped = OFFERED - leaky.completed;
    const assessment = reduceMatchedWindows({
      dimension: 'performance',
      metricId: 'op-latency-ms',
      algorithm: 'pooled-lower-median',
      config: { version: 1 },
      threshold: { comparison: 'lt', value: ABS_P50_MS },
      windows: [{ windowId: 'leaky', observations: leaky.latenciesMs, droppedObservations: dropped }],
      rawRefs: ['runs/sc3-18/sc3-08-leaky.json'],
    });
    expect(assessment.result).toBe('inconclusive');
    expect(assessment.measurementValidity).toBe('invalid');

    const receipts = [trialReceipt(plan, 802, { result: 'fail' })];
    expect(summarizeCampaign(receipts, plan).verdict).toBe('campaign_complete');
    writeReceipts('sc3-08-leaky.json', {
      planHash: plan.planHash,
      receipts,
      completed: leaky.completed,
      dropped,
      timedOut: leaky.timedOut,
      outstanding: leaky.outstandingAfterDrain,
      assessment,
    });
  }, 180_000);
});
