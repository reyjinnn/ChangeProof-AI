import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { ChangeProofError, IdSchema, InstantSchema } from '../../core/index.js';

import { assertSafeReturnTarget } from './challenges.js';
import { normalizeEmail } from './email.js';

/**
 * GitHub identity: verified-profile registration, account linking, and
 * session issue (WP3-28/WP3-22, FR3-29/FR3-38).
 *
 * Linking requires authentication of BOTH identities, never a bare email
 * match: a GitHub profile whose verified email belongs to an existing
 * password account must log in with the password first, then link from an
 * authenticated session. GitHub-only accounts carry an unusable password
 * marker — `verifyPassword` reads it as false — so they are never silently
 * assigned a local password.
 *
 * Persistence follows the V5 pre-auth pattern: exact-match SECURITY DEFINER
 * functions in `infra/postgres/V13__github_identity.sql`, bound parameters
 * only, no direct table access.
 */

const SESSION_TTL_MS = 12 * 3_600_000;
const SESSION_REMEMBER_TTL_MS = 30 * 24 * 3_600_000;

/**
 * Unusable password hash for GitHub-only accounts. Not a scrypt payload,
 * so password verification always returns false — never access.
 */
export const GITHUB_ONLY_PASSWORD_MARKER_PREFIX = 'github-only$v1$';

const GithubLinkRowSchema = z.object({ user_id: z.string(), login: z.string() });
const UserLinkRowSchema = z.object({ github_id: z.string(), login: z.string() });
const EmailUserIdRowSchema = z.object({ id: z.string() });
const TenantRowSchema = z.object({ list_user_tenants: z.string() });

