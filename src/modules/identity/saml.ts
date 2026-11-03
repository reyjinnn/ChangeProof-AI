import { createHash, createPublicKey, verify } from 'node:crypto';

import { z } from 'zod';

import {
  ChangeProofError,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  SamlAssertionSchema,
  SamlConnectionSchema,
  type SamlAssertion,
  type SamlConnection,
  type TenantContext,
} from '../../core/index.js';

import { assertOwnerOrAdmin } from './guards.js';
import type { IdentityDb, IdentityDbClient } from './store.js';

/**
 * SAML SSO validation and login (WP3-32, FR3-44).
 *
 * Claim validation is pure and pinned to the tenant's connection record:
 * issuer, audience, destination, request correlation, and the validity
 * window must all match — a wrong issuer fails the same way whether or not
 * any tenant owns it (NEG3-38). Signatures are real RSA-SHA256 over the
 * signed bytes with the connection certificate; there is no verifier that
 * always says yes. Subjects link to members only through an explicit
 * owner/admin link — email or domain similarity never merges accounts.
 *
 * Boundary: this module validates parsed claims. XML parsing and SignedInfo
 * canonicalization belong to the caller (vendor decision recorded in
 * `docs/decisions/t32-provider-catalog.md`); the live-IdP row stays blocked
 * until a parser, a configured IdP, and signatures from that IdP exist.
 */

const ConnectionRowSchema = z.object({
  tenant_id: z.string(),
  entity_id: z.string(),
  idp_issuer: z.string(),
  audience: z.string(),
  acs_url: z.string(),
  cert_pem: z.string(),
  cert_fingerprint: z.string(),
  verified_domain: z.string(),
  status: z.string(),
  created_at: z.unknown(),
  rotated_at: z.unknown(),
});

const MembershipStatusRowSchema = z.object({
  user_id: z.string(),
  role: z.string(),
  status: z.string(),
});

/** Canonical certificate fingerprint: SHA-256 over the DER bytes. Rejects garbage PEM. */
export function fingerprintCert(certPem: string): string {
  const pem = NonEmptyStringSchema.parse(certPem);
  try {
    const key = createPublicKey(pem);
    const der = key.export({ format: 'der', type: 'spki' });
    return createHash('sha256').update(der).digest('hex');
  } catch {
    throw new ChangeProofError('SAML certificate does not parse; refusing to trust it.');
  }
}

export function verifySamlSignature(input: {
  certPem: string;
  signedContentB64: string;
  signatureB64: string;
}): void {
  const pem = NonEmptyStringSchema.parse(input.certPem);
  const signed = Buffer.from(NonEmptyStringSchema.parse(input.signedContentB64), 'base64');
  const signature = Buffer.from(NonEmptyStringSchema.parse(input.signatureB64), 'base64');
  let valid: boolean;
  try {
    valid = verify('sha256', signed, pem, signature);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new ChangeProofError('SAML signature is invalid for this connection certificate; refusing.');
  }
}

function instantMs(value: string, field: string): number {
  const parsed = Date.parse(InstantSchema.parse(value));
  if (!Number.isFinite(parsed)) {
    throw new ChangeProofError(`SAML timestamp ${field} is unreadable; refusing.`);
  }
  return parsed;
}

export function validateSamlAssertion(input: {
  connection: SamlConnection;
  assertion: SamlAssertion;
  expectedRequestId: string;
  nowIso: string;
}): { subject: string; email?: string } {
  const connection = SamlConnectionSchema.parse(input.connection);
  const assertion = SamlAssertionSchema.parse(input.assertion);
  const expectedRequestId = NonEmptyStringSchema.parse(input.expectedRequestId);
  if (connection.status !== 'active') {
    throw new ChangeProofError('SAML connection is disabled; every assertion is refused.');
  }
  if (assertion.issuer !== connection.idpIssuer) {
    throw new ChangeProofError('SAML issuer does not match the pinned connection issuer; refusing.');
  }
  if (assertion.audience !== connection.audience) {
    throw new ChangeProofError('SAML audience does not match the pinned connection audience; refusing.');
  }
  if (assertion.destination !== connection.acsUrl) {
    throw new ChangeProofError('SAML destination does not match this endpoint; refusing.');
  }
  if (assertion.requestId !== expectedRequestId) {
    throw new ChangeProofError('SAML response answers a different request; refusing.');
  }
  const now = instantMs(input.nowIso, 'now');
  const notBefore = instantMs(assertion.notBefore, 'notBefore');
  const notOnOrAfter = instantMs(assertion.notOnOrAfter, 'notOnOrAfter');
  const authnInstant = instantMs(assertion.authnInstant, 'authnInstant');
  if (now < notBefore || now >= notOnOrAfter) {
    throw new ChangeProofError('SAML assertion is outside its validity window; refusing.');
  }
  if (authnInstant > now) {
    throw new ChangeProofError('SAML authentication instant is in the future; refusing.');
  }
  return assertion.email === undefined ? { subject: assertion.subject } : { subject: assertion.subject, email: assertion.email };
}

