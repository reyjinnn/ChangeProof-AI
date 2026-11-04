import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  ChangeProofError,
  DataLifecycleRecordSchema,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  TenantContextSchema,
  type TenantContext,
} from '../../core/index.js';

import { assertCanMutate, assertNoLastOwnerLockout, assertServerAuthority } from './guards.js';

/**
 * PostgreSQL-backed identity services (WP3-21, FR3-29/35).
 *
 * Sessions, invitations, membership changes, tenant deletion fences, and
 * retention records live in `infra/postgres/V1+V2` and are reached only with
 * bound parameters — never interpolation. Pre-auth objects (sessions,
 * invitations, tombstones) resolve by exact match through SECURITY DEFINER
 * functions; tenant-scoped reads/writes run in a transaction with the tenant
 * bound via `set_config(..., is_local => true)` (auto-reset, no pool leak).
 *
 * Time is injected, never read. Tokens are 256-bit opaque values returned once
 * at creation; only their SHA-256 persists. The session id is a bearer secret:
 * it is transported, never logged — this module logs nothing.
 *
 * The database handle is a narrow interface, not a driver import: production
 * passes a `pg` pool (structurally compatible), the boundary stays driver-free.
 */

export interface IdentityDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface IdentityDbClient {
  query(text: string, params?: readonly unknown[]): Promise<IdentityDbResult>;
  release(): void;
}

export interface IdentityDb {
  query(text: string, params?: readonly unknown[]): Promise<IdentityDbResult>;
  connect(): Promise<IdentityDbClient>;
}

const RoleSchema = TenantContextSchema.shape.role;
const PurgeProgressSchema = DataLifecycleRecordSchema.shape.purgeProgress;
type PurgeProgress = z.infer<typeof PurgeProgressSchema>;

const SessionRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  user_id: z.string(),
  grant_version_at_issue: z.number().int(),
  issued_at: z.date(),
  expires_at: z.date(),
  revoked_at: z.date().nullable(),
});

const MembershipRowSchema = z.object({
  user_id: z.string(),
  role: z.string(),
  grant_version: z.number().int(),
  status: z.string(),
});

const ProjectRowSchema = z.object({ id: z.string() });
const RepositoryGrantRowSchema = z.object({ repository_id: z.string() });
const FencedRowSchema = z.object({ fenced: z.boolean() });
const InvitationIdRowSchema = z.object({ id: z.string() });
const AcceptRowSchema = z.object({ tenant_id: z.string(), role: z.string() });

function purgeOrder(stage: PurgeProgress): number {
  switch (stage) {
    case 'not_started':
      return 0;
    case 'in_progress':
      return 1;
    case 'complete':
      return 2;
    case 'failed':
      return 3;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '';
}

/** Map a driver failure to a specific actionable error; raw SQL never escapes. */
function refuse(operation: string, error: unknown, duplicateMessage?: string): never {
  const code = errorCode(error);
  if (code === '23505' && duplicateMessage !== undefined) {
    throw new ChangeProofError(duplicateMessage);
  }
  const message = errorMessage(error);
  const token = (name: string): boolean => message.includes(name);
  if (token('tenant_fenced')) {
    throw new ChangeProofError('Tenant is deleted; the deletion fence admits nothing new.');
  }
  if (token('unknown_membership')) {
    throw new ChangeProofError('Tenant or membership is unknown; refusing to authenticate.');
  }
  if (token('unknown_invitation')) {
    throw new ChangeProofError('Invitation token is unknown; refusing to accept.');
  }
  if (token('invitation_spent')) {
    throw new ChangeProofError('Invitation was already used or revoked; replay is rejected.');
  }
  if (token('invitation_expired')) {
    throw new ChangeProofError('Invitation has expired; request a fresh one.');
  }
  if (token('already_member')) {
    throw new ChangeProofError('User is already a member of this tenant; refusing to double-add.');
  }
  if (token('invite_not_authorized')) {
    throw new ChangeProofError('Invitation is not authorized for this role; only owners and admins may invite.');
  }
  if (token('delete_not_authorized')) {
    throw new ChangeProofError('Tenant deletion is not authorized; only the tenant owner may delete.');
  }
  if (token('invalid_tenant')) {
    throw new ChangeProofError('Tenant id is empty; refusing to create.');
  }
  throw new ChangeProofError(`${operation} (sqlstate ${code ?? 'unknown'}).`);
}

function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString('hex')}`;
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Bearer session id: always Id-shaped (raw base64url may start with `-`). */
function randomSessionId(): string {
  return `sess-${randomToken()}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface CreateSessionInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly ttlMs: number;
  readonly nowMs: number;
}

