import { afterEach, expect, test, vi } from 'vitest';

import { refreshAccount, renderAccount } from './session.js';
import { renderShell } from './shell.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
  window.localStorage.clear();
});

function boot(): void {
  const app = document.createElement('div');
  document.body.appendChild(app);
  renderShell(app);
}

test('logged-out slot links to login', () => {
  boot();
  renderAccount({ authenticated: false });
  expect(document.querySelector('#account a[href="#/login"]')?.textContent).toBe('Log in');
});

test('logged-in slot shows tenant, role, settings, and logout', () => {
  boot();
  renderAccount({ authenticated: true, tenantId: 'acme', role: 'owner' });
  expect(document.querySelector('#account')?.textContent).toContain('acme · owner');
  expect(document.querySelector('#account a[href="#/settings"]')).not.toBeNull();
  expect(document.querySelector('#account button')?.textContent).toBe('Log out');
});

test('refresh fills the slot from the session endpoint', async () => {
  boot();
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, data: { authenticated: true, tenantId: 'acme', role: 'admin' } }), {
        status: 200,
      }),
    ),
  );
  await refreshAccount();
  expect(document.querySelector('#account')?.textContent).toContain('acme · admin');
});

test('refresh failure falls back to logged out', async () => {
  boot();
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('down')));
  await refreshAccount();
  expect(document.querySelector('#account a[href="#/login"]')).not.toBeNull();
});
