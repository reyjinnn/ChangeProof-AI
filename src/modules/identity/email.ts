import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  ChangeProofError,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  type EmailDeliveryPort,
  type SecretBrokerPort,
} from '../../core/index.js';

import { assertSafeReturnTarget, mintChallenge, verifyChallenge } from './challenges.js';
import { assertPasswordAcceptable, hashPassword, verifyPassword } from './passwords.js';

/**
 * Email identity: registration, verification, login, recovery, onboarding
 * (WP3-28, FR3-38).
 *
 * Users, challenge hashes, and rate-limit attempts live in
 * `infra/postgres/V5` behind exact-match SECURITY DEFINER functions — the
 * application role cannot dump them. Tokens are HMAC challenges from the
 * proven `challenges.ts` core; single-use is atomic in the database, and
 * unknown/used/expired/wrong-purpose tokens share one error message so a
 * token is never an existence oracle. Unknown addresses get the same response
 * shape as known ones on resend/reset; login failures share one message for
 * unknown users and wrong passwords.
 *
 * TTLs, session lifetimes, and rate limits below are `[DERIVED]` server
 * values (FR3-38 leaves them to implementation; the mockup's minimums do
 * not govern). Time is injected; the HMAC secret is read from the broker at
 * call time and never stored, logged, or forwarded.
 */

const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 3_600_000;
const CLAIM_TTL_MS = 24 * 3_600_000;
const SESSION_TTL_MS = 12 * 3_600_000;
const SESSION_REMEMBER_TTL_MS = 30 * 24 * 3_600_000;
const RATE_WINDOW_MS = 3_600_000;
const REGISTER_MAX_PER_HOUR = 10;
const RESEND_MAX_PER_HOUR = 5;
const RESET_MAX_PER_HOUR = 5;
const LOGIN_MAX_PER_HOUR = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EmailUserRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  password_hash: z.string(),
  verified_at: z.date().nullable(),
});

const TenantRowSchema = z.object({ list_user_tenants: z.string() });

const SessionRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  issued_at: z.date(),
  expires_at: z.date(),
  revoked_at: z.date().nullable(),
});

export interface EmailIdentityDeps {
  readonly delivery: EmailDeliveryPort;
  readonly secrets: SecretBrokerPort;
  readonly challengeSecretRef: string;
}

