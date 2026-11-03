import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import {
  ChangeProofError,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  ScimEventSchema,
  type ScimEvent,
  type TenantContext,
} from '../../core/index.js';

import { assertNoLastOwnerLockout, assertOwnerOrAdmin } from './guards.js';
import type { IdentityDb, IdentityDbClient } from './store.js';

/**
 * SCIM provisioning lifecycle (WP3-32, FR3-44).
 *
 * Bearer tokens are minted once and stored as hashes; authentication compares
 * in constant time and fails closed on unknown, revoked, or malformed
 * tokens. Events apply idempotently in version order per external id: a
 * retried push lands once, an older version never overwrites newer state,
 * and a same-version conflict is refused instead of guessed (NEG3-38).
 *
 * Provisioning creates `member` memberships only — privilege elevation stays
 * an explicit owner/admin action, and SCIM never grants repository or
 * platform-operator permission. Disable suspends the membership and revokes
 * every session, which holds queued and running work the next time any
 * effect re-derives current grants; removing the last owner is refused.
 */

const SCIM_TOKEN_PREFIX = 'scim_';

const TokenRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  token_hash: z.string(),
  status: z.string(),
});

const EventVersionRowSchema = z.object({
  version: z.number(),
  operation: z.string(),
});

const MemberRowSchema = z.object({
  user_id: z.string(),
  role: z.string(),
  status: z.string(),
});

export function mintScimTokenValue(): string {
  return `${SCIM_TOKEN_PREFIX}${randomBytes(16).toString('hex')}`;
}

export function hashScimToken(token: string): string {
  return createHash('sha256').update(NonEmptyStringSchema.parse(token), 'utf8').digest('hex');
}

/** Constant-time hash compare; malformed inputs fail closed without comparing. */
export function scimTokenMatches(presentedHash: string, storedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(presentedHash) || !/^[0-9a-f]{64}$/.test(storedHash)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(presentedHash, 'utf8'), Buffer.from(storedHash, 'utf8'));
}

export type ScimApplyDecision = 'apply' | 'duplicate' | 'conflict' | 'superseded';

