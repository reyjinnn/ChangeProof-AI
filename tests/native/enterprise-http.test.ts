import { createHash, createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';

import type { EmailDeliveryReceipt, EmailMessage } from '../../src/core/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import {
  composeAdapterCapabilities,
  composeCollaboration,
  composeDistribution,
  composeEmailIdentity,
  composeFileEvidence,
  composeIdentityStore,
  composeJobs,
  composeLifecycle,
  composeMapSecrets,
  composeNotifications,
  composePublicSite,
  composeQueries,
  composeSupport,
  composeUsage,
  type IdentityComposition,
  type UsageComposition,
} from '../../src/orchestrator/index.js';
import { createMapSecretBroker } from '../../src/modules/github/broker.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * T-49 — enterprise HTTP routes over real PostgreSQL + the real server.
 *
 * Native check, reported separately: run with `DATABASE_URL=…` against a
 * disposable PostgreSQL 16 container. Applies V1–V11 into its
 * own `t_enterprisehttp` database. The BYOK broker is a test-owned map
 * (values placed out-of-band, as the CLI secrets file does); every
 * enterprise step otherwise goes over HTTP as app_user, so RLS fencing
 * and owner/admin gates are real. Payment events are recorded at the
 * store boundary (webhook-only, no HTTP route by design).
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL is required (e.g. postgresql://postgres:<pw>@127.0.0.1:55433/postgres). ' +
      'Start the disposable probe container first.',
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const migration = (name: string): string => readFileSync(join(rootDir, 'infra', 'postgres', name), 'utf8');

const fileDbUrl = databaseUrlFor(databaseUrl, 't_enterprisehttp');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const sent: EmailMessage[] = [];
const delivery = {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    sent.push(message);
    return Promise.resolve({ messageId: `enterprise-http-${String(sent.length)}`, acceptedAt: new Date().toISOString() });
  },
};
const secrets = createMapSecretBroker(new Map([['email-challenge-secret', 'enterprise-http-secret-32plus!!']]));

const evidenceDir = mkdtempSync(join(tmpdir(), 'cp-enterprisehttp-evidence-'));
const byokValues = new Map<string, string>();

let identity: IdentityComposition;
let handle: HttpHandle | undefined;
let base = '';
let counter = 0;

