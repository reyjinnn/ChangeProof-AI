import { describe, expect, it } from 'vitest';

import {
  RepositoryConnectionSchema,
  TenantContextSchema,
  type RepositoryConnection,
  type TenantContext,
} from '../../src/core/index.js';
import {
  assertCanMutate,
  assertConnectionActive,
  assertGrantCurrent,
  assertProjectGrant,
  assertServerAuthority,
  assertSessionFresh,
  assertTenantMatch,
  assertNoLastOwnerLockout,
} from '../../src/modules/identity/index.js';

/**
 * WP3-21 / T2-5 — grant/session failure-path tests (NEG3-21, NEG3-30, NEG3-38).
 *
 * Written before the implementation. Every access checks current grants:
 * forged tenant IDs, stale membership, viewer mutation, expired sessions and
 * last-owner removal are rejected without disclosing cross-tenant resources.
 * These are pure unit checks; the live PostgreSQL/RLS proof lives in
 * `tests/native/identity-rls.test.ts` and is reported separately.
 */

function context(overrides: Partial<TenantContext> = {}): TenantContext {
  return TenantContextSchema.parse({
    schemaVersion: '1',
    tenantId: 'tenant-a',
    userId: 'user-1',
    sessionId: 'sess-1',
    role: 'owner',
    projectGrants: ['proj-1'],
    repositoryGrants: ['repo-1'],
    grantVersion: 3,
    expiresAt: '2030-01-01T00:00:00.000Z',
    authoritySource: 'server',
    ...overrides,
  });
}

function connection(overrides: Partial<RepositoryConnection> = {}): RepositoryConnection {
  return RepositoryConnectionSchema.parse({
    schemaVersion: '1',
    connectionId: 'conn-1',
    tenantId: 'tenant-a',
    installationId: 'install-1',
    provider: 'github',
    repositoryAllowlist: ['repo-1'],
    permissionMatrix: { contents: true },
    status: 'active',
    revocationVersion: 0,
    credentialRef: 'cred-1',
    ...overrides,
  });
}

describe('tenant and authority checks (NEG3-21)', () => {
  it('rejects a forged tenant ID without disclosing stored resources', () => {
    expect(() => { assertTenantMatch(context(), 'tenant-b'); }).toThrow(/not authorized/);
  });

  it('accepts the session tenant', () => {
    expect(() => { assertTenantMatch(context(), 'tenant-a'); }).not.toThrow();
  });

  it('rejects a context that was not derived server-side', () => {
    expect(() =>
      TenantContextSchema.parse({ ...context(), authoritySource: 'browser' }),
    ).toThrow();
    expect(() => { assertServerAuthority({ authoritySource: 'browser' }); }).toThrow(/server/);
  });

  it('rejects a stale member whose grant version moved on', () => {
    expect(() => { assertGrantCurrent(context(), 4); }).toThrow(/stale|revoked/);
  });

  it('accepts a current grant version', () => {
    expect(() => { assertGrantCurrent(context(), 3); }).not.toThrow();
  });

  it('rejects a project outside the grant set', () => {
    expect(() => { assertProjectGrant(context(), 'proj-9'); }).toThrow(/not authorized/);
  });

  it('rejects a revoked repository connection instead of authorizing from cache', () => {
    expect(() => { assertConnectionActive(connection({ status: 'revoked' })); }).toThrow(/revoked/);
  });
});

describe('role checks (NEG3-21, NEG3-34)', () => {
  it('rejects viewer mutation', () => {
    expect(() => { assertCanMutate(context({ role: 'viewer' })); }).toThrow(/not authorized/);
  });

  it('rejects operator-console access from a tenant role shape', () => {
    expect(() => { assertCanMutate(context({ role: 'operator' })); }).toThrow(/not authorized/);
  });

  it('allows owner, admin and member mutation', () => {
    expect(() => { assertCanMutate(context({ role: 'owner' })); }).not.toThrow();
    expect(() => { assertCanMutate(context({ role: 'admin' })); }).not.toThrow();
    expect(() => { assertCanMutate(context({ role: 'member' })); }).not.toThrow();
  });
});

describe('session freshness (NEG3-30)', () => {
  it('rejects an expired session instead of serving from it', () => {
    expect(() => { assertSessionFresh(context(), '2031-06-01T00:00:00.000Z'); }).toThrow(/expired/);
  });

  it('accepts a live session', () => {
    expect(() => { assertSessionFresh(context(), '2026-10-29T00:00:00.000Z'); }).not.toThrow();
  });

  it('fails closed on an unreadable timestamp instead of defaulting to valid', () => {
    expect(() => { assertSessionFresh(context(), 'not-a-time'); }).toThrow();
  });
});

describe('last-owner lockout (NEG3-38)', () => {
  const members = [
    { userId: 'user-1', role: 'owner' as const },
    { userId: 'user-2', role: 'member' as const },
  ];

  it('refuses to remove the final owner', () => {
    expect(() => { assertNoLastOwnerLockout(members, 'user-1'); }).toThrow(/last owner/);
  });

  it('allows removing a non-owner', () => {
    expect(() => { assertNoLastOwnerLockout(members, 'user-2'); }).not.toThrow();
  });

  it('allows removing one owner while another remains', () => {
    const twoOwners = [
      { userId: 'user-1', role: 'owner' as const },
      { userId: 'user-2', role: 'owner' as const },
    ];
    expect(() => { assertNoLastOwnerLockout(twoOwners, 'user-1'); }).not.toThrow();
  });
});
