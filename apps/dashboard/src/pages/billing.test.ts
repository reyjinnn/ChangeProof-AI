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
  expect(outlet.querySelector('h1')?.textContent).toBe('Usage & data');
  expect(outlet.querySelector('.usage-bar')?.getAttribute('aria-label')).toContain('120 used, 50 reserved, 830 remaining');
  expect(outlet.querySelector('.split')).not.toBeNull();
  expect(outlet.querySelector('a[href="#/run?id=run-1"]')).not.toBeNull();
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

test('a new organization without a configured usage period shows an honest empty state', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: OWNER_SESSION },
    '/api/billing/balances': { status: 200, json: { periodId: null, cap: null, consumed: 0, reservedActive: 0, reservations: [] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/billing');
  expect(outlet.textContent).toContain('Usage period not configured');
  expect(outlet.querySelector('.usage-bar')).toBeNull();
  expect(outlet.textContent).not.toContain('null');
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
