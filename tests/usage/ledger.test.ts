import { describe, expect, it } from 'vitest';

import { UsageLedgerEntrySchema, type UsageLedgerEntry } from '../../src/core/index.js';
import {
  assertCumulativeMonotonic,
  assertEntitlementVerified,
  assertNoDoubleDebit,
  assertReservationAdmitted,
} from '../../src/modules/usage/index.js';

/**
 * WP3-24 / T2-8 — usage ledger failure-path tests (NEG3-13, NEG3-25, NEG3-36).
 *
 * Written before the implementation. Reservations are capped, usage is
 * idempotent by effect identity, cumulative usage never resets, and
 * entitlement comes only from server-verified receipts — never from a
 * frontend success page. Atomic admission under concurrency is proven by the
 * hosted store with the full WP; this is the pure accounting core.
 */

const digest = (seed: string): string =>
  seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a');

function entry(overrides: Partial<UsageLedgerEntry> = {}): UsageLedgerEntry {
  return UsageLedgerEntrySchema.parse({
    schemaVersion: '1',
    tenantId: 'tenant-a',
    runId: 'run-1',
    reservationId: 'res-1',
    effectId: digest('e1'),
    provider: 'model-broker',
    measuredUnits: 100,
    unitName: 'tokens-k',
    rateVersion: 'rate-1',
    periodId: 'period-1',
    event: 'consume',
    consumedAmount: 10,
    reservedAmount: 100,
    occurredAt: '2026-10-29T02:00:00.000Z',
    ...overrides,
  });
}

describe('reservation admission (NEG3-25)', () => {
  it('admits a reservation that fits the remaining cap', () => {
    expect(() => { assertReservationAdmitted({ cap: 1000, reservedActive: 400, requested: 500 }); },
    ).not.toThrow();
  });

  it('rejects a reservation that would exceed the cap instead of over-admitting', () => {
    expect(() => { assertReservationAdmitted({ cap: 1000, reservedActive: 700, requested: 400 }); },
    ).toThrow(/quota exhausted/i);
  });

  it('fails closed on unreadable amounts instead of defaulting to admitted', () => {
    expect(() => { assertReservationAdmitted({ cap: 1000, reservedActive: 0, requested: Number.NaN }); },
    ).toThrow();
  });
});

describe('idempotent usage, no double debit (NEG3-25)', () => {
  it('accepts entries with distinct effect identities', () => {
    expect(() => { assertNoDoubleDebit([entry({ effectId: digest('e1') }), entry({ effectId: digest('e2') })]); },
    ).not.toThrow();
  });

  it('rejects a retried consume with the same effect identity', () => {
    expect(() => { assertNoDoubleDebit([entry({ effectId: digest('e1') }), entry({ effectId: digest('e1') })]); },
    ).toThrow(/duplicate|double/i);
  });

  it('ignores reserve-event replays when finding debits, but still flags consume replays', () => {
    expect(() => { assertNoDoubleDebit([
        entry({ effectId: digest('e9'), event: 'reserve' }),
        entry({ effectId: digest('e9'), event: 'reserve' }),
      ]); },
    ).not.toThrow();
  });
});

describe('budget is never reset (NEG3-13)', () => {
  it('accepts non-decreasing cumulative usage', () => {
    expect(() => { assertCumulativeMonotonic([10, 10, 25]); }).not.toThrow();
  });

  it('rejects usage that moved backwards as a cap reset, not progress', () => {
    expect(() => { assertCumulativeMonotonic([25, 10]); }).toThrow(/never reset/);
  });
});

describe('entitlement only from server-verified receipts (NEG3-36)', () => {
  it('accepts a settlement carrying its provider receipt', () => {
    expect(() => { assertEntitlementVerified(entry({ event: 'settle', providerReceiptRef: 'receipt-7' })); },
    ).not.toThrow();
  });

  it('rejects a settlement with no provider receipt instead of trusting the caller', () => {
    expect(() => { assertEntitlementVerified(entry({ event: 'settle', providerReceiptRef: undefined })); },
    ).toThrow(/server-verified/);
  });

  it('rejects a refund replay that reuses a settled effect identity', () => {
    expect(() => { assertNoDoubleDebit([
        entry({ effectId: digest('f1'), event: 'settle', providerReceiptRef: 'receipt-7' }),
        entry({ effectId: digest('f1'), event: 'settle', providerReceiptRef: 'receipt-7' }),
      ]); },
    ).toThrow(/duplicate|double/i);
  });
});
