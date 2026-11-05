import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerBillingPages } from './billing.js';

const realFetch = globalThis.fetch;

type StubHit = { status: number; json: unknown } | ((url: string) => { status: number; json: unknown });

function stubFetch(routes: Record<string, StubHit>): void {
  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const hit = routes[path] ?? routes[url];
    const resolved = typeof hit === 'function' ? hit(url) : hit;
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
  registerBillingPages();
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

const BALANCES = {
  periodId: 'period-1',
  cap: 1000,
  consumed: 120,
  reservedActive: 50,
  reservations: [{ reservationId: 'res-1', runId: 'run-1', state: 'open', consumed: 0, reserved: 50 }],
};

test('guests see a login card on billing, never balances', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/billing');
  await settle(outlet, 'Billing needs a login');
  expect(outlet.textContent).toContain('Log in');
  expect(outlet.textContent).not.toContain('period-1');
});

test('owners see the period cap, usage, and open reservations', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: BALANCES },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/billing');
  await settle(outlet, 'period-1');
  expect(outlet.textContent).toContain('1000');
  expect(outlet.textContent).toContain('120');
  expect(outlet.textContent).toContain('830');
  expect(outlet.textContent).toContain('res-1');
  expect(outlet.textContent).toContain('run-1');
});

test('owners without an entitlement see a no-period state, never raw null', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: { ...BALANCES, periodId: null, cap: null } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/billing');
  await settle(outlet, 'No active billing period');
  expect(outlet.querySelector('.stats')).toBeNull();
  expect(outlet.textContent).not.toContain('null');
});

test('billing says plainly that invoices have no listing endpoint', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: BALANCES },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/billing');
  await settle(outlet, 'period-1');
  expect(outlet.textContent).toContain('no invoice listing');
});

test('a failed balances read offers a retry that recovers', async () => {
  let calls = 0;
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': () => {
      calls += 1;
      return calls === 1
        ? { status: 500, json: { ok: false, error: { code: 'boom', message: 'Balances exploded.' } } }
        : { status: 200, json: BALANCES };
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/billing');
  await settle(outlet, 'Billing unavailable');
  required(outlet.querySelector('button'), 'retry button').click();
  await settle(outlet, 'period-1');
  expect(outlet.textContent).toContain('830');
});

test('usage is the same period page under its own route', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: BALANCES },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/usage');
  await settle(outlet, 'period-1');
  expect(outlet.querySelectorAll('.stats .stat').length).toBe(4);
  expect(outlet.textContent).toContain('1000');
  expect(outlet.textContent).toContain('830');
  expect(outlet.textContent).toContain('res-1');
  expect(outlet.textContent).toContain('run-1');
});

test('caps form refuses to fake a save', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: BALANCES },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/usage');
  await settle(outlet, 'Budget & concurrency');
  const form = required(outlet.querySelector<HTMLFormElement>('#capsForm'), 'caps form');
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await settle(outlet, 'no spending-limit endpoint');
});

test('ledger stays empty when nothing has settled', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: BALANCES },
    '/api/billing/ledger?limit=50': { status: 200, json: { items: [] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/usage');
  await settle(outlet, 'No ledger entries');
  expect(outlet.textContent).toContain('No usage has settled in this period yet.');
});

test('ledger reports honestly when it cannot load', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: BALANCES },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/usage');
  await settle(outlet, 'Ledger unavailable');
  expect(outlet.textContent).toContain('could not be loaded');
});

test('ledger lists entries when the endpoint answers', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: BALANCES },
    '/api/billing/ledger?limit=50': {
      status: 200,
      json: { items: [{ entryId: 'le-1', kind: 'consume', amount: 5, runId: 'run-1' }] },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/usage');
  await settle(outlet, 'le-1');
  expect(outlet.textContent).toContain('consume');
});

test('checkout refuses to fake a payment flow', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: BALANCES },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/usage');
  await settle(outlet, 'Current plan');
  const checkout = [...outlet.querySelectorAll('button')].find((b) => b.textContent === 'Start checkout');
  if (checkout === undefined) throw new Error('Missing checkout button.');
  checkout.click();
  await settle(outlet, 'no payment endpoint');
});
