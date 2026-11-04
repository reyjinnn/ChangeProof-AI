import { afterEach, expect, test, vi } from 'vitest';

import { h } from './components.js';
import { registerRoute, renderRoute } from './routes.js';
import { renderStatus } from './status.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); document.body.replaceChildren(); });

function outlet(): HTMLElement {
  const host = h('main');
  document.body.append(host);
  return host;
}

test('healthy public API does not disguise an unavailable account service as a guest session', async () => {
  globalThis.fetch = vi.fn((input: unknown) => Promise.resolve(new Response(JSON.stringify(
    String(input) === '/api/health'
      ? { ok: true, data: { status: 'ok', service: 'changeproof', contentVersion: 'test-1' } }
      : { ok: false, error: { code: 'unavailable', message: 'Account service is not configured.' } },
  ), { status: String(input) === '/api/health' ? 200 : 503 })));
  const host = outlet();
  await renderStatus(host);
  expect(host.textContent).toContain('Unavailable');
  expect(host.textContent).toContain('No live Muse model or Modal sandbox connection is confirmed');
  expect(host.querySelector('a[href="#/p/sample-report"]')).not.toBeNull();
});

test('an offline API stays an actionable error rather than a successful overview', async () => {
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('offline')));
  const host = outlet();
  await renderStatus(host);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Service unreachable');
  expect(host.querySelector('button')?.textContent).toContain('Retry');
});

test('a late health response cannot overwrite a newer route', async () => {
  let release!: (value: Response) => void;
  globalThis.fetch = vi.fn((input: unknown) => String(input) === '/api/health'
    ? new Promise<Response>((resolve) => { release = resolve; })
    : Promise.resolve(new Response(JSON.stringify({ ok: true, data: { authenticated: false } }), { status: 200 })));
  registerRoute({ path: '/pending-health', title: 'Health', render: renderStatus });
  registerRoute({ path: '/after-health', title: 'Current', render: (host) => { host.textContent = 'Current page'; } });
  const host = outlet();
  const pending = renderRoute(host, '#/pending-health');
  await renderRoute(host, '#/after-health');
  release(new Response(JSON.stringify({ ok: true, data: { status: 'ok', service: 'changeproof', contentVersion: '1' } }), { status: 200 }));
  await pending;
  expect(host.textContent).toBe('Current page');
});