export interface EmailIdentityDb {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface EmailIdentityStore {
  registerUser(input: { email: string; password: string; nowIso: string }): Promise<{ userId: string }>;
  resendVerification(input: { email: string; nowIso: string }): Promise<void>;
  verifyEmail(input: { token: string; nowIso: string }): Promise<{ userId: string; claimTicket: string }>;
  loginWithPassword(input: {
    email: string;
    password: string;
    tenantId?: string;
    rememberMe: boolean;
    returnTarget?: string;
    nowIso: string;
  }): Promise<{ sessionId: string; expiresAt: string; tenantId: string }>;
  requestPasswordReset(input: { email: string; nowIso: string }): Promise<void>;
  resetPassword(input: { token: string; newPassword: string; nowIso: string }): Promise<void>;
  claimTenant(input: { ticket: string; tenantId: string; nowIso: string }): Promise<{ tenantId: string }>;
  listUserSessions(input: { userId: string }): Promise<
    readonly { sessionId: string; tenantId: string; expiresAt: string; revoked: boolean }[]
  >;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString('hex')}`;
}

/** Shared by the GitHub identity store: one email rule for every sign-in path. */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new ChangeProofError('Email address is malformed; refusing.');
  }
  return normalized;
}

export function createEmailIdentityStore(db: EmailIdentityDb, deps: EmailIdentityDeps): EmailIdentityStore {
  const secretRef = NonEmptyStringSchema.parse(deps.challengeSecretRef);

  async function checkRateLimit(key: string, action: string, max: number, nowIso: string): Promise<void> {
    try {
      await db.query(`SELECT check_rate_limit($1, $2, $3, $4, $5)`, [key, action, max, RATE_WINDOW_MS, nowIso]);
    } catch (error) {
      if (error instanceof ChangeProofError) {
        throw error;
      }
      if (error instanceof Error && error.message.includes('rate_limited')) {
        throw new ChangeProofError('Too many attempts; wait before retrying.');
      }
      throw error;
    }
  }

  async function findUserByEmail(email: string): Promise<z.infer<typeof EmailUserRowSchema> | null> {
    const found = await db.query(`SELECT * FROM lookup_email_user($1)`, [email]);
    if (found.rows.length === 0) {
      return null;
    }
    return EmailUserRowSchema.parse(found.rows[0]);
  }

  async function userTenants(userId: string): Promise<readonly string[]> {
    const found = await db.query(`SELECT list_user_tenants($1)`, [userId]);
    return found.rows.map((row) => TenantRowSchema.parse(row).list_user_tenants);
  }

  async function issueChallenge(
    userId: string,
    email: string,
    purpose: 'verify_email' | 'reset_password',
    ttlMs: number,
    nowIso: string,
    subject: string,
    intro: string,
  ): Promise<void> {
    const secret = await deps.secrets.readCredential(secretRef);
    const nowMs = Date.parse(nowIso);
    const token = mintChallenge({
      purpose,
      subjectId: userId,
      issuedAtMs: nowMs,
      ttlMs,
      nonce: randomBytes(16).toString('hex'),
      secret,
    });
    await db.query(`SELECT store_email_challenge($1, $2, $3, $4, $5)`, [
      sha256Hex(token),
      userId,
      purpose,
      new Date(nowMs + ttlMs).toISOString(),
      nowIso,
    ]);
    await deps.delivery.send({
      to: email,
      subject,
      textBody: `${intro}\n\nToken (single use, expires as stated):\n${token}\n`,
    });
  }

  return {
    async registerUser(input: { email: string; password: string; nowIso: string }): Promise<{ userId: string }> {
      const email = normalizeEmail(input.email);
      assertPasswordAcceptable(input.password);
      const nowIso = InstantSchema.parse(input.nowIso);
      await checkRateLimit(`email:${sha256Hex(email)}`, 'register', REGISTER_MAX_PER_HOUR, nowIso);
      const existing = await findUserByEmail(email);
      if (existing !== null) {
        if (existing.verified_at === null) {
          await checkRateLimit(existing.id, 'resend', RESEND_MAX_PER_HOUR, nowIso);
          await issueChallenge(
            existing.id,
            email,
            'verify_email',
            VERIFY_TTL_MS,
            nowIso,
            'Verify your ChangeProof email',
            'Your verification token is below. It can be used once.',
          );
        } else {
          await checkRateLimit(existing.id, 'notice', RESEND_MAX_PER_HOUR, nowIso);
          await deps.delivery.send({
            to: email,
            subject: 'Your ChangeProof account already exists',
            textBody: 'This address already has a ChangeProof account. Log in, or reset the password if needed.\n',
          });
        }
        return { userId: existing.id };
      }
      const userId = randomId('emailuser');
      const passwordHash = await hashPassword(input.password);
      try {
        await db.query(`SELECT register_email_user($1, $2, $3, $4)`, [userId, email, passwordHash, nowIso]);
      } catch (error) {
        if (error instanceof Error && error.message.includes('duplicate_email')) {
          // Lost a race with a concurrent registration: fall through to the
          // existing-address path so both callers see the same shape.
          const raced = await findUserByEmail(email);
          if (raced === null) {
            throw new ChangeProofError('Registration raced; retry against current state.');
          }
          return { userId: raced.id };
        }
        throw error;
      }
      await issueChallenge(
        userId,
        email,
        'verify_email',
        VERIFY_TTL_MS,
        nowIso,
        'Verify your ChangeProof email',
        'Your verification token is below. It can be used once.',
      );
      return { userId };
    },

    async resendVerification(input: { email: string; nowIso: string }): Promise<void> {
      const email = normalizeEmail(input.email);
      const nowIso = InstantSchema.parse(input.nowIso);
      const existing = await findUserByEmail(email);
      if (existing?.verified_at !== null) {
        return;
      }
      await checkRateLimit(existing.id, 'resend', RESEND_MAX_PER_HOUR, nowIso);
      await issueChallenge(
        existing.id,
        email,
        'verify_email',
        VERIFY_TTL_MS,
        nowIso,
        'Verify your ChangeProof email',
        'Your verification token is below. It can be used once.',
      );
    },

    async verifyEmail(input: { token: string; nowIso: string }): Promise<{ userId: string; claimTicket: string }> {
      const nowIso = InstantSchema.parse(input.nowIso);
      const nowMs = Date.parse(nowIso);
      const secret = await deps.secrets.readCredential(secretRef);
      verifyChallenge({ token: input.token, expectedPurpose: 'verify_email', nowMs, secret });
      let userId: string;
      try {
        const consumed = await db.query(`SELECT consume_email_challenge($1, $2, $3)`, [
          sha256Hex(input.token),
          'verify_email',
          nowIso,
        ]);
        userId = (consumed.rows[0] as { consume_email_challenge: string }).consume_email_challenge;
      } catch (error) {
        if (error instanceof Error && error.message.includes('invalid_challenge')) {
          throw new ChangeProofError('Verification token is invalid, used, or expired; refusing.');
        }
        throw error;
      }
      await db.query(`SELECT verify_email_user($1, $2)`, [IdSchema.parse(userId), nowIso]);
      const claimTicket = mintChallenge({
        purpose: 'claim_organization',
        subjectId: userId,
        issuedAtMs: nowMs,
        ttlMs: CLAIM_TTL_MS,
        nonce: randomBytes(16).toString('hex'),
        secret,
      });
      await db.query(`SELECT store_email_challenge($1, $2, $3, $4, $5)`, [
        sha256Hex(claimTicket),
        userId,
        'claim_organization',
        new Date(nowMs + CLAIM_TTL_MS).toISOString(),
        nowIso,
      ]);
      return { userId, claimTicket };
    },

    async loginWithPassword(input: {
      email: string;
      password: string;
      tenantId?: string;
      rememberMe: boolean;
      returnTarget?: string;
      nowIso: string;
    }): Promise<{ sessionId: string; expiresAt: string; tenantId: string }> {
      const email = normalizeEmail(input.email);
      const nowIso = InstantSchema.parse(input.nowIso);
      if (input.returnTarget !== undefined) {
        assertSafeReturnTarget(input.returnTarget);
      }
      const existing = await findUserByEmail(email);
      if (existing === null) {
        // Same work and same message as a wrong password: the address is no oracle.
        await hashPassword('dummy-password-for-unknown-user');
        await checkRateLimit(`email:${sha256Hex(email)}`, 'login', LOGIN_MAX_PER_HOUR, nowIso);
        throw new ChangeProofError('Email or password is incorrect.');
      }
      await checkRateLimit(existing.id, 'login', LOGIN_MAX_PER_HOUR, nowIso);
      if (!(await verifyPassword(input.password, existing.password_hash))) {
        throw new ChangeProofError('Email or password is incorrect.');
      }
      const tenants = await userTenants(existing.id);
      if (tenants.length === 0) {
        throw new ChangeProofError('No organization yet; claim one with the ticket from verification.');
      }
      let tenantId: string;
      if (input.tenantId === undefined) {
        if (tenants.length > 1) {
          throw new ChangeProofError('Several organizations found; name the tenant to log in to.');
        }
        tenantId = tenants[0] ?? '';
        if (tenantId.length === 0) {
          throw new ChangeProofError('Tenant lookup came back empty; refusing.');
        }
      } else {
        tenantId = IdSchema.parse(input.tenantId);
        if (!tenants.includes(tenantId)) {
          throw new ChangeProofError('No membership in the named tenant; refusing.');
        }
      }
      const ttlMs = input.rememberMe ? SESSION_REMEMBER_TTL_MS : SESSION_TTL_MS;
      const sessionId = randomId('sess');
      const expiresAt = new Date(Date.parse(nowIso) + ttlMs).toISOString();
      try {
        await db.query(`SELECT create_session($1, $2, $3, $4, $5)`, [
          sessionId,
          tenantId,
          existing.id,
          nowIso,
          expiresAt,
        ]);
      } catch (error) {
        if (error instanceof Error && error.message.includes('tenant_fenced')) {
          throw new ChangeProofError('Tenant is deleted; the deletion fence admits nothing new.');
        }
        throw error;
      }
      return { sessionId, expiresAt, tenantId };
    },

    async requestPasswordReset(input: { email: string; nowIso: string }): Promise<void> {
      const email = normalizeEmail(input.email);
      const nowIso = InstantSchema.parse(input.nowIso);
      const existing = await findUserByEmail(email);
      if (existing === null) {
        return;
      }
      await checkRateLimit(existing.id, 'reset', RESET_MAX_PER_HOUR, nowIso);
      await issueChallenge(
        existing.id,
        email,
        'reset_password',
        RESET_TTL_MS,
        nowIso,
        'Reset your ChangeProof password',
        'Your password-reset token is below. It can be used once and expires in one hour.',
      );
    },

    async resetPassword(input: { token: string; newPassword: string; nowIso: string }): Promise<void> {
      assertPasswordAcceptable(input.newPassword);
      const nowIso = InstantSchema.parse(input.nowIso);
      const nowMs = Date.parse(nowIso);
      const secret = await deps.secrets.readCredential(secretRef);
      verifyChallenge({ token: input.token, expectedPurpose: 'reset_password', nowMs, secret });
      let userId: string;
      try {
        const consumed = await db.query(`SELECT consume_email_challenge($1, $2, $3)`, [
          sha256Hex(input.token),
          'reset_password',
          nowIso,
        ]);
        userId = (consumed.rows[0] as { consume_email_challenge: string }).consume_email_challenge;
      } catch (error) {
        if (error instanceof Error && error.message.includes('invalid_challenge')) {
          throw new ChangeProofError('Reset token is invalid, used, or expired; refusing.');
        }
        throw error;
      }
      await db.query(`SELECT set_password_hash($1, $2)`, [userId, await hashPassword(input.newPassword)]);
      // Documented policy: a reset revokes every session of the user, on all tenants.
      for (const tenantId of await userTenants(userId)) {
        await db.query(`SELECT revoke_user_sessions($1, $2)`, [tenantId, userId]);
      }
    },

    async claimTenant(input: { ticket: string; tenantId: string; nowIso: string }): Promise<{ tenantId: string }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const nowIso = InstantSchema.parse(input.nowIso);
      const nowMs = Date.parse(nowIso);
      const secret = await deps.secrets.readCredential(secretRef);
      verifyChallenge({ token: input.ticket, expectedPurpose: 'claim_organization', nowMs, secret });
      try {
        await db.query(`SELECT claim_tenant_with_ticket($1, $2, $3)`, [tenantId, sha256Hex(input.ticket), nowIso]);
      } catch (error) {
        if (error instanceof Error && error.message.includes('invalid_challenge')) {
          throw new ChangeProofError('Claim ticket is invalid, used, or expired; refusing.');
        }
        if (error instanceof Error && error.message.includes('duplicate_tenant')) {
          throw new ChangeProofError('Tenant id is already taken; choose another.');
        }
        throw error;
      }
      return { tenantId };
    },

    async listUserSessions(input: { userId: string }): Promise<
      readonly { sessionId: string; tenantId: string; expiresAt: string; revoked: boolean }[]
    > {
      const userId = IdSchema.parse(input.userId);
      const found = await db.query(`SELECT * FROM list_user_sessions($1)`, [userId]);
      return found.rows.map((row) => {
        const parsed = SessionRowSchema.parse(row);
        return {
          sessionId: parsed.id,
          tenantId: parsed.tenant_id,
          expiresAt: parsed.expires_at.toISOString(),
          revoked: parsed.revoked_at !== null,
        };
      });
    },
  };
}
