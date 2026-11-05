import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

import {
  ChangeProofError,
  type ByokCredential,
  type SamlConnection,
  type TenantContext,
} from '../../src/core/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import type { EnterpriseDeps } from '../../src/http/routes-enterprise.js';
import type { ByokStore } from '../../src/modules/distribution/index.js';
import type { SamlStore, ScimStore } from '../../src/modules/identity/index.js';
import type { UsageStore } from '../../src/modules/usage/index.js';
import { composePublicSite } from '../../src/orchestrator/index.js';

// Enterprise HTTP proof (T-49): the real server over stub stores with
// sentinel ids. No database — the native suite proves the real stores;
// the no-deps server answers 503 on every enterprise path. Key material
// never appears: BYOK moves fingerprints only, and SCIM tokens show
// once at creation.
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const manifestPath = join(rootDir, 'config', 'publicsite', 'manifest.json');

const NOW_ISO = '2026-11-02T00:00:00.000Z';
const HEX_64 = 'f'.repeat(64);

const ownerCtx: TenantContext = {
  schemaVersion: '1',
  tenantId: 'tenant-acme',
  userId: 'user-owner',
  sessionId: 'sess-owner',
  role: 'owner',
  projectGrants: ['project-1'],
  repositoryGrants: ['repo-1'],
  grantVersion: 3,
  expiresAt: '2026-11-03T00:00:00.000Z',
  authoritySource: 'server',
};

const balances = {
  periodId: 'period-1',
  cap: 1000,
  consumed: 120,
  reservedActive: 50,
  reservations: [{ reservationId: 'res-1', runId: 'run-1', state: 'open', consumed: 0, reserved: 50 }],
};

const credential: ByokCredential = {
  schemaVersion: '1',
  refId: 'byok-1',
  tenantId: 'tenant-acme',
  provider: 'acme-models',
  model: 'fixer-2',
  fingerprint: HEX_64,
  status: 'active',
  rotationVersion: 1,
  createdAt: NOW_ISO,
  rotatedAt: NOW_ISO,
};

const saml: SamlConnection = {
  schemaVersion: '1',
  tenantId: 'tenant-acme',
  entityId: 'https://idp.example.com/entity',
  idpIssuer: 'https://idp.example.com/issuer',
  audience: 'https://changeproof.example.com/saml',
  acsUrl: 'https://changeproof.example.com/saml/acs',
  certPem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----',
  certFingerprint: HEX_64,
  verifiedDomain: 'example.com',
  status: 'active',
  createdAt: NOW_ISO,
  rotatedAt: NOW_ISO,
};

function unknown(what: string): ChangeProofError {
  return new ChangeProofError(`${what} is unknown in this tenant; refusing.`);
}

function ownerOnly(what: string): ChangeProofError {
  return new ChangeProofError(`${what} require an owner or admin; refusing.`);
}

const usage: UsageStore = {
  setEntitlement: () => Promise.reject(new Error('control-plane only: never over HTTP')),
  rolloverPeriod: () => Promise.reject(new Error('control-plane only: never over HTTP')),
  admitReservation: () => Promise.reject(new Error('workers only: never over HTTP')),
  recordConsume: () => Promise.reject(new Error('workers only: never over HTTP')),
  releaseReservation: () => Promise.reject(new Error('workers only: never over HTTP')),
  settleReservation: () => Promise.reject(new Error('workers only: never over HTTP')),
  recordPaymentEvent: () => Promise.reject(new Error('webhooks only: never over HTTP')),
  readBalances: () => Promise.resolve(balances),
  listLedger: () =>
    Promise.resolve({
      entries: [{ entryId: 'eff-1', kind: 'consume', amount: 12, runId: 'run-1', occurredAt: NOW_ISO }],
    }),
};

const byok: ByokStore = {
  provisionCredential: (input) =>
    input.context.userId === 'user-member'
      ? Promise.reject(ownerOnly('BYOK credential changes'))
      : Promise.resolve({ refId: input.refId, duplicate: false }),
  rotateCredential: (input) =>
    input.refId === 'byok-missing'
      ? Promise.reject(unknown('Credential ref'))
      : Promise.resolve({ refId: input.refId, rotationVersion: 2 }),
  revokeCredential: (input) =>
    input.refId === 'byok-missing'
      ? Promise.reject(unknown('Credential ref'))
      : Promise.resolve({ refId: input.refId, revoked: true }),
  getCredential: (input) =>
    input.refId === 'byok-missing' ? Promise.reject(unknown('Credential ref')) : Promise.resolve(credential),
};