export function decideScimApply(
  existing: { version: number; operation: string } | null,
  incoming: { version: number; operation: string },
): ScimApplyDecision {
  if (existing === null) {
    return 'apply';
  }
  if (incoming.version < existing.version) {
    return 'superseded';
  }
  if (incoming.version > existing.version) {
    return 'apply';
  }
  return incoming.operation === existing.operation ? 'duplicate' : 'conflict';
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export type ScimOutcome = 'applied' | 'duplicate' | 'superseded' | 'refused';

export interface ScimStore {
  createToken(input: {
    actor: TenantContext;
    tokenId: string;
    nowIso: string;
  }): Promise<{ tokenId: string; token: string }>;
  revokeToken(input: {
    actor: TenantContext;
    tokenId: string;
    nowIso: string;
  }): Promise<{ tokenId: string; revoked: boolean }>;
  authenticate(input: { tenantId: string; presented: string; nowIso: string }): Promise<string>;
  applyEvent(input: { tenantId: string; event: ScimEvent; nowIso: string }): Promise<{
    outcome: ScimOutcome;
    userId: string | null;
  }>;
}

export function createScimStore(db: IdentityDb): ScimStore {
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
    async createToken(input): Promise<{ tokenId: string; token: string }> {
      assertOwnerOrAdmin(input.actor, 'SCIM token creation');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const tokenId = IdSchema.parse(input.tokenId);
      const nowIso = InstantSchema.parse(input.nowIso);
      const token = mintScimTokenValue();
      const tokenHash = hashScimToken(token);
      return inTenant(tenantId, async (client) => {
        try {
          await client.query(
            `INSERT INTO scim_tokens (id, tenant_id, token_hash, status, created_at, revoked_at, last_used_at)
             VALUES ($1, $2, $3, 'active', $4, NULL, NULL)`,
            [tokenId, tenantId, tokenHash, nowIso],
          );
        } catch (error) {
          if (errorCode(error) === '23505') {
            throw new ChangeProofError('SCIM token id is already taken; mint a new id.');
          }
          throw error;
        }
        return { tokenId, token };
      });
    },

    async revokeToken(input): Promise<{ tokenId: string; revoked: boolean }> {
      assertOwnerOrAdmin(input.actor, 'SCIM token revocation');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const tokenId = IdSchema.parse(input.tokenId);
      const nowIso = InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const updated = await client.query(
          `UPDATE scim_tokens SET status = 'revoked', revoked_at = $1
           WHERE id = $2 AND tenant_id = $3 AND status = 'active'`,
          [nowIso, tokenId, tenantId],
        );
        return { tokenId, revoked: (updated.rowCount ?? 0) > 0 };
      });
    },

    async authenticate(input): Promise<string> {
      const tenantId = IdSchema.parse(input.tenantId);
      const nowIso = InstantSchema.parse(input.nowIso);
      const presentedHash = hashScimToken(NonEmptyStringSchema.parse(input.presented));
      const found = await db.query(`SELECT * FROM lookup_scim_token($1)`, [presentedHash]);
      const row = found.rows[0];
      if (row === undefined) {
        throw new ChangeProofError('SCIM credential is unknown or revoked; refusing.');
      }
      const parsed = TokenRowSchema.parse(row);
      if (parsed.tenant_id !== tenantId || !scimTokenMatches(presentedHash, parsed.token_hash)) {
        throw new ChangeProofError('SCIM credential is unknown or revoked; refusing.');
      }
      await inTenant(tenantId, async (client) => {
        await client.query(`UPDATE scim_tokens SET last_used_at = $1 WHERE id = $2`, [nowIso, parsed.id]);
      });
      return parsed.id;
    },

    async applyEvent(input): Promise<{ outcome: ScimOutcome; userId: string | null }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const event = ScimEventSchema.parse(input.event);
      if (event.tenantId !== tenantId) {
        throw new ChangeProofError('SCIM event names a different tenant; refusing.');
      }
      const nowIso = InstantSchema.parse(input.nowIso);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        try {
          await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
          const latest = await client.query(
            `SELECT version, operation FROM scim_events
             WHERE tenant_id = $1 AND external_id = $2 AND outcome = 'applied'
             ORDER BY version DESC LIMIT 1`,
            [tenantId, event.externalId],
          );
          const latestRow = latest.rows[0];
          const decision = decideScimApply(
            latestRow === undefined ? null : EventVersionRowSchema.parse(latestRow),
            { version: event.version, operation: event.operation },
          );
          if (decision === 'duplicate' || decision === 'superseded') {
            await client.query(
              `INSERT INTO scim_events
                 (id, tenant_id, external_id, operation, version, email, groups, outcome, applied_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT DO NOTHING`,
              [
                IdSchema.parse(event.eventId),
                tenantId,
                event.externalId,
                event.operation,
                event.version,
                event.email ?? null,
                JSON.stringify(event.groups),
                decision,
                nowIso,
              ],
            );
            await client.query('COMMIT');
            return { outcome: decision, userId: null };
          }
          if (decision === 'conflict') {
            throw new ChangeProofError(
              'SCIM version is already applied with a different operation; refusing to guess.',
            );
          }
          // Opaque, always a valid identifier: external ids are IdP-controlled
          // and may contain characters a user id must not carry.
          const userId = `scim-${createHash('sha256').update(event.externalId, 'utf8').digest('hex').slice(0, 32)}`;
          if (event.operation === 'disable') {
            const members = await client.query(
              `SELECT user_id, role, status FROM memberships WHERE tenant_id = $1`,
              [tenantId],
            );
            const parsed = members.rows.map((row) => MemberRowSchema.parse(row));
            const target = parsed.find((member) => member.user_id === userId);
            if (target === undefined) {
              throw new ChangeProofError('SCIM disable names an unknown provisioned user; refusing.');
            }
            assertNoLastOwnerLockout(
              parsed.map((member) => ({ userId: member.user_id, role: member.role })),
              userId,
            );
            await client.query(
              `UPDATE memberships SET status = 'suspended' WHERE tenant_id = $1 AND user_id = $2`,
              [tenantId, userId],
            );
            await client.query(`SELECT revoke_user_sessions($1, $2)`, [tenantId, userId]);
          } else {
            await client.query(
              `INSERT INTO memberships (tenant_id, user_id, role, grant_version, status)
               VALUES ($1, $2, 'member', 0, 'active')
               ON CONFLICT (tenant_id, user_id)
               DO UPDATE SET status = 'active', grant_version = memberships.grant_version + 1`,
              [tenantId, userId],
            );
          }
          await client.query('SAVEPOINT scim_event_guard');
          try {
            await client.query(
              `INSERT INTO scim_events
                 (id, tenant_id, external_id, operation, version, email, groups, outcome, applied_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied', $8)`,
              [
                IdSchema.parse(event.eventId),
                tenantId,
                event.externalId,
                event.operation,
                event.version,
                event.email ?? null,
                JSON.stringify(event.groups),
                nowIso,
              ],
            );
            await client.query('RELEASE SAVEPOINT scim_event_guard');
          } catch (error) {
            if (errorCode(error) !== '23505') {
              throw error;
            }
            // A concurrent retry won the race; this attempt lands as a duplicate.
            await client.query('ROLLBACK TO SAVEPOINT scim_event_guard');
            await client.query('COMMIT');
            return { outcome: 'duplicate', userId: null };
          }
          await client.query('COMMIT');
          return { outcome: 'applied', userId };
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
