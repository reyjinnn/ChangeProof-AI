import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIdentityStore } from '../../src/modules/identity/index.js';
import { createJobsStore } from '../../src/modules/jobs/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-23 / T-16 — durable dispatcher + hosted store on real PostgreSQL
 * (FR3-32/33, NEG3-22/23/26).
 *
 * Native check, reported separately from the pure suite: `pnpm test` excludes
 * `tests/native/**`; run with `DATABASE_URL=… pnpm test:identity:native`
 * against a disposable PostgreSQL 16 container. Fails closed without
 * DATABASE_URL. Applies V1 (tenancy) + V2 (services) + V3 (jobs); every test
 * uses its own tenant ids so tests never share state.
 *
 * Written before the implementation. Admission is one atomic transaction with
 * idempotent replay; claims are fenced by monotonic epoch + CAS version; a
 * resumed job keeps its candidate digest but always gets a fresh guest; a job
 * with unreconciled effects cannot complete; cancellation drains instead of
 * merely relabelling.
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL is required (e.g. postgresql://postgres:<pw>@127.0.0.1:55432/postgres). ' +
      'Start the disposable probe container first; see docs/phase-reports/phase-2.md.',
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const migration = (name: string): string =>
  readFileSync(join(here, '..', '..', 'infra', 'postgres', name), 'utf8');
const v1 = migration('V1__identity_tenancy.sql');
const v2 = migration('V2__identity_services.sql');
const v3 = migration('V3__jobs.sql');

// Own database per file: scheduling (serial or parallel) cannot cross-talk.
const fileDbUrl = databaseUrlFor(databaseUrl, 't_jobs');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });
const identity = createIdentityStore(appPool);
const store = createJobsStore(appPool);

const NOW = '2026-11-01T00:00:00.000Z';
const HOUR_MS = 3_600_000;
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function seedTenant(prefix = 'tenant'): Promise<string> {
  const tenantId = uniqueId(prefix);
  await identity.createTenant(tenantId);
  return tenantId;
}

async function admit(tenantId: string, keySuffix = 'key'): Promise<{ runId: string; jobId: string }> {
  const admitted = await store.admitRun({
    runId: uniqueId('run'),
    jobId: uniqueId('job'),
    tenantId,
    idempotencyKey: `${uniqueId('idem')}-${keySuffix}`,
    reservationId: uniqueId('res'),
    nowIso: NOW,
  });
  return { runId: admitted.runId, jobId: admitted.jobId };
}

