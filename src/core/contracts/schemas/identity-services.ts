import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema } from '../primitives.js';

/**
 * Identity service contracts (WP3-21, FR3-29/FR3-38; WP3-32, FR3-44).
 *
 * Sessions and invitations are server-side records. Tokens are opaque
 * references resolved by exact match only; the raw token is returned once at
 * creation and never stored, logged, or embedded in another contract.
 *
 * SAML/SCIM records follow the same discipline: a SCIM bearer token is
 * returned once and only its hash is stored; a SAML assertion carries the
 * claims to validate plus the opaque signed bytes the signature verifier
 * checks — the validator never executes, fetches, or trusts anything inside
 * the payload beyond the validated claims.
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

export const SamlConnectionSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    tenantId: IdSchema,
    entityId: NonEmptyStringSchema,
    idpIssuer: NonEmptyStringSchema,
    audience: NonEmptyStringSchema,
    acsUrl: NonEmptyStringSchema,
    /** IdP signing certificate (public key material); signatures verify against it. */
    certPem: NonEmptyStringSchema,
    certFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    verifiedDomain: NonEmptyStringSchema,
    status: z.enum(['active', 'disabled']),
    createdAt: z.iso.datetime({ offset: true }),
    rotatedAt: z.iso.datetime({ offset: true }),
  })
  .describe('Tenant SAML SSO binding; issuer/audience/destination pinned');
export type SamlConnection = z.infer<typeof SamlConnectionSchema>;

export const SamlAssertionSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    assertionId: NonEmptyStringSchema,
    issuer: NonEmptyStringSchema,
    audience: NonEmptyStringSchema,
    destination: NonEmptyStringSchema,
    /** Persistent subject identifier; links to a member only via an explicit link. */
    subject: NonEmptyStringSchema,
    /** Informational hint only — never links or merges accounts by itself. */
    email: NonEmptyStringSchema.optional(),
    authnInstant: z.iso.datetime({ offset: true }),
    notBefore: z.iso.datetime({ offset: true }),
    notOnOrAfter: z.iso.datetime({ offset: true }),
    requestId: NonEmptyStringSchema,
    /** Canonical signed bytes, opaque to the validator; the verifier checks them. */
    signedContentB64: NonEmptyStringSchema,
    signatureB64: NonEmptyStringSchema,
  })
  .describe('Parsed SAML assertion claims awaiting validation and verification');
export type SamlAssertion = z.infer<typeof SamlAssertionSchema>;

export const ScimTokenSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    tokenId: IdSchema,
    tenantId: IdSchema,
    /** SHA-256 of the bearer token; the token itself is returned once, never stored. */
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(['active', 'revoked']),
    createdAt: z.iso.datetime({ offset: true }),
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
    lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .describe('SCIM bearer credential; hash-only storage like invitations');
export type ScimToken = z.infer<typeof ScimTokenSchema>;

export const ScimEventSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    eventId: IdSchema,
    tenantId: IdSchema,
    /** Stable IdP-side identifier; versions order effects per external id. */
    externalId: NonEmptyStringSchema,
    operation: z.enum(['provision', 'update', 'disable']),
    version: z.number().int().gte(1),
    email: NonEmptyStringSchema.optional(),
    groups: z.array(NonEmptyStringSchema),
  })
  .describe('IdP provisioning event; applied idempotently in version order');
export type ScimEvent = z.infer<typeof ScimEventSchema>;
