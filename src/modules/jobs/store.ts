import { z } from 'zod';

import {
  ChangeProofError,
  IdSchema,
  InstantSchema,
  JobLeaseSchema,
  NonEmptyStringSchema,
  Sha256Schema,
  type JobLease,
} from '../../core/index.js';

import { assertLeaseWritable, nextRetryCount } from './fencing.js';
import { assertOpsAdmissibleClient } from './ops-store.js';

/**
 * PostgreSQL-backed durable dispatcher (WP3-23, FR3-32/33).
 *
 * Runs, jobs, leases, outbox, and checkpoints live in `infra/postgres/V3` and
 * are reached only with bound parameters — never interpolation. Tenant-scoped
 * reads/writes run in a transaction with the tenant bound via
 * `set_config(..., is_local => true)` (auto-reset, no pool leak).
 *
 * Authority rules, enforced here:
 * - Admission is one transaction (run + job) with idempotent replay by
 *   idempotency key; a fenced tenant admits nothing.
 * - Claims are per-tenant FIFO under a concurrency cap, each with a fresh
 *   guest id; a re-claim after expiry bumps the epoch and reuses the stored
 *   candidate digest — a different digest is a new job, never a resume.
 * - Every worker write loads the lease and passes the pure fencing guard
 *   first, then mutates with compare-and-swap on the version.
 * - Completion requires every effect reconciled; cancellation drains.
 *
 * Time is injected, never read. The database handle is a narrow interface,
 * not a driver import: production passes a `pg` pool (structurally
 * compatible), the boundary stays driver-free.
 */

export interface JobsDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface JobsDbClient {
  query(text: string, params?: readonly unknown[]): Promise<JobsDbResult>;
  release(): void;
}

export interface JobsDb {
  query(text: string, params?: readonly unknown[]): Promise<JobsDbResult>;
  connect(): Promise<JobsDbClient>;
}

const FencedRowSchema = z.object({ fenced: z.boolean() });

const LeaseRowSchema = z.object({
  job_id: z.string(),
  tenant_id: z.string(),
  run_id: z.string(),
  epoch: z.number().int(),
  version: z.number().int(),
  owner_id: z.string(),
  guest_id: z.string(),
  image_digest: z.string(),
  candidate_digest: z.string(),
  plan_digest: z.string(),
  heartbeat_at: z.date(),
  expires_at: z.date(),
  lease_state: z.string(),
  retry_count: z.number().int(),
  cancel_requested: z.boolean(),
  grant_version: z.number().int(),
});

const JobRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  state: z.string(),
});

const EffectKindSchema = z.enum(['result', 'usage', 'publication', 'notification']);
const ReconcileOutcomeSchema = z.enum(['done', 'redispatch']);

const OutboxRowSchema = z.object({
  effect_id: z.string(),
  job_id: z.string(),
  kind: z.string(),
  payload_ref: z.string(),
  state: z.string(),
  attempts: z.number().int(),
});

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}

/** Current-authority inputs shared by every fenced worker write. */
export interface FencedAuthority {
  readonly tenantId: string;
  readonly jobId: string;
  readonly ownerId: string;
  readonly epoch: number;
  readonly version: number;
  readonly nowIso: string;
  readonly currentGrantVersion: number;
}

export interface AdmitRunInput {
  readonly runId: string;
  readonly jobId: string;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly reservationId: string;
  readonly nowIso: string;
}

export interface ClaimJobInput {
  readonly tenantId: string;
  readonly workerId: string;
  readonly guestId: string;
  readonly imageDigest: string;
  readonly candidateDigest: string;
  readonly planDigest: string;
  readonly grantVersion: number;
  readonly ttlMs: number;
  readonly maxConcurrent: number;
  readonly nowIso: string;
}

export interface HeartbeatInput extends FencedAuthority {
  readonly ttlMs: number;
}

export interface CheckpointInput extends FencedAuthority {
  readonly stateRef: string;
}

export interface EnqueueEffectInput extends FencedAuthority {
  readonly effectId: string;
  readonly kind: string;
  readonly payloadRef: string;
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ChangeProofError(`${name} must be a positive integer; refusing.`);
  }
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ChangeProofError(`${name} must be a non-negative integer; refusing.`);
  }
}

