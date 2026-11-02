import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  ChangeProofError,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  Sha256Schema,
} from '../../core/index.js';

import { assertReservationAdmitted } from './accounting.js';
import { assertPaymentEventApplies, verifyPaymentSignature, type PaymentEventKind } from './billing.js';

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}

/**
 * PostgreSQL-backed atomic usage store (WP3-24, FR3-34).
 *
 * Entitlements, reservations, and the ledger live in `infra/postgres/V4` and
 * are reached only with bound parameters — never interpolation. Tenant-scoped
 * reads/writes run in a transaction with the tenant bound via
 * `set_config(..., is_local => true)` (auto-reset, no pool leak).
 *
 * Accounting rules, enforced here:
 * - There is no default cap: admission without an operator-set entitlement
 *   fails closed. Concurrent admissions serialize on the locked entitlement
 *   row and share one cap check (the pure `assertReservationAdmitted` core).
 * - Every event carries a caller-stable effect identity; a retried event
 *   returns the stored outcome, never a second debit. The ledger is
 *   append-only (no UPDATE/DELETE grant), so cumulative consumption cannot
 *   move backwards by retry, resume, cancel, or rollover.
 * - Consumption burns the outstanding hold and never exceeds it; racing
 *   burns serialize on the locked reservation row.
 * - Settlement frees the unused hold and requires a server-side provider
 *   receipt. Period rollover opens a new capped period while in-flight
 *   reservations keep their own balances.
 *
 * Time is injected, never read. The database handle is a narrow interface,
 * not a driver import: production passes a `pg` pool (structurally
 * compatible), the boundary stays driver-free.
 */

export interface UsageDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface UsageDbClient {
  query(text: string, params?: readonly unknown[]): Promise<UsageDbResult>;
  release(): void;
}

export interface UsageDb {
  query(text: string, params?: readonly unknown[]): Promise<UsageDbResult>;
  connect(): Promise<UsageDbClient>;
}

const FencedRowSchema = z.object({ fenced: z.boolean() });

const EntitlementRowSchema = z.object({
  tenant_id: z.string(),
  period_id: z.string(),
  cap_amount: z.number(),
  rate_version: z.string(),
});

const ReservationRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  period_id: z.string(),
  amount: z.number(),
  state: z.string(),
});

const LedgerRowSchema = z.object({
  effect_id: z.string(),
  reservation_id: z.string(),
  provider: z.string(),
  measured_units: z.number(),
  event: z.string(),
  consumed_amount: z.number(),
  reserved_amount: z.number(),
});