function claimInput(tenantId: string, jobOverrides = {}): {
  tenantId: string;
  workerId: string;
  guestId: string;
  imageDigest: string;
  candidateDigest: string;
  planDigest: string;
  grantVersion: number;
  ttlMs: number;
  maxConcurrent: number;
  nowIso: string;
} {
  return {
    tenantId,
    workerId: uniqueId('worker'),
    guestId: uniqueId('guest'),
    imageDigest: DIGEST_A,
    candidateDigest: DIGEST_B,
    planDigest: DIGEST_C,
    grantVersion: 0,
    ttlMs: HOUR_MS,
    maxConcurrent: 4,
    nowIso: NOW,
    ...jobOverrides,
  };
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_jobs');
  await admin.query(v1);
  await admin.query(v2);
  await admin.query(v3);
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('admission is atomic and idempotent (NEG3-23)', () => {
  it('admits a run with its job in one transaction', async () => {
    const tenantId = await seedTenant();
    const { runId, jobId } = await admit(tenantId);
    const claimed = await store.claimJob(claimInput(tenantId));
    expect(claimed?.jobId).toBe(jobId);
    expect(claimed?.lease.runId).toBe(runId);
    expect(claimed?.lease.epoch).toBe(1);
  });

  it('replays the same idempotency key to the same run without a second job', async () => {
    const tenantId = await seedTenant();
    const key = uniqueId('idem-replay');
    const first = await store.admitRun({
      runId: uniqueId('run'),
      jobId: uniqueId('job'),
      tenantId,
      idempotencyKey: key,
      reservationId: uniqueId('res'),
      nowIso: NOW,
    });
    const second = await store.admitRun({
      runId: uniqueId('run-other'),
      jobId: uniqueId('job-other'),
      tenantId,
      idempotencyKey: key,
      reservationId: uniqueId('res-other'),
      nowIso: NOW,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.runId).toBe(first.runId);
    expect(second.jobId).toBe(first.jobId);
  });

  it('refuses admission for a fenced (deleted) tenant', async () => {
    const tenantId = await seedTenant();
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
      store.admitRun({
        runId: uniqueId('run'),
        jobId: uniqueId('job'),
        tenantId,
        idempotencyKey: uniqueId('idem'),
        reservationId: uniqueId('res'),
        nowIso: NOW,
      }),
    ).rejects.toThrow(/fence|deleted/i);
    await expect(store.claimJob(claimInput(tenantId))).rejects.toThrow(/fence|deleted/i);
  });
});

describe('claims are fenced, capped and fair per tenant', () => {
  it('hands one job to one worker; a second claim finds nothing while active', async () => {
    const tenantId = await seedTenant();
    const { jobId } = await admit(tenantId);
    const first = await store.claimJob(claimInput(tenantId));
    expect(first?.jobId).toBe(jobId);
    const second = await store.claimJob(claimInput(tenantId));
    expect(second).toBeNull();
  });

  it('enforces the per-tenant concurrency cap without blocking other tenants', async () => {
    const tenantId = await seedTenant('tenant-capped');
    const otherId = await seedTenant('tenant-free');
    await admit(tenantId, 'k1');
    await admit(tenantId, 'k2');
    const otherJob = await admit(otherId, 'k1');
    const first = await store.claimJob({ ...claimInput(tenantId), maxConcurrent: 1 });
    expect(first).not.toBeNull();
    const capped = await store.claimJob({ ...claimInput(tenantId), maxConcurrent: 1 });
    expect(capped).toBeNull();
    const other = await store.claimJob({ ...claimInput(otherId), maxConcurrent: 1 });
    expect(other?.jobId).toBe(otherJob.jobId);
  });

  it('claims the oldest queued job first (FIFO)', async () => {
    const tenantId = await seedTenant();
    const firstJob = await admit(tenantId, 'k1');
    await admit(tenantId, 'k2');
    const claimed = await store.claimJob(claimInput(tenantId));
    expect(claimed?.jobId).toBe(firstJob.jobId);
  });
});

describe('heartbeats extend the lease under compare-and-swap', () => {
  it('extends expiry and bumps the version on current authority', async () => {
    const tenantId = await seedTenant();
    await admit(tenantId);
    const claimed = await store.claimJob(claimInput(tenantId));
    const lease = claimed?.lease;
    expect(lease).toBeDefined();
    if (lease === undefined) {
      throw new Error('claim must succeed for the heartbeat test');
    }
    const beat = await store.heartbeat({
      tenantId,
      jobId: lease.jobId,
      ownerId: lease.ownerId,
      epoch: lease.epoch,
      version: lease.version,
      ttlMs: HOUR_MS,
      nowIso: '2026-11-01T00:30:00.000Z',
      currentGrantVersion: 0,
    });
    expect(beat.version).toBe(lease.version + 1);
    expect(Date.parse(beat.expiresAt)).toBeGreaterThan(Date.parse(lease.expiresAt));
  });

  it('rejects a heartbeat that lost the version race', async () => {
    const tenantId = await seedTenant();
    await admit(tenantId);
    const claimed = await store.claimJob(claimInput(tenantId));
    const lease = claimed?.lease;
    if (lease === undefined) {
      throw new Error('claim must succeed for the race test');
    }
    const base = {
      tenantId,
      jobId: lease.jobId,
      ownerId: lease.ownerId,
      epoch: lease.epoch,
      ttlMs: HOUR_MS,
      nowIso: NOW,
      currentGrantVersion: 0,
    };
    await store.heartbeat({ ...base, version: lease.version });
    await expect(store.heartbeat({ ...base, version: lease.version })).rejects.toThrow(/version|race/i);
  });
});

describe('fenced writes reject stale, revoked and cancelled authority (NEG3-22/23/26)', () => {
  it('accepts a checkpoint on current authority and chains versions', async () => {
    const tenantId = await seedTenant();
    await admit(tenantId);
    const claimed = await store.claimJob(claimInput(tenantId));
    const lease = claimed?.lease;
    if (lease === undefined) {
      throw new Error('claim must succeed for the checkpoint test');
    }
    const base = {
      tenantId,
      jobId: lease.jobId,
      ownerId: lease.ownerId,
      epoch: lease.epoch,
      nowIso: NOW,
      currentGrantVersion: 0,
    };
    const first = await store.writeCheckpoint({ ...base, version: lease.version, stateRef: 'state-1' });
    const second = await store.writeCheckpoint({ ...base, version: first.version, stateRef: 'state-2' });
    expect(second.version).toBe(first.version + 1);
  });

  it('rejects writes from a stale epoch, a moved grant, and after cancel', async () => {
    const tenantId = await seedTenant();
    await admit(tenantId);
    const claimed = await store.claimJob(claimInput(tenantId));
    const lease = claimed?.lease;
    if (lease === undefined) {
      throw new Error('claim must succeed for the fencing test');
    }
    const base = {
      tenantId,
      jobId: lease.jobId,
      ownerId: lease.ownerId,
      stateRef: 'state-x',
      nowIso: NOW,
    };
    await expect(
      store.writeCheckpoint({ ...base, epoch: lease.epoch - 1, version: lease.version, currentGrantVersion: 0 }),
    ).rejects.toThrow(/stale epoch/i);
    await expect(
      store.writeCheckpoint({ ...base, epoch: lease.epoch, version: lease.version, currentGrantVersion: 1 }),
    ).rejects.toThrow(/revoked|grant/i);
    await store.requestCancel({ tenantId, jobId: lease.jobId, nowIso: NOW });
    await expect(
      store.writeCheckpoint({ ...base, epoch: lease.epoch, version: lease.version, currentGrantVersion: 0 }),
    ).rejects.toThrow(/cancel/i);
  });
});

describe('crash and resume preserve identity with a fresh guest', () => {
  it('resumes an expired lease with epoch+1, a new guest, and the same candidate', async () => {
    const tenantId = await seedTenant();
    await admit(tenantId);
    const firstInput = { ...claimInput(tenantId), ttlMs: 1000 };
    const claimed = await store.claimJob(firstInput);
    const lease = claimed?.lease;
    if (lease === undefined) {
      throw new Error('claim must succeed for the resume test');
    }
    const expired = await store.expireStaleLeases({ tenantId, nowIso: '2026-11-01T02:00:00.000Z', maxRetries: 3 });
    expect(expired).toEqual({ expired: 1, failed: 0 });
    const resumed = await store.claimJob(claimInput(tenantId));
    expect(resumed?.jobId).toBe(lease.jobId);
    expect(resumed?.lease.epoch).toBe(lease.epoch + 1);
    expect(resumed?.guestId).not.toBe(firstInput.guestId);
    expect(resumed?.lease.candidateDigest).toBe(DIGEST_B);
    expect(resumed?.lease.retryCount).toBe(lease.retryCount + 1);
    // The stale owner can no longer write, even with its old version.
    await expect(
      store.writeCheckpoint({
        tenantId,
        jobId: lease.jobId,
        ownerId: lease.ownerId,
        epoch: lease.epoch,
        version: lease.version,
        stateRef: 'stale-write',
        nowIso: NOW,
        currentGrantVersion: 0,
      }),
    ).rejects.toThrow(/stale epoch/i);
  });

  it('refuses a resume that names a different candidate digest', async () => {
    const tenantId = await seedTenant();
    await admit(tenantId);
    await store.claimJob({ ...claimInput(tenantId), ttlMs: 1000 });
    await store.expireStaleLeases({ tenantId, nowIso: '2026-11-01T02:00:00.000Z', maxRetries: 3 });
    await expect(
      store.claimJob({ ...claimInput(tenantId), candidateDigest: 'd'.repeat(64) }),
    ).rejects.toThrow(/candidate/i);
  });

  it('fails the job once retries are exhausted instead of resuming forever', async () => {
    const tenantId = await seedTenant();
    await admit(tenantId);
    const claimed = await store.claimJob({ ...claimInput(tenantId), ttlMs: 1000 });
    const lease = claimed?.lease;
    if (lease === undefined) {
      throw new Error('claim must succeed for the exhaustion test');
    }
    const outcome = await store.expireStaleLeases({ tenantId, nowIso: '2026-11-01T02:00:00.000Z', maxRetries: 0 });
    expect(outcome).toEqual({ expired: 0, failed: 1 });
    expect(await store.claimJob(claimInput(tenantId))).toBeNull();
    await expect(
      store.writeCheckpoint({
        tenantId,
        jobId: lease.jobId,
        ownerId: lease.ownerId,
        epoch: lease.epoch,
        version: lease.version,
        stateRef: 'after-fail',
        nowIso: NOW,
        currentGrantVersion: 0,
      }),
    ).rejects.toThrow();
  });
});

describe('cancel drains instead of relabelling (NEG3-26)', () => {
  it('cancels a queued job immediately and settles a claimed one after drain', async () => {
    const tenantId = await seedTenant();
    const queued = await admit(tenantId, 'k1');
    const active = await admit(tenantId, 'k2');
    const claimed = await store.claimJob(claimInput(tenantId));
    expect(claimed?.jobId).toBe(queued.jobId);
    await store.requestCancel({ tenantId, jobId: queued.jobId, nowIso: NOW });
    await store.requestCancel({ tenantId, jobId: active.jobId, nowIso: NOW });
    await store.settleCancelled({ tenantId, jobId: queued.jobId, nowIso: NOW });
    await store.settleCancelled({ tenantId, jobId: active.jobId, nowIso: NOW });
    expect(await store.claimJob(claimInput(tenantId))).toBeNull();
  });

  it('refuses to settle a job whose cancel was never requested', async () => {
    const tenantId = await seedTenant();
    const { jobId } = await admit(tenantId);
    await expect(store.settleCancelled({ tenantId, jobId, nowIso: NOW })).rejects.toThrow(/cancel/i);
  });
});

describe('outbox effects reconcile to one logical effect (NEG3-23)', () => {
  it('dedups the same effect, dispatches once, and gates completion on reconcile', async () => {
    const tenantId = await seedTenant();
    await admit(tenantId);
    const claimed = await store.claimJob(claimInput(tenantId));
    const lease = claimed?.lease;
    if (lease === undefined) {
      throw new Error('claim must succeed for the outbox test');
    }
    const authority = {
      tenantId,
      jobId: lease.jobId,
      ownerId: lease.ownerId,
      epoch: lease.epoch,
      version: lease.version,
      nowIso: NOW,
      currentGrantVersion: 0,
    };
    const effectId = 'e'.repeat(64);
    const first = await store.enqueueEffect({ ...authority, effectId, kind: 'result', payloadRef: 'sha:1' });
    const replay = await store.enqueueEffect({ ...authority, effectId, kind: 'result', payloadRef: 'sha:1' });
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    await expect(
      store.enqueueEffect({ ...authority, effectId, kind: 'result', payloadRef: 'sha:2' }),
    ).rejects.toThrow(/collision|identity/i);
    const batchA = await store.dispatchEffects({ tenantId, limit: 10, nowIso: NOW });
    const batchB = await store.dispatchEffects({ tenantId, limit: 10, nowIso: NOW });
    expect(batchA).toHaveLength(1);
    expect(batchB).toHaveLength(0);
    await expect(store.completeJob(authority)).rejects.toThrow(/reconcil/i);
    await store.reconcileEffect({ tenantId, effectId, outcome: 'done' });
    await store.completeJob(authority);
    expect(await store.claimJob(claimInput(tenantId))).toBeNull();
  });
});

describe('tenant isolation holds on every job path (FR3-32)', () => {
  it('lets no tenant claim, fence-write, or dispatch another tenant’s jobs', async () => {
    const tenantId = await seedTenant('tenant-owner');
    const otherId = await seedTenant('tenant-stranger');
    await admit(tenantId);
    expect(await store.claimJob(claimInput(otherId))).toBeNull();
    const claimed = await store.claimJob(claimInput(tenantId));
    const lease = claimed?.lease;
    if (lease === undefined) {
      throw new Error('claim must succeed for the isolation test');
    }
    await expect(
      store.writeCheckpoint({
        tenantId: otherId,
        jobId: lease.jobId,
        ownerId: lease.ownerId,
        epoch: lease.epoch,
        version: lease.version,
        stateRef: 'cross-tenant',
        nowIso: NOW,
        currentGrantVersion: 0,
      }),
    ).rejects.toThrow();
    await expect(
      store.heartbeat({
        tenantId: otherId,
        jobId: lease.jobId,
        ownerId: lease.ownerId,
        epoch: lease.epoch,
        version: lease.version,
        ttlMs: HOUR_MS,
        nowIso: NOW,
        currentGrantVersion: 0,
      }),
    ).rejects.toThrow();
    expect(await store.dispatchEffects({ tenantId: otherId, limit: 10, nowIso: NOW })).toHaveLength(0);
  });
});
