import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { assertPaymentEventApplies, verifyPaymentSignature } from '../../src/modules/usage/billing.js';

/**
 * WP3-26 / T-40 — signed payment event tests (NEG3-36).
 *
 * Written before the durable wiring. Provider events verify by HMAC-SHA256
 * with a timing-safe comparison; a forged signature changes nothing.
 * Duplicate deliveries collapse by event id, and a refund applies only
 * after a recorded charge.
 */

const SECRET = 't40-broker-secret';
const PAYLOAD = '{"id":"evt-1","type":"checkout.completed","tenant":"acme"}';

function sign(payload: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex')}`;
}

describe('payment signatures verify server-side', () => {
  it('accepts a genuine signature and refuses forgeries', () => {
    expect(() => {
      verifyPaymentSignature({ payload: PAYLOAD, signature: sign(PAYLOAD), secret: SECRET });
    }).not.toThrow();
    expect(() => {
      verifyPaymentSignature({ payload: PAYLOAD, signature: sign(`${PAYLOAD}tampered`), secret: SECRET });
    }).toThrow(/forged|signature/i);
    expect(() => {
      verifyPaymentSignature({ payload: PAYLOAD, signature: 'sha256=deadbeef', secret: SECRET });
    }).toThrow(/forged|signature/i);
    expect(() => {
      verifyPaymentSignature({ payload: PAYLOAD, signature: sign(PAYLOAD), secret: '' });
    }).toThrow(/secret/i);
  });
});

describe('payment events apply idempotently and in order', () => {
  it('collapses duplicate deliveries by event id', () => {
    const event = { eventId: 'evt-1', kind: 'checkout.completed' as const, tenantId: 'acme' };
    expect(assertPaymentEventApplies(event, new Set(), new Set())).toBe('apply');
    expect(assertPaymentEventApplies(event, new Set(['evt-1']), new Set(['acme']))).toBe('duplicate');
  });

  it('refuses a refund without a recorded charge', () => {
    const refund = { eventId: 'evt-9', kind: 'refund.issued' as const, tenantId: 'acme' };
    expect(() => {
      assertPaymentEventApplies(refund, new Set(), new Set());
    }).toThrow(/charge|refund/i);
    expect(assertPaymentEventApplies(refund, new Set(), new Set(['acme']))).toBe('apply');
  });
});
