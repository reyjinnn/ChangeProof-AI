import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIdentityStore } from '../../src/modules/identity/index.js';
import { assertCumulativeMonotonic, createUsageStore } from '../../src/modules/usage/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-24 / T-17 — atomic usage store + settlement on real PostgreSQL
 * (FR3-34, NEG3-13/25/36).
 *
 * Native check, reported separately from the pure suite: `pnpm test` excludes
 * `tests/native/**`; run with `DATABASE_URL=… pnpm test:identity:native`
 * against a disposable PostgreSQL 16 container. Fails closed without
 * DATABASE_URL. Applies V1 (tenancy) + V2 (services) + V4 (usage); every test
 * uses its own tenant ids so tests never share state.
 *
 * Written before the implementation. Admission is atomic under concurrency
 * (serialized on the entitlement row, capped, no default cap); usage events
 * are idempotent by effect identity (a retried consume never double-debits);
 * the ledger is append-only so cumulative consumption cannot move backwards;
 * settlement frees the unused hold and requires a server-side provider
 * receipt; period rollover preserves in-flight consumption.
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL is required (e.g. postgresql://postgres:<pw>@127.0.0.1:55433/postgres). ' +
      'Start the disposable probe container first; see docs/phase-reports/phase-2.md.',
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const migration = (name: string): string =>
  readFileSync(join(here, '..', '..', 'infra', 'postgres', name), 'utf8');
const v1 = migration('V1__identity_tenancy.sql');
const v2 = migration('V2__identity_services.sql');
const v4 = migration('V4__usage.sql');

// Own database per file: scheduling (serial or parallel) cannot cross-talk.
const fileDbUrl = databaseUrlFor(databaseUrl, 't_usage');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });
const identity = createIdentityStore(appPool);
const store = createUsageStore(appPool);

const NOW = '2026-11-01T00:00:00.000Z';

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function effectId(tag: string): string {
  if (tag.length === 0) {
    throw new Error('Effect tag must not be empty.');
  }
  counter += 1;
  return counter.toString(16).padStart(64, '0');
}

async function seedTenantWithCap(cap: number): Promise<{ tenantId: string; periodId: string }> {
  const tenantId = uniqueId('tenant');
  const periodId = uniqueId('period');
  await identity.createTenant(tenantId);
  await store.setEntitlement({ tenantId, capAmount: cap, rateVersion: uniqueId('rate'), periodId, nowIso: NOW });
  return { tenantId, periodId };
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_usage');
  await admin.query(v1);
  await admin.query(v2);
  await admin.query(v4);
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('entitlements gate admission with no default cap', () => {
  it('admits a fitting reservation and reports the active hold', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const admitted = await store.admitReservation({
      tenantId,
      runId: uniqueId('run'),
      reservationId: uniqueId('res'),
      effectId: effectId('reserve'),
      requested: 40,
      nowIso: NOW,
    });
    expect(admitted.duplicate).toBe(false);
    expect(admitted.reserved).toBe(40);
    const balances = await store.readBalances({ tenantId });
    expect(balances.reservedActive).toBe(40);
    expect(balances.consumed).toBe(0);
  });

  it('refuses admission when no entitlement exists instead of inventing a cap', async () => {
    const tenantId = uniqueId('tenant-nocap');
    await identity.createTenant(tenantId);
    await expect(
      store.admitReservation({
        tenantId,
        runId: uniqueId('run'),
        reservationId: uniqueId('res'),
        effectId: effectId('reserve'),
        requested: 10,
        nowIso: NOW,
      }),
    ).rejects.toThrow(/entitlement|cap/i);
  });

  it('replays the same reservation identity without a second hold or ledger row', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const reservationId = uniqueId('res');
    const reserveEffect = effectId('reserve');
    const input = {
      tenantId,
      runId: uniqueId('run'),
      reservationId,
      effectId: reserveEffect,
      requested: 30,
      nowIso: NOW,
    };
    const first = await store.admitReservation(input);
    const replay = await store.admitReservation(input);
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.reserved).toBe(30);
    const balances = await store.readBalances({ tenantId });
    expect(balances.reservedActive).toBe(30);
  });
});

describe('concurrent admission is atomic and capped (NEG3-25)', () => {
  it('admits exactly what fits when three reservations race a cap of 100', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const attempts = await Promise.allSettled(
      [1, 2, 3].map(() =>
        store.admitReservation({
          tenantId,
          runId: uniqueId('run'),
          reservationId: uniqueId('res'),
          effectId: effectId('reserve-race'),
          requested: 40,
          nowIso: NOW,
        }),
      ),
    );
    const admitted = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(admitted).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    const balances = await store.readBalances({ tenantId });
    expect(balances.reservedActive).toBe(80);
  });
});