const { publicKey } = generateKeyPairSync('ed25519');
const CERT_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function tokenFrom(subjectPart: string): string {
  const found = [...sent].reverse().find((message) => message.subject.toLowerCase().includes(subjectPart));
  if (found === undefined) throw new Error(`No mail with subject containing "${subjectPart}".`);
  const match = /Token \(single use[^\n]*\n(\S+)\s*/.exec(found.textBody);
  if (match?.[1] === undefined) throw new Error('Mail carries no extractable token.');
  return match[1];
}

interface Call {
  readonly status: number;
  readonly body: unknown;
  readonly setCookie: readonly string[];
}

async function call(method: string, path: string, body?: unknown, cookie?: string): Promise<Call> {
  const headers: Record<string, string> = { 'X-Requested-With': 'ChangeProofUI' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie !== undefined) headers['Cookie'] = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.getSetCookie();
  return { status: response.status, body: await response.json(), setCookie };
}

function cookieOf(callResult: Call): string {
  const first = callResult.setCookie[0];
  if (first === undefined) throw new Error('Expected a session cookie.');
  return first.split(';')[0] ?? '';
}

function idempotencyKey(seed: string): string {
  return createHash('sha256').update(`enterprise-http:${seed}`).digest('hex');
}

interface Fixture {
  readonly tenantId: string;
  readonly ownerCookie: string;
  readonly memberCookie: string;
  readonly memberId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly grantVersion: number;
  readonly runId: string;
}

async function registerVerifyClaim(email: string, password: string, tenantId: string): Promise<void> {
  const registered = await call('POST', '/api/auth/register', { email, password });
  expect(registered.status).toBe(201);
  const verified = await call('POST', '/api/auth/verify', { token: tokenFrom('verif') });
  expect(verified.status).toBe(200);
  const ticket = (verified.body as { data: { claimTicket: string } }).data.claimTicket;
  const claimed = await call('POST', '/api/orgs', { tenantId, ticket });
  expect(claimed.status).toBe(201);
}

async function seedFixture(tag: string): Promise<Fixture> {
  counter += 1;
  const stamp = `${tag}-${String(counter)}`;
  const tenantId = `enterprise-${stamp}`;
  const repositoryId = `repo-${stamp}`;
  const ownerEmail = `enterprise-owner-${stamp}@example.com`;
  await registerVerifyClaim(ownerEmail, 'correct-horse-42', tenantId);
  const ownerCookie = cookieOf(await call('POST', '/api/auth/login', { email: ownerEmail, password: 'correct-horse-42', rememberMe: false }));
  const created = await call('POST', '/api/projects', { name: `${tag} project` }, ownerCookie);
  expect(created.status).toBe(201);
  const projectId = (created.body as { data: { projectId: string } }).data.projectId;
  await admin.query('INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)', [
    tenantId,
    repositoryId,
    projectId,
  ]);
  const session = await call('GET', '/api/auth/session', undefined, ownerCookie);
  const sessionData = (session.body as { data: { grantVersion: number } }).data;
  const invited = await call('POST', `/api/orgs/${tenantId}/invitations`, { role: 'member' }, ownerCookie);
  expect(invited.status).toBe(201);
  const inviteToken = (invited.body as { data: { token: string } }).data.token;
  const memberEmail = `enterprise-member-${stamp}@example.com`;
  await registerVerifyClaim(memberEmail, 'correct-horse-42', `${tenantId}-home`);
  const memberHomeCookie = cookieOf(await call('POST', '/api/auth/login', { email: memberEmail, password: 'correct-horse-42', rememberMe: false }));
  const accepted = await call('POST', '/api/invitations/accept', { token: inviteToken }, memberHomeCookie);
  expect(accepted.status).toBe(200);
  const memberLogin = await call('POST', '/api/auth/login', { email: memberEmail, password: 'correct-horse-42', rememberMe: false, tenantId });
  expect(memberLogin.status).toBe(200);
  const memberCookie = cookieOf(memberLogin);
  const memberSession = await call('GET', '/api/auth/session', undefined, memberCookie);
  const memberId = (memberSession.body as { data: { userId: string } }).data.userId;
  return { tenantId, ownerCookie, memberCookie, memberId, projectId, repositoryId, grantVersion: sessionData.grantVersion, runId: '' };
}

let usageComp: UsageComposition;

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_enterprisehttp');
  for (const name of [
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
    'V11__service_operations.sql',
    'V12__workspace.sql',
  ]) {
    await admin.query(migration(name));
  }
  identity = composeIdentityStore(appPool);
  usageComp = composeUsage(appPool);
  const usage = usageComp;
  const jobs = composeJobs(appPool);
  const evidence = composeFileEvidence(evidenceDir);
  const lifecycle = composeLifecycle(appPool, {
    identity: identity.store,
    usage: usage.store,
    jobs: jobs.store,
    evidence: evidence.store,
  });
  const queries = composeQueries(appPool, { identity: identity.store, lifecycle: lifecycle.store });
  const notificationsComp = composeNotifications(appPool, identity.store);
  const distribution = composeDistribution({ db: appPool, maintenanceDb: appPool, secrets: composeMapSecrets(byokValues) });
  handle = createHttpServer({
    publicSite: composePublicSite(),
    manifestPath: join(rootDir, 'config', 'publicsite', 'manifest.json'),
    auth: {
      identity,
      email: composeEmailIdentity(appPool, {
        delivery,
        secrets,
        challengeSecretRef: 'email-challenge-secret',
      }),
    },
    runs: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      lifecycle,
      queries,
    },
    notifications: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      notifications: notificationsComp,
    },
    teamwork: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      support: composeSupport(appPool, { identity: identity.store, jobs: jobs.store }),
      collaboration: composeCollaboration(appPool, { identity: identity.store, notifications: notificationsComp.store }),
      capabilities: composeAdapterCapabilities().registry,
    },
    enterprise: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      usage: { store: usage.store },
      byok: { store: distribution.byok, secrets: distribution.secrets },
      saml: { store: identity.saml },
      scim: { store: identity.scim },
    },
  });
  await new Promise<void>((resolve) => handle?.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
  base = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.close();
  await appPool.end();
  await admin.end();
  rmSync(evidenceDir, { recursive: true, force: true });
});