const samlStore: SamlStore = {
  provisionConnection: () => Promise.resolve(saml),
  rotateCertificate: () => Promise.resolve(saml),
  disableConnection: () => Promise.resolve(),
  getConnection: (tenantId) => Promise.resolve(tenantId === 'tenant-empty' ? null : saml),
  linkSubject: () => Promise.resolve(),
  acceptLogin: () => Promise.reject(new Error('login flow only: never a direct call')),
};

const scimStore: ScimStore = {
  createToken: (input) =>
    Promise.resolve({ tokenId: input.tokenId, token: 'scim-secret-once' }),
  revokeToken: (input) =>
    Promise.resolve({ tokenId: input.tokenId, revoked: input.tokenId !== 'scim-missing' }),
  authenticate: () => Promise.reject(new Error('server-to-server only: never over HTTP')),
  applyEvent: () => Promise.reject(new Error('server-to-server only: never over HTTP')),
};

function deps(): EnterpriseDeps {
  return {
    session: {
      deriveContext: (input) => {
        if (input.sessionId === 'sess-owner') return Promise.resolve(ownerCtx);
        if (input.sessionId === 'sess-member') {
          return Promise.resolve({ ...ownerCtx, sessionId: 'sess-member', userId: 'user-member', role: 'member' });
        }
        return Promise.reject(new ChangeProofError('nope'));
      },
    },
    usage: { store: usage },
    byok: { store: byok, secrets: { readCredential: () => Promise.resolve('stub-secret-value') } },
    saml: { store: samlStore },
    scim: { store: scimStore },
  };
}

let handle: HttpHandle | undefined;
let bare: HttpHandle | undefined;
let base = '';
let bareBase = '';

