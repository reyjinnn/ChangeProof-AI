import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerSupportPages } from './support.js';

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
  registerSupportPages();
  registerRoute({ path: '/operator', title: 'Operator', render: () => undefined });
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

const OWNER_SESSION = {
  authenticated: true,
  userId: 'user-owner',
  tenantId: 'acme',
  role: 'owner',
  grantVersion: 3,
};

const CREATED = '2026-11-02T00:00:00.000Z';

const TICKET_OPEN = {
  schemaVersion: '1',
  ticketId: 'ticket-1',
  tenantId: 'acme',
  reporterId: 'user-member',
  category: 'bug',
  summary: 'Checkout 500s',
  context: 'Pay step fails.',
  status: 'open',
  createdAt: CREATED,
  updatedAt: CREATED,
};

const INCIDENT = {
  schemaVersion: '1',
  incidentId: 'inc-1',
  component: 'queue',
  status: 'open',
  summary: 'Backlog growing.',
  createdAt: CREATED,
  updatedAt: CREATED,
};

function supportStubs(): Record<string, StubHit> {
  return {
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/support/tickets?limit=20': { status: 200, json: { items: [TICKET_OPEN], cursor: '' } },
    '/api/support/incidents?limit=20': { status: 200, json: { items: [INCIDENT], cursor: '' } },
  };
}

test('guests see a login card on support routes, never data', async () => {
  const fetchSpy = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true, data: { authenticated: false } }), { status: 200 })),
  );
  globalThis.fetch = fetchSpy;
  const outlet = boot();
  await renderRoute(outlet, '#/support');
  await settle(outlet, 'Support needs a login');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('tickets list with status transitions; filing re-lists with a receipt', async () => {
  let calls = 0;
  stubFetch({
    ...supportStubs(),
    '/api/support/tickets?limit=20': () => {
      calls += 1;
      return { status: 200, json: { items: [TICKET_OPEN], cursor: '' } };
    },
    '/api/support/tickets': { status: 201, json: { ...TICKET_OPEN, ticketId: 'ticket-9' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/support');
  await settle(outlet, 'Checkout 500s');
  expect(outlet.querySelector('button[data-triage="ticket-1"]')).not.toBeNull();
  expect(outlet.querySelector('button[data-resolve="ticket-1"]')).toBeNull();
  required(outlet.querySelector<HTMLInputElement>('#ticket-summary'), 'summary field').value = 'Checkout 500s';
  required(outlet.querySelector<HTMLTextAreaElement>('#ticket-context'), 'context field').value = 'Pay step fails.';
  required(outlet.querySelector<HTMLButtonElement>('#ticket-file'), 'file button').click();
  await settle(outlet, 'ticket-9');
  expect(posted.map((entry) => entry.url)).toContain('/api/support/tickets');
  expect(calls).toBeGreaterThanOrEqual(2);
});

test('transition posts then refreshes the list', async () => {
  stubFetch({
    ...supportStubs(),
    '/api/support/tickets/ticket-1/triage': { status: 200, json: { ...TICKET_OPEN, status: 'triaged' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/support');
  await settle(outlet, 'Checkout 500s');
  required(outlet.querySelector<HTMLButtonElement>('button[data-triage="ticket-1"]'), 'triage button').click();
  await settle(outlet, 'triaged');
  expect(posted.map((entry) => entry.url)).toContain('/api/support/tickets/ticket-1/triage');
});

test('access request files with a receipt; decide and revoke take pasted ids', async () => {
  stubFetch({
    ...supportStubs(),
    '/api/support/access-requests': {
      status: 201,
      json: {
        schemaVersion: '1',
        requestId: 'accreq-9',
        tenantId: 'acme',
        requesterId: 'user-owner',
        resourceType: 'run',
        resourceId: 'run-1',
        reason: 'Review.',
        status: 'pending',
        expiresAt: '2026-11-09T00:00:00.000Z',
        createdAt: CREATED,
      },
    },
    '/api/support/access-requests/accreq-9/decide': {
      status: 200,
      json: { requestId: 'accreq-9', status: 'approved', grantId: 'grant-9' },
    },
    '/api/support/grants/grant-9/revoke': { status: 200, json: { grantId: 'grant-9' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/support');
  await settle(outlet, 'Access requests');
  required(outlet.querySelector<HTMLInputElement>('#access-resource'), 'resource field').value = 'run-1';
  required(outlet.querySelector<HTMLInputElement>('#access-reason'), 'reason field').value = 'Review.';
  required(outlet.querySelector<HTMLButtonElement>('#access-file'), 'request button').click();
  await settle(outlet, 'accreq-9');
  required(outlet.querySelector<HTMLInputElement>('#decide-request'), 'decide field').value = 'accreq-9';
  required(outlet.querySelector<HTMLButtonElement>('#decide-approve'), 'approve button').click();
  await settle(outlet, 'grant-9');
  required(outlet.querySelector<HTMLInputElement>('#revoke-grant'), 'revoke field').value = 'grant-9';
  required(outlet.querySelector<HTMLButtonElement>('#revoke-run'), 'revoke button').click();
  await settle(outlet, 'Grant grant-9 revoked');
});

test('tenants see the incident list; owners see no operator link', async () => {
  stubFetch(supportStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/support');
  await settle(outlet, 'Backlog growing');
  expect(outlet.querySelector('a[href="#/operator"]')).toBeNull();
});

test('operators see the console link on the support page', async () => {
  stubFetch({
    ...supportStubs(),
    '/api/auth/session': { status: 200, json: { ...OWNER_SESSION, role: 'operator', userId: 'user-operator' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/support');
  await settle(outlet, 'Backlog growing');
  expect(outlet.querySelector('a[href="#/operator"]')).not.toBeNull();
});