test('balances show the entitlement and the submitted reservation', async () => {
  const fixture = await seedFixture('balances');
  await usageComp.store.setEntitlement({
    tenantId: fixture.tenantId,
    capAmount: 1000,
    rateVersion: 'test-rates-1',
    periodId: 'period-1',
    nowIso: new Date().toISOString(),
  });
  const before = await call('GET', '/api/billing/balances', undefined, fixture.ownerCookie);
  expect(before.body).toMatchObject({ ok: true, data: { periodId: 'period-1', cap: 1000, consumed: 0, reservedActive: 0 } });
  const saved = await call(
    'POST',
    '/api/drafts',
    { projectId: fixture.projectId, body: { intent: 'billing run', budgetCap: 50 } },
    fixture.ownerCookie,
  );
  expect(saved.status).toBe(201);
  const draft = (saved.body as { data: { draftId: string; revision: number } }).data;
  const submitted = await call(
    'POST',
    '/api/runs',
    {
      projectId: fixture.projectId,
      repositoryIds: [fixture.repositoryId],
      sourceRefs: ['git:abc1234'],
      intentRef: 'intent-billing',
      executionMode: 'real_runtime',
      invariantRefs: ['invariant-billing'],
      verificationPlanRef: 'plan-billing',
      budgetProfileId: 'budget-billing',
      publicationConsent: false,
      idempotencyKey: idempotencyKey(fixture.tenantId),
      expectedGrantVersion: fixture.grantVersion,
      draftId: draft.draftId,
      draftRevision: draft.revision,
      requestedBudget: 50,
    },
    fixture.ownerCookie,
  );
  expect(submitted.status).toBe(201);
  const after = await call('GET', '/api/billing/balances', undefined, fixture.ownerCookie);
  const data = (after.body as { data: { reservedActive: number; reservations: unknown[] } }).data;
  expect(data.reservedActive).toBe(50);
  expect(data.reservations).toHaveLength(1);
  const member = await call('GET', '/api/billing/balances', undefined, fixture.memberCookie);
  expect(member.status).toBe(200);
  const guest = await call('GET', '/api/billing/balances');
  expect(guest.status).toBe(401);
});

test('payment events verify, deduplicate, and refuse forgeries at the store boundary (NEG3-36)', async () => {
  const fixture = await seedFixture('payments');
  const secret = 'webhook-secret-32plus-chars-long!!';
  const payload = JSON.stringify({ id: `evt-pay-${fixture.tenantId}`, tenant: fixture.tenantId });
  const signature = `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`;
  const first = await usageComp.store.recordPaymentEvent({
    tenantId: fixture.tenantId,
    eventId: `evt-pay-${fixture.tenantId}`,
    kind: 'checkout.completed',
    amount: 1000,
    periodId: 'period-1',
    payload,
    signature,
    webhookSecret: secret,
    nowIso: new Date().toISOString(),
  });
  expect(first.duplicate).toBe(false);
  const replay = await usageComp.store.recordPaymentEvent({
    tenantId: fixture.tenantId,
    eventId: `evt-pay-${fixture.tenantId}`,
    kind: 'checkout.completed',
    amount: 1000,
    periodId: 'period-1',
    payload,
    signature,
    webhookSecret: secret,
    nowIso: new Date().toISOString(),
  });
  expect(replay.duplicate).toBe(true);
  await expect(
    usageComp.store.recordPaymentEvent({
      tenantId: fixture.tenantId,
      eventId: `evt-forged-${fixture.tenantId}`,
      kind: 'checkout.completed',
      amount: 1000,
      periodId: 'period-1',
      payload,
      signature: 'sha256=deadbeef',
      webhookSecret: secret,
      nowIso: new Date().toISOString(),
    }),
  ).rejects.toThrow('forged or corrupt');
  const fresh = await seedFixture('payments-fresh');
  await expect(
    usageComp.store.recordPaymentEvent({
      tenantId: fresh.tenantId,
      eventId: `evt-refund-${fresh.tenantId}`,
      kind: 'refund.issued',
      amount: 100,
      periodId: 'period-1',
      payload,
      signature,
      webhookSecret: secret,
      nowIso: new Date().toISOString(),
    }),
  ).rejects.toThrow('without a recorded charge');
});

