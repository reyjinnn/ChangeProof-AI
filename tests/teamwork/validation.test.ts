import { describe, expect, it } from 'vitest';

import {
  AccessRequestSchema,
  CommentBodySchema,
  OperatorActionReceiptSchema,
  OperatorIncidentSchema,
  SanitizedTextSchema,
  SupportGrantSchema,
  SupportTicketSchema,
  ThreadSchema,
} from '../../src/core/index.js';

/**
 * WP3-30 / T-30 — teamwork contract validation (fast, no database).
 *
 * Written before the implementation. Ticket context refuses credential-shaped
 * text, comment bodies refuse active markup, requests and grants are separate
 * contracts (a request is never a grant), and operator receipts name the
 * fenced epoch. Durable behavior is proven natively in
 * tests/native/teamwork.test.ts.
 */

describe('support contracts', () => {
  it('accepts a clean ticket and refuses credential-shaped context', () => {
    const ticket = SupportTicketSchema.parse({
      schemaVersion: '1',
      ticketId: 'ticket-1',
      tenantId: 'tenant-a',
      reporterId: 'user-a',
      category: 'bug',
      summary: 'Checkout total is wrong.',
      context: 'Steps: place an order for two items and check the total.',
      status: 'open',
      createdAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
    });

    expect(ticket.status).toBe('open');
    expect(() => SanitizedTextSchema.parse('my api_key: abc123')).toThrow(/secret/i);
    expect(() => SanitizedTextSchema.parse('password=hunter2')).toThrow(/secret/i);
  });

  it('keeps access requests and grants as separate contracts', () => {
    const request = AccessRequestSchema.parse({
      schemaVersion: '1',
      requestId: 'req-1',
      tenantId: 'tenant-a',
      requesterId: 'support-1',
      resourceType: 'run',
      resourceId: 'run-1',
      reason: 'Help diagnose the failed run.',
      status: 'pending',
      expiresAt: '2026-11-03T00:00:00.000Z',
      createdAt: '2026-11-02T00:00:00.000Z',
    });
    const grant = SupportGrantSchema.parse({
      schemaVersion: '1',
      grantId: 'grant-1',
      tenantId: 'tenant-a',
      userId: 'support-1',
      requestId: 'req-1',
      resourceType: 'run',
      resourceId: 'run-1',
      expiresAt: '2026-11-03T00:00:00.000Z',
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    expect(request.status).toBe('pending');
    expect(grant.requestId).toBe('req-1');
    expect('status' in grant).toBe(false);
  });

  it('stamps operator receipts with the fenced epoch', () => {
    const incident = OperatorIncidentSchema.parse({
      schemaVersion: '1',
      incidentId: 'inc-1',
      component: 'worker-fleet',
      status: 'open',
      summary: 'Queue latency is above the bound.',
      createdAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
    });
    const receipt = OperatorActionReceiptSchema.parse({
      schemaVersion: '1',
      actionId: 'act-1',
      tenantId: 'tenant-a',
      targetJobId: 'job-1',
      kind: 'drain',
      leaseEpoch: 3,
      reason: 'Worker stopped heartbeating.',
      operatorId: 'op-1',
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    expect(incident.component).toBe('worker-fleet');
    expect(receipt.leaseEpoch).toBe(3);
  });
});

describe('collaboration contracts', () => {
  it('binds threads to a run and candidate digest', () => {
    const thread = ThreadSchema.parse({
      schemaVersion: '1',
      threadId: 'thread-1',
      tenantId: 'tenant-a',
      runId: 'run-1',
      candidateDigest: 'd'.repeat(64),
      audience: 'reviewer',
      status: 'open',
      audienceHistory: [],
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    expect(thread.audience).toBe('reviewer');
  });

  it('refuses active markup in comment bodies', () => {
    expect(() => CommentBodySchema.parse('Looks good <script>alert(1)</script>')).toThrow(/active markup/i);
    expect(() => CommentBodySchema.parse('See javascript:alert(1)')).toThrow(/active markup/i);
    expect(() => CommentBodySchema.parse('<img src=x onerror=alert(1)>')).toThrow(/active markup/i);
    expect(CommentBodySchema.parse('The total matches: 2 < 3 items is fine.')).toContain('2 < 3');
  });
});
