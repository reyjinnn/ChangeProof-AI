import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerEnterprisePages } from './enterprise.js';

const realFetch = globalThis.fetch;
const posted: { url: string; body: unknown }[] = [];

type StubHit = { status: number; json: unknown } | ((url: string, body: unknown) => { status: number; json: unknown });

function stubFetch(routes: Record<string, StubHit>): void {
  posted.length = 0;
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
    let body: unknown;
    if ((init?.method ?? 'GET') !== 'GET' && init?.body !== undefined) {
      if (typeof init.body !== 'string') throw new Error('Stub fetch expects string bodies.');
      body = JSON.parse(init.body) as unknown;
      posted.push({ url, body });
    }
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const hit = routes[path] ?? routes[url];
    const resolved = typeof hit === 'function' ? hit(url, body) : hit;
    if (resolved === undefined) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify(resolved.status < 400 ? { ok: true, data: resolved.json } : resolved.json),
        { status: resolved.status },
      ),
    );
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
  window.location.hash = '';
});

function boot(): HTMLElement {
  registerEnterprisePages();
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

async function settle(host: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 60 && !host.textContent.includes(text); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function required<T extends HTMLElement>(element: T | null, what: string): T {
  if (element === null) throw new Error(`Missing ${what}.`);
  return element;
}

function fill(id: string, value: string): void {
  const field = required(document.getElementById(id) as HTMLInputElement | null, id);
  field.value = value;
}

function click(id: string): void {
  required(document.getElementById(id) as HTMLButtonElement | null, id).click();
}

const OWNER_SESSION = {
  authenticated: true,
  userId: 'user-owner',
  tenantId: 'acme',
  role: 'owner',
  grantVersion: 3,
};

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

const CREDENTIAL = {
  schemaVersion: '1',
  refId: 'byok-1',
  tenantId: 'acme',
  provider: 'acme-models',
  model: 'fixer-2',
  fingerprint: HEX_A,
  status: 'active',
  rotationVersion: 1,
  createdAt: '2026-11-02T00:00:00.000Z',
  rotatedAt: '2026-11-02T00:00:00.000Z',
};

const SAML = {
  schemaVersion: '1',
  tenantId: 'acme',
  entityId: 'https://idp.example.com/entity',
  idpIssuer: 'https://idp.example.com/issuer',
  audience: 'https://changeproof.example.com/saml',
  acsUrl: 'https://changeproof.example.com/saml/acs',
  certPem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----',
  certFingerprint: HEX_A,
  verifiedDomain: 'example.com',
  status: 'active',
  createdAt: '2026-11-02T00:00:00.000Z',
  rotatedAt: '2026-11-02T00:00:00.000Z',
};

function baseStubs(): Record<string, StubHit> {
  return {
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/enterprise/saml': { status: 200, json: null },
  };
}

test('guests see a login card on enterprise, never tenant data', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/enterprise');
  await settle(outlet, 'Enterprise needs a login');
  expect(outlet.textContent).toContain('Log in');
  expect(outlet.textContent).not.toContain('byok-');
});

test('BYOK provision posts metadata and reports the new ref', async () => {
  stubFetch({ ...baseStubs(), '/api/byok/credentials': { status: 201, json: { refId: 'byok-1', duplicate: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/enterprise');
  await settle(outlet, 'BYOK credentials');
  fill('byok-ref', 'byok-1');
  fill('byok-provider', 'acme-models');
  fill('byok-model', 'fixer-2');
  fill('byok-fingerprint', HEX_A);
  click('byok-provision');
  await settle(outlet, 'byok-1 provisioned');
  expect(posted).toContainEqual({
    url: '/api/byok/credentials',
    body: { refId: 'byok-1', provider: 'acme-models', model: 'fixer-2', fingerprint: HEX_A },
  });
});

test('BYOK lookup shows fingerprints and rotates; unknown refs stay quiet', async () => {
  stubFetch({
    ...baseStubs(),
    '/api/byok/credentials/byok-1': { status: 200, json: CREDENTIAL },
    '/api/byok/credentials/byok-1/rotate': { status: 200, json: { refId: 'byok-1', rotationVersion: 2 } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/enterprise');
  await settle(outlet, 'BYOK credentials');
  fill('byok-lookup-ref', 'byok-nope');
  click('byok-lookup');
  await settle(outlet, 'unknown in this tenant');
  fill('byok-lookup-ref', 'byok-1');
  click('byok-lookup');
  await settle(outlet, HEX_A);
  expect(outlet.textContent).toContain('acme-models');
  fill('byok-new-fingerprint', HEX_B);
  click('byok-rotate');
  await settle(outlet, 'rotation 2');
  expect(posted).toContainEqual({
    url: '/api/byok/credentials/byok-1/rotate',
    body: { newFingerprint: HEX_B },
  });
});

test('BYOK member writes surface the server refusal', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: { ...OWNER_SESSION, userId: 'user-member', role: 'member' } },
    '/api/enterprise/saml': { status: 200, json: null },
    '/api/byok/credentials': {
      status: 403,
      json: { ok: false, error: { code: 'forbidden', message: 'BYOK credential changes require an owner or admin; refusing.' } },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/enterprise');
  await settle(outlet, 'BYOK credentials');
  fill('byok-ref', 'byok-9');
  fill('byok-provider', 'acme-models');
  fill('byok-model', 'fixer-2');
  fill('byok-fingerprint', HEX_A);
  click('byok-provision');
  await settle(outlet, 'owner or admin');
});

test('SAML empty state provisions; active connections rotate, link, and disable', async () => {
  let connection: unknown = null;
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/enterprise/saml': () => ({ status: 200, json: connection }),
  });
  const outlet = boot();
  await renderRoute(outlet, '#/enterprise');
  await settle(outlet, 'No SAML connection');
  fill('saml-entity', SAML.entityId);
  fill('saml-issuer', SAML.idpIssuer);
  fill('saml-audience', SAML.audience);
  fill('saml-acs', SAML.acsUrl);
  fill('saml-cert', SAML.certPem);
  fill('saml-domain', SAML.verifiedDomain);
  connection = SAML;
  click('saml-provision');
  await settle(outlet, SAML.idpIssuer);
  expect(posted).toContainEqual({
    url: '/api/enterprise/saml',
    body: {
      entityId: SAML.entityId,
      idpIssuer: SAML.idpIssuer,
      audience: SAML.audience,
      acsUrl: SAML.acsUrl,
      certPem: SAML.certPem,
      verifiedDomain: SAML.verifiedDomain,
    },
  });
});

test('SCIM mint shows the token once; revoke reports without leaking', async () => {
  stubFetch({
    ...baseStubs(),
    '/api/enterprise/scim/tokens': { status: 201, json: { tokenId: 'scim-1', token: 'scim-secret-once' } },
    '/api/enterprise/scim/tokens/scim-1/revoke': { status: 200, json: { tokenId: 'scim-1', revoked: true } },
    '/api/enterprise/scim/tokens/scim-nope/revoke': { status: 200, json: { tokenId: 'scim-nope', revoked: false } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/enterprise');
  await settle(outlet, 'SCIM tokens');
  click('scim-mint');
  await settle(outlet, 'scim-secret-once');
  expect(outlet.textContent).toContain('shown once');
  fill('scim-revoke-id', 'scim-nope');
  click('scim-revoke');
  await settle(outlet, 'already revoked or unknown');
  fill('scim-revoke-id', 'scim-1');
  click('scim-revoke');
  await settle(outlet, 'scim-1 revoked');
});