test('BYOK registers, rotates, revokes, and reads metadata with the broker pre-loaded (NEG3-37)', async () => {
  const fixture = await seedFixture('byok');
  const refId = `byok-${fixture.tenantId}`;
  const missing = await call(
    'POST',
    '/api/byok/credentials',
    { refId, provider: 'acme-models', model: 'fixer-2', fingerprint: 'a'.repeat(64) },
    fixture.ownerCookie,
  );
  expect(missing.status).toBe(404);
  byokValues.set(refId, 'key-material-never-leaves-the-broker');
  const provisioned = await call(
    'POST',
    '/api/byok/credentials',
    { refId, provider: 'acme-models', model: 'fixer-2', fingerprint: 'a'.repeat(64) },
    fixture.ownerCookie,
  );
  expect(provisioned.status).toBe(201);
  const read = await call('GET', `/api/byok/credentials/${refId}`, undefined, fixture.memberCookie);
  expect(read.status).toBe(200);
  expect(JSON.stringify(read.body)).not.toContain('key-material-never-leaves-the-broker');
  const rotated = await call(
    'POST',
    `/api/byok/credentials/${refId}/rotate`,
    { newFingerprint: 'b'.repeat(64) },
    fixture.ownerCookie,
  );
  expect(rotated.status).toBe(200);
  expect((rotated.body as { data: { rotationVersion: number } }).data.rotationVersion).toBe(2);
  const memberWrite = await call(
    'POST',
    `/api/byok/credentials/${refId}/revoke`,
    {},
    fixture.memberCookie,
  );
  expect(memberWrite.status).toBe(403);
  const revoked = await call('POST', `/api/byok/credentials/${refId}/revoke`, {}, fixture.ownerCookie);
  expect(revoked.status).toBe(200);
  const afterRevoke = await call('GET', `/api/byok/credentials/${refId}`, undefined, fixture.ownerCookie);
  expect((afterRevoke.body as { data: { status: string } }).data.status).toBe('revoked');
});

test('SAML provisions, rotates, links, and disables; members stay out', async () => {
  const fixture = await seedFixture('saml');
  const empty = await call('GET', '/api/enterprise/saml', undefined, fixture.ownerCookie);
  expect(empty.body).toEqual({ ok: true, data: null });
  const memberProvision = await call(
    'POST',
    '/api/enterprise/saml',
    {
      entityId: 'https://idp.example.com/entity',
      idpIssuer: 'https://idp.example.com/issuer',
      audience: 'https://changeproof.example.com/saml',
      acsUrl: 'https://changeproof.example.com/saml/acs',
      certPem: CERT_PEM,
      verifiedDomain: 'example.com',
    },
    fixture.memberCookie,
  );
  expect(memberProvision.status).toBe(403);
  const provisioned = await call(
    'POST',
    '/api/enterprise/saml',
    {
      entityId: 'https://idp.example.com/entity',
      idpIssuer: 'https://idp.example.com/issuer',
      audience: 'https://changeproof.example.com/saml',
      acsUrl: 'https://changeproof.example.com/saml/acs',
      certPem: CERT_PEM,
      verifiedDomain: 'example.com',
    },
    fixture.ownerCookie,
  );
  expect(provisioned.status).toBe(201);
  const linked = await call(
    'POST',
    '/api/enterprise/saml/link',
    { subject: `subject-${fixture.tenantId}`, userId: fixture.memberId },
    fixture.ownerCookie,
  );
  expect(linked.status).toBe(200);
  const rotated = await call('POST', '/api/enterprise/saml/rotate', { certPem: CERT_PEM }, fixture.ownerCookie);
  expect(rotated.status).toBe(200);
  const disabled = await call('POST', '/api/enterprise/saml/disable', {}, fixture.ownerCookie);
  expect(disabled.status).toBe(200);
  const read = await call('GET', '/api/enterprise/saml', undefined, fixture.ownerCookie);
  expect((read.body as { data: { status: string } }).data.status).toBe('disabled');
});

test('SCIM tokens mint once and revoke; tenants stay fenced', async () => {
  const fixture = await seedFixture('scim');
  const other = await seedFixture('scim-other');
  const minted = await call('POST', '/api/enterprise/scim/tokens', {}, fixture.ownerCookie);
  expect(minted.status).toBe(201);
  const tokenId = (minted.body as { data: { tokenId: string } }).data.tokenId;
  // Foreign and already-revoked revokes answer identically (no existence leak);
  // the own-tenant revoke below still flips to true, proving no cross effect.
  const foreign = await call('POST', `/api/enterprise/scim/tokens/${tokenId}/revoke`, {}, other.ownerCookie);
  expect(foreign.status).toBe(200);
  expect((foreign.body as { data: { revoked: boolean } }).data.revoked).toBe(false);
  const revoked = await call('POST', `/api/enterprise/scim/tokens/${tokenId}/revoke`, {}, fixture.ownerCookie);
  expect(revoked.status).toBe(200);
  expect((revoked.body as { data: { revoked: boolean } }).data.revoked).toBe(true);
  const again = await call('POST', `/api/enterprise/scim/tokens/${tokenId}/revoke`, {}, fixture.ownerCookie);
  expect((again.body as { data: { revoked: boolean } }).data.revoked).toBe(false);
});

