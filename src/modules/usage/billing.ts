import { createHmac, timingSafeEqual } from 'node:crypto';

import { ChangeProofError } from '../../core/index.js';

/**
 * Signed payment event decision core (WP3-26, FR3-34/36, NEG3-36).
 *
 * Pure billing rules. Provider events verify by HMAC-SHA256 with a
 * timing-safe comparison — a forged signature changes no entitlement.
 * Duplicate deliveries collapse to one logical effect by event id, and a
 * refund applies only after a recorded charge. The secret arrives from the
 * broker at the call boundary and is never stored here. The durable
 * payment store persists verified events and calls these guards.
 */

export function verifyPaymentSignature(input: { payload: string; signature: string; secret: string }): void {
  if (input.secret.length === 0) {
    throw new ChangeProofError('Payment webhook secret is missing; nothing verifies without it.');
  }
  const expected = createHmac('sha256', input.secret).update(input.payload, 'utf8').digest('hex');
  const actual = input.signature.startsWith('sha256=') ? input.signature.slice('sha256='.length) : input.signature;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const actualBytes = Buffer.from(actual, 'utf8');
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    throw new ChangeProofError('Payment signature is forged or corrupt; no entitlement changes.');
  }
}

export type PaymentEventKind = 'checkout.completed' | 'invoice.paid' | 'refund.issued' | 'subscription.cancelled';

export interface PaymentEvent {
  readonly eventId: string;
  readonly kind: PaymentEventKind;
  readonly tenantId: string;
}

/**
 * Decide how a verified event applies: duplicate ids replay idempotently,
 * and a refund needs a prior recorded charge for the same tenant.
 */
export function assertPaymentEventApplies(event: PaymentEvent, seenEventIds: ReadonlySet<string>, chargedTenants: ReadonlySet<string>): 'apply' | 'duplicate' {
  if (event.eventId.length === 0 || event.tenantId.length === 0) {
    throw new ChangeProofError('Payment events need a stable id and tenant; refusing.');
  }
  if (seenEventIds.has(event.eventId)) {
    return 'duplicate';
  }
  if (event.kind === 'refund.issued' && !chargedTenants.has(event.tenantId)) {
    throw new ChangeProofError('Refund without a recorded charge; refusing to invent money movement.');
  }
  return 'apply';
}
