import { afterEach, expect, test, vi } from 'vitest';

import { refreshAccount, renderAccount } from './session.js';
import { closeAccount, renderShell, toggleAccount } from './shell.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  closeAccount();
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

test('logged-out avatar shows guest and the popover links to login', () => {
  boot();
  renderAccount({ authenticated: false });
  expect(document.querySelector('.top-avatar .avatar-label')?.textContent).toBe('Guest');
  toggleAccount();
  expect(document.querySelector('#accountRoot a[href="#/login"]')?.textContent).toContain('Sign in');
});

test('logged-in avatar shows tenant identity with settings and sign out', () => {
  boot();
  renderAccount({ authenticated: true, tenantId: 'acme', role: 'owner' });
  expect(document.querySelector('.top-avatar .avatar-label')?.textContent).toBe('acme');
  expect(document.getElementById('orgLabel')?.textContent).toBe('acme');
  toggleAccount();
  expect(document.querySelector('#accountRoot .account-identity')?.textContent).toContain('acme');
  expect(document.querySelector('#accountRoot a[href="#/settings"]')).not.toBeNull();
  expect(document.querySelector('#accountRoot .signout')?.textContent).toContain('Sign out');
});

test('refresh fills the avatar from the session endpoint', async () => {
  boot();
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, data: { authenticated: true, tenantId: 'acme', role: 'admin' } }), {
        status: 200,
      }),
    ),
  );
  await refreshAccount();
  expect(document.querySelector('.top-avatar .avatar-label')?.textContent).toBe('acme');
});

test('refresh failure falls back to guest', async () => {
  boot();
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('down')));
  await refreshAccount();
  expect(document.querySelector('.top-avatar .avatar-label')?.textContent).toBe('Guest');
});