test('billing summary and ledger mirror settled usage per tenant', async () => {
  const fixture = await seedFixture('ledger');
  await usageComp.store.setEntitlement({
    tenantId: fixture.tenantId,
    capAmount: 1000,
    rateVersion: 'test-rates-1',
    periodId: 'period-1',
    nowIso: new Date().toISOString(),
  });
  const emptySummary = await call('GET', '/api/billing/summary', undefined, fixture.ownerCookie);
  expect(emptySummary.body).toEqual({ ok: true, data: { used: 0, limit: 1000 } });
  const emptyLedger = await call('GET', '/api/billing/ledger?limit=50', undefined, fixture.ownerCookie);
  expect((emptyLedger.body as { data: { items: unknown[] } }).data.items).toEqual([]);
  const saved = await call(
    'POST',
    '/api/drafts',
    { projectId: fixture.projectId, body: { intent: 'ledger run', budgetCap: 50 } },
    fixture.ownerCookie,
  );
  expect(saved.status).toBe(201);
  const draft = (saved.body as { data: { draftId: string; revision: number } }).data;
  const submitted = await call(
    'POST',
    '/api/runs',
    {
      projectId: fixture.projectId,
      repositoryIds: [fixture.repositoryId],
      sourceRefs: ['git:abc1234'],
      intentRef: 'intent-ledger',
      executionMode: 'real_runtime',
      invariantRefs: ['invariant-ledger'],
      verificationPlanRef: 'plan-ledger',
      budgetProfileId: 'budget-ledger',
      publicationConsent: false,
      idempotencyKey: idempotencyKey(fixture.tenantId),
      expectedGrantVersion: fixture.grantVersion,
      draftId: draft.draftId,
      draftRevision: draft.revision,
      requestedBudget: 50,
    },
    fixture.ownerCookie,
  );
  expect(submitted.status).toBe(201);
  const runId = (submitted.body as { data: { runId: string; reservationId: string } }).data.runId;
  const reservationId = (submitted.body as { data: { reservationId: string } }).data.reservationId;
  // Worker simulation at the store boundary: a consume on the run's own
  // reservation lands a second ledger entry.
  await usageComp.store.recordConsume({
    tenantId: fixture.tenantId,
    reservationId,
    effectId: idempotencyKey(`consume-${fixture.tenantId}`),
    provider: 'test-provider',
    measuredUnits: 10,
    unitName: 'credits',
    nowIso: new Date().toISOString(),
  });
  const balances = await call('GET', '/api/billing/balances', undefined, fixture.ownerCookie);
  const settled = (balances.body as { data: { consumed: number; cap: number } }).data;
  const summary = await call('GET', '/api/billing/summary', undefined, fixture.ownerCookie);
  expect(summary.body).toEqual({ ok: true, data: { used: settled.consumed, limit: settled.cap } });
  expect(settled.consumed).toBeGreaterThan(0);
  const ledger = await call('GET', '/api/billing/ledger?limit=50', undefined, fixture.ownerCookie);
  const items = (
    ledger.body as { data: { items: { entryId: string; kind: string; amount: number; detail: string }[] } }
  ).data.items;
  expect(items.map((entry) => entry.kind).sort()).toEqual(['consume', 'reserve']);
  expect(items.every((entry) => entry.detail === runId)).toBe(true);
  expect(items.every((entry) => /^[0-9a-f]{64}$/.test(entry.entryId))).toBe(true);
  const other = await seedFixture('ledger-other');
  await usageComp.store.setEntitlement({
    tenantId: other.tenantId,
    capAmount: 1000,
    rateVersion: 'test-rates-1',
    periodId: 'period-1',
    nowIso: new Date().toISOString(),
  });
  const fenced = await call('GET', '/api/billing/ledger?limit=50', undefined, other.ownerCookie);
  expect((fenced.body as { data: { items: unknown[] } }).data.items).toEqual([]);
  const bad = await call('GET', '/api/billing/ledger?limit=500', undefined, fixture.ownerCookie);
  expect(bad.status).toBe(400);
  const guest = await call('GET', '/api/billing/summary');
  expect(guest.status).toBe(401);
});
