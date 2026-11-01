import { ChangeProofError, type TenantContext } from '../../core/index.js';

/**
 * Tenant grant and session checks (WP3-21, FR3-29).
 *
 * Pure, deterministic checks over the server-derived `TenantContext`. Every
 * check fails closed with a generic message — a rejection never discloses
 * whether another tenant, project, or repository exists (NEG3-21). Kept in
 * this file (rather than the public index) so the durable store can reuse the
 * same guards without an import cycle.
 */

/** The context must be derived server-side; a browser or job payload is not authority. */
export function assertServerAuthority(context: { readonly authoritySource: string }): void {
  if (context.authoritySource !== 'server') {
    throw new ChangeProofError(
      'Tenant context is not server-derived; opaque IDs and payloads are not permission.',
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