describe('consumption burns the hold without double debit (NEG3-25)', () => {
  it('burns the hold, rejects overspend, and dedups a retried consume', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const reservationId = uniqueId('res');
    await store.admitReservation({
      tenantId,
      runId: uniqueId('run'),
      reservationId,
      effectId: effectId('reserve'),
      requested: 100,
      nowIso: NOW,
    });
    const first = await store.recordConsume({
      tenantId,
      reservationId,
      effectId: effectId('consume'),
      provider: 'compute',
      measuredUnits: 30,
      unitName: 'cpu-second',
      nowIso: NOW,
    });
    expect(first.consumed).toBe(30);
    expect(first.reserved).toBe(70);
    expect(first.duplicate).toBe(false);
    await expect(
      store.recordConsume({
        tenantId,
        reservationId,
        effectId: effectId('consume-big'),
        provider: 'compute',
        measuredUnits: 71,
        unitName: 'cpu-second',
        nowIso: NOW,
      }),
    ).rejects.toThrow(/exceed|hold|reservation/i);
    const replayEffect = effectId('consume-replay');
    const consumeInput = {
      tenantId,
      reservationId,
      effectId: replayEffect,
      provider: 'compute',
      measuredUnits: 10,
      unitName: 'cpu-second',
      nowIso: NOW,
    };
    const once = await store.recordConsume(consumeInput);
    const twice = await store.recordConsume(consumeInput);
    expect(once.duplicate).toBe(false);
    expect(twice.duplicate).toBe(true);
    expect(twice.consumed).toBe(40);
    const balances = await store.readBalances({ tenantId });
    expect(balances.consumed).toBe(40);
    expect(balances.reservedActive).toBe(60);
  });

  it('lets exactly one of two racing consumes win when only one fits the hold', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const reservationId = uniqueId('res');
    await store.admitReservation({
      tenantId,
      runId: uniqueId('run'),
      reservationId,
      effectId: effectId('reserve'),
      requested: 100,
      nowIso: NOW,
    });
    const attempts = await Promise.allSettled([
      store.recordConsume({
        tenantId,
        reservationId,
        effectId: effectId('race-a'),
        provider: 'compute',
        measuredUnits: 60,
        unitName: 'cpu-second',
        nowIso: NOW,
      }),
      store.recordConsume({
        tenantId,
        reservationId,
        effectId: effectId('race-b'),
        provider: 'compute',
        measuredUnits: 60,
        unitName: 'cpu-second',
        nowIso: NOW,
      }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const balances = await store.readBalances({ tenantId });
    expect(balances.consumed).toBe(60);
  });
});

describe('release and settlement free the hold without resetting consumption (NEG3-13)', () => {
  it('releases a cancelled reservation and refuses further consumption', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const reservationId = uniqueId('res');
    await store.admitReservation({
      tenantId,
      runId: uniqueId('run'),
      reservationId,
      effectId: effectId('reserve'),
      requested: 50,
      nowIso: NOW,
    });
    await store.recordConsume({
      tenantId,
      reservationId,
      effectId: effectId('consume'),
      provider: 'compute',
      measuredUnits: 20,
      unitName: 'cpu-second',
      nowIso: NOW,
    });
    const released = await store.releaseReservation({
      tenantId,
      reservationId,
      effectId: effectId('release'),
      nowIso: NOW,
    });
    expect(released.released).toBe(30);
    const balances = await store.readBalances({ tenantId });
    expect(balances.consumed).toBe(20);
    expect(balances.reservedActive).toBe(0);
    await expect(
      store.recordConsume({
        tenantId,
        reservationId,
        effectId: effectId('consume-late'),
        provider: 'compute',
        measuredUnits: 1,
        unitName: 'cpu-second',
        nowIso: NOW,
      }),
    ).rejects.toThrow(/closed|released|settled/i);
  });

  it('settles with a provider receipt and keeps consumption across the close', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const reservationId = uniqueId('res');
    await store.admitReservation({
      tenantId,
      runId: uniqueId('run'),
      reservationId,
      effectId: effectId('reserve'),
      requested: 50,
      nowIso: NOW,
    });
    await store.recordConsume({
      tenantId,
      reservationId,
      effectId: effectId('consume'),
      provider: 'model',
      measuredUnits: 20,
      unitName: 'token-thousand',
      nowIso: NOW,
    });
    await expect(
      store.settleReservation({
        tenantId,
        reservationId,
        effectId: effectId('settle-noreceipt'),
        providerReceiptRef: '',
        nowIso: NOW,
      }),
    ).rejects.toThrow(/receipt/i);
    const settled = await store.settleReservation({
      tenantId,
      reservationId,
      effectId: effectId('settle'),
      providerReceiptRef: uniqueId('receipt'),
      nowIso: NOW,
    });
    expect(settled.consumed).toBe(20);
    expect(settled.released).toBe(30);
    expect(settled.duplicate).toBe(false);
    const replay = await store.settleReservation({
      tenantId,
      reservationId,
      effectId: settled.settleEffectId,
      providerReceiptRef: uniqueId('receipt-other'),
      nowIso: NOW,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.consumed).toBe(20);
    const balances = await store.readBalances({ tenantId });
    expect(balances.consumed).toBe(20);
    expect(balances.reservedActive).toBe(0);
  });

  it('keeps cumulative consumption monotonic across every event (NEG3-13)', async () => {
    const { tenantId } = await seedTenantWithCap(200);
    const seen: number[] = [0];
    for (const amount of [50, 30]) {
      const reservationId = uniqueId('res');
      await store.admitReservation({
        tenantId,
        runId: uniqueId('run'),
        reservationId,
        effectId: effectId('reserve'),
        requested: amount,
        nowIso: NOW,
      });
      await store.recordConsume({
        tenantId,
        reservationId,
        effectId: effectId('consume'),
        provider: 'compute',
        measuredUnits: amount / 2,
        unitName: 'cpu-second',
        nowIso: NOW,
      });
      seen.push((await store.readBalances({ tenantId })).consumed);
    }
    expect(seen).toEqual([0, 25, 40]);
    expect(() => {
      assertCumulativeMonotonic(seen);
    }).not.toThrow();
  });
});

