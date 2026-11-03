import { describe, expect, it } from 'vitest';

import {
  ExportManifestSchema,
  NotificationPreferencesSchema,
  NotificationRecordSchema,
  SearchQuerySchema,
} from '../../src/core/index.js';

/**
 * WP3-29 / T-29 — engagement contract validation (fast, no database).
 *
 * Written before the implementation. Notifications carry idempotent event ids
 * and validated deep links; preferences mute whole categories; search queries
 * scope explicitly with bounded paging; export manifests stamp a digest over
 * the rows. Durable behavior is proven natively in
 * tests/native/engagement.test.ts.
 */

describe('notification contracts', () => {
  it('accepts a complete notification record', () => {
    const record = NotificationRecordSchema.parse({
      schemaVersion: '1',
      notificationId: 'notif-1',
      tenantId: 'tenant-a',
      userId: 'user-a',
      eventId: 'run-queued:run-1',
      category: 'results',
      title: 'Run queued',
      body: 'Run run-1 entered the queue.',
      deepLink: '/app/runs/run-1',
      runId: 'run-1',
      projectId: 'project-1',
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    expect(record.category).toBe('results');
  });

  it('rejects deep links outside the validated surface', () => {
    expect(() =>
      NotificationRecordSchema.parse({
        schemaVersion: '1',
        notificationId: 'notif-2',
        tenantId: 'tenant-a',
        userId: 'user-a',
        eventId: 'x',
        category: 'results',
        title: 'X',
        body: 'X',
        deepLink: 'https://evil.example/phish',
        createdAt: '2026-11-02T00:00:00.000Z',
      }),
    ).toThrow(/deep links/i);
  });

  it('accepts muted-category preferences', () => {
    const prefs = NotificationPreferencesSchema.parse({
      schemaVersion: '1',
      tenantId: 'tenant-a',
      userId: 'user-a',
      muted: ['quota', 'cleanup'],
    });

    expect(prefs.muted).toEqual(['quota', 'cleanup']);
  });
});

describe('search and export contracts', () => {
  it('accepts a scoped search with bounded paging', () => {
    const query = SearchQuerySchema.parse({
      schemaVersion: '1',
      scope: 'runs',
      text: 'checkout',
      runState: 'failed',
      limit: 20,
    });

    expect(query.scope).toBe('runs');
  });

  it('rejects blank text and wild paging', () => {
    expect(() => SearchQuerySchema.parse({ schemaVersion: '1', scope: 'runs', text: '   ', limit: 20 })).toThrow();
    expect(() => SearchQuerySchema.parse({ schemaVersion: '1', scope: 'runs', limit: 500 })).toThrow();
  });

  it('stamps export manifests with a row digest', () => {
    const manifest = ExportManifestSchema.parse({
      schemaVersion: '1',
      exportId: 'export-1',
      scope: 'audit',
      rowCount: 12,
      digest: 'c'.repeat(64),
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    expect(manifest.rowCount).toBe(12);
  });
});
