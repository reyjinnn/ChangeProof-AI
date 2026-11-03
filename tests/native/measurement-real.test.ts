import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { reduceMatchedWindows, reducerDigestFor } from '../../src/modules/verifier/index.js';

import { databaseUrlFor, redisUrlFor, resetProbeDatabase } from './db.js';
import { createRig } from './fixture-rig.js';

/**
 * WP3-17 — measurement reducers over real observations (dry run).
 *
 * The trusted reducer (`reduceMatchedWindows`) assesses latency windows
 * measured live on the fixture rig: matched v1 windows must assess
 * deterministically, and a window with real measurement loss (service killed
 * mid-window) must turn `inconclusive`/`invalid`, never a pass (NEG3-18).
 * Receipts land in runs/sc3-baseline/ (gitignored).
 *
 * The threshold below is fixed BEFORE the run and is labeled for what it is:
 * a disposable-rig sandbox budget, not a product SLO. Real SLOs are frozen by
 * the owner (see fixtures/sc3-baseline/CALIBRATION-PROPOSAL.md). No candidate
 * arm exists yet — the healthy/failing/candidate trio of FR3-27.3 needs the
 * WP3-07 repair loop; healthy (v1) vs failing (v2) is proven in WP3-06.
 */

// Fixed before the run: generous local-rig budget, NOT a product SLO.
const PROPOSED_THRESHOLD_MS = 5000;

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required; start the disposable PostgreSQL container first.');
}
if (redisUrl === undefined || redisUrl.length === 0) {
  throw new Error('REDIS_URL is required; start the disposable Redis container first.');
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'fixtures', 'sc3-baseline');
const schema = readFileSync(join(fixtureDir, 'schema.sql'), 'utf8');

// Own database + redis db per file: scheduling cannot cross-talk.
const fileDbUrl = databaseUrlFor(databaseUrl, 't_measure');
const fileRedisUrl = redisUrlFor(redisUrl, 2);
const admin = new Pool({ connectionString: fileDbUrl });
const redis = createClient({ url: fileRedisUrl });
const rig = createRig({ databaseUrl: fileDbUrl, redisUrl: fileRedisUrl, fixtureDir });

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_measure');
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

describe('reducers assess real matched windows deterministically (dry run)', () => {
  it('passes three real v1 windows with a pinned digest and raw refs', async () => {
    await admin.query(schema);
    const { port } = await rig.startService('v1');
    await rig.startConsumer();
    const windows: { windowId: string; observations: number[] }[] = [];
    const orderIds: string[] = [];
    for (let window = 0; window < 3; window += 1) {
      const observations: number[] = [];
      for (let trial = 0; trial < 4; trial += 1) {
        const orderId = await rig.placeOrder(port, 'tenant-a', 1200 + trial);
        orderIds.push(orderId);
        observations.push(await rig.waitForStatus(port, orderId, 'fulfilled', 10_000));
      }
      windows.push({ windowId: `w-${String(window + 1)}`, observations });
    }
    const runDir = join(here, '..', '..', 'runs', 'sc3-baseline', new Date().toISOString().replaceAll(':', '-'));
    mkdirSync(runDir, { recursive: true });
    const rawRefs = [runDir, ...orderIds];
    const input = {
      dimension: 'performance' as const,
      metricId: 'order-fulfilled-latency-ms',
      algorithm: 'lower-median-p50',
      config: { p: 50 },
      threshold: { comparison: 'lt' as const, value: PROPOSED_THRESHOLD_MS },
      windows,
      rawRefs,
    };
    const first = reduceMatchedWindows(input);
    const second = reduceMatchedWindows(input);
    expect(first.result).toBe('pass');
    expect(first.measurementValidity).toBe('valid');
    expect(first.reducerDigest).toBe(reducerDigestFor('lower-median-p50', { p: 50 }));
    expect(second).toEqual(first);
    expect(first.uncertainty).toContain('pooled n=12');
    const sorted = windows.flatMap((window) => window.observations).sort((left, right) => left - right);
    const quantile = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    writeFileSync(
      join(runDir, 'measurement.json'),
      JSON.stringify(
        {
          case: 'SC3-01-baseline-slice',
          dimension: 'performance',
          frozen: false,
          note: 'Dry-run rig check with a proposed sandbox threshold, not a frozen SLO.',
          proposedThresholdMs: PROPOSED_THRESHOLD_MS,
          windows,
          distributionMs: { p50: quantile(0.5), p90: quantile(0.9), p99: quantile(0.99), max: sorted[sorted.length - 1] },
          assessment: { result: first.result, measurementValidity: first.measurementValidity },
          reducerDigest: first.reducerDigest,
        },
        null,
        2,
      ),
    );
  }, 60_000);

  it('turns inconclusive/invalid when a real window loses its service (NEG3-18)', async () => {
    await admin.query(schema);
    const { port } = await rig.startService('v1');
    await rig.startConsumer();
    const healthy: number[] = [];
    for (let trial = 0; trial < 4; trial += 1) {
      const orderId = await rig.placeOrder(port, 'tenant-a', 1200 + trial);
      healthy.push(await rig.waitForStatus(port, orderId, 'fulfilled', 10_000));
    }
    // Real loss: the service dies mid-campaign; every attempt in the next
    // window fails to connect and is counted dropped — never silently skipped.
    await rig.stopAll();
    let dropped = 0;
    for (let trial = 0; trial < 4; trial += 1) {
      try {
        await rig.placeOrder(port, 'tenant-a', 1300 + trial);
      } catch {
        dropped += 1;
      }
    }
    expect(dropped).toBe(4);
    const assessment = reduceMatchedWindows({
      dimension: 'performance',
      metricId: 'order-fulfilled-latency-ms',
      algorithm: 'lower-median-p50',
      config: { p: 50 },
      threshold: { comparison: 'lt', value: PROPOSED_THRESHOLD_MS },
      windows: [
        { windowId: 'w-healthy', observations: healthy },
        { windowId: 'w-blackout', observations: [], droppedObservations: dropped },
      ],
      rawRefs: ['runs/sc3-baseline/blackout-window'],
    });
    expect(assessment.result).toBe('inconclusive');
    expect(assessment.measurementValidity).toBe('invalid');
    expect(assessment.uncertainty).toContain('w-blackout');
  }, 60_000);
});
