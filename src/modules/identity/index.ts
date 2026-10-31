import {
  ChangeProofError,
  type RepositoryConnection,
  type TenantContext,
} from '../../core/index.js';

export * from './challenges.js';

/**
 * Tenant grant and session checks (WP3-21, FR3-29).
 *
 * Preparation scope: pure, deterministic checks over the server-derived
 * `TenantContext` (and `RepositoryConnection`) contracts. Every check fails
 * closed with a generic message — a rejection never discloses whether another
 * tenant, project, or repository exists (NEG3-21). Durable state (PostgreSQL
 * + RLS) and hosted wiring (sessions, invites, lifecycle) arrive with the
 * full WP; the live RLS proof lives in `tests/native/identity-rls.test.ts`.
 */

/** The context must be derived server-side; a browser or job payload is not authority. */
export function assertServerAuthority(context: { readonly authoritySource: string }): void {
  if (context.authoritySource !== 'server') {
    throw new ChangeProofError(
      'Tenant context is not server-derived; opaque IDs and payloads are not permission.',
    );
  }
}

/** The requested tenant must equal the session tenant. */
export function assertTenantMatch(context: TenantContext, tenantId: string): void {
  assertServerAuthority(context);
  if (context.tenantId !== tenantId) {
    throw new ChangeProofError('Request is not authorized for this tenant.');
  }
}

/** Membership at an older grant version than the current one is stale. */
export function assertGrantCurrent(context: TenantContext, currentGrantVersion: number): void {
  assertServerAuthority(context);
  if (!Number.isInteger(currentGrantVersion) || currentGrantVersion < 0) {
    throw new ChangeProofError('Current grant version is unreadable; refusing to authorize.');
  }
  if (context.grantVersion < currentGrantVersion) {
    throw new ChangeProofError(
      'Membership is stale or revoked; re-authentication is required.',
    );
  }
}

/** Only owner/admin/member mutate tenant resources; viewer never does, and the
 *  operator role carries no tenant authority (NEG3-34). */
export function assertCanMutate(context: TenantContext): void {
  assertServerAuthority(context);
  if (
    context.role !== 'owner' &&
    context.role !== 'admin' &&
    context.role !== 'member'
  ) {
    throw new ChangeProofError('Role is not authorized to mutate this resource.');
  }
}

/** The project must be inside the session grant set. */
export function assertProjectGrant(context: TenantContext, projectId: string): void {
  assertServerAuthority(context);
  if (!context.projectGrants.includes(projectId)) {
    throw new ChangeProofError('Request is not authorized for this project.');
  }
}

/** Every repository in a multi-repo set must be individually granted. */
export function assertAllRepositoryGrants(
  context: TenantContext,
  repositoryIds: readonly string[],
): void {
  assertServerAuthority(context);
  for (const repositoryId of repositoryIds) {
    if (!context.repositoryGrants.includes(repositoryId)) {
      throw new ChangeProofError('Request is not authorized for every required repository.');
    }
  }
}

/** Sessions past expiry authorize nothing; unreadable timestamps fail closed. */
export function assertSessionFresh(context: TenantContext, nowIso: string): void {
  assertServerAuthority(context);
  const now = Date.parse(nowIso);
  const expires = Date.parse(context.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires)) {
    throw new ChangeProofError('Session timestamp is unreadable; refusing to authorize.');
  }
  if (expires <= now) {
    throw new ChangeProofError('Session has expired; re-authentication is required.');
  }
}

/** Removing the final owner would lock the tenant out (NEG3-38). */
export function assertNoLastOwnerLockout(
  members: readonly { readonly userId: string; readonly role: string }[],
  removingUserId: string,
): void {
  const remainingOwners = members.filter(
    (member) => member.role === 'owner' && member.userId !== removingUserId,
  );
  const removing = members.find((member) => member.userId === removingUserId);
  if (removing?.role === 'owner' && remainingOwners.length === 0) {
    throw new ChangeProofError(
      'Removing the last owner is refused; transfer ownership first.',
    );
  }
}

/** Only an `active` connection authorizes effects; revocation stops new work. */
export function assertConnectionActive(connection: RepositoryConnection): void {
  if (connection.status !== 'active') {
    throw new ChangeProofError(
      'Repository connection is revoked or inactive; new effects are rejected and queued work stops.',
    );
  }
}