export interface JobsStore {
  admitRun(input: AdmitRunInput): Promise<{ runId: string; jobId: string; duplicate: boolean }>;
  claimJob(input: ClaimJobInput): Promise<{ jobId: string; lease: JobLease; guestId: string } | null>;
  heartbeat(input: HeartbeatInput): Promise<{ expiresAt: string; version: number }>;
  writeCheckpoint(input: CheckpointInput): Promise<{ version: number }>;
  enqueueEffect(input: EnqueueEffectInput): Promise<{ effectId: string; duplicate: boolean }>;
  dispatchEffects(input: {
    tenantId: string;
    limit: number;
    nowIso: string;
  }): Promise<readonly { effectId: string; jobId: string; kind: string; payloadRef: string; attempts: number }[]>;
  reconcileEffect(input: {
    tenantId: string;
    effectId: string;
    outcome: string;
  }): Promise<{ effectId: string; state: string }>;
  completeJob(input: FencedAuthority): Promise<void>;
  failJob(input: FencedAuthority): Promise<void>;
  requestCancel(input: { tenantId: string; jobId: string; nowIso: string }): Promise<void>;
  settleCancelled(input: { tenantId: string; jobId: string; nowIso: string }): Promise<void>;
  expireStaleLeases(input: { tenantId: string; nowIso: string; maxRetries: number }): Promise<{
    expired: number;
    failed: number;
  }>;
}

const TERMINAL_JOB_STATES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled']);

