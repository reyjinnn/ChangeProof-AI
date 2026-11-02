import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';

/**
 * Collaboration contracts (FR3-42, WP3-30).
 *
 * Threads bind a run to the candidate digest under discussion; comments carry
 * versions and edit history, and a candidate revision marks them outdated
 * without moving them. Bodies reject active markup (script, event handlers,
 * javascript URLs) at parse time. Sharing is explicit per user and revocable;
 * audience changes are owner/admin acts with a recorded history. Nothing here
 * touches verdicts, oracles, or publication authority — structurally, there is
 * no field for it.
 */

const ACTIVE_MARKUP = /<\s*script|<\s*iframe|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=/i;

export const CommentBodySchema = z
  .string()
  .min(1)
  .max(4000)
  .superRefine((value, ctx) => {
    if (ACTIVE_MARKUP.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'Comment carries active markup; plain text only.' });
    }
  });
export type CommentBody = z.infer<typeof CommentBodySchema>;

export const ThreadAudienceSchema = z.enum(['internal', 'reviewer']);
export type ThreadAudience = z.infer<typeof ThreadAudienceSchema>;

export const ThreadStatusSchema = z.enum(['open', 'resolved']);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const AudienceChangeSchema = z.strictObject({
  from: ThreadAudienceSchema,
  to: ThreadAudienceSchema,
  by: IdSchema,
  at: z.iso.datetime({ offset: true }),
});
export type AudienceChange = z.infer<typeof AudienceChangeSchema>;

export const ThreadSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  threadId: IdSchema,
  tenantId: IdSchema,
  runId: IdSchema,
  candidateDigest: Sha256Schema,
  artifactRef: NonEmptyStringSchema.optional(),
  diffLocation: NonEmptyStringSchema.optional(),
  audience: ThreadAudienceSchema,
  status: ThreadStatusSchema,
  audienceHistory: z.array(AudienceChangeSchema),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const CommentSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  commentId: IdSchema,
  threadId: IdSchema,
  tenantId: IdSchema,
  authorId: IdSchema,
  body: CommentBodySchema,
  version: z.number().int().positive(),
  outdated: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  editedAt: z.iso.datetime({ offset: true }).optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const ShareRecordSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  shareId: IdSchema,
  threadId: IdSchema,
  tenantId: IdSchema,
  sharedWith: IdSchema,
  grantedBy: IdSchema,
  revokedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ShareRecord = z.infer<typeof ShareRecordSchema>;
