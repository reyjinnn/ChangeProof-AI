import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { chromium } from 'playwright-core';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { databaseUrlFor, redisUrlFor, resetProbeDatabase } from './db.js';
import { createRig } from './fixture-rig.js';

/**
 * WP3-06 — SC3-01 baseline rig on a real app + PostgreSQL + Redis (dry run).
 *
 * Native check, reported separately from the pure suite. The rig (service
 * v1/v2 + pinned-v1 consumer as real child processes) is proven here:
 * old-valid fulfills repeatedly, the new version exhibits one attributed
 * failure (event-schema change breaks the pinned consumer) while its API
 * stays green. Receipts land in runs/sc3-baseline/ (gitignored).
 *
 * This is a rig dry run, NOT frozen-oracle acceptance: the oracle is frozen
 * only by the owner ceremony in fixtures/sc3-baseline/INTENT-PROPOSAL.md.
 * Requires DATABASE_URL + REDIS_URL (disposable containers); fails closed
 * without them. The browser case needs system Chrome (CHROME_PATH or the
 * default install path); a missing browser is a missing check, never a pass.
 */

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
const fileDbUrl = databaseUrlFor(databaseUrl, 't_fixture');
const fileRedisUrl = redisUrlFor(redisUrl, 1);
const admin = new Pool({ connectionString: fileDbUrl });
const redis = createClient({ url: fileRedisUrl });
const rig = createRig({ databaseUrl: fileDbUrl, redisUrl: fileRedisUrl, fixtureDir });

function receiptDir(): string {
  const runDir = join(here, '..', '..', 'runs', 'sc3-baseline', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_fixture');
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

describe('old-valid baseline fulfills repeatedly (dry run, [DERIVED] n=3)', () => {
  it('fulfills three consecutive v1 orders on real PostgreSQL + Redis', async () => {
    await admin.query(schema);
    const { port } = await rig.startService('v1');
    await rig.startConsumer();
    const orders: { orderId: string; fulfilledMs: number }[] = [];
    for (let trial = 0; trial < 3; trial += 1) {
      const orderId = await rig.placeOrder(port, 'tenant-a', 1200 + trial);
      const fulfilledMs = await rig.waitForStatus(port, orderId, 'fulfilled', 10_000);
      orders.push({ orderId, fulfilledMs });
    }
    writeFileSync(
      join(receiptDir(), 'baseline-old.json'),
      JSON.stringify(
        {
          case: 'SC3-01-baseline-slice',
          version: 'v1',
          frozen: false,
          note: 'Dry-run rig check; acceptance needs the owner freeze ceremony.',
          orders,
        },
        null,
        2,
      ),
    );
    expect(orders).toHaveLength(3);
  }, 30_000);
});

describe('new version exhibits one attributed failure (dry run)', () => {
  it('keeps the API green while the pinned consumer dead-letters v2 events', async () => {
    await admin.query(schema);
    const { port } = await rig.startService('v2');
    await rig.startConsumer();
    // API-level checks pass: the failure is workflow-level only.
    const orderId = await rig.placeOrder(port, 'tenant-a', 1200);
    expect(await rig.orderStatus(port, orderId)).toBe('created');
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    expect(await rig.orderStatus(port, orderId)).toBe('created');
    const dead = (await redis.xRange('order-deadletters', '-', '+')) ?? [];
    expect(dead.map((entry) => entry.message['cause'])).toContain('unsupported-event-schema');
    expect(dead.map((entry) => entry.message['orderId'])).toContain(orderId);
    writeFileSync(
      join(receiptDir(), 'baseline-new.json'),
      JSON.stringify(
        {
          case: 'SC3-01-baseline-slice',
          version: 'v2',
          frozen: false,
          note: 'Dry-run rig check; acceptance needs the owner freeze ceremony.',
          orderId,
          apiGreen: true,
          fulfilled: false,
          deadletterCause: 'unsupported-event-schema',
        },
        null,
        2,
      ),
    );
  }, 30_000);
});

describe('real browser places an order end to end (dry run)', () => {
  it('submits the order form in system Chrome and the order fulfills', async () => {
    const chromePath =
      process.env['CHROME_PATH'] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    await admin.query(schema);
    const { port } = await rig.startService('v1');
    await rig.startConsumer();
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${String(port)}/`);
      await page.fill('input[name="tenant"]', 'tenant-browser');
      await page.fill('input[name="amountCents"]', '2500');
      await page.click('button[type="submit"]');
      await page.waitForSelector('text=Order placed');
      const orderId = (await page.textContent('strong'))?.trim() ?? '';
      expect(orderId.startsWith('ord-')).toBe(true);
      await rig.waitForStatus(port, orderId, 'fulfilled', 10_000);
    } finally {
      await browser.close();
    }
  }, 30_000);
});