export interface DeriveContextInput {
  readonly sessionId: string;
  readonly nowIso: string;
}

export interface CreateInvitationInput {
  readonly actor: TenantContext;
  readonly role: string;
  readonly ttlMs: number;
  readonly nowMs: number;
}

export interface AcceptInvitationInput {
  readonly token: string;
  readonly userId: string;
  readonly nowMs: number;
}

export interface MemberChangeInput {
  readonly actor: TenantContext;
  readonly userId: string;
  readonly role: string;
}

export interface MemberRemovalInput {
  readonly actor: TenantContext;
  readonly userId: string;
}

export interface DeleteTenantInput {
  readonly actor: TenantContext;
  readonly reason: string;
  readonly nowMs: number;
}

export interface RecordRetentionInput {
  readonly actor: TenantContext;
  readonly artifactId: string;
  readonly retentionVersion: string;
  readonly categories: readonly string[];
  readonly locations: readonly string[];
}

export interface AdvancePurgeInput {
  readonly actor: TenantContext;
  readonly recordId: string;
  readonly from: string;
  readonly to: string;
}

export interface IdentityStore {
  createTenant(tenantId: string): Promise<void>;
  createSession(input: CreateSessionInput): Promise<{ sessionId: string; expiresAt: string }>;
  deriveContext(input: DeriveContextInput): Promise<TenantContext>;
  revokeSession(sessionId: string): Promise<void>;
  revokeUserSessions(tenantId: string, userId: string): Promise<void>;
  createInvitation(input: CreateInvitationInput): Promise<{ invitationId: string; token: string }>;
  acceptInvitation(input: AcceptInvitationInput): Promise<{ tenantId: string; role: string }>;
  changeMemberRole(input: MemberChangeInput): Promise<void>;
  removeMember(input: MemberRemovalInput): Promise<void>;
  deleteTenant(input: DeleteTenantInput): Promise<void>;
  recordRetention(input: RecordRetentionInput): Promise<{ recordId: string; purgeProgress: PurgeProgress }>;
  advancePurge(input: AdvancePurgeInput): Promise<void>;
  listMembers(actor: TenantContext): Promise<readonly { userId: string; role: string; detail: string }[]>;
}

function assertOwnerOrAdmin(actor: TenantContext, action: string): void {
  assertServerAuthority(actor);
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw new ChangeProofError(`${action} is not authorized for this role; only owners and admins may act.`);
  }
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ChangeProofError(`${label} must be a positive integer; refusing to proceed.`);
  }
}

function assertInstantMs(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
    throw new ChangeProofError(`${label} is unreadable; refusing to proceed.`);
  }
}

