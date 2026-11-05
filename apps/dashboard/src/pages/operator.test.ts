import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerOperatorPages } from './operator.js';

const realFetch = globalThis.fetch;

type StubHit = { status: number; json: unknown } | ((url: string, body: unknown) => { status: number; json: unknown });

function stubFetch(routes: Record<string, StubHit>): void {
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
    let body: unknown;
    if ((init?.method ?? 'GET') !== 'GET' && init?.body !== undefined) {
      if (typeof init.body !== 'string') throw new Error('Stub fetch expects string bodies.');
      body = JSON.parse(init.body) as unknown;
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
  registerOperatorPages();
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

const OPERATOR_SESSION = {
  authenticated: true,
  userId: 'user-operator',
  tenantId: 'acme-ops',
  role: 'operator',
  grantVersion: 1,
};

const CREATED = '2026-11-02T00:00:00.000Z';

const INCIDENT = {
  schemaVersion: '1',
  incidentId: 'inc-1',
  component: 'queue',
  status: 'open',
  summary: 'Backlog growing.',
  createdAt: CREATED,
  updatedAt: CREATED,
};

const RECEIPT = {
  schemaVersion: '1',
  actionId: 'act-1',
  tenantId: 'acme',
  targetJobId: 'job-1',
  kind: 'drain',
  leaseEpoch: 4,
  reason: 'Stuck lease.',
  operatorId: 'user-operator',
  createdAt: CREATED,
};

function operatorStubs(): Record<string, StubHit> {
  return {
    '/api/auth/session': { status: 200, json: OPERATOR_SESSION },
    '/api/support/incidents?limit=20': { status: 200, json: { items: [INCIDENT], cursor: '' } },
    '/api/operator/actions?limit=20': { status: 200, json: { items: [RECEIPT], cursor: '' } },
  };
}

test('owners on the console route get an honest denial with no data fetch', async () => {
  const fetchSpy = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ ok: true, data: { ...OPERATOR_SESSION, role: 'owner', userId: 'user-owner' } }),
        { status: 200 },
      ),
    ),
  );
  globalThis.fetch = fetchSpy;
  const outlet = boot();
  await renderRoute(outlet, '#/operator');
  await settle(outlet, 'Operator console is unavailable');
  expect(outlet.textContent).toContain('Owner accounts cannot reach operator actions');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('guests on the console route see a login card', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: { authenticated: false } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/operator');
  await settle(outlet, 'Operator console needs a login');
});

test('operators report, acknowledge, and resolve incidents', async () => {
  stubFetch({
    ...operatorStubs(),
    '/api/operator/incidents': { status: 201, json: INCIDENT },
    '/api/operator/incidents/inc-1/acknowledge': { status: 200, json: { ...INCIDENT, status: 'mitigating' } },
    '/api/operator/incidents/inc-1/resolve': { status: 200, json: { ...INCIDENT, status: 'resolved' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/operator');
  await settle(outlet, 'Backlog growing');
  required(outlet.querySelector<HTMLInputElement>('#incident-component'), 'component field').value = 'queue';
  required(outlet.querySelector<HTMLInputElement>('#incident-summary'), 'summary field').value = 'Backlog growing.';
  required(outlet.querySelector<HTMLButtonElement>('#incident-report'), 'report button').click();
  await settle(outlet, 'inc-1');
  required(outlet.querySelector<HTMLButtonElement>('button[data-ack="inc-1"]'), 'ack button').click();
  await settle(outlet, 'mitigating');
});

test('operators inspect then drain under the lease fence; stale refuses', async () => {
  stubFetch({
    ...operatorStubs(),
    '/api/operator/targets/inspect': { status: 200, json: { tenantId: 'acme', state: 'running', epoch: 4 } },
    '/api/operator/targets/drain': { status: 200, json: RECEIPT },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/operator');
  await settle(outlet, 'Operator actions');
  required(outlet.querySelector<HTMLInputElement>('#target-tenant'), 'tenant field').value = 'acme';
  required(outlet.querySelector<HTMLInputElement>('#target-job'), 'job field').value = 'job-1';
  required(outlet.querySelector<HTMLButtonElement>('#target-inspect'), 'inspect button').click();
  await settle(outlet, 'epoch 4');
  required(outlet.querySelector<HTMLInputElement>('#target-reason'), 'reason field').value = 'Stuck lease.';
  required(outlet.querySelector<HTMLButtonElement>('#target-drain'), 'drain button').click();
  await settle(outlet, 'act-1');
});

test('operations alias renders the same console', async () => {
  stubFetch(operatorStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/operations');
  await settle(outlet, 'Backlog growing');
  expect(outlet.querySelectorAll('.stats .stat').length).toBe(4);
  expect(outlet.textContent).toContain('Worker lifecycle');
  expect(outlet.textContent).toContain('Operator actions');
});

test('worker lifecycle is honest without an endpoint', async () => {
  stubFetch(operatorStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/operator');
  await settle(outlet, 'Worker lifecycle');
  expect(outlet.textContent).toContain('no worker-lifecycle endpoint');
});

test('console stats count incidents and actions from the service', async () => {
  stubFetch(operatorStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/operator');
  await settle(outlet, 'Backlog growing');
  await settle(outlet, 'act-1');
  const values = [...outlet.querySelectorAll('.stats .value')].map((node) => node.textContent);
  expect(values).toEqual(['1', '1', '1', '—']);
});

test('release and admission cards link to the customer-facing status', async () => {
  stubFetch(operatorStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/operator');
  await settle(outlet, 'Backlog growing');
  expect(outlet.textContent).toContain('Release & recovery');
  expect(outlet.textContent).toContain('Admission & fairness');
  expect(outlet.querySelector('a[href="#/service-status"]')).not.toBeNull();
});
