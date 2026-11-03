import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SamlAssertion, TenantContext } from '../../src/core/index.js';
import {
  createIdentityStore,
  fingerprintCert,
} from '../../src/modules/identity/index.js';
import {
  composeIdentityStore,
  composeMapSecrets,
  composeProviders,
} from '../../src/orchestrator/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-32 / T-32 — SAML/SCIM lifecycle plus provider events on real PostgreSQL.
 *
 * Written before the implementation. Connections provision with parsed
 * certificates, subjects link explicitly, logins verify real RSA signatures
 * with replay protection, SCIM tokens authenticate by hash, events apply in
 * version order with races landing once, disable suspends memberships and
 * revokes sessions (holding every later grant derivation), the last owner
 * cannot be deprovisioned, and provider events dedup per provider key
 * (NEG3-21, NEG3-38, NEG3-39). Live IdP interop and live provider calls stay
 * blocked on authorized test remotes; nothing here fakes them.
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required; start the disposable PostgreSQL container first.');
}

const here = dirname(fileURLToPath(import.meta.url));
const migration = (name: string): string =>
  readFileSync(join(here, '..', '..', 'infra', 'postgres', name), 'utf8');
const migrations = [
  'V1__identity_tenancy.sql',
  'V2__identity_services.sql',
  'V3__jobs.sql',
  'V4__usage.sql',
  'V5__email_identity.sql',
  'V6__lifecycle.sql',
  'V7__engagement.sql',
  'V8__teamwork.sql',
  'V9__distribution.sql',
  'V10__enterprise.sql',
].map((name) => migration(name));