function errorField(error: unknown, field: 'code' | 'constraint'): string | null {
  if (typeof error === 'object' && error !== null && field in error) {
    const value: unknown = (error as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function assertPositiveAmount(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ChangeProofError(`${name} must be a finite positive amount; refusing.`);
  }
}

function assertNonNegativeAmount(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ChangeProofError(`${name} must be a finite non-negative amount; refusing.`);
  }
}

export interface UsageStore {
  setEntitlement(input: {
    tenantId: string;
    capAmount: number;
    rateVersion: string;
    periodId: string;
    nowIso: string;
  }): Promise<void>;
  rolloverPeriod(input: {
    tenantId: string;
    newPeriodId: string;
    capAmount: number;
    rateVersion: string;
    nowIso: string;
  }): Promise<void>;
  admitReservation(input: {
    tenantId: string;
    runId: string;
    reservationId: string;
    effectId: string;
    requested: number;
    nowIso: string;
  }): Promise<{ reservationId: string; reserved: number; duplicate: boolean }>;
  recordConsume(input: {
    tenantId: string;
    reservationId: string;
    effectId: string;
    provider: string;
    measuredUnits: number;
    unitName: string;
    nowIso: string;
  }): Promise<{ consumed: number; reserved: number; duplicate: boolean }>;
  releaseReservation(input: {
    tenantId: string;
    reservationId: string;
    effectId: string;
    nowIso: string;
  }): Promise<{ released: number }>;
  settleReservation(input: {
    tenantId: string;
    reservationId: string;
    effectId: string;
    providerReceiptRef: string;
    nowIso: string;
  }): Promise<{ consumed: number; released: number; duplicate: boolean; settleEffectId: string }>;
  recordPaymentEvent(input: {
    tenantId: string;
    eventId: string;
    kind: string;
    amount: number;
    periodId: string;
    payload: string;
    signature: string;
    webhookSecret: string;
    nowIso: string;
  }): Promise<{ duplicate: boolean }>;
  readBalances(input: { tenantId: string }): Promise<{
    periodId: string | null;
    cap: number | null;
    consumed: number;
    reservedActive: number;
    reservations: readonly {
      reservationId: string;
      runId: string;
      state: string;
      consumed: number;
      reserved: number;
    }[];
  }>;
}

export function createUsageStore(db: UsageDb): UsageStore {
  async function inTenant<T>(tenantId: string, work: (client: UsageDbClient) => Promise<T>): Promise<T> {
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

  async function findEffect(
    client: UsageDbClient,
    effectId: string,
  ): Promise<z.infer<typeof LedgerRowSchema> | null> {
    const found = await client.query(
      `SELECT effect_id, reservation_id, provider, measured_units, event, consumed_amount, reserved_amount
       FROM usage_ledger WHERE effect_id = $1`,
      [effectId],
    );
    if (found.rows.length === 0) {
      return null;
    }
    return LedgerRowSchema.parse(found.rows[0]);
  }

  async function lockReservation(
    client: UsageDbClient,
    reservationId: string,
  ): Promise<z.infer<typeof ReservationRowSchema>> {
    const found = await client.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [reservationId]);
    if (found.rows.length === 0) {
      throw new ChangeProofError('Reservation is unknown in this tenant; refusing.');
    }
    return ReservationRowSchema.parse(found.rows[0]);
  }

  async function rateForPeriod(client: UsageDbClient, tenantId: string, periodId: string): Promise<string> {
    const entitled = await client.query(
      `SELECT rate_version FROM entitlements WHERE tenant_id = $1 AND period_id = $2`,
      [tenantId, periodId],
    );
    if (entitled.rows.length === 0) {
      throw new ChangeProofError('Reservation names an unknown rate version; refusing to price.');
    }
    return (entitled.rows[0] as { rate_version: string }).rate_version;
  }

  async function latestBalances(
    client: UsageDbClient,
    reservation: z.infer<typeof ReservationRowSchema>,
  ): Promise<{ consumed: number; reserved: number }> {
    const found = await client.query(
      `SELECT consumed_amount, reserved_amount FROM usage_ledger
       WHERE reservation_id = $1 ORDER BY occurred_at DESC, effect_id DESC LIMIT 1`,
      [reservation.id],
    );
    if (found.rows.length === 0) {
      return { consumed: 0, reserved: reservation.state === 'reserved' ? reservation.amount : 0 };
    }
    const row = found.rows[0] as { consumed_amount: number; reserved_amount: number };
    return { consumed: row.consumed_amount, reserved: row.reserved_amount };
  }

  return {
    async setEntitlement(input: {
      tenantId: string;
      capAmount: number;
      rateVersion: string;
      periodId: string;
      nowIso: string;
    }): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      assertNonNegativeAmount(input.capAmount, 'Cap amount');
      const rateVersion = IdSchema.parse(input.rateVersion);
      const periodId = IdSchema.parse(input.periodId);
      const nowIso = InstantSchema.parse(input.nowIso);
      await inTenant(tenantId, async (client) => {
        try {
          await client.query(
            `INSERT INTO entitlements (tenant_id, period_id, cap_amount, rate_version, created_at, superseded_at)
             VALUES ($1, $2, $3, $4, $5, NULL)`,
            [tenantId, periodId, input.capAmount, rateVersion, nowIso],
          );
        } catch (error) {
          const constraint = errorField(error, 'constraint');
          if (constraint === 'entitlements_current_unique') {
            throw new ChangeProofError(
              'A current entitlement already exists; roll over to a new period instead of double-setting.',
            );
          }
          if (errorField(error, 'code') === '23505') {
            const existing = await client.query(
              `SELECT * FROM entitlements WHERE tenant_id = $1 AND period_id = $2`,
              [tenantId, periodId],
            );
            if (existing.rows.length === 0) {
              throw new ChangeProofError('Entitlement raced; retry against current state.');
            }
            const row = EntitlementRowSchema.parse(existing.rows[0]);
            if (row.cap_amount === input.capAmount && row.rate_version === rateVersion) {
              return;
            }
            throw new ChangeProofError(
              'Entitlement identity collision: the same period names different terms; refusing.',
            );
          }
          throw error;
        }
      });
    },

    async rolloverPeriod(input: {
      tenantId: string;
      newPeriodId: string;
      capAmount: number;
      rateVersion: string;
      nowIso: string;
    }): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      const newPeriodId = IdSchema.parse(input.newPeriodId);
      assertNonNegativeAmount(input.capAmount, 'Cap amount');
      const rateVersion = IdSchema.parse(input.rateVersion);
      const nowIso = InstantSchema.parse(input.nowIso);
      await inTenant(tenantId, async (client) => {
        const current = await client.query(
          `SELECT period_id FROM entitlements WHERE tenant_id = $1 AND superseded_at IS NULL FOR UPDATE`,
          [tenantId],
        );
        if (current.rows.length === 0) {
          throw new ChangeProofError('No current entitlement to roll over; set the first one explicitly.');
        }
        await client.query(
          `UPDATE entitlements SET superseded_at = $1 WHERE tenant_id = $2 AND superseded_at IS NULL`,
          [nowIso, tenantId],
        );
        await client.query(
          `INSERT INTO entitlements (tenant_id, period_id, cap_amount, rate_version, created_at, superseded_at)
           VALUES ($1, $2, $3, $4, $5, NULL)`,
          [tenantId, newPeriodId, input.capAmount, rateVersion, nowIso],
        );
      });
    },

    async admitReservation(input: {
      tenantId: string;
      runId: string;
      reservationId: string;
      effectId: string;
      requested: number;
      nowIso: string;
    }): Promise<{ reservationId: string; reserved: number; duplicate: boolean }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const runId = IdSchema.parse(input.runId);
      const reservationId = IdSchema.parse(input.reservationId);
      const effectId = Sha256Schema.parse(input.effectId);
      assertPositiveAmount(input.requested, 'Requested reservation');
      const nowIso = InstantSchema.parse(input.nowIso);
      await assertTenantAdmitted(tenantId);
      return inTenant(tenantId, async (client) => {
        const entitled = await client.query(
          `SELECT * FROM entitlements WHERE tenant_id = $1 AND superseded_at IS NULL FOR UPDATE`,
          [tenantId],
        );
        if (entitled.rows.length === 0) {
          throw new ChangeProofError('No entitlement set for this tenant; the operator must set caps first.');
        }
        const entitlement = EntitlementRowSchema.parse(entitled.rows[0]);
        const held = await client.query(
          `SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM reservations
           WHERE tenant_id = $1 AND state = 'reserved'`,
          [tenantId],
        );
        const reservedActive = (held.rows[0] as { total: number }).total;
        assertReservationAdmitted({ cap: entitlement.cap_amount, reservedActive, requested: input.requested });
        const inserted = await client.query(
          `INSERT INTO reservations (id, tenant_id, run_id, period_id, amount, state, created_at, closed_at)
           VALUES ($1, $2, $3, $4, $5, 'reserved', $6, NULL)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [reservationId, tenantId, runId, entitlement.period_id, input.requested, nowIso],
        );
        if (inserted.rows.length === 0) {
          const existing = await lockReservation(client, reservationId);
          if (existing.run_id !== runId || existing.amount !== input.requested) {
            throw new ChangeProofError(
              'Reservation identity collision: the same identity names different terms; refusing.',
            );
          }
          const balances = await latestBalances(client, existing);
          return { reservationId, reserved: balances.reserved, duplicate: true };
        }
        await client.query(
          `INSERT INTO usage_ledger (effect_id, tenant_id, run_id, reservation_id, provider, measured_units,
             unit_name, rate_version, period_id, event, consumed_amount, reserved_amount,
             provider_receipt_ref, occurred_at)
           VALUES ($1, $2, $3, $4, 'system', 0, 'reservation', $5, $6, 'reserve', 0, $7, NULL, $8)`,
          [effectId, tenantId, runId, reservationId, entitlement.rate_version, entitlement.period_id,
            input.requested, nowIso],
        );
        return { reservationId, reserved: input.requested, duplicate: false };
      });
    },

    async recordConsume(input: {
      tenantId: string;
      reservationId: string;
      effectId: string;
      provider: string;
      measuredUnits: number;
      unitName: string;
      nowIso: string;
    }): Promise<{ consumed: number; reserved: number; duplicate: boolean }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const reservationId = IdSchema.parse(input.reservationId);
      const effectId = Sha256Schema.parse(input.effectId);
      const provider = NonEmptyStringSchema.parse(input.provider);
      assertPositiveAmount(input.measuredUnits, 'Measured units');
      const unitName = NonEmptyStringSchema.parse(input.unitName);
      const nowIso = InstantSchema.parse(input.nowIso);
      await assertTenantAdmitted(tenantId);
      return inTenant(tenantId, async (client) => {
        const replay = await findEffect(client, effectId);
        if (replay !== null) {
          if (
            replay.event === 'consume' &&
            replay.reservation_id === reservationId &&
            replay.provider === provider &&
            replay.measured_units === input.measuredUnits
          ) {
            return { consumed: replay.consumed_amount, reserved: replay.reserved_amount, duplicate: true };
          }
          throw new ChangeProofError(
            'Effect identity collision: the same identity names different content; refusing.',
          );
        }
        const reservation = await lockReservation(client, reservationId);
        if (reservation.state !== 'reserved') {
          throw new ChangeProofError(`Reservation is ${reservation.state}; closed holds burn nothing.`);
        }
        const rateVersion = await rateForPeriod(client, tenantId, reservation.period_id);
        const balances = await latestBalances(client, reservation);
        if (input.measuredUnits > balances.reserved) {
          throw new ChangeProofError(
            `Consume exceeds the outstanding hold (${input.measuredUnits} > ${balances.reserved}); ` +
              'admit a larger reservation first.',
          );
        }
        const consumed = balances.consumed + input.measuredUnits;
        const reserved = balances.reserved - input.measuredUnits;
        await client.query(
          `INSERT INTO usage_ledger (effect_id, tenant_id, run_id, reservation_id, provider, measured_units,
             unit_name, rate_version, period_id, event, consumed_amount, reserved_amount,
             provider_receipt_ref, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'consume', $10, $11, NULL, $12)`,
          [effectId, tenantId, reservation.run_id, reservationId, provider, input.measuredUnits, unitName,
            rateVersion, reservation.period_id, consumed, reserved, nowIso],
        );
        return { consumed, reserved, duplicate: false };
      });
    },

    async releaseReservation(input: {
      tenantId: string;
      reservationId: string;
      effectId: string;
      nowIso: string;
    }): Promise<{ released: number }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const reservationId = IdSchema.parse(input.reservationId);
      const effectId = Sha256Schema.parse(input.effectId);
      const nowIso = InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const replay = await findEffect(client, effectId);
        if (replay !== null) {
          if (replay.event === 'release' && replay.reservation_id === reservationId) {
            return { released: replay.measured_units };
          }
          throw new ChangeProofError(
            'Effect identity collision: the same identity names different content; refusing.',
          );
        }
        const reservation = await lockReservation(client, reservationId);
        if (reservation.state !== 'reserved') {
          throw new ChangeProofError(`Reservation is ${reservation.state}; nothing to release.`);
        }
        const balances = await latestBalances(client, reservation);
        const rateVersion = await rateForPeriod(client, tenantId, reservation.period_id);
        await client.query(
          `INSERT INTO usage_ledger (effect_id, tenant_id, run_id, reservation_id, provider, measured_units,
             unit_name, rate_version, period_id, event, consumed_amount, reserved_amount,
             provider_receipt_ref, occurred_at)
           VALUES ($1, $2, $3, $4, 'system', $5, 'reservation', $6, $7, 'release', $8, 0, NULL, $9)`,
          [effectId, tenantId, reservation.run_id, reservationId, balances.reserved, rateVersion,
            reservation.period_id, balances.consumed, nowIso],
        );
        await client.query(`UPDATE reservations SET state = 'released', closed_at = $1 WHERE id = $2`, [
          nowIso,
          reservationId,
        ]);
        return { released: balances.reserved };
      });
    },

    async settleReservation(input: {
      tenantId: string;
      reservationId: string;
      effectId: string;
      providerReceiptRef: string;
      nowIso: string;
    }): Promise<{ consumed: number; released: number; duplicate: boolean; settleEffectId: string }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const reservationId = IdSchema.parse(input.reservationId);
      const effectId = Sha256Schema.parse(input.effectId);
      if (input.providerReceiptRef.trim().length === 0) {
        throw new ChangeProofError(
          'Settlement without a server-verified provider receipt changes no entitlement.',
        );
      }
      const receiptRef = IdSchema.parse(input.providerReceiptRef);
      const nowIso = InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const replay = await findEffect(client, effectId);
        if (replay !== null) {
          if (replay.event === 'settle' && replay.reservation_id === reservationId) {
            return {
              consumed: replay.consumed_amount,
              released: replay.measured_units,
              duplicate: true,
              settleEffectId: effectId,
            };
          }
          throw new ChangeProofError(
            'Effect identity collision: the same identity names different content; refusing.',
          );
        }
        const reservation = await lockReservation(client, reservationId);
        if (reservation.state !== 'reserved') {
          throw new ChangeProofError(`Reservation is ${reservation.state}; nothing to settle.`);
        }
        const balances = await latestBalances(client, reservation);
        const rateVersion = await rateForPeriod(client, tenantId, reservation.period_id);
        await client.query(
          `INSERT INTO usage_ledger (effect_id, tenant_id, run_id, reservation_id, provider, measured_units,
             unit_name, rate_version, period_id, event, consumed_amount, reserved_amount,
             provider_receipt_ref, occurred_at)
           VALUES ($1, $2, $3, $4, 'system', $5, 'reservation', $6, $7, 'settle', $8, 0, $9, $10)`,
          [effectId, tenantId, reservation.run_id, reservationId, balances.reserved, rateVersion,
            reservation.period_id, balances.consumed, receiptRef, nowIso],
        );
        await client.query(`UPDATE reservations SET state = 'settled', closed_at = $1 WHERE id = $2`, [
          nowIso,
          reservationId,
        ]);
        return { consumed: balances.consumed, released: balances.reserved, duplicate: false, settleEffectId: effectId };
      });
    },

    async recordPaymentEvent(input: {
      tenantId: string;
      eventId: string;
      kind: string;
      amount: number;
      periodId: string;
      payload: string;
      signature: string;
      webhookSecret: string;
      nowIso: string;
    }): Promise<{ duplicate: boolean }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const eventId = NonEmptyStringSchema.parse(input.eventId);
      const kind: PaymentEventKind = z
        .enum(['checkout.completed', 'invoice.paid', 'refund.issued', 'subscription.cancelled'])
        .parse(input.kind);
      if (!Number.isFinite(input.amount) || input.amount < 0) {
        throw new ChangeProofError('Payment amount must be finite and non-negative.');
      }
      const periodId = NonEmptyStringSchema.parse(input.periodId);
      const nowIso = InstantSchema.parse(input.nowIso);
      // The broker secret verifies here and is never stored, logged, or returned.
      verifyPaymentSignature({ payload: input.payload, signature: input.signature, secret: input.webhookSecret });
      await assertTenantAdmitted(tenantId);
      return inTenant(tenantId, async (client) => {
        const table = await client.query(`SELECT to_regclass('public.payment_events') AS reg`);
        if ((table.rows[0] as { reg: string | null }).reg === null) {
          try {
            await client.query(
              `CREATE TABLE IF NOT EXISTS payment_events (event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL, amount NUMERIC NOT NULL, period_id TEXT NOT NULL, payload_hash TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL)`,
            );
          } catch (error) {
            if (errorCode(error) === '42501') {
              throw new ChangeProofError(
                'Payment tables are missing and this role cannot create them; apply infra/postgres/V11__service_operations.sql.',
              );
            }
            throw error;
          }
        }
        const prior = await client.query(`SELECT tenant_id, kind FROM payment_events WHERE event_id = $1`, [eventId]);
        const seen = prior.rows[0] as { tenant_id: string; kind: string } | undefined;
        if (seen !== undefined) {
          if (seen.tenant_id !== tenantId || seen.kind !== kind) {
            throw new ChangeProofError(
              'Payment event identity collision: the same identity names different content; refusing.',
            );
          }
          return { duplicate: true };
        }
        const charges = await client.query(
          `SELECT 1 FROM payment_events WHERE tenant_id = $1 AND kind IN ('checkout.completed', 'invoice.paid') LIMIT 1`,
          [tenantId],
        );
        const charged = new Set<string>();
        if (charges.rows.length > 0) {
          charged.add(tenantId);
        }
        assertPaymentEventApplies({ eventId, kind, tenantId }, new Set(), charged);
        const payloadHash = createHash('sha256').update(input.payload, 'utf8').digest('hex');
        await client.query(
          `INSERT INTO payment_events (event_id, tenant_id, kind, amount, period_id, payload_hash, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [eventId, tenantId, kind, input.amount, periodId, payloadHash, nowIso],
        );
        return { duplicate: false };
      });
    },

    async readBalances(input: { tenantId: string }): Promise<{
      periodId: string | null;
      cap: number | null;
      consumed: number;
      reservedActive: number;
      reservations: readonly {
        reservationId: string;
        runId: string;
        state: string;
        consumed: number;
        reserved: number;
      }[];
    }> {
      const tenantId = IdSchema.parse(input.tenantId);
      return inTenant(tenantId, async (client) => {
        const entitled = await client.query(
          `SELECT period_id, cap_amount FROM entitlements WHERE tenant_id = $1 AND superseded_at IS NULL`,
          [tenantId],
        );
        const current = entitled.rows[0] as { period_id: string; cap_amount: number } | undefined;
        const rows = await client.query(
          `SELECT DISTINCT ON (r.id) r.id, r.run_id, r.state, r.amount,
                  l.consumed_amount, l.reserved_amount
           FROM reservations r LEFT JOIN usage_ledger l ON l.reservation_id = r.id
           WHERE r.tenant_id = $1 ORDER BY r.id, l.occurred_at DESC, l.effect_id DESC`,
          [tenantId],
        );
        const reservations = rows.rows.map((unknownRow) => {
          const row = unknownRow as {
            id: string;
            run_id: string;
            state: string;
            amount: number;
            consumed_amount: number | null;
            reserved_amount: number | null;
          };
          return {
            reservationId: row.id,
            runId: row.run_id,
            state: row.state,
            consumed: row.consumed_amount ?? 0,
            reserved: row.reserved_amount ?? (row.state === 'reserved' ? row.amount : 0),
          };
        });
        let consumed = 0;
        let reservedActive = 0;
        for (const reservation of reservations) {
          consumed += reservation.consumed;
          if (reservation.state === 'reserved') {
            reservedActive += reservation.reserved;
          }
        }
        return {
          periodId: current?.period_id ?? null,
          cap: current?.cap_amount ?? null,
          consumed,
          reservedActive,
          reservations,
        };
      });
    },
  };
}
