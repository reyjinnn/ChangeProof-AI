import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { renderRoute, registerRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerAuthPages } from './auth.js';

const realFetch = globalThis.fetch;
const seen: { url: string; body: unknown }[] = [];

function stubFetch(routes: Record<string, { status: number; json: unknown }>): void {
  seen.length = 0;
  globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    let body: unknown;
    const rawBody = init?.body;
    if (typeof rawBody === 'string') {
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        body = undefined;
      }
    }
    seen.push({ url, body });
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
  registerAuthPages();
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

async function submit(outlet: HTMLElement): Promise<void> {
  outlet.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

test('login validates empty fields and focuses the first problem', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  expect(outlet.querySelector('h1')?.textContent).toBe('Log in');
  await submit(outlet);
  expect(outlet.querySelector('#login-email-error')?.textContent).toContain('email address');
  expect(document.activeElement?.id).toBe('login-email');
  expect(seen.some((call) => call.url === '/api/auth/login')).toBe(false);
});

test('multi-tenant login reveals the organization field', async () => {
  stubFetch({
    '/api/auth/providers': { status: 200, json: { email: true, github: false } },
    '/api/auth/login': {
      status: 400,
      json: { ok: false, error: { code: 'bad_request', message: 'Several organizations found; name the tenant to log in to.' } },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  (document.getElementById('login-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('login-password') as HTMLInputElement).value = 'long-enough-password';
  await submit(outlet);
  expect((document.getElementById('login-tenant') as HTMLInputElement).style.display).not.toBe('none');
  expect(document.activeElement?.id).toBe('login-tenant');
});

test('evil return targets never leave the browser', async () => {
  stubFetch({
    '/api/auth/providers': { status: 200, json: { email: true, github: false } },
    '/api/auth/login': { status: 200, json: { tenantId: 't', expiresAt: '2030-01-01T00:00:00.000Z' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/login?return=https%3A%2F%2Fevil.example%2F');
  (document.getElementById('login-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('login-password') as HTMLInputElement).value = 'long-enough-password';
  await submit(outlet);
  const login = seen.find((call) => call.url === '/api/auth/login');
  expect(login?.body).not.toHaveProperty('returnTarget');
});

test('github login reports its unavailable state honestly', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  for (let i = 0; i < 20 && !outlet.textContent.includes('GitHub login'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(outlet.textContent).toContain('no authorized GitHub App');
  expect(outlet.querySelector('a[href*="github"]')).toBeNull();
  expect(outlet.querySelector('button[type="submit"]')?.textContent).toBe('Log in');
});

test('register rejects mismatched passwords without a request', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  (document.getElementById('reg-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('reg-password') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reg-confirm') as HTMLInputElement).value = 'different-password';
  await submit(outlet);
  expect(outlet.querySelector('#reg-confirm-error')?.textContent).toContain('do not match');
  expect(seen.some((call) => call.url === '/api/auth/register')).toBe(false);
});

test('verify consumes the token then hands a ticket to create-org', async () => {
  stubFetch({
    '/api/auth/verify': { status: 200, json: { claimTicket: 'ticket-1' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/verify-email?token=tok');
  for (let i = 0; i < 20 && !outlet.textContent.includes('Email verified'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(outlet.textContent).toContain('Email verified');
  await renderRoute(outlet, '#/create-org');
  expect(outlet.querySelector('#org-slug')).not.toBeNull();
});

test('verify without a token shows recovery, not a blank page', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/verify-email');
  expect(outlet.textContent).toContain('no token');
});

test('create-org without a ticket explains the recovery path', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/create-org');
  expect(outlet.textContent).toContain('single-use ticket');
});
