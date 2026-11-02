import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema } from '../primitives.js';

/**
 * Support contracts (FR3-41, WP3-30).
 *
 * Tickets carry sanitized context (credential-shaped text is refused, not
 * scrubbed silently). Access requests are never grants: an approval mints a
 * separate scoped, expiring grant row, and every support-scoped read is
 * logged. Operator incidents are platform-wide status without customer
 * source; drain/quarantine actions name the lease epoch they fenced against.
 */

const SECRET_SHAPE =
  /(api[_-]?key|secret|passwd|password|bearer|authorization|client_secret|private_key|refresh_token|session_key|connection_string)\s*[:=]/i;

export const SanitizedTextSchema = z
  .string()
  .min(1)
  .max(4000)
  .superRefine((value, ctx) => {
    if (SECRET_SHAPE.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Context looks like it carries a secret; remove credentials before filing.',
      });
    }
  });
export type SanitizedText = z.infer<typeof SanitizedTextSchema>;

export const TicketCategorySchema = z.enum(['bug', 'question', 'incident', 'access']);
export type TicketCategory = z.infer<typeof TicketCategorySchema>;

export const TicketStatusSchema = z.enum(['open', 'triaged', 'resolved', 'closed']);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const SupportTicketSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  ticketId: IdSchema,
  tenantId: IdSchema,
  reporterId: IdSchema,
  category: TicketCategorySchema,
  summary: NonEmptyStringSchema,
  context: SanitizedTextSchema,
  runId: IdSchema.optional(),
  status: TicketStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type SupportTicket = z.infer<typeof SupportTicketSchema>;

export const AccessResourceSchema = z.enum(['run', 'project', 'repository', 'evidence']);
export type AccessResource = z.infer<typeof AccessResourceSchema>;

export const AccessRequestStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired', 'revoked']);
export type AccessRequestStatus = z.infer<typeof AccessRequestStatusSchema>;

export const AccessRequestSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  requestId: IdSchema,
  tenantId: IdSchema,
  requesterId: IdSchema,
  resourceType: AccessResourceSchema,
  resourceId: IdSchema,
  reason: SanitizedTextSchema,
  status: AccessRequestStatusSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  decidedBy: IdSchema.optional(),
  decidedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type AccessRequest = z.infer<typeof AccessRequestSchema>;

export const SupportGrantSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  grantId: IdSchema,
  tenantId: IdSchema,
  userId: IdSchema,
  requestId: IdSchema,
  resourceType: AccessResourceSchema,
  resourceId: IdSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  revokedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type SupportGrant = z.infer<typeof SupportGrantSchema>;

export const IncidentStatusSchema = z.enum(['open', 'mitigating', 'resolved']);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const OperatorIncidentSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  incidentId: IdSchema,
  component: NonEmptyStringSchema,
  status: IncidentStatusSchema,
  summary: SanitizedTextSchema,
  queueImpact: z.string().max(500).optional(),
  modelImpact: z.string().max(500).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type OperatorIncident = z.infer<typeof OperatorIncidentSchema>;

export const OperatorActionKindSchema = z.enum(['drain', 'quarantine', 'inspect']);
export type OperatorActionKind = z.infer<typeof OperatorActionKindSchema>;

export const OperatorActionReceiptSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  actionId: IdSchema,
  tenantId: IdSchema,
  targetJobId: IdSchema,
  kind: OperatorActionKindSchema,
  leaseEpoch: z.number().int().positive(),
  reason: SanitizedTextSchema,
  operatorId: IdSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type OperatorActionReceipt = z.infer<typeof OperatorActionReceiptSchema>;
