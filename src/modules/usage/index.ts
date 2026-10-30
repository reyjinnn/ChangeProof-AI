import { ChangeProofError, type UsageLedgerEntry } from '../../core/index.js';

/**
 * Usage reservations and idempotent ledger accounting (WP3-24, FR3-34).
 *
 * Preparation scope: the pure accounting core over the proven
 * `UsageLedgerEntry` contract. Admission is capped, debits are idempotent by
 * effect identity, cumulative usage never resets, and entitlement-changing
 * settlement requires a server-verified provider receipt — never a frontend
 * success page. Atomic admission under concurrency is proven by the hosted
 * store (unique effect constraint + transactional outbox) with the full WP.
 */

export interface ReservationRequest {
  readonly cap: number;
  readonly reservedActive: number;
  readonly requested: number;
}

/** Admit only what fits the remaining cap; unreadable amounts fail closed. */
export function assertReservationAdmitted(request: ReservationRequest): void {
  for (const amount of [request.cap, request.reservedActive, request.requested]) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new ChangeProofError('Reservation amounts must be finite and non-negative.');
    }
  }
  if (request.requested <= 0) {
    throw new ChangeProofError('Reservation must request a positive amount.');
  }
  if (request.reservedActive + request.requested > request.cap) {
    throw new ChangeProofError(
      'Quota exhausted: the reservation does not fit the remaining cap.',
    );
  }
}

const DEBIT_EVENTS: ReadonlySet<string> = new Set(['consume', 'settle']);

/**
 * Reject a retried debit that reuses an effect identity (no double debit).
 * Non-debit replays (reserve/reserve, reserve/consume lifecycles) stay
 * idempotent without raising.
 */
export function assertNoDoubleDebit(entries: readonly UsageLedgerEntry[]): void {
  const debitedByEffect = new Map<string, string>();
  for (const candidate of entries) {
    if (!DEBIT_EVENTS.has(candidate.event)) {
      continue;
    }
    const prior = debitedByEffect.get(candidate.effectId);
    if (prior !== undefined) {
      throw new ChangeProofError(
        'Duplicate debit identity: a retried usage event must not double-debit.',
      );
    }
    debitedByEffect.set(candidate.effectId, candidate.event);
  }
}

/** Cumulative usage only grows; a backwards move is a cap reset, never progress. */
export function assertCumulativeMonotonic(history: readonly number[]): void {
  let previous = 0;
  for (const total of history) {
    if (!Number.isFinite(total) || total < 0) {
      throw new ChangeProofError('Cumulative usage must be finite and non-negative.');
    }
    if (total < previous) {
      throw new ChangeProofError(
        'Cumulative usage moved backwards; budget is never reset by retry, resume, or cancel.',
      );
    }
    previous = total;
  }
}

/** Settlement changes entitlement, so it needs a server-verified provider receipt. */
export function assertEntitlementVerified(candidate: UsageLedgerEntry): void {
  if (candidate.event === 'settle' && candidate.providerReceiptRef === undefined) {
    throw new ChangeProofError(
      'Settlement without a server-verified provider receipt changes no entitlement.',
    );
  }
}
