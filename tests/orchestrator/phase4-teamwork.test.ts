import { describe, expect, it, vi } from 'vitest';

import type { CollaborationDb } from '../../src/modules/collaboration/index.js';
import type { IdentityStore } from '../../src/modules/identity/index.js';
import type { JobsStore } from '../../src/modules/jobs/index.js';
import type { NotificationsStore } from '../../src/modules/notifications/index.js';
import type { SupportDb } from '../../src/modules/support/index.js';
import { composeCollaboration, composeSupport } from '../../src/orchestrator/index.js';

/**
 * WP3-30 composition wiring.
 *
 * The composition root binds the support and collaboration stores without
 * adding behavior. The stubs below never connect — durable behavior is proven
 * natively in `tests/native/teamwork.test.ts`, not here.
 */
describe('composeSupport', () => {
  const stubDb: SupportDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    connect: () =>
      Promise.resolve({
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        release: () => undefined,
      }),
  };

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeSupport(stubDb, {
      identity: { deriveContext: vi.fn() } as unknown as IdentityStore,
      jobs: { requestCancel: vi.fn() } as unknown as JobsStore,
    });

    for (const key of [
      'createTicket',
      'listTickets',
      'triageTicket',
      'resolveTicket',
      'closeTicket',
      'requestAccess',
      'decideAccess',
      'revokeGrant',
      'listActiveScopes',
      'logAccess',
      'reportIncident',
      'listIncidents',
      'acknowledgeIncident',
      'resolveIncident',
      'drainTarget',
      'quarantineTarget',
      'inspectTarget',
      'listOperatorActions',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
  });
});

describe('composeCollaboration', () => {
  const stubDb: CollaborationDb = {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    connect: () =>
      Promise.resolve({
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        release: () => undefined,
      }),
  };

  it('exposes the full store surface without wrapping it', () => {
    const composed = composeCollaboration(stubDb, {
      identity: { deriveContext: vi.fn() } as unknown as IdentityStore,
      notifications: { publishFromEvent: vi.fn() } as unknown as NotificationsStore,
    });

    for (const key of [
      'createThread',
      'listThreads',
      'postComment',
      'editComment',
      'listComments',
      'commentHistory',
      'resolveThread',
      'changeAudience',
      'shareThread',
      'revokeShare',
      'recordCandidateRevision',
    ] as const) {
      expect(typeof composed.store[key]).toBe('function');
    }
  });
});
