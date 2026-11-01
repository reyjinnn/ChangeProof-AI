import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  CanonicalObjectHash,
  ExperimentPlanSchema,
  type ExperimentPlan,
} from '../../src/core/index.js';
import { runCampaign, summarizeCampaign } from '../../src/modules/verifier/index.js';

import { databaseUrlFor, redisUrlFor, resetProbeDatabase } from './db.js';
import { createRig } from './fixture-rig.js';

/**
 * WP3-16 — real trial campaigns on the fixture rig (dry run).
 *
 * The bounded executor (`runCampaign`) runs pre-registered plans for real:
 * declared resets between trials, exact-n enforcement, real kill faults from
 * the frozen allowlist, and validated receipts reconciled by
 * `summarizeCampaign`. Campaign receipts land in runs/sc3-baseline/
 * (gitignored). Requires DATABASE_URL + REDIS_URL; fails closed without them.
 *
 * Bounded slice: process-lifecycle faults only, no barrier/interleaving
 * control (FR3-26.3) and no network-edge faults — those need disposable
 * topology control from the full WP.
 */

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
const fixtureDir = join(rootDir, 'fixtures', 'sc3-baseline');
const schema = readFileSync(join(fixtureDir, 'schema.sql'), 'utf8');

// Own database + redis db per file: scheduling cannot cross-talk.
const fileDbUrl = databaseUrlFor(databaseUrl, 't_campaign');
const fileRedisUrl = redisUrlFor(redisUrl, 3);
const admin = new Pool({ connectionString: fileDbUrl });
const redis = createClient({ url: fileRedisUrl });
const rig = createRig({ databaseUrl: fileDbUrl, redisUrl: fileRedisUrl, fixtureDir });

const CANDIDATE = 'c'.repeat(64);
const ENVIRONMENT = 'disposable-rig:postgres:16-alpine+redis:7-alpine';

function frozenPlan(n: number, warmupTrials: number): ExperimentPlan {
  const body = {
    schemaVersion: '1' as const,
    planVersion: 1,
    subjects: [{ kind: 'consumer' as const, id: 'sc3-orders-v1' }],
    workload: { arrivalDistribution: 'steady' as const, concurrency: 1, dataSkew: 'none' as const },
    resetSemantics: 'declared-restore' as const,
    seeds: [11, 12, 13, 14, 15, 16].slice(0, n + warmupTrials),
    intendedSchedules: [{ id: 'sched-1', faultStartMs: 0, faultDurationMs: 0, faultTarget: 'trial-process' }],
    observations: ['order-fulfilled'],
    trialUnit: 'trial' as const,
    n,
    warmupTrials,
    measurementWindow: { kind: 'fixed' as const, durationMs: 30_000 },
    thresholds: [
      { metricId: 'order-fulfilled-latency-ms', statistic: 'p50' as const, comparison: 'lt' as const, value: 5000, unit: 'ms' },
    ],
    stopRules: [{ kind: 'stop' as const, afterTrials: n }],
    forecast: { estimatedCostUsd: 0, estimatedWallTimeMs: 120_000 },
    claimEnvelope: 'SC3-01-baseline-slice dry run',
  };
  return ExperimentPlanSchema.parse({ ...body, planHash: CanonicalObjectHash.of(body).digest });
}

function trialArgv(serviceUrl: string, orders: number, budgetMs: number, timeoutMs: number): {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
} {
  return {
    command: process.execPath,
    args: [
      join(fixtureDir, 'trial.mjs'),
      '--service-url',
      serviceUrl,
      '--orders',
      String(orders),
      '--budget-ms',
      String(budgetMs),
    ],
    cwd: rootDir,
    timeoutMs,
  };
}

function resetArgv(): { command: string; args: readonly string[]; cwd: string; timeoutMs: number } {
  return {
    command: process.execPath,
    args: [join(fixtureDir, 'reset.mjs'), '--database-url', fileDbUrl, '--redis-url', fileRedisUrl],
    cwd: rootDir,
    timeoutMs: 15_000,
  };
}

function writeReceipts(name: string, payload: unknown): void {
  const runDir = join(rootDir, 'runs', 'sc3-baseline', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, name), JSON.stringify(payload, null, 2));
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_campaign');
  await redis.connect();
  await redis.flushDb();
}, 30_000);

afterEach(async () => {
  await rig.stopAll();
  await redis.del('order-events');
  await redis.del('order-deadletters');
});

afterAll(async () => {
  await rig.stopAll();
  await redis.quit().catch(() => undefined);
  await admin.end();
});

