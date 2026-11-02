import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema } from '../primitives.js';

/**
 * Queries + notifications contracts (FR3-39/40, WP3-29).
 *
 * Notifications are durable per-user inbox rows keyed by idempotent business
 * event ids; preferences mute categories per user. Search queries scope to
 * projects, runs, or audit events with text, filters, and a paging cursor;
 * counts and snippets are computed after grant filtering, never before.
 * Exports carry a digest-stamped manifest so a tampered export is detectable.
 */

export const NotificationCategorySchema = z.enum(['results', 'blockers', 'access', 'quota', 'cleanup']);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NotificationRecordSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  notificationId: IdSchema,
  tenantId: IdSchema,
  userId: IdSchema,
  eventId: NonEmptyStringSchema,
  category: NotificationCategorySchema,
  title: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
  deepLink: z.string().regex(/^\/app(\/|$|\?)/, 'deep links stay on the validated /app surface').optional(),
  runId: IdSchema.optional(),
  projectId: IdSchema.optional(),
  repositoryId: IdSchema.optional(),
  readAt: z.iso.datetime({ offset: true }).optional(),
  dismissedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;

export const NotificationPreferencesSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  tenantId: IdSchema,
  userId: IdSchema,
  muted: z.array(NotificationCategorySchema),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const SearchScopeSchema = z.enum(['projects', 'runs', 'audit']);
export type SearchScope = z.infer<typeof SearchScopeSchema>;

export const SearchQuerySchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    scope: SearchScopeSchema,
    text: z.string().max(200).optional(),
    projectId: IdSchema.optional(),
    runState: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
    eventKind: NonEmptyStringSchema.optional(),
    actor: z.string().max(200).optional(),
    sinceIso: z.iso.datetime({ offset: true }).optional(),
    untilIso: z.iso.datetime({ offset: true }).optional(),
    afterSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100),
  })
  .superRefine((query, ctx) => {
    if (query.text?.trim().length === 0) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'Search text must not be blank.' });
    }
  });
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchHitSchema = z.strictObject({
  kind: z.enum(['project', 'run', 'audit-event']),
  id: NonEmptyStringSchema,
  projectId: IdSchema.optional(),
  title: NonEmptyStringSchema,
  snippet: NonEmptyStringSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResultSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  hits: z.array(SearchHitSchema),
  totalCount: z.number().int().nonnegative(),
  cursor: z.number().int().nonnegative(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const ExportManifestSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  exportId: IdSchema,
  scope: SearchScopeSchema,
  rowCount: z.number().int().nonnegative(),
  digest: z.string().regex(/^[0-9a-f]{64}$/, 'export digest is sha256 over the canonical rows'),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ExportManifest = z.infer<typeof ExportManifestSchema>;