describe('period rollover preserves in-flight consumption (NEG3-13)', () => {
  it('opens a new capped period while the old reservation keeps its balances', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const reservationId = uniqueId('res');
    await store.admitReservation({
      tenantId,
      runId: uniqueId('run'),
      reservationId,
      effectId: effectId('reserve'),
      requested: 60,
      nowIso: NOW,
    });
    await store.recordConsume({
      tenantId,
      reservationId,
      effectId: effectId('consume'),
      provider: 'compute',
      measuredUnits: 25,
      unitName: 'cpu-second',
      nowIso: NOW,
    });
    const nextPeriod = uniqueId('period-next');
    await store.rolloverPeriod({
      tenantId,
      newPeriodId: nextPeriod,
      capAmount: 500,
      rateVersion: uniqueId('rate-next'),
      nowIso: NOW,
    });
    const balances = await store.readBalances({ tenantId });
    expect(balances.periodId).toBe(nextPeriod);
    expect(balances.cap).toBe(500);
    expect(balances.consumed).toBe(25);
    expect(balances.reservedActive).toBe(35);
    // The old reservation still burns its own hold after the rollover.
    const after = await store.recordConsume({
      tenantId,
      reservationId,
      effectId: effectId('consume-after'),
      provider: 'compute',
      measuredUnits: 10,
      unitName: 'cpu-second',
      nowIso: NOW,
    });
    expect(after.consumed).toBe(35);
  });
});

describe('tenant isolation and the deletion fence hold (FR3-32)', () => {
  it('isolates balances and consumption per tenant', async () => {
    const first = await seedTenantWithCap(100);
    const second = await seedTenantWithCap(100);
    const reservationId = uniqueId('res');
    await store.admitReservation({
      tenantId: first.tenantId,
      runId: uniqueId('run'),
      reservationId,
      effectId: effectId('reserve'),
      requested: 50,
      nowIso: NOW,
    });
    await expect(
      store.recordConsume({
        tenantId: second.tenantId,
        reservationId,
        effectId: effectId('consume-x'),
        provider: 'compute',
        measuredUnits: 10,
        unitName: 'cpu-second',
        nowIso: NOW,
      }),
    ).rejects.toThrow();
    const balances = await store.readBalances({ tenantId: second.tenantId });
    expect(balances.consumed).toBe(0);
    expect(balances.reservedActive).toBe(0);
  });

  it('refuses new reservations for a fenced tenant', async () => {
    const { tenantId } = await seedTenantWithCap(100);
    const ownerId = uniqueId('user-owner');
    await admin.query(
      `INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, 'owner', 0)`,
      [tenantId, ownerId],
    );
    await admin.query(`SELECT fence_tenant($1, $2, $3, $4, $5)`, [
      tenantId,
      ownerId,
      'probe-deletion',
      NOW,
      uniqueId('ret'),
    ]);
    await expect(
      store.admitReservation({
        tenantId,
        runId: uniqueId('run'),
        reservationId: uniqueId('res'),
        effectId: effectId('reserve'),
        requested: 10,
        nowIso: NOW,
      }),
    ).rejects.toThrow(/fence|deleted/i);
  });
});