describe('real campaigns reconcile every trial (dry run)', () => {
  it('completes n=3 with a warmup, resets, and passing receipts', async () => {
    await admin.query(schema);
    const { port } = await rig.startService('v1');
    await rig.startConsumer();
    const plan = frozenPlan(3, 1);
    const serviceUrl = `http://127.0.0.1:${String(port)}`;

    const campaign = await runCampaign(plan, {
      trial: trialArgv(serviceUrl, 2, 15_000, 30_000),
      reset: resetArgv(),
      seeds: plan.seeds,
      candidateBundleDigest: CANDIDATE,
      environmentIdentity: ENVIRONMENT,
      telemetryRefs: ['runs/sc3-baseline/campaign-clean'],
    });

    expect(campaign.receipts).toHaveLength(3);
    expect(campaign.warmupTrials).toBe(1);
    expect(campaign.resetReceipts).toHaveLength(4);
    expect(campaign.resetReceipts.every((receipt) => receipt.exitCode === 0)).toBe(true);
    const summary = summarizeCampaign(campaign.receipts, plan);
    expect(summary.verdict).toBe('campaign_complete');
    expect(summary.counts).toEqual({ planned: 3, completed: 3, failed: 0, invalid: 0, censored: 0, notRun: 0 });
    writeReceipts('campaign-clean.json', { planHash: plan.planHash, receipts: campaign.receipts, summary });
  }, 120_000);

  it('marks a killed-and-never-restarted trial experiment_invalid (NEG3-17, real fault)', async () => {
    await admin.query(schema);
    const { port } = await rig.startService('v1');
    await rig.startConsumer();
    const plan = frozenPlan(1, 0);
    const serviceUrl = `http://127.0.0.1:${String(port)}`;

    const campaign = await runCampaign(plan, {
      trial: trialArgv(serviceUrl, 3, 20_000, 30_000),
      reset: resetArgv(),
      fault: { target: 'trial-process', action: 'kill', atMs: 100 },
      seeds: plan.seeds,
      candidateBundleDigest: CANDIDATE,
      environmentIdentity: ENVIRONMENT,
      telemetryRefs: ['runs/sc3-baseline/campaign-killed'],
    });

    expect(campaign.receipts).toHaveLength(1);
    const receipt = campaign.receipts[0];
    expect(receipt?.faultApplied).toBe(true);
    expect(receipt?.faultRemoved).toBe(false);
    expect(receipt?.result).toBe('excluded');
    const summary = summarizeCampaign(campaign.receipts, plan);
    expect(summary.verdict).toBe('experiment_invalid');
    writeReceipts('campaign-killed.json', { planHash: plan.planHash, receipts: campaign.receipts, summary });
  }, 120_000);

  it('records a healed fault as applied-and-removed with a passing receipt', async () => {
    await admin.query(schema);
    const { port } = await rig.startService('v1');
    await rig.startConsumer();
    const plan = frozenPlan(1, 0);
    const serviceUrl = `http://127.0.0.1:${String(port)}`;

    const campaign = await runCampaign(plan, {
      trial: trialArgv(serviceUrl, 2, 15_000, 30_000),
      reset: resetArgv(),
      fault: { target: 'trial-process', action: 'kill-and-restart', atMs: 100 },
      seeds: plan.seeds,
      candidateBundleDigest: CANDIDATE,
      environmentIdentity: ENVIRONMENT,
      telemetryRefs: ['runs/sc3-baseline/campaign-healed'],
    });

    expect(campaign.receipts).toHaveLength(1);
    const receipt = campaign.receipts[0];
    expect(receipt?.faultApplied).toBe(true);
    expect(receipt?.faultRemoved).toBe(true);
    expect(receipt?.result).toBe('pass');
    expect(campaign.executions[0]?.attempts).toHaveLength(2);
    const summary = summarizeCampaign(campaign.receipts, plan);
    expect(summary.verdict).toBe('campaign_complete');
    writeReceipts('campaign-healed.json', { planHash: plan.planHash, receipts: campaign.receipts, summary });
  }, 120_000);

  it('fails closed on an unlisted fault target, short seeds, and trial timeout', async () => {
    await admin.query(schema);
    // v2: orders never fulfill, so the timeout below is deterministic, not a race.
    const { port } = await rig.startService('v2');
    await rig.startConsumer();
    const plan = frozenPlan(1, 0);
    const serviceUrl = `http://127.0.0.1:${String(port)}`;
    const base = {
      trial: trialArgv(serviceUrl, 2, 15_000, 30_000),
      reset: resetArgv(),
      seeds: plan.seeds,
      candidateBundleDigest: CANDIDATE,
      environmentIdentity: ENVIRONMENT,
      telemetryRefs: ['runs/sc3-baseline/campaign-negatives'],
    };

    await expect(
      runCampaign(plan, { ...base, fault: { target: 'prod-database', action: 'kill', atMs: 0 } }),
    ).rejects.toThrow(/allowlist|frozen plan/i);
    await expect(runCampaign(plan, { ...base, seeds: [] })).rejects.toThrow(/seed/i);

    const timedOut = await runCampaign(plan, {
      ...base,
      trial: trialArgv(serviceUrl, 5, 60_000, 500),
    });
    expect(timedOut.receipts[0]?.result).toBe('fail');
    expect(timedOut.executions[0]?.attempts[0]?.timedOut).toBe(true);
  }, 120_000);
});