beforeAll(async () => {
  handle = createHttpServer({ publicSite: composePublicSite(), manifestPath, enterprise: deps() });
  await new Promise<void>((resolve) => handle?.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
  base = `http://127.0.0.1:${address.port}`;
  bare = createHttpServer({ publicSite: composePublicSite(), manifestPath });
  await new Promise<void>((resolve) => bare?.server.listen(0, '127.0.0.1', resolve));
  const bareAddress = bare.server.address();
  if (typeof bareAddress !== 'object' || bareAddress === null) throw new Error('Bare server did not bind.');
  bareBase = `http://127.0.0.1:${bareAddress.port}`;
}, 30_000);

afterAll(async () => {
  await handle?.close();
  await bare?.close();
});

const UI = { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI' };
const owner = { ...UI, Cookie: 'cp_session=sess-owner' };
const member = { ...UI, Cookie: 'cp_session=sess-member' };

async function call(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown; root?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${options.root ?? base}${path}`, {
    method,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: await response.json() };
}

test('balances read the session tenant; guests refused', async () => {
  const read = await call('GET', '/api/billing/balances', { headers: owner });
  expect(read.status).toBe(200);
  expect(read.body).toEqual({ ok: true, data: balances });
  const guest = await call('GET', '/api/billing/balances');
  expect(guest.status).toBe(401);
});

test('BYOK registers, rotates, revokes, and reads fingerprints — never key material', async () => {
  const provisioned = await call('POST', '/api/byok/credentials', {
    headers: owner,
    body: { refId: 'byok-1', provider: 'acme-models', model: 'fixer-2', fingerprint: HEX_64 },
  });
  expect(provisioned.status).toBe(201);
  const read = await call('GET', '/api/byok/credentials/byok-1', { headers: owner });
  expect(read.status).toBe(200);
  expect(JSON.stringify(read.body)).not.toContain('sk-');
  const rotated = await call('POST', '/api/byok/credentials/byok-1/rotate', {
    headers: owner,
    body: { newFingerprint: 'e'.repeat(64) },
  });
  expect(rotated.status).toBe(200);
  const revoked = await call('POST', '/api/byok/credentials/byok-1/revoke', { headers: owner, body: {} });
  expect(revoked.status).toBe(200);
  const missing = await call('GET', '/api/byok/credentials/byok-missing', { headers: owner });
  expect(missing.status).toBe(404);
  const memberWrite = await call('POST', '/api/byok/credentials', {
    headers: member,
    body: { refId: 'byok-2', provider: 'acme-models', model: 'fixer-2', fingerprint: HEX_64 },
  });
  expect(memberWrite.status).toBe(403);
});

test('SAML provisions, rotates, links, disables, and reads the connection', async () => {
  const provisioned = await call('POST', '/api/enterprise/saml', {
    headers: owner,
    body: {
      entityId: saml.entityId,
      idpIssuer: saml.idpIssuer,
      audience: saml.audience,
      acsUrl: saml.acsUrl,
      certPem: saml.certPem,
      verifiedDomain: saml.verifiedDomain,
    },
  });
  expect(provisioned.status).toBe(201);
  const read = await call('GET', '/api/enterprise/saml', { headers: owner });
  expect(read.status).toBe(200);
  const rotated = await call('POST', '/api/enterprise/saml/rotate', {
    headers: owner,
    body: { certPem: saml.certPem },
  });
  expect(rotated.status).toBe(200);
  const linked = await call('POST', '/api/enterprise/saml/link', {
    headers: owner,
    body: { subject: 'subject-1', userId: 'user-member' },
  });
  expect(linked.status).toBe(200);
  const disabled = await call('POST', '/api/enterprise/saml/disable', { headers: owner, body: {} });
  expect(disabled.status).toBe(200);
  const guest = await call('GET', '/api/enterprise/saml');
  expect(guest.status).toBe(401);
});

test('SCIM tokens mint once and revoke; unknown ids stay quiet', async () => {
  const minted = await call('POST', '/api/enterprise/scim/tokens', { headers: owner, body: {} });
  expect(minted.status).toBe(201);
  const data = (minted.body as { data: { tokenId: string; token: string } }).data;
  expect(data.token).toBe('scim-secret-once');
  const revoked = await call('POST', `/api/enterprise/scim/tokens/${data.tokenId}/revoke`, { headers: owner, body: {} });
  expect(revoked.status).toBe(200);
  const missing = await call('POST', '/api/enterprise/scim/tokens/scim-missing/revoke', { headers: owner, body: {} });
  expect(missing.status).toBe(200);
  expect((missing.body as { data: { revoked: boolean } }).data.revoked).toBe(false);
});

test('no-deps server answers 503 on enterprise paths', async () => {
  const read = await call('GET', '/api/billing/balances', { headers: owner, root: bareBase });
  expect(read.status).toBe(503);
  const minted = await call('POST', '/api/enterprise/scim/tokens', { headers: owner, body: {}, root: bareBase });
  expect(minted.status).toBe(503);
});

test('billing summary and ledger read settled usage; empty stays empty', async () => {
  const summary = await call('GET', '/api/billing/summary', { headers: owner });
  expect(summary.status).toBe(200);
  expect(summary.body).toEqual({ ok: true, data: { used: 120, limit: 1000 } });
  const ledger = await call('GET', '/api/billing/ledger?limit=50', { headers: owner });
  expect(ledger.status).toBe(200);
  const items = (ledger.body as { data: { items: { entryId: string; kind: string; amount: number; detail: string }[] } })
    .data.items;
  expect(items).toEqual([{ entryId: 'eff-1', kind: 'consume', amount: 12, detail: 'run-1' }]);
  const bad = await call('GET', '/api/billing/ledger?limit=500', { headers: owner });
  expect(bad.status).toBe(400);
  const guest = await call('GET', '/api/billing/summary');
  expect(guest.status).toBe(401);
  const bareSummary = await call('GET', '/api/billing/summary', { headers: owner, root: bareBase });
  expect(bareSummary.status).toBe(503);
  const bareLedger = await call('GET', '/api/billing/ledger?limit=50', { headers: owner, root: bareBase });
  expect(bareLedger.status).toBe(503);
});