export function createJobsStore(db: JobsDb): JobsStore {
  async function inTenant<T>(tenantId: string, work: (client: JobsDbClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      try {
        // Bound tenant, transaction-local: reset is automatic on COMMIT/ROLLBACK.
        await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async function assertTenantAdmitted(tenantId: string): Promise<void> {
    const fenced = await db.query(`SELECT is_tenant_fenced($1) AS fenced`, [tenantId]);
    if (FencedRowSchema.parse(fenced.rows[0]).fenced) {
      throw new ChangeProofError('Tenant is deleted; the deletion fence admits nothing new.');
    }
  }

  function toLease(row: z.infer<typeof LeaseRowSchema>): JobLease {
    return JobLeaseSchema.parse({
      schemaVersion: '1',
      tenantId: row.tenant_id,
      runId: row.run_id,
      jobId: row.job_id,
      imageDigest: row.image_digest,
      candidateDigest: row.candidate_digest,
      planDigest: row.plan_digest,
      epoch: row.epoch,
      ownerId: row.owner_id,
      heartbeatAt: row.heartbeat_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      state: row.lease_state,
      retryCount: row.retry_count,
      cancelRequested: row.cancel_requested,
      version: row.version,
      grantVersion: row.grant_version,
    });
  }

  async function loadAuthority(client: JobsDbClient, input: FencedAuthority): Promise<JobLease> {
    const jobId = IdSchema.parse(input.jobId);
    IdSchema.parse(input.ownerId);
    assertNonNegativeInt(input.version, 'Lease version');
    const found = await client.query(
      `SELECT l.job_id, l.tenant_id, j.run_id, l.epoch, l.version, l.owner_id, l.guest_id,
              l.image_digest, l.candidate_digest, l.plan_digest, l.heartbeat_at, l.expires_at,
              l.state AS lease_state, l.retry_count, l.cancel_requested, l.grant_version
         FROM job_leases l JOIN jobs j ON j.id = l.job_id
        WHERE l.job_id = $1`,
      [jobId],
    );
    if (found.rows.length === 0) {
      // Same message for missing and foreign-tenant jobs: RLS zeroes the
      // latter, and the caller learns nothing either way.
      throw new ChangeProofError('Job lease is unknown in this tenant; refusing.');
    }
    const lease = toLease(LeaseRowSchema.parse(found.rows[0]));
    // No owner comparison: the fencing epoch is the write authority. A
    // re-claim always bumps the epoch, so a superseded owner fails the epoch
    // check below with the spec-defined message.
    const nowIso = InstantSchema.parse(input.nowIso);
    assertNonNegativeInt(input.currentGrantVersion, 'Current grant version');
    assertLeaseWritable(lease, {
      epoch: input.epoch,
      version: input.version,
      nowIso,
      currentGrantVersion: input.currentGrantVersion,
    });
    return lease;
  }

  /** Recompute the run state from its jobs; call after every job transition. */
  async function syncRunState(client: JobsDbClient, runId: string): Promise<void> {
    const states = await client.query(`SELECT state FROM jobs WHERE run_id = $1`, [runId]);
    const names = states.rows.map((row) => (row as { state: string }).state);
    let next = 'queued';
    if (names.length > 0 && names.every((state) => state === 'cancelled')) {
      next = 'cancelled';
    } else if (names.includes('failed')) {
      next = 'failed';
    } else if (names.some((state) => state === 'claimed' || state === 'running')) {
      next = 'running';
    } else if (names.length > 0 && names.every((state) => state === 'succeeded')) {
      next = 'succeeded';
    }
    await client.query(`UPDATE runs SET state = $1 WHERE id = $2`, [next, runId]);
  }

  async function lockJob(client: JobsDbClient, jobId: string): Promise<z.infer<typeof JobRowSchema>> {
    const found = await client.query(`SELECT id, run_id, state FROM jobs WHERE id = $1 FOR UPDATE`, [jobId]);
    if (found.rows.length === 0) {
      throw new ChangeProofError('Job is unknown in this tenant; refusing.');
    }
    return JobRowSchema.parse(found.rows[0]);
  }

  async function finishJob(client: JobsDbClient, lease: JobLease, terminal: 'succeeded' | 'failed'): Promise<void> {
    const unacked = await client.query(
      `SELECT 1 FROM outbox WHERE job_id = $1 AND state IN ('pending', 'dispatched') LIMIT 1`,
      [lease.jobId],
    );
    if (unacked.rows.length > 0) {
      throw new ChangeProofError('Unreconciled effects remain; reconcile every effect before completion.');
    }
    const job = await lockJob(client, lease.jobId);
    if (TERMINAL_JOB_STATES.has(job.state)) {
      throw new ChangeProofError(`Job is already ${job.state}; refusing to re-finish.`);
    }
    const finished = await client.query(
      `UPDATE job_leases SET state = 'completed', version = version + 1 WHERE job_id = $1 AND version = $2`,
      [lease.jobId, lease.version],
    );
    if (finished.rowCount !== 1) {
      throw new ChangeProofError('Completion lost a version race; re-read the lease and retry.');
    }
    await client.query(`UPDATE jobs SET state = $1 WHERE id = $2`, [terminal, lease.jobId]);
    await syncRunState(client, lease.runId);
  }

  return {
    async admitRun(input: AdmitRunInput): Promise<{ runId: string; jobId: string; duplicate: boolean }> {
      const runId = IdSchema.parse(input.runId);
      const jobId = IdSchema.parse(input.jobId);
      const tenantId = IdSchema.parse(input.tenantId);
      const key = NonEmptyStringSchema.parse(input.idempotencyKey);
      const reservationId = IdSchema.parse(input.reservationId);
      const nowIso = InstantSchema.parse(input.nowIso);
      await assertTenantAdmitted(tenantId);
      return inTenant(tenantId, async (client) => {
        await assertOpsAdmissibleClient(client, { component: 'admission' });
        const inserted = await client.query(
          `INSERT INTO runs (id, tenant_id, idempotency_key, reservation_id, state, created_at)
           VALUES ($1, $2, $3, $4, 'queued', $5)
           ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
          [runId, tenantId, key, reservationId, nowIso],
        );
        if (inserted.rows.length > 0) {
          await client.query(
            `INSERT INTO jobs (id, tenant_id, run_id, state, created_at) VALUES ($1, $2, $3, 'queued', $4)`,
            [jobId, tenantId, runId, nowIso],
          );
          return { runId, jobId, duplicate: false };
        }
        const existing = await client.query(
          `SELECT r.id AS run_id, j.id AS job_id FROM runs r JOIN jobs j ON j.run_id = r.id
            WHERE r.tenant_id = $1 AND r.idempotency_key = $2 ORDER BY j.created_at, j.id LIMIT 1`,
          [tenantId, key],
        );
        if (existing.rows.length === 0) {
          // Lost a race with a concurrent admission that has not committed yet.
          throw new ChangeProofError('Admission raced; retry against current state.');
        }
        const row = existing.rows[0] as { run_id: string; job_id: string };
        return { runId: row.run_id, jobId: row.job_id, duplicate: true };
      });
    },

    async claimJob(
      input: ClaimJobInput,
    ): Promise<{ jobId: string; lease: JobLease; guestId: string } | null> {
      const tenantId = IdSchema.parse(input.tenantId);
      const workerId = IdSchema.parse(input.workerId);
      const guestId = IdSchema.parse(input.guestId);
      const imageDigest = Sha256Schema.parse(input.imageDigest);
      const candidateDigest = Sha256Schema.parse(input.candidateDigest);
      const planDigest = Sha256Schema.parse(input.planDigest);
      assertNonNegativeInt(input.grantVersion, 'Grant version');
      assertPositiveInt(input.ttlMs, 'Lease TTL');
      assertPositiveInt(input.maxConcurrent, 'Per-tenant concurrency cap');
      const nowIso = InstantSchema.parse(input.nowIso);
      const nowMs = Date.parse(nowIso);
      await assertTenantAdmitted(tenantId);
      return inTenant(tenantId, async (client) => {
        await assertOpsAdmissibleClient(client, { workerId, component: 'dispatch' });
        const active = await client.query(
          `SELECT COUNT(*)::int AS count FROM jobs WHERE tenant_id = $1 AND state IN ('claimed', 'running')`,
          [tenantId],
        );
        const activeCount = (active.rows[0] as { count: number }).count;
        if (activeCount >= input.maxConcurrent) {
          return null;
        }
        const next = await client.query(
          `SELECT id, run_id FROM jobs WHERE tenant_id = $1 AND state = 'queued'
           ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [tenantId],
        );
        if (next.rows.length === 0) {
          return null;
        }
        const picked = next.rows[0] as { id: string; run_id: string };
        const expiresAt = new Date(nowMs + input.ttlMs).toISOString();
        const prior = await client.query(`SELECT * FROM job_leases WHERE job_id = $1`, [picked.id]);
        if (prior.rows.length === 0) {
          await client.query(
            `INSERT INTO job_leases (job_id, tenant_id, epoch, version, owner_id, guest_id,
               image_digest, candidate_digest, plan_digest, heartbeat_at, expires_at,
               state, retry_count, cancel_requested, grant_version)
             VALUES ($1, $2, 1, 0, $3, $4, $5, $6, $7, $8, $9, 'active', 0, FALSE, $10)`,
            [picked.id, tenantId, workerId, guestId, imageDigest, candidateDigest, planDigest, nowIso, expiresAt,
              input.grantVersion],
          );
        } else {
          const row = prior.rows[0] as Record<string, unknown>;
          const state = row['state'];
          if (state !== 'expired') {
            throw new ChangeProofError('Job is not queued for claim; refusing to double-claim.');
          }
          if (
            row['candidate_digest'] !== candidateDigest ||
            row['image_digest'] !== imageDigest ||
            row['plan_digest'] !== planDigest
          ) {
            throw new ChangeProofError('Resume names different digests; a changed candidate is a new job, not a resume.');
          }
          await client.query(
            `UPDATE job_leases SET epoch = epoch + 1, version = version + 1, owner_id = $2, guest_id = $3,
                    heartbeat_at = $4, expires_at = $5, state = 'active' WHERE job_id = $1`,
            [picked.id, workerId, guestId, nowIso, expiresAt],
          );
        }
        await client.query(`UPDATE jobs SET state = 'claimed' WHERE id = $1`, [picked.id]);
        await syncRunState(client, picked.run_id);
        const reloaded = await client.query(
          `SELECT l.job_id, l.tenant_id, j.run_id, l.epoch, l.version, l.owner_id, l.guest_id,
                  l.image_digest, l.candidate_digest, l.plan_digest, l.heartbeat_at, l.expires_at,
                  l.state AS lease_state, l.retry_count, l.cancel_requested, l.grant_version
             FROM job_leases l JOIN jobs j ON j.id = l.job_id WHERE l.job_id = $1`,
          [picked.id],
        );
        const lease = toLease(LeaseRowSchema.parse(reloaded.rows[0]));
        return { jobId: picked.id, lease, guestId };
      });
    },

    async heartbeat(input: HeartbeatInput): Promise<{ expiresAt: string; version: number }> {
      const tenantId = IdSchema.parse(input.tenantId);
      assertPositiveInt(input.ttlMs, 'Lease TTL');
      const nowIso = InstantSchema.parse(input.nowIso);
      const expiresAt = new Date(Date.parse(nowIso) + input.ttlMs).toISOString();
      return inTenant(tenantId, async (client) => {
        const lease = await loadAuthority(client, input);
        const bumped = await client.query(
          `UPDATE job_leases SET heartbeat_at = $1, expires_at = $2, version = version + 1
           WHERE job_id = $3 AND version = $4`,
          [nowIso, expiresAt, lease.jobId, lease.version],
        );
        if (bumped.rowCount !== 1) {
          throw new ChangeProofError('Heartbeat lost a version race; re-read the lease and retry.');
        }
        return { expiresAt, version: lease.version + 1 };
      });
    },

    async writeCheckpoint(input: CheckpointInput): Promise<{ version: number }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const stateRef = NonEmptyStringSchema.parse(input.stateRef);
      const nowIso = InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const lease = await loadAuthority(client, input);
        const bumped = await client.query(
          `UPDATE job_leases SET version = version + 1 WHERE job_id = $1 AND version = $2`,
          [lease.jobId, lease.version],
        );
        if (bumped.rowCount !== 1) {
          throw new ChangeProofError('Checkpoint lost a version race; re-read the lease and retry.');
        }
        try {
          await client.query(
            `INSERT INTO checkpoints (job_id, version, tenant_id, epoch, state_ref, written_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [lease.jobId, lease.version + 1, tenantId, lease.epoch, stateRef, nowIso],
          );
        } catch (error) {
          if (errorCode(error) === '23505') {
            throw new ChangeProofError('Checkpoint version already written; re-read the lease and retry.');
          }
          throw error;
        }
        return { version: lease.version + 1 };
      });
    },

    async enqueueEffect(input: EnqueueEffectInput): Promise<{ effectId: string; duplicate: boolean }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const effectId = Sha256Schema.parse(input.effectId);
      const kind = EffectKindSchema.parse(input.kind);
      const payloadRef = NonEmptyStringSchema.parse(input.payloadRef);
      const nowIso = InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const lease = await loadAuthority(client, input);
        const inserted = await client.query(
          `INSERT INTO outbox (effect_id, tenant_id, job_id, kind, payload_ref, state, attempts, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', 0, $6)
           ON CONFLICT (effect_id) DO NOTHING RETURNING effect_id`,
          [effectId, tenantId, lease.jobId, kind, payloadRef, nowIso],
        );
        if (inserted.rows.length > 0) {
          return { effectId, duplicate: false };
        }
        const existing = await client.query(`SELECT * FROM outbox WHERE effect_id = $1`, [effectId]);
        const row = OutboxRowSchema.parse(existing.rows[0]);
        if (row.job_id === lease.jobId && row.kind === kind && row.payload_ref === payloadRef) {
          return { effectId, duplicate: true };
        }
        throw new ChangeProofError(
          'Effect identity collision: the same identity names different content; refusing.',
        );
      });
    },

    async dispatchEffects(input: { tenantId: string; limit: number; nowIso: string }): Promise<
      readonly { effectId: string; jobId: string; kind: string; payloadRef: string; attempts: number }[]
    > {
      const tenantId = IdSchema.parse(input.tenantId);
      assertPositiveInt(input.limit, 'Dispatch batch');
      if (input.limit > 1000) {
        throw new ChangeProofError('Dispatch batch exceeds the 1000-effect API bound; refusing.');
      }
      InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const pending = await client.query(
          `SELECT effect_id FROM outbox WHERE tenant_id = $1 AND state = 'pending'
           ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
          [tenantId, input.limit],
        );
        const ids = pending.rows.map((row) => (row as { effect_id: string }).effect_id);
        if (ids.length === 0) {
          return [];
        }
        const claimed = await client.query(
          `UPDATE outbox SET state = 'dispatched', attempts = attempts + 1
           WHERE effect_id = ANY($1) RETURNING effect_id, job_id, kind, payload_ref, attempts`,
          [ids],
        );
        return claimed.rows.map((row) => {
          const parsed = row as {
            effect_id: string;
            job_id: string;
            kind: string;
            payload_ref: string;
            attempts: number;
          };
          return {
            effectId: parsed.effect_id,
            jobId: parsed.job_id,
            kind: parsed.kind,
            payloadRef: parsed.payload_ref,
            attempts: parsed.attempts,
          };
        });
      });
    },

    async reconcileEffect(input: { tenantId: string; effectId: string; outcome: string }): Promise<{
      effectId: string;
      state: string;
    }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const effectId = Sha256Schema.parse(input.effectId);
      const outcome = ReconcileOutcomeSchema.parse(input.outcome);
      return inTenant(tenantId, async (client) => {
        const found = await client.query(`SELECT * FROM outbox WHERE effect_id = $1 FOR UPDATE`, [effectId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Effect is unknown in this tenant; refusing.');
        }
        const row = OutboxRowSchema.parse(found.rows[0]);
        if (row.state === 'done' && outcome === 'done') {
          return { effectId, state: 'done' };
        }
        if (row.state === 'done') {
          throw new ChangeProofError('Effect is already terminal; redispatch is refused.');
        }
        const next = outcome === 'done' ? 'done' : 'pending';
        await client.query(`UPDATE outbox SET state = $1 WHERE effect_id = $2`, [next, effectId]);
        return { effectId, state: next };
      });
    },

    async completeJob(input: FencedAuthority): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      return inTenant(tenantId, async (client) => {
        const lease = await loadAuthority(client, input);
        await finishJob(client, lease, 'succeeded');
      });
    },

    async failJob(input: FencedAuthority): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      return inTenant(tenantId, async (client) => {
        const lease = await loadAuthority(client, input);
        await finishJob(client, lease, 'failed');
      });
    },

    async requestCancel(input: { tenantId: string; jobId: string; nowIso: string }): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      const jobId = IdSchema.parse(input.jobId);
      InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const job = await lockJob(client, jobId);
        if (TERMINAL_JOB_STATES.has(job.state)) {
          return;
        }
        await client.query(`UPDATE job_leases SET cancel_requested = TRUE WHERE job_id = $1`, [jobId]);
        if (job.state === 'queued') {
          await client.query(`UPDATE jobs SET state = 'cancelled' WHERE id = $1`, [jobId]);
          await syncRunState(client, job.run_id);
        }
      });
    },

    async settleCancelled(input: { tenantId: string; jobId: string; nowIso: string }): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      const jobId = IdSchema.parse(input.jobId);
      InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const job = await lockJob(client, jobId);
        if (TERMINAL_JOB_STATES.has(job.state)) {
          return;
        }
        const found = await client.query(`SELECT cancel_requested, version FROM job_leases WHERE job_id = $1`, [
          jobId,
        ]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Cancel was never requested for this job; refusing to settle.');
        }
        const row = found.rows[0] as { cancel_requested: boolean; version: number };
        if (!row.cancel_requested) {
          throw new ChangeProofError('Cancel was never requested for this job; refusing to settle.');
        }
        const settled = await client.query(
          `UPDATE job_leases SET state = 'completed', version = version + 1 WHERE job_id = $1 AND version = $2`,
          [jobId, row.version],
        );
        if (settled.rowCount !== 1) {
          throw new ChangeProofError('Settle lost a version race; re-read the lease and retry.');
        }
        await client.query(`UPDATE jobs SET state = 'cancelled' WHERE id = $1`, [jobId]);
        await syncRunState(client, job.run_id);
      });
    },

    async expireStaleLeases(input: { tenantId: string; nowIso: string; maxRetries: number }): Promise<{
      expired: number;
      failed: number;
    }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const nowIso = InstantSchema.parse(input.nowIso);
      assertNonNegativeInt(input.maxRetries, 'Max retries');
      return inTenant(tenantId, async (client) => {
        const stale = await client.query(
          `SELECT l.job_id, l.retry_count, j.run_id FROM job_leases l JOIN jobs j ON j.id = l.job_id
           WHERE l.tenant_id = $1 AND l.state = 'active' AND l.expires_at <= $2::timestamptz FOR UPDATE OF l`,
          [tenantId, nowIso],
        );
        let expired = 0;
        let failed = 0;
        for (const unknownRow of stale.rows) {
          const row = unknownRow as { job_id: string; retry_count: number; run_id: string };
          assertNonNegativeInt(row.retry_count, 'Stored retry count');
          let retriesLeft = true;
          try {
            nextRetryCount(row.retry_count, input.maxRetries);
          } catch {
            retriesLeft = false;
          }
          if (retriesLeft) {
            await client.query(
              `UPDATE job_leases SET state = 'expired', version = version + 1, retry_count = retry_count + 1
               WHERE job_id = $1`,
              [row.job_id],
            );
            await client.query(`UPDATE jobs SET state = 'queued' WHERE id = $1`, [row.job_id]);
            expired += 1;
          } else {
            await client.query(
              `UPDATE job_leases SET state = 'completed', version = version + 1 WHERE job_id = $1`,
              [row.job_id],
            );
            await client.query(`UPDATE jobs SET state = 'failed' WHERE id = $1`, [row.job_id]);
            failed += 1;
          }
          await syncRunState(client, row.run_id);
        }
        return { expired, failed };
      });
    },
  };
}