function instantOf(value: unknown, field: string): string {
  if (typeof value === 'string') {
    return InstantSchema.parse(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  throw new ChangeProofError(`SAML row has an unreadable ${field}; refusing.`);
}

function toConnection(row: z.infer<typeof ConnectionRowSchema>): SamlConnection {
  return SamlConnectionSchema.parse({
    schemaVersion: '1',
    tenantId: row.tenant_id,
    entityId: row.entity_id,
    idpIssuer: row.idp_issuer,
    audience: row.audience,
    acsUrl: row.acs_url,
    certPem: row.cert_pem,
    certFingerprint: row.cert_fingerprint,
    verifiedDomain: row.verified_domain,
    status: row.status,
    createdAt: instantOf(row.created_at, 'created_at'),
    rotatedAt: instantOf(row.rotated_at, 'rotated_at'),
  });
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export interface SamlStore {
  provisionConnection(input: {
    actor: TenantContext;
    entityId: string;
    idpIssuer: string;
    audience: string;
    acsUrl: string;
    certPem: string;
    verifiedDomain: string;
    nowIso: string;
  }): Promise<SamlConnection>;
  rotateCertificate(input: {
    actor: TenantContext;
    certPem: string;
    nowIso: string;
  }): Promise<SamlConnection>;
  disableConnection(input: { actor: TenantContext; nowIso: string }): Promise<void>;
  getConnection(tenantId: string): Promise<SamlConnection | null>;
  linkSubject(input: {
    actor: TenantContext;
    subject: string;
    userId: string;
    nowIso: string;
  }): Promise<void>;
  acceptLogin(input: {
    tenantId: string;
    assertion: SamlAssertion;
    expectedRequestId: string;
    nowIso: string;
  }): Promise<{ tenantId: string; userId: string }>;
}

export function createSamlStore(db: IdentityDb): SamlStore {
  async function inTenant<T>(tenantId: string, work: (client: IdentityDbClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      try {
        await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  return {
    async provisionConnection(input): Promise<SamlConnection> {
      assertOwnerOrAdmin(input.actor, 'SAML provisioning');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const nowIso = InstantSchema.parse(input.nowIso);
      const fingerprint = fingerprintCert(input.certPem);
      return inTenant(tenantId, async (client) => {
        try {
          const created = await client.query(
            `INSERT INTO saml_connections
               (tenant_id, entity_id, idp_issuer, audience, acs_url, cert_pem, cert_fingerprint,
                verified_domain, status, created_at, rotated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $9)
             RETURNING *`,
            [
              tenantId,
              NonEmptyStringSchema.parse(input.entityId),
              NonEmptyStringSchema.parse(input.idpIssuer),
              NonEmptyStringSchema.parse(input.audience),
              NonEmptyStringSchema.parse(input.acsUrl),
              NonEmptyStringSchema.parse(input.certPem),
              fingerprint,
              NonEmptyStringSchema.parse(input.verifiedDomain),
              nowIso,
            ],
          );
          const row = created.rows[0];
          if (row === undefined) {
            throw new ChangeProofError('SAML connection write did not persist; refusing.');
          }
          return toConnection(ConnectionRowSchema.parse(row));
        } catch (error) {
          if (errorCode(error) === '23505') {
            throw new ChangeProofError(
              'Tenant already has a SAML connection; rotate or disable it instead.',
            );
          }
          throw error;
        }
      });
    },

    async rotateCertificate(input): Promise<SamlConnection> {
      assertOwnerOrAdmin(input.actor, 'SAML rotation');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const nowIso = InstantSchema.parse(input.nowIso);
      const fingerprint = fingerprintCert(input.certPem);
      const certPem = NonEmptyStringSchema.parse(input.certPem);
      return inTenant(tenantId, async (client) => {
        const updated = await client.query(
          `UPDATE saml_connections SET cert_pem = $1, cert_fingerprint = $2, rotated_at = $3
           WHERE tenant_id = $4 AND status = 'active'
           RETURNING *`,
          [certPem, fingerprint, nowIso, tenantId],
        );
        const row = updated.rows[0];
        if (row === undefined) {
          throw new ChangeProofError('No active SAML connection to rotate; refusing.');
        }
        return toConnection(ConnectionRowSchema.parse(row));
      });
    },

    async disableConnection(input): Promise<void> {
      assertOwnerOrAdmin(input.actor, 'SAML disablement');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      await inTenant(tenantId, async (client) => {
        await client.query(`UPDATE saml_connections SET status = 'disabled' WHERE tenant_id = $1`, [
          tenantId,
        ]);
      });
    },

    async getConnection(tenantId: string): Promise<SamlConnection | null> {
      const id = IdSchema.parse(tenantId);
      return inTenant(id, async (client) => {
        const found = await client.query(`SELECT * FROM saml_connections WHERE tenant_id = $1`, [id]);
        const row = found.rows[0];
        if (row === undefined) {
          return null;
        }
        return toConnection(ConnectionRowSchema.parse(row));
      });
    },

    async linkSubject(input): Promise<void> {
      assertOwnerOrAdmin(input.actor, 'SAML subject linking');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const subject = NonEmptyStringSchema.parse(input.subject);
      const userId = IdSchema.parse(input.userId);
      const nowIso = InstantSchema.parse(input.nowIso);
      await inTenant(tenantId, async (client) => {
        const member = await client.query(
          `SELECT user_id FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
          [tenantId, userId],
        );
        if (member.rows.length === 0) {
          throw new ChangeProofError('Link target is not a member of this tenant; refusing.');
        }
        try {
          await client.query(
            `INSERT INTO saml_subject_links (tenant_id, subject, user_id, created_at)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, subject, userId, nowIso],
          );
        } catch (error) {
          if (errorCode(error) === '23505') {
            throw new ChangeProofError('Subject is already linked; refusing to relink by guess.');
          }
          throw error;
        }
      });
    },

    async acceptLogin(input): Promise<{ tenantId: string; userId: string }> {
      // Logins are always initiated for an explicit tenant — the issuer alone
      // never routes, so two tenants may share one IdP without ambiguity.
      const tenantId = IdSchema.parse(input.tenantId);
      const assertion = SamlAssertionSchema.parse(input.assertion);
      const nowIso = InstantSchema.parse(input.nowIso);
      const connection = await inTenant(tenantId, async (client) => {
        const found = await client.query(`SELECT * FROM saml_connections WHERE tenant_id = $1`, [
          tenantId,
        ]);
        const row = found.rows[0];
        if (row === undefined) {
          return null;
        }
        return toConnection(ConnectionRowSchema.parse(row));
      });
      if (connection?.status !== 'active') {
        throw new ChangeProofError('SAML login is not available for this tenant; refusing.');
      }
      const claims = validateSamlAssertion({
        connection,
        assertion,
        expectedRequestId: NonEmptyStringSchema.parse(input.expectedRequestId),
        nowIso,
      });
      verifySamlSignature({
        certPem: connection.certPem,
        signedContentB64: assertion.signedContentB64,
        signatureB64: assertion.signatureB64,
      });
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        try {
          await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
          await client.query('SAVEPOINT saml_replay_guard');
          try {
            await client.query(
              `INSERT INTO saml_assertions_used (tenant_id, assertion_id, used_at)
               VALUES ($1, $2, $3)`,
              [tenantId, assertion.assertionId, nowIso],
            );
            await client.query('RELEASE SAVEPOINT saml_replay_guard');
          } catch (error) {
            if (errorCode(error) !== '23505') {
              throw error;
            }
            await client.query('ROLLBACK TO SAVEPOINT saml_replay_guard');
            throw new ChangeProofError('SAML assertion was already used; replay is refused.');
          }
          const link = await client.query(
            `SELECT user_id FROM saml_subject_links WHERE tenant_id = $1 AND subject = $2`,
            [tenantId, claims.subject],
          );
          const linkRow = link.rows[0];
          if (linkRow === undefined) {
            throw new ChangeProofError(
              'SAML subject has no linked account; an owner must link it first — email similarity never links.',
            );
          }
          const userId = z.object({ user_id: z.string() }).parse(linkRow).user_id;
          const member = await client.query(
            `SELECT user_id, role, status FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
            [tenantId, userId],
          );
          const memberRow = member.rows[0];
          if (memberRow === undefined) {
            throw new ChangeProofError('Linked SAML account is no longer a member; refusing.');
          }
          const parsedMember = MembershipStatusRowSchema.parse(memberRow);
          if (parsedMember.status !== 'active') {
            throw new ChangeProofError('Linked SAML account is suspended; refusing.');
          }
          await client.query('COMMIT');
          return { tenantId, userId };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } finally {
        client.release();
      }
    },
  };
}