export interface GitHubIdentityDb {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface GitHubLink {
  readonly userId: string;
  readonly login: string;
}

export interface UserGitHubLink {
  readonly githubId: string;
  readonly login: string;
}

export interface GitHubIdentityStore {
  findLinkByGitHubId(githubId: string): Promise<GitHubLink | null>;
  findUserIdByEmail(email: string): Promise<string | null>;
  listLinksByUser(userId: string): Promise<readonly UserGitHubLink[]>;
  registerGitHubUser(input: {
    email: string;
    githubId: string;
    login: string;
    nowIso: string;
  }): Promise<{ userId: string; tenantId: string }>;
  linkGitHubIdentity(input: {
    userId: string;
    githubId: string;
    login: string;
    nowIso: string;
  }): Promise<void>;
  loginWithGitHub(input: {
    userId: string;
    tenantId?: string;
    rememberMe: boolean;
    returnTarget?: string;
    nowIso: string;
  }): Promise<{ sessionId: string; expiresAt: string; tenantId: string }>;
}

function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString('hex')}`;
}

function assertGitHubId(githubId: string): string {
  if (!/^[0-9]{1,30}$/.test(githubId)) {
    throw new ChangeProofError('GitHub identity is malformed; refusing.');
  }
  return githubId;
}

function assertLogin(login: string): string {
  const trimmed = login.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new ChangeProofError('GitHub profile is missing its login; refusing.');
  }
  return trimmed;
}

/**
 * Personal tenant for a new GitHub user: derived from the login plus fresh
 * randomness, always Id-shaped. Collisions retry with fresh randomness at
 * the call site, bounded.
 */
export function derivePersonalTenantId(login: string, randomHex: string): string {
  const sanitized = login
    .toLowerCase()
    .replace(/[^a-z0-9._~:@+-]/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60);
  const base = sanitized === '' ? 'gh' : `gh-${sanitized}`;
  return IdSchema.parse(`${base}-${randomHex}`);
}

export function createGitHubIdentityStore(db: GitHubIdentityDb): GitHubIdentityStore {
  async function userTenants(userId: string): Promise<readonly string[]> {
    const found = await db.query(`SELECT list_user_tenants($1)`, [userId]);
    return found.rows.map((row) => TenantRowSchema.parse(row).list_user_tenants);
  }

  return {
    async findLinkByGitHubId(githubId: string): Promise<GitHubLink | null> {
      const found = await db.query(`SELECT * FROM lookup_github_link($1)`, [assertGitHubId(githubId)]);
      if (found.rows.length === 0) return null;
      const parsed = GithubLinkRowSchema.parse(found.rows[0]);
      return { userId: parsed.user_id, login: parsed.login };
    },

    async findUserIdByEmail(email: string): Promise<string | null> {
      const found = await db.query(`SELECT id FROM lookup_email_user($1)`, [normalizeEmail(email)]);
      if (found.rows.length === 0) return null;
      return EmailUserIdRowSchema.parse(found.rows[0]).id;
    },

    async listLinksByUser(userId: string): Promise<readonly UserGitHubLink[]> {
      const found = await db.query(`SELECT * FROM list_github_links($1)`, [IdSchema.parse(userId)]);
      return found.rows.map((row) => {
        const parsed = UserLinkRowSchema.parse(row);
        return { githubId: parsed.github_id, login: parsed.login };
      });
    },

    async registerGitHubUser(input: {
      email: string;
      githubId: string;
      login: string;
      nowIso: string;
    }): Promise<{ userId: string; tenantId: string }> {
      const email = normalizeEmail(input.email);
      const githubId = assertGitHubId(input.githubId);
      const login = assertLogin(input.login);
      const nowIso = InstantSchema.parse(input.nowIso);
      const userId = randomId('emailuser');
      const passwordHash = `${GITHUB_ONLY_PASSWORD_MARKER_PREFIX}${randomBytes(16).toString('hex')}`;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const tenantId = derivePersonalTenantId(login, randomBytes(4).toString('hex'));
        try {
          await db.query(`SELECT register_github_user($1, $2, $3, $4, $5, $6, $7)`, [
            userId,
            email,
            passwordHash,
            githubId,
            login,
            tenantId,
            nowIso,
          ]);
          return { userId, tenantId };
        } catch (error) {
          if (error instanceof Error && error.message.includes('duplicate_email')) {
            throw new ChangeProofError(
              'This email already has a password account; log in with email, then link GitHub from Account.',
            );
          }
          if (error instanceof Error && error.message.includes('duplicate_github')) {
            throw new ChangeProofError('This GitHub account is already linked to a different user; refusing.');
          }
          if (error instanceof Error && error.message.includes('duplicate_tenant')) {
            lastError = error;
            continue;
          }
          throw error;
        }
      }
      throw new ChangeProofError(
        `Personal organization id collided repeatedly; refusing. (${lastError instanceof Error ? lastError.message : 'unknown'})`,
      );
    },

    async linkGitHubIdentity(input: {
      userId: string;
      githubId: string;
      login: string;
      nowIso: string;
    }): Promise<void> {
      const userId = IdSchema.parse(input.userId);
      const githubId = assertGitHubId(input.githubId);
      const login = assertLogin(input.login);
      const nowIso = InstantSchema.parse(input.nowIso);
      try {
        await db.query(`SELECT link_github_identity($1, $2, $3, $4)`, [userId, githubId, login, nowIso]);
      } catch (error) {
        if (error instanceof Error && error.message.includes('duplicate_github')) {
          throw new ChangeProofError('This GitHub account is already linked to a different user; refusing.');
        }
        if (error instanceof Error && error.message.includes('unknown_email_user')) {
          throw new ChangeProofError('Account is unknown; refusing to link.');
        }
        throw error;
      }
    },

    async loginWithGitHub(input: {
      userId: string;
      tenantId?: string;
      rememberMe: boolean;
      returnTarget?: string;
      nowIso: string;
    }): Promise<{ sessionId: string; expiresAt: string; tenantId: string }> {
      const userId = IdSchema.parse(input.userId);
      const nowIso = InstantSchema.parse(input.nowIso);
      if (input.returnTarget !== undefined) {
        assertSafeReturnTarget(input.returnTarget);
      }
      const tenants = await userTenants(userId);
      if (tenants.length === 0) {
        throw new ChangeProofError('No organization yet; claim one before signing in.');
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
        await db.query(`SELECT create_session($1, $2, $3, $4, $5)`, [sessionId, tenantId, userId, nowIso, expiresAt]);
      } catch (error) {
        if (error instanceof Error && error.message.includes('tenant_fenced')) {
          throw new ChangeProofError('Tenant is deleted; the deletion fence admits nothing new.');
        }
        throw error;
      }
      return { sessionId, expiresAt, tenantId };
    },
  };
}
