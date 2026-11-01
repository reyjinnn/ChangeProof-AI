import { z } from 'zod';

import { IdSchema } from '../primitives.js';

/**
 * Identity service contracts (WP3-21, FR3-29/FR3-38).
 *
 * Sessions and invitations are server-side records. Tokens are opaque
 * references resolved by exact match only; the raw token is returned once at
 * creation and never stored, logged, or embedded in another contract.
 */

export const SessionSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    sessionId: IdSchema,
    tenantId: IdSchema,
    userId: IdSchema,
    /** Membership grant version when the session was issued (staleness base). */
    grantVersionAtIssue: z.number().int().nonnegative(),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .describe('Server-side session; revocation and expiry checked at derive time');
export type Session = z.infer<typeof SessionSchema>;

export const InvitationSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    invitationId: IdSchema,
    tenantId: IdSchema,
    role: z.enum(['owner', 'admin', 'member', 'viewer', 'operator']),
    invitedBy: IdSchema,
    /** SHA-256 of the opaque token; the token itself is never stored. */
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .describe('Single-use, expiring invitation; accept is an atomic CAS');
export type Invitation = z.infer<typeof InvitationSchema>;