export function createIdentityStore(db: IdentityDb): IdentityStore {
  async function inTenant<T>(tenantId: string, work: (client: IdentityDbClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      try {
        // Bound tenant, transaction-local: reset is automatic on COMMIT/ROLLBACK.
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
    async createTenant(tenantId: string): Promise<void> {
      if (tenantId.trim().length === 0) {
        throw new ChangeProofError('Tenant id is empty; refusing to create.');
      }
      const id = IdSchema.parse(tenantId);
      try {
        await db.query(`SELECT create_tenant($1)`, [id]);
      } catch (error) {
        refuse('Tenant creation failed.', error, 'Tenant already exists; refusing to recreate.');
      }
    },

    async createSession(input: CreateSessionInput): Promise<{ sessionId: string; expiresAt: string }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const userId = IdSchema.parse(input.userId);
      assertPositiveInt(input.ttlMs, 'Session lifetime');
      assertInstantMs(input.nowMs, 'Session issue time');
      const sessionId = randomSessionId();
      const issuedAt = new Date(input.nowMs).toISOString();
      const expiresAt = new Date(input.nowMs + input.ttlMs).toISOString();
      try {
        const result = await db.query(`SELECT * FROM create_session($1, $2, $3, $4, $5)`, [
          sessionId,
          tenantId,
          userId,
          issuedAt,
          expiresAt,
        ]);
        const row = SessionRowSchema.parse(result.rows[0]);
        return { sessionId: row.id, expiresAt: row.expires_at.toISOString() };
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Session creation failed.', error);
      }
    },

    async deriveContext(input: DeriveContextInput): Promise<TenantContext> {
      const sessionId = IdSchema.parse(input.sessionId);
      const nowIso = InstantSchema.parse(input.nowIso);
      const nowMs = Date.parse(nowIso);
      let session: z.infer<typeof SessionRowSchema>;
      try {
        const found = await db.query(`SELECT * FROM lookup_session($1)`, [sessionId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Session is unknown; re-authentication is required.');
        }
        session = SessionRowSchema.parse(found.rows[0]);
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Session lookup failed.', error);
      }
      if (session.revoked_at !== null) {
        throw new ChangeProofError('Session was revoked; re-authentication is required.');
      }
      if (session.expires_at.getTime() <= nowMs) {
        throw new ChangeProofError('Session has expired; re-authentication is required.');
      }
      try {
        const fenced = await db.query(`SELECT is_tenant_fenced($1) AS fenced`, [session.tenant_id]);
        if (FencedRowSchema.parse(fenced.rows[0]).fenced) {
          throw new ChangeProofError('Tenant is deleted; the deletion fence admits nothing new.');
        }
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Tenant fence check failed.', error);
      }
      try {
        return await inTenant(session.tenant_id, async (client) => {
          const membership = await client.query(
            `SELECT user_id, role, grant_version, status FROM memberships WHERE user_id = $1`,
            [session.user_id],
          );
          if (membership.rows.length === 0) {
            throw new ChangeProofError('Membership is gone; re-authentication is required.');
          }
          const member = MembershipRowSchema.parse(membership.rows[0]);
          if (member.status !== 'active') {
            throw new ChangeProofError('Membership is suspended; re-authentication is required.');
          }
          if (member.grant_version > session.grant_version_at_issue) {
            throw new ChangeProofError('Session grant is stale; re-authentication is required.');
          }
          const projects = await client.query(`SELECT id FROM projects ORDER BY id`);
          const grants = await client.query(`SELECT repository_id FROM repository_grants ORDER BY repository_id`);
          return TenantContextSchema.parse({
            schemaVersion: '1',
            tenantId: session.tenant_id,
            userId: session.user_id,
            sessionId: session.id,
            role: RoleSchema.parse(member.role),
            projectGrants: projects.rows.map((row) => ProjectRowSchema.parse(row).id),
            repositoryGrants: grants.rows.map((row) => RepositoryGrantRowSchema.parse(row).repository_id),
            grantVersion: member.grant_version,
            expiresAt: session.expires_at.toISOString(),
            authoritySource: 'server',
          });
        });
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Context derivation failed.', error);
      }
    },

    async revokeSession(sessionId: string): Promise<void> {
      const id = IdSchema.parse(sessionId);
      try {
        await db.query(`SELECT revoke_session($1)`, [id]);
      } catch (error) {
        refuse('Session revocation failed.', error);
      }
    },

    async revokeUserSessions(tenantId: string, userId: string): Promise<void> {
      const tenant = IdSchema.parse(tenantId);
      const user = IdSchema.parse(userId);
      try {
        await db.query(`SELECT revoke_user_sessions($1, $2)`, [tenant, user]);
      } catch (error) {
        refuse('Session revocation failed.', error);
      }
    },

    async createInvitation(input: CreateInvitationInput): Promise<{ invitationId: string; token: string }> {
      assertOwnerOrAdmin(input.actor, 'Invitation');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const role = RoleSchema.parse(input.role);
      assertPositiveInt(input.ttlMs, 'Invitation lifetime');
      assertInstantMs(input.nowMs, 'Invitation issue time');
      const invitationId = randomId('inv');
      const token = randomToken();
      const issuedAt = new Date(input.nowMs).toISOString();
      const expiresAt = new Date(input.nowMs + input.ttlMs).toISOString();
      try {
        const result = await db.query(`SELECT * FROM create_invitation($1, $2, $3, $4, $5, $6, $7)`, [
          invitationId,
          tenantId,
          role,
          input.actor.userId,
          sha256Hex(token),
          issuedAt,
          expiresAt,
        ]);
        const row = InvitationIdRowSchema.parse(result.rows[0]);
        return { invitationId: row.id, token };
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Invitation creation failed.', error, 'Invitation id collided; retry with a fresh mint.');
      }
    },

    async acceptInvitation(input: AcceptInvitationInput): Promise<{ tenantId: string; role: string }> {
      const token = NonEmptyStringSchema.parse(input.token);
      const userId = IdSchema.parse(input.userId);
      assertInstantMs(input.nowMs, 'Invitation accept time');
      try {
        const result = await db.query(`SELECT * FROM accept_invitation($1, $2, $3)`, [
          sha256Hex(token),
          userId,
          new Date(input.nowMs).toISOString(),
        ]);
        const row = AcceptRowSchema.parse(result.rows[0]);
        return { tenantId: IdSchema.parse(row.tenant_id), role: RoleSchema.parse(row.role) };
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Invitation accept failed.', error);
      }
    },

    async changeMemberRole(input: MemberChangeInput): Promise<void> {
      assertOwnerOrAdmin(input.actor, 'Role change');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const userId = IdSchema.parse(input.userId);
      const role = RoleSchema.parse(input.role);
      try {
        await inTenant(tenantId, async (client) => {
          const members = await client.query(
            `SELECT user_id, role, grant_version, status FROM memberships ORDER BY user_id FOR UPDATE`,
          );
          const parsed = members.rows.map((row) => MembershipRowSchema.parse(row));
          const lockoutView = parsed.map((member) => ({ userId: member.user_id, role: member.role }));
          if (!lockoutView.some((member) => member.userId === userId)) {
            throw new ChangeProofError('Membership is unknown; refusing to change it.');
          }
          assertNoLastOwnerLockout(lockoutView, userId);
          await client.query(`UPDATE memberships SET role = $1, grant_version = grant_version + 1 WHERE user_id = $2`, [
            role,
            userId,
          ]);
        });
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Role change failed.', error);
      }
    },

    async removeMember(input: MemberRemovalInput): Promise<void> {
      assertOwnerOrAdmin(input.actor, 'Member removal');
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const userId = IdSchema.parse(input.userId);
      try {
        await inTenant(tenantId, async (client) => {
          const members = await client.query(
            `SELECT user_id, role, grant_version, status FROM memberships ORDER BY user_id FOR UPDATE`,
          );
          const parsed = members.rows.map((row) => MembershipRowSchema.parse(row));
          const lockoutView = parsed.map((member) => ({ userId: member.user_id, role: member.role }));
          if (!lockoutView.some((member) => member.userId === userId)) {
            throw new ChangeProofError('Membership is unknown; refusing to remove it.');
          }
          assertNoLastOwnerLockout(lockoutView, userId);
          await client.query(`DELETE FROM memberships WHERE user_id = $1`, [userId]);
          await client.query(`SELECT revoke_user_sessions($1, $2)`, [tenantId, userId]);
        });
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Member removal failed.', error);
      }
    },

    async deleteTenant(input: DeleteTenantInput): Promise<void> {
      assertServerAuthority(input.actor);
      if (input.actor.role !== 'owner') {
        throw new ChangeProofError('Tenant deletion is not authorized; only the tenant owner may delete.');
      }
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const reason = NonEmptyStringSchema.parse(input.reason);
      assertInstantMs(input.nowMs, 'Tenant deletion time');
      try {
        await db.query(`SELECT fence_tenant($1, $2, $3, $4, $5)`, [
          tenantId,
          input.actor.userId,
          reason,
          new Date(input.nowMs).toISOString(),
          randomId('lc'),
        ]);
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Tenant deletion failed.', error);
      }
    },

    async recordRetention(
      input: RecordRetentionInput,
    ): Promise<{ recordId: string; purgeProgress: PurgeProgress }> {
      assertCanMutate(input.actor);
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const artifactId = IdSchema.parse(input.artifactId);
      const retentionVersion = IdSchema.parse(input.retentionVersion);
      const categories = z.array(NonEmptyStringSchema).min(1).parse([...input.categories]);
      const locations = z.array(NonEmptyStringSchema).min(1).parse([...input.locations]);
      const recordId = randomId('lr');
      try {
        await inTenant(tenantId, async (client) => {
          await client.query(
            `INSERT INTO lifecycle_records
               (id, tenant_id, artifact_id, retention_version, categories, locations, purge_progress)
             VALUES ($1, current_setting('app.current_tenant'), $2, $3, $4, $5, 'not_started')`,
            [recordId, artifactId, retentionVersion, categories, locations],
          );
        });
        return { recordId, purgeProgress: 'not_started' };
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Retention recording failed.', error);
      }
    },

    async advancePurge(input: AdvancePurgeInput): Promise<void> {
      assertCanMutate(input.actor);
      const tenantId = IdSchema.parse(input.actor.tenantId);
      const recordId = IdSchema.parse(input.recordId);
      const from = PurgeProgressSchema.parse(input.from);
      const to = PurgeProgressSchema.parse(input.to);
      const forward =
        to === 'failed'
          ? from === 'not_started' || from === 'in_progress'
          : purgeOrder(to) > purgeOrder(from);
      if (!forward || from === 'complete' || from === 'failed') {
        throw new ChangeProofError('Purge transition is not a forward move; refusing to rewrite history.');
      }
      try {
        await inTenant(tenantId, async (client) => {
          const updated = await client.query(
            `UPDATE lifecycle_records SET purge_progress = $1
             WHERE id = $2 AND purge_progress = $3`,
            [to, recordId, from],
          );
          if (updated.rowCount !== 1) {
            throw new ChangeProofError(
              'Purge CAS failed: the record is missing, already moved, or owned by another tenant.',
            );
          }
        });
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Purge advance failed.', error);
      }
    },

    async listMembers(actor: TenantContext): Promise<readonly { userId: string; role: string; detail: string }[]> {
      assertServerAuthority(actor);
      if (actor.role === 'operator') {
        throw new ChangeProofError('Operator accounts carry no tenant authority here (NEG3-34).');
      }
      const tenantId = IdSchema.parse(actor.tenantId);
      return inTenant(tenantId, async (client) => {
        const statusCol = await client.query(
          `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'status'`,
        );
        const withStatus = statusCol.rows.length > 0;
        const found = await client.query(
          withStatus
            ? 'SELECT user_id, role, grant_version, status FROM memberships WHERE tenant_id = $1 ORDER BY user_id ASC'
            : 'SELECT user_id, role, grant_version FROM memberships WHERE tenant_id = $1 ORDER BY user_id ASC',
          [tenantId],
        );
        return found.rows.map((row) => {
          if (withStatus) {
            const parsed = MembershipRowSchema.parse(row);
            return {
              userId: parsed.user_id,
              role: parsed.role,
              detail: `grant v${String(parsed.grant_version)} · ${parsed.status}`,
            };
          }
          const parsed = MembershipRowSchema.omit({ status: true }).parse(row);
          return { userId: parsed.user_id, role: parsed.role, detail: `grant v${String(parsed.grant_version)}` };
        });
      });
    },
  };
}
