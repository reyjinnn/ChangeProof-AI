import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { renderRoute, registerRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerSettingsPage } from './settings.js';

const realFetch = globalThis.fetch;
const seen: string[] = [];

function stubFetch(routes: Record<string, { status: number; json: unknown }>): void {
  seen.length = 0;
  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    seen.push(url);
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const hit = routes[path];
    if (hit === undefined) return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(hit.status < 400 ? { ok: true, data: hit.json } : hit.json), { status: hit.status }),
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
  registerSettingsPage();
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

const SESSION = { authenticated: true, userId: 'u-1', tenantId: 'acme', role: 'owner', expiresAt: '2030-01-01T00:00:00.000Z' };
const SESSIONS = [
  { sessionId: 'sess-current', tenantId: 'acme', expiresAt: '2030-01-01T00:00:00.000Z', revoked: false, current: true },
  { sessionId: 'sess-other', tenantId: 'acme', expiresAt: '2030-01-01T00:00:00.000Z', revoked: false, current: false },
];

async function settle(outlet: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 30 && !outlet.textContent.includes(text); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('guests see a login card, never settings', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'Settings need a login');
  expect(outlet.querySelector('a[href="#/login"]')).not.toBeNull();
  expect(seen.some((url) => url === '/api/auth/sessions')).toBe(false);
});

test('sessions list marks the current one and revokes others', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: SESSIONS },
    '/api/auth/sessions/sess-other': { status: 200, json: { revoked: true } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'This session');
  expect(outlet.textContent).toContain('This session');
  const revoke = [...outlet.querySelectorAll('.faq-item button')].find((b) => b.textContent === 'Revoke');
  expect(revoke).toBeDefined();
  (revoke as HTMLButtonElement).click();
  await settle(outlet, 'revoked');
  expect(seen.some((url) => url === '/api/auth/sessions/sess-other')).toBe(true);
});

test('dead sessions redirect to the expired page', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': {
      status: 401,
      json: { ok: false, error: { code: 'session_expired', message: 'Expired.' } },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  for (let i = 0; i < 30 && window.location.hash !== '#/session-expired'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(window.location.hash).toBe('#/session-expired');
});

test('invite creation shows the one-time link', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: [] },
    '/api/orgs/acme/invitations': { status: 201, json: { invitationId: 'inv-1', token: 'tok-abc' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'Invite someone');
  const form = [...outlet.querySelectorAll('form')].find((f) => f.textContent.includes('Create invitation'));
  form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await settle(outlet, 'tok-abc');
  expect(outlet.textContent).toContain('#/invite?token=tok-abc');
});

test('deletion demands a matching confirmation, no request otherwise', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'Delete organization');
  (document.getElementById('delete-reason') as HTMLInputElement).value = 'done';
  (document.getElementById('delete-confirm') as HTMLInputElement).value = 'wrong-slug';
  const form = [...outlet.querySelectorAll('form')].find((f) => f.textContent.includes('Delete this organization'));
  form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await settle(outlet, 'does not match');
  expect(seen.some((url) => url === '/api/orgs/acme')).toBe(false);
});