const fileDbUrl = databaseUrlFor(databaseUrl, 't_enterprise');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const NOW_ISO = '2026-11-02T00:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const HOUR_MS = 3_600_000;

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERT_PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const { publicKey: rotatedPublicKey, privateKey: rotatedPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const ROTATED_PEM = rotatedPublicKey.export({ format: 'pem', type: 'spki' }).toString();

const ISSUER = 'https://idp.example.com/metadata';
const ENTITY = 'https://changeproof.example.com/saml/metadata';
const ACS = 'https://changeproof.example.com/saml/acs';

function signedAssertion(overrides: {
  assertionId?: string;
  issuer?: string;
  subject?: string;
  requestId?: string;
  key?: typeof privateKey;
}): SamlAssertion {
  const assertionId = overrides.assertionId ?? uniqueId('assertion');
  const subject = overrides.subject ?? 'subject-1';
  const content = `${assertionId}|${subject}|2026-11-02T00:05:00.000Z`;
  const key = overrides.key ?? privateKey;
  return {
    schemaVersion: '1',
    assertionId,
    issuer: overrides.issuer ?? ISSUER,
    audience: ENTITY,
    destination: ACS,
    subject,
    authnInstant: NOW_ISO,
    notBefore: '2026-11-01T23:59:00.000Z',
    notOnOrAfter: '2026-11-02T00:05:00.000Z',
    requestId: overrides.requestId ?? 'request-1',
    signedContentB64: Buffer.from(content, 'utf8').toString('base64'),
    signatureB64: sign('sha256', Buffer.from(content, 'utf8'), key).toString('base64'),
  };
}

interface SeededTenant {
  tenantId: string;
  owner: TenantContext;
  memberId: string;
}

async function seedTenant(prefix: string): Promise<SeededTenant> {
  const identity = createIdentityStore(appPool);
  const tenantId = uniqueId(`${prefix}-tenant`);
  const ownerId = uniqueId(`${prefix}-owner`);
  const memberId = uniqueId(`${prefix}-member`);
  await identity.createTenant(tenantId);
  for (const [userId, role] of [
    [ownerId, 'owner'],
    [memberId, 'member'],
  ] as const) {
    await admin.query(
      'INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, $3, 0)',
      [tenantId, userId, role],
    );
  }
  const session = await identity.createSession({ tenantId, userId: ownerId, ttlMs: HOUR_MS, nowMs: NOW_MS });
  const owner = await identity.deriveContext({ sessionId: session.sessionId, nowIso: NOW_ISO });
  return { tenantId, owner, memberId };
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_enterprise');
  for (const sql of migrations) {
    await admin.query(sql);
  }
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('SAML connection and login (native)', () => {
  it('provisions, links, logs in, and refuses replays', async () => {
    const tenant = await seedTenant('saml');
    const composed = composeIdentityStore(appPool);
    const connection = await composed.saml.provisionConnection({
      actor: tenant.owner,
      entityId: ENTITY,
      idpIssuer: ISSUER,
      audience: ENTITY,
      acsUrl: ACS,
      certPem: CERT_PEM,
      verifiedDomain: 'example.com',
      nowIso: NOW_ISO,
    });
    expect(connection.certFingerprint).toBe(fingerprintCert(CERT_PEM));
    await expect(
      composed.saml.provisionConnection({
        actor: tenant.owner,
        entityId: ENTITY,
        idpIssuer: ISSUER,
        audience: ENTITY,
        acsUrl: ACS,
        certPem: CERT_PEM,
        verifiedDomain: 'example.com',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/already has/);
    await composed.saml.linkSubject({
      actor: tenant.owner,
      subject: 'subject-1',
      userId: tenant.memberId,
      nowIso: NOW_ISO,
    });
    await expect(
      composed.saml.linkSubject({
        actor: tenant.owner,
        subject: 'subject-1',
        userId: tenant.memberId,
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/already linked/);
    await expect(
      composed.saml.linkSubject({
        actor: tenant.owner,
        subject: 'subject-ghost',
        userId: 'user-ghost',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/not a member/);
    const login = await composed.saml.acceptLogin({
      tenantId: tenant.tenantId,
      assertion: signedAssertion({}),
      expectedRequestId: 'request-1',
      nowIso: NOW_ISO,
    });
    expect(login).toMatchObject({ tenantId: tenant.tenantId, userId: tenant.memberId });
    await expect(
      composed.saml.acceptLogin({
        tenantId: tenant.tenantId,
        assertion: signedAssertion({ assertionId: 'assertion-replay-1' }),
        expectedRequestId: 'request-1',
        nowIso: NOW_ISO,
      }),
    ).resolves.toMatchObject({ userId: tenant.memberId });
    await expect(
      composed.saml.acceptLogin({
        tenantId: tenant.tenantId,
        assertion: signedAssertion({ assertionId: 'assertion-replay-1' }),
        expectedRequestId: 'request-1',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/already used/);
  }, 60_000);

  it('refuses wrong issuers, tampered signatures, and unlinked subjects', async () => {
    const tenant = await seedTenant('saml-neg');
    const composed = composeIdentityStore(appPool);
    await composed.saml.provisionConnection({
      actor: tenant.owner,
      entityId: ENTITY,
      idpIssuer: ISSUER,
      audience: ENTITY,
      acsUrl: ACS,
      certPem: CERT_PEM,
      verifiedDomain: 'example.com',
      nowIso: NOW_ISO,
    });
    await composed.saml.linkSubject({
      actor: tenant.owner,
      subject: 'subject-1',
      userId: tenant.memberId,
      nowIso: NOW_ISO,
    });
    await expect(
      composed.saml.acceptLogin({
        tenantId: tenant.tenantId,
        assertion: signedAssertion({ issuer: 'https://evil.example.com/metadata' }),
        expectedRequestId: 'request-1',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/pinned connection issuer/);
    const tampered = signedAssertion({ subject: 'subject-1' });
    tampered.signedContentB64 = Buffer.from('tampered', 'utf8').toString('base64');
    await expect(
      composed.saml.acceptLogin({
        tenantId: tenant.tenantId,
        assertion: tampered,
        expectedRequestId: 'request-1',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/signature/);
    await expect(
      composed.saml.acceptLogin({
        tenantId: tenant.tenantId,
        assertion: signedAssertion({ subject: 'subject-nobody' }),
        expectedRequestId: 'request-1',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/no linked account/);
  }, 60_000);

  it('rotates certificates and honors disablement', async () => {
    const tenant = await seedTenant('saml-rot');
    const composed = composeIdentityStore(appPool);
    const before = await composed.saml.provisionConnection({
      actor: tenant.owner,
      entityId: ENTITY,
      idpIssuer: ISSUER,
      audience: ENTITY,
      acsUrl: ACS,
      certPem: CERT_PEM,
      verifiedDomain: 'example.com',
      nowIso: NOW_ISO,
    });
    await composed.saml.linkSubject({
      actor: tenant.owner,
      subject: 'subject-1',
      userId: tenant.memberId,
      nowIso: NOW_ISO,
    });
    const rotated = await composed.saml.rotateCertificate({
      actor: tenant.owner,
      certPem: ROTATED_PEM,
      nowIso: NOW_ISO,
    });
    expect(rotated.certFingerprint).not.toBe(before.certFingerprint);
    await expect(
      composed.saml.acceptLogin({
        tenantId: tenant.tenantId,
        assertion: signedAssertion({}),
        expectedRequestId: 'request-1',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/signature/);
    await expect(
      composed.saml.acceptLogin({
        tenantId: tenant.tenantId,
        assertion: signedAssertion({ key: rotatedPrivateKey }),
        expectedRequestId: 'request-1',
        nowIso: NOW_ISO,
      }),
    ).resolves.toMatchObject({ userId: tenant.memberId });
    await composed.saml.disableConnection({ actor: tenant.owner, nowIso: NOW_ISO });
    await expect(
      composed.saml.acceptLogin({
        tenantId: tenant.tenantId,
        assertion: signedAssertion({ key: rotatedPrivateKey }),
        expectedRequestId: 'request-1',
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/not available for this tenant/);
  }, 60_000);
});

describe('SCIM lifecycle (native)', () => {
  it('mints hash-only tokens and authenticates by hash', async () => {
    const tenant = await seedTenant('scim-tok');
    const composed = composeIdentityStore(appPool);
    const minted = await composed.scim.createToken({
      actor: tenant.owner,
      tokenId: uniqueId('scim-token'),
      nowIso: NOW_ISO,
    });
    expect(minted.token).toMatch(/^scim_[0-9a-f]{32}$/);
    const stored = await admin.query(`SELECT token_hash FROM scim_tokens WHERE id = $1`, [minted.tokenId]);
    expect((stored.rows[0] as { token_hash: string }).token_hash).not.toContain(minted.token);
    await expect(
      composed.scim.authenticate({ tenantId: tenant.tenantId, presented: minted.token, nowIso: NOW_ISO }),
    ).resolves.toBe(minted.tokenId);
    await expect(
      composed.scim.authenticate({ tenantId: tenant.tenantId, presented: 'scim_ffff', nowIso: NOW_ISO }),
    ).rejects.toThrow(/unknown or revoked/);
    const revoked = await composed.scim.revokeToken({ actor: tenant.owner, tokenId: minted.tokenId, nowIso: NOW_ISO });
    expect(revoked.revoked).toBe(true);
    await expect(
      composed.scim.authenticate({ tenantId: tenant.tenantId, presented: minted.token, nowIso: NOW_ISO }),
    ).rejects.toThrow(/unknown or revoked/);
  }, 60_000);

  it('applies events in version order with idempotent retries', async () => {
    const tenant = await seedTenant('scim-ev');
    const composed = composeIdentityStore(appPool);
    const base = {
      schemaVersion: '1' as const,
      tenantId: tenant.tenantId,
      externalId: 'idp-user-7',
      groups: [],
    };
    const provisioned = await composed.scim.applyEvent({
      tenantId: tenant.tenantId,
      event: { ...base, eventId: uniqueId('ev'), operation: 'provision' as const, version: 1 },
      nowIso: NOW_ISO,
    });
    expect(provisioned.outcome).toBe('applied');
    const scimUserId = provisioned.userId ?? '';
    expect(scimUserId.startsWith('scim-')).toBe(true);
    const member = await admin.query(
      `SELECT role, status FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
      [tenant.tenantId, scimUserId],
    );
    expect(member.rows[0]).toMatchObject({ role: 'member', status: 'active' });
    const retry = await composed.scim.applyEvent({
      tenantId: tenant.tenantId,
      event: { ...base, eventId: uniqueId('ev'), operation: 'provision' as const, version: 1 },
      nowIso: NOW_ISO,
    });
    expect(retry.outcome).toBe('duplicate');
    const updated = await composed.scim.applyEvent({
      tenantId: tenant.tenantId,
      event: { ...base, eventId: uniqueId('ev'), operation: 'update' as const, version: 2 },
      nowIso: NOW_ISO,
    });
    expect(updated.outcome).toBe('applied');
    const stale = await composed.scim.applyEvent({
      tenantId: tenant.tenantId,
      event: { ...base, eventId: uniqueId('ev'), operation: 'update' as const, version: 1 },
      nowIso: NOW_ISO,
    });
    expect(stale.outcome).toBe('superseded');
    await expect(
      composed.scim.applyEvent({
        tenantId: tenant.tenantId,
        event: { ...base, eventId: uniqueId('ev'), operation: 'disable' as const, version: 2 },
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/different operation/);
  }, 60_000);

  it('disables with session revocation, holds grants, and re-enables on a newer version', async () => {
    const tenant = await seedTenant('scim-dis');
    const identity = createIdentityStore(appPool);
    const composed = composeIdentityStore(appPool);
    const base = {
      schemaVersion: '1' as const,
      tenantId: tenant.tenantId,
      externalId: 'idp-user-9',
      groups: [],
    };
    const provisioned = await composed.scim.applyEvent({
      tenantId: tenant.tenantId,
      event: { ...base, eventId: uniqueId('ev'), operation: 'provision' as const, version: 1 },
      nowIso: NOW_ISO,
    });
    const scimUserId = provisioned.userId ?? '';
    const session = await identity.createSession({ tenantId: tenant.tenantId, userId: scimUserId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    await expect(
      identity.deriveContext({ sessionId: session.sessionId, nowIso: NOW_ISO }),
    ).resolves.toMatchObject({ userId: scimUserId });
    const disabled = await composed.scim.applyEvent({
      tenantId: tenant.tenantId,
      event: { ...base, eventId: uniqueId('ev'), operation: 'disable' as const, version: 2 },
      nowIso: NOW_ISO,
    });
    expect(disabled.outcome).toBe('applied');
    await expect(
      identity.deriveContext({ sessionId: session.sessionId, nowIso: NOW_ISO }),
    ).rejects.toThrow(/revoked|suspended/);
    const reenabled = await composed.scim.applyEvent({
      tenantId: tenant.tenantId,
      event: { ...base, eventId: uniqueId('ev'), operation: 'provision' as const, version: 3 },
      nowIso: NOW_ISO,
    });
    expect(reenabled.outcome).toBe('applied');
    const fresh = await identity.createSession({ tenantId: tenant.tenantId, userId: scimUserId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    await expect(
      identity.deriveContext({ sessionId: fresh.sessionId, nowIso: NOW_ISO }),
    ).resolves.toMatchObject({ userId: scimUserId });
  }, 60_000);

  it('refuses to deprovision the last owner and lands races once', async () => {
    const tenant = await seedTenant('scim-race');
    const composed = composeIdentityStore(appPool);
    const identity = createIdentityStore(appPool);
    const base = {
      schemaVersion: '1' as const,
      tenantId: tenant.tenantId,
      externalId: 'idp-user-11',
      groups: [],
    };
    const provisioned = await composed.scim.applyEvent({
      tenantId: tenant.tenantId,
      event: { ...base, eventId: uniqueId('ev'), operation: 'provision' as const, version: 1 },
      nowIso: NOW_ISO,
    });
    const scimUserId = provisioned.userId ?? '';
    await identity.changeMemberRole({ actor: tenant.owner, userId: scimUserId, role: 'owner' });
    const ownerSession = await identity.createSession({
      tenantId: tenant.tenantId,
      userId: tenant.owner.userId,
      ttlMs: HOUR_MS,
      nowMs: NOW_MS,
    });
    const ownerCtx = await identity.deriveContext({ sessionId: ownerSession.sessionId, nowIso: NOW_ISO });
    await identity.removeMember({ actor: ownerCtx, userId: tenant.owner.userId });
    await expect(
      composed.scim.applyEvent({
        tenantId: tenant.tenantId,
        event: { ...base, eventId: uniqueId('ev'), operation: 'disable' as const, version: 2 },
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/last owner/);
    const racing = await Promise.all([
      composed.scim.applyEvent({
        tenantId: tenant.tenantId,
        event: { ...base, eventId: uniqueId('ev'), externalId: 'idp-user-12', operation: 'provision' as const, version: 1 },
        nowIso: NOW_ISO,
      }),
      composed.scim.applyEvent({
        tenantId: tenant.tenantId,
        event: { ...base, eventId: uniqueId('ev'), externalId: 'idp-user-12', operation: 'provision' as const, version: 1 },
        nowIso: NOW_ISO,
      }),
    ]);
    expect(racing.map((result) => result.outcome).sort()).toEqual(['applied', 'duplicate']);
  }, 60_000);
});

describe('provider events and reconciliation (native)', () => {
  it('dedups deliveries per provider key with tenant isolation', async () => {
    const first = await seedTenant('prov-a');
    const second = await seedTenant('prov-b');
    const providers = composeProviders({ db: appPool, secrets: composeMapSecrets(new Map()) });
    const recorded = await providers.events.recordEvent({
      tenantId: first.tenantId,
      provider: 'gitlab',
      eventUuid: 'evt-uuid-1',
      verified: true,
      nowIso: NOW_ISO,
    });
    expect(recorded).toMatchObject({ outcome: 'reconciled', duplicate: false });
    const redelivered = await providers.events.recordEvent({
      tenantId: first.tenantId,
      provider: 'gitlab',
      eventUuid: 'evt-uuid-1',
      verified: true,
      nowIso: NOW_ISO,
    });
    expect(redelivered).toMatchObject({ outcome: 'duplicate', duplicate: true });
    const otherProvider = await providers.events.recordEvent({
      tenantId: first.tenantId,
      provider: 'bitbucket',
      eventUuid: 'evt-uuid-1',
      verified: false,
      nowIso: NOW_ISO,
    });
    expect(otherProvider).toMatchObject({ outcome: 'trigger_only', duplicate: false });
    const reader = await appPool.connect();
    try {
      await reader.query(`SELECT set_config('app.current_tenant', $1, true)`, [second.tenantId]);
      const isolated = await reader.query(`SELECT * FROM provider_events`);
      expect(isolated.rows).toHaveLength(0);
    } finally {
      reader.release();
    }
  }, 60_000);

  it('reconciles event triggers against exact API state', async () => {
    const tenant = await seedTenant('prov-r');
    const secrets = composeMapSecrets(new Map([['conn-cred-1', 'provider-token']]));
    const providers = composeProviders({ db: appPool, secrets });
    const sha = 'c'.repeat(40);
    const seen: string[] = [];
    const gitlab = providers.gitlab(() => ({
      getCommit: (input) => {
        seen.push(input.sha);
        return Promise.resolve({ sha, message: 'event commit', committedAt: NOW_ISO });
      },
      getBranchHead: () => Promise.resolve({ sha }),
      openMergeRequest: () => Promise.resolve({ id: '1', url: 'https://example.com/1', headSha: sha, state: 'opened' }),
      findRequestByHead: () => Promise.resolve(null),
      listRepositories: () => Promise.resolve([]),
      getPipelineBySha: (input) => Promise.resolve({ sha: input.sha, pipelineId: 'pipe-1', status: 'success' }),
    }));
    await providers.events.recordEvent({
      tenantId: tenant.tenantId,
      provider: 'gitlab',
      eventUuid: 'evt-reconcile-1',
      verified: false,
      nowIso: NOW_ISO,
    });
    const commit = await gitlab.fetchCommit({
      connection: {
        schemaVersion: '1',
        connectionId: 'conn-1',
        tenantId: tenant.tenantId,
        installationId: 'install-1',
        provider: 'gitlab',
        repositoryAllowlist: ['repo-1'],
        permissionMatrix: {},
        status: 'active',
        revocationVersion: 0,
        credentialRef: 'conn-cred-1',
      },
      repository: { id: 'repo-1', path: 'group/project' },
      sha,
    });
    expect(commit.sha).toBe(sha);
    expect(seen).toEqual([sha]);
  }, 60_000);
});
