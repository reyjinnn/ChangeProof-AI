import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIdentityStore } from '../../src/modules/identity/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-21 — identity services on real PostgreSQL (FR3-29/35, NEG3-21/30/38).
 *
 * Native check, reported separately from the pure suite: `pnpm test` excludes
 * `tests/native/**`; run with `DATABASE_URL=… pnpm test:identity:native`
 * against a disposable PostgreSQL 16 container. Fails closed without
 * DATABASE_URL. Applies V1 (tenancy) then V2 (services); every test uses its
 * own tenant ids so tests never share state.
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL is required (e.g. postgresql://postgres:<pw>@127.0.0.1:55432/postgres). ' +
      'Start the disposable probe container first; see docs/phase-reports/phase-2.md.',
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const v1 = readFileSync(join(here, '..', '..', 'infra', 'postgres', 'V1__identity_tenancy.sql'), 'utf8');
const v2 = readFileSync(join(here, '..', '..', 'infra', 'postgres', 'V2__identity_services.sql'), 'utf8');

// Own database per file: scheduling (serial or parallel) cannot cross-talk.
const fileDbUrl = databaseUrlFor(databaseUrl, 't_svc');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });
const store = createIdentityStore(appPool);

const NOW = '2026-10-31T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const HOUR_MS = 3_600_000;

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function seedOwner(tenantId: string, userId: string): Promise<void> {
  await store.createTenant(tenantId);
  await admin.query(`INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, 'owner', 0)`, [
    tenantId,
    userId,
  ]);
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_svc');
  await admin.query(v1);
  await admin.query(v2);
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('tenant creation rejects empty identities (T-14 forward constraint)', () => {
  it('refuses an empty or blank tenant id', async () => {
    await expect(store.createTenant('')).rejects.toThrow(/tenant/i);
    await expect(store.createTenant('   ')).rejects.toThrow(/tenant/i);
  });

  it('refuses a duplicate tenant with a specific error', async () => {
    const tenantId = uniqueId('tenant-dup');
    await store.createTenant(tenantId);
    await expect(store.createTenant(tenantId)).rejects.toThrow(/already exists|duplicate/i);
  });
});

describe('sessions authenticate server-side (NEG3-21)', () => {
  it('derives a server-authoritative context with current grants', async () => {
    const tenantId = uniqueId('tenant-sess');
    const userId = uniqueId('user-owner');
    await seedOwner(tenantId, userId);
    await admin.query(`INSERT INTO projects (id, tenant_id) VALUES ($1, $2)`, [`${tenantId}-p1`, tenantId]);
    await admin.query(
      `INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)`,
      [tenantId, `${tenantId}-r1`, `${tenantId}-p1`],
    );

    const session = await store.createSession({ tenantId, userId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const context = await store.deriveContext({ sessionId: session.sessionId, nowIso: NOW });

    expect(context.authoritySource).toBe('server');
    expect(context.tenantId).toBe(tenantId);
    expect(context.userId).toBe(userId);
    expect(context.role).toBe('owner');
    expect(context.projectGrants).toEqual([`${tenantId}-p1`]);
    expect(context.repositoryGrants).toEqual([`${tenantId}-r1`]);
  });

  it('refuses a session for an unknown tenant or non-member', async () => {
    await expect(
      store.createSession({ tenantId: uniqueId('tenant-ghost'), userId: 'ghost', ttlMs: HOUR_MS, nowMs: NOW_MS }),
    ).rejects.toThrow(/membership|tenant/i);
  });

  it('refuses to derive from an unknown session id', async () => {
    await expect(
      store.deriveContext({ sessionId: `sess-${randomBytes(32).toString('base64url')}`, nowIso: NOW }),
    ).rejects.toThrow(/session/i);
  });

  it('refuses to derive from an expired session', async () => {
    const tenantId = uniqueId('tenant-exp');
    const userId = uniqueId('user-exp');
    await seedOwner(tenantId, userId);
    const session = await store.createSession({ tenantId, userId, ttlMs: HOUR_MS, nowMs: NOW_MS });

    await expect(
      store.deriveContext({ sessionId: session.sessionId, nowIso: new Date(NOW_MS + 2 * HOUR_MS).toISOString() }),
    ).rejects.toThrow(/expired/i);
  });

  it('refuses to derive after logout, and logout-everywhere revokes all sessions', async () => {
    const tenantId = uniqueId('tenant-logout');
    const userId = uniqueId('user-logout');
    await seedOwner(tenantId, userId);
    const first = await store.createSession({ tenantId, userId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const second = await store.createSession({ tenantId, userId, ttlMs: HOUR_MS, nowMs: NOW_MS });

    await store.revokeSession(first.sessionId);
    await expect(store.deriveContext({ sessionId: first.sessionId, nowIso: NOW })).rejects.toThrow(/revoked/i);
    // The other session still works until logout-everywhere.
    await expect(store.deriveContext({ sessionId: second.sessionId, nowIso: NOW })).resolves.toMatchObject({
      tenantId,
    });
    await store.revokeUserSessions(tenantId, userId);
    await expect(store.deriveContext({ sessionId: second.sessionId, nowIso: NOW })).rejects.toThrow(/revoked/i);
  });

  it('treats a session as stale once the membership grant version moves (NEG3-21)', async () => {
    const tenantId = uniqueId('tenant-stale');
    const ownerId = uniqueId('user-owner');
    const memberId = uniqueId('user-member');
    await seedOwner(tenantId, ownerId);
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, 'member', 0)`, [
      tenantId,
      memberId,
    ]);
    const session = await store.createSession({ tenantId, userId: memberId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const ownerSession = await store.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const owner = await store.deriveContext({ sessionId: ownerSession.sessionId, nowIso: NOW });

    await store.changeMemberRole({ actor: owner, userId: memberId, role: 'admin' });

    await expect(store.deriveContext({ sessionId: session.sessionId, nowIso: NOW })).rejects.toThrow(/stale/i);
  });
});

describe('invitations are single-use and expiring (NEG3-30)', () => {
  it('lets an owner invite and a new user accept exactly once', async () => {
    const tenantId = uniqueId('tenant-inv');
    const ownerId = uniqueId('user-owner');
    await seedOwner(tenantId, ownerId);
    const ownerSession = await store.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const owner = await store.deriveContext({ sessionId: ownerSession.sessionId, nowIso: NOW });

    const invite = await store.createInvitation({ actor: owner, role: 'member', ttlMs: HOUR_MS, nowMs: NOW_MS });
    // Secret-serialization: the raw token is returned once; only its hash persists.
    expect(invite.token.length).toBeGreaterThan(32);
    const stored = await admin.query(`SELECT token_hash FROM invitations WHERE id = $1`, [invite.invitationId]);
    const hash = (stored.rows as { token_hash: string }[])[0]?.token_hash;
    expect(hash).toBe(createHash('sha256').update(invite.token).digest('hex'));
    expect(JSON.stringify(stored.rows)).not.toContain(invite.token);

    const accepted = await store.acceptInvitation({ token: invite.token, userId: uniqueId('user-new'), nowMs: NOW_MS });
    expect(accepted.tenantId).toBe(tenantId);
    expect(accepted.role).toBe('member');
    // Replay loses: the CAS marks the invitation spent.
    await expect(
      store.acceptInvitation({ token: invite.token, userId: uniqueId('user-other'), nowMs: NOW_MS }),
    ).rejects.toThrow(/spent|replay|already/i);
  });

  it('refuses a tampered or unknown token without disclosing tenant state', async () => {
    await expect(
      store.acceptInvitation({ token: randomBytes(32).toString('base64url'), userId: 'nobody', nowMs: NOW_MS }),
    ).rejects.toThrow(/invitation/i);
  });

  it('refuses an expired invitation', async () => {
    const tenantId = uniqueId('tenant-invexp');
    const ownerId = uniqueId('user-owner');
    await seedOwner(tenantId, ownerId);
    const ownerSession = await store.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const owner = await store.deriveContext({ sessionId: ownerSession.sessionId, nowIso: NOW });

    const invite = await store.createInvitation({ actor: owner, role: 'viewer', ttlMs: HOUR_MS, nowMs: NOW_MS });
    await expect(
      store.acceptInvitation({ token: invite.token, userId: uniqueId('user-late'), nowMs: NOW_MS + 2 * HOUR_MS }),
    ).rejects.toThrow(/expired/i);
  });

  it('refuses an invitation minted by a member or viewer ([DERIVED] owner/admin only)', async () => {
    const tenantId = uniqueId('tenant-invrole');
    const ownerId = uniqueId('user-owner');
    const memberId = uniqueId('user-member');
    await seedOwner(tenantId, ownerId);
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, 'member', 0)`, [
      tenantId,
      memberId,
    ]);
    const memberSession = await store.createSession({ tenantId, userId: memberId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const member = await store.deriveContext({ sessionId: memberSession.sessionId, nowIso: NOW });

    await expect(store.createInvitation({ actor: member, role: 'viewer', ttlMs: HOUR_MS, nowMs: NOW_MS })).rejects.toThrow(
      /not authorized|owner|admin/i,
    );
  });
});

describe('membership changes keep an owner and stay current (NEG3-38)', () => {
  it('refuses to remove or demote the last owner', async () => {
    const tenantId = uniqueId('tenant-lastown');
    const ownerId = uniqueId('user-owner');
    await seedOwner(tenantId, ownerId);
    const ownerSession = await store.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const owner = await store.deriveContext({ sessionId: ownerSession.sessionId, nowIso: NOW });

    await expect(store.removeMember({ actor: owner, userId: ownerId })).rejects.toThrow(/last owner/i);
    await expect(store.changeMemberRole({ actor: owner, userId: ownerId, role: 'member' })).rejects.toThrow(
      /last owner/i,
    );
  });

  it('refuses role changes from a non-owner/admin actor', async () => {
    const tenantId = uniqueId('tenant-roleauth');
    const ownerId = uniqueId('user-owner');
    const memberId = uniqueId('user-member');
    await seedOwner(tenantId, ownerId);
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, 'member', 0)`, [
      tenantId,
      memberId,
    ]);
    const memberSession = await store.createSession({ tenantId, userId: memberId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const member = await store.deriveContext({ sessionId: memberSession.sessionId, nowIso: NOW });

    await expect(store.changeMemberRole({ actor: member, userId: ownerId, role: 'viewer' })).rejects.toThrow(
      /not authorized/i,
    );
  });
});

describe('tenant deletion fences every admission (AGENTS.md §10)', () => {
  it('refuses deletion by a non-owner, then fences the tenant for everyone', async () => {
    const tenantId = uniqueId('tenant-del');
    const ownerId = uniqueId('user-owner');
    const memberId = uniqueId('user-member');
    await seedOwner(tenantId, ownerId);
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, 'member', 0)`, [
      tenantId,
      memberId,
    ]);
    const memberSession = await store.createSession({ tenantId, userId: memberId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const member = await store.deriveContext({ sessionId: memberSession.sessionId, nowIso: NOW });
    await expect(store.deleteTenant({ actor: member, reason: 'hostile takeover', nowMs: NOW_MS })).rejects.toThrow(
      /not authorized|owner/i,
    );

    const ownerSession = await store.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const owner = await store.deriveContext({ sessionId: ownerSession.sessionId, nowIso: NOW });
    await store.deleteTenant({ actor: owner, reason: 'owner requested deletion', nowMs: NOW_MS });

    // Every admission path now refuses: old sessions, new sessions, new invites.
    await expect(store.deriveContext({ sessionId: memberSession.sessionId, nowIso: NOW })).rejects.toThrow(
      /fenced|deleted|revoked/i,
    );
    await expect(
      store.createSession({ tenantId, userId: memberId, ttlMs: HOUR_MS, nowMs: NOW_MS }),
    ).rejects.toThrow(/fenced|deleted/i);
    await expect(store.createInvitation({ actor: owner, role: 'viewer', ttlMs: HOUR_MS, nowMs: NOW_MS })).rejects.toThrow(
      /fenced|deleted/i,
    );
  });

  it('seeds a tenant lifecycle record in not_started purge state', async () => {
    const tenantId = uniqueId('tenant-lifecycle');
    const ownerId = uniqueId('user-owner');
    await seedOwner(tenantId, ownerId);
    const ownerSession = await store.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const owner = await store.deriveContext({ sessionId: ownerSession.sessionId, nowIso: NOW });
    await store.deleteTenant({ actor: owner, reason: 'lifecycle seed check', nowMs: NOW_MS });

    const rows = await admin.query(`SELECT purge_progress FROM lifecycle_records WHERE tenant_id = $1`, [tenantId]);
    expect((rows.rows as { purge_progress: string }[]).map((row) => row.purge_progress)).toContain('not_started');
  });
});

describe('retention records advance forward only (FR3-35)', () => {
  it('records retention state and refuses backward purge transitions', async () => {
    const tenantId = uniqueId('tenant-ret');
    const ownerId = uniqueId('user-owner');
    await seedOwner(tenantId, ownerId);
    const ownerSession = await store.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const owner = await store.deriveContext({ sessionId: ownerSession.sessionId, nowIso: NOW });

    const record = await store.recordRetention({
      actor: owner,
      artifactId: `${tenantId}-artifact`,
      retentionVersion: 'retention-v1',
      categories: ['evidence'],
      locations: ['object-store'],
    });
    expect(record.purgeProgress).toBe('not_started');

    await store.advancePurge({ actor: owner, recordId: record.recordId, from: 'not_started', to: 'in_progress' });
    await expect(
      store.advancePurge({ actor: owner, recordId: record.recordId, from: 'in_progress', to: 'not_started' }),
    ).rejects.toThrow(/purge|transition|progress/i);
    // CAS: the expected state must match reality.
    await expect(
      store.advancePurge({ actor: owner, recordId: record.recordId, from: 'not_started', to: 'complete' }),
    ).rejects.toThrow(/purge|transition|progress|concurrent|modified/i);
  });

  it('isolates lifecycle records per tenant', async () => {
    const tenantA = uniqueId('tenant-reta');
    const tenantB = uniqueId('tenant-retb');
    const ownerA = uniqueId('user-a');
    const ownerB = uniqueId('user-b');
    await seedOwner(tenantA, ownerA);
    await seedOwner(tenantB, ownerB);
    const sessionA = await store.createSession({ tenantId: tenantA, userId: ownerA, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const sessionB = await store.createSession({ tenantId: tenantB, userId: ownerB, ttlMs: HOUR_MS, nowMs: NOW_MS });
    const contextA = await store.deriveContext({ sessionId: sessionA.sessionId, nowIso: NOW });
    const contextB = await store.deriveContext({ sessionId: sessionB.sessionId, nowIso: NOW });

    const record = await store.recordRetention({
      actor: contextA,
      artifactId: `${tenantA}-artifact`,
      retentionVersion: 'retention-v1',
      categories: ['evidence'],
      locations: ['object-store'],
    });
    // Tenant B cannot see or move tenant A's record.
    await expect(
      store.advancePurge({ actor: contextB, recordId: record.recordId, from: 'not_started', to: 'in_progress' }),
    ).rejects.toThrow(/purge|transition|progress|authorized|not found/i);
  });
});
