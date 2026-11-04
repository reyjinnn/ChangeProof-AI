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

function registerInput(outlet: HTMLElement, id: string): HTMLInputElement {
  const input = outlet.querySelector<HTMLInputElement>(`#${id}`);
  if (input === null) throw new Error(`Missing registration input: ${id}`);
  return input;
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

test('login uses the original modal, preserves recovery navigation and toggles only the password display', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  expect(outlet.querySelector('[role="dialog"]')).not.toBeNull();
  expect(outlet.querySelector('a[href="#/forgot-password"]')).not.toBeNull();
  outlet.querySelector<HTMLButtonElement>('[aria-controls="login-password"]')?.click();
  expect(outlet.querySelector<HTMLInputElement>('#login-password')?.type).toBe('text');
  expect(seen.some(call => call.url === '/api/auth/login')).toBe(false);
});

test('password recovery uses the original modal and retains the non-enumerating service response', async () => {
  stubFetch({ '/api/auth/password/forgot': { status: 200, json: {} } });
  const outlet = boot();
  await renderRoute(outlet, '#/forgot-password');
  expect(outlet.querySelector('[role="dialog"]')).not.toBeNull();
  const email = outlet.querySelector<HTMLInputElement>('#forgot-email');
  if (email === null) throw new Error('Recovery email missing');
  email.value = 'a@b.co';
  await submit(outlet);
  expect(outlet.textContent).toContain('If the address is registered');
  expect(seen.find(call => call.url === '/api/auth/password/forgot')?.body).toEqual({ email: 'a@b.co' });
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

test('a successful server-validated login retains the requested app destination', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } }, '/api/auth/login': { status: 200, json: { tenantId: 't', expiresAt: '2030-01-01T00:00:00.000Z' } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login?return=%2Fapp%2Fprojects%2Fnew%3Ftemplate%3Dbugfix-run');
  (document.getElementById('login-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('login-password') as HTMLInputElement).value = 'long-enough-password';
  await submit(outlet);
  expect(window.location.hash).toBe('#/app/projects/new?template=bugfix-run');
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

test('register uses the reference dialog with accessible password visibility and public dismissal', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  const dialog = outlet.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog?.getAttribute('aria-modal')).toBe('true');
  expect(dialog?.getAttribute('aria-labelledby')).toBe('register-title');
  expect(document.activeElement).toBe(dialog);
  expect(outlet.querySelector<HTMLElement>('.register-backdrop')?.inert).toBe(true);
  expect(outlet.querySelector('.fresh-auth-story')).toBeNull();
  expect(outlet.querySelector('input[autocomplete="name"]')).toBeNull();
  expect(outlet.querySelector<HTMLButtonElement>('.github-auth')?.disabled).toBe(true);
  expect(outlet.querySelector('.github-auth')?.textContent).toContain('unavailable');
  const toggle = outlet.querySelector<HTMLButtonElement>('[aria-controls="reg-password"]');
  toggle?.click();
  expect(outlet.querySelector<HTMLInputElement>('#reg-password')?.type).toBe('text');
  expect(toggle?.getAttribute('aria-label')).toBe('Hide password');
  toggle?.click();
  expect(outlet.querySelector<HTMLInputElement>('#reg-password')?.type).toBe('password');
  const last = dialog?.querySelector<HTMLAnchorElement>('.auth-switch a');
  last?.focus();
  last?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close registration');
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(window.location.hash).toBe('#/p/');
});

test('register retains the backend password bounds and never sends an invalid password', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  registerInput(outlet, 'reg-email').value = 'a@b.co';
  for (const value of ['123456789', 'x'.repeat(129)]) {
    registerInput(outlet, 'reg-password').value = value;
    registerInput(outlet, 'reg-confirm').value = value;
    await submit(outlet);
    expect(outlet.querySelector('#reg-password-error')?.textContent).toContain('10 and 128');
    expect(document.activeElement?.id).toBe('reg-password');
  }
  expect(seen.some(call => call.url === '/api/auth/register')).toBe(false);
});

test('register preserves the exact API payload, actionable service error, retry and verification destination', async () => {
  stubFetch({ '/api/auth/register': { status: 503, json: { ok: false, error: { code: 'auth_unavailable', message: 'Account services need a database.' } } } });
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  registerInput(outlet, 'reg-email').value = ' a@b.co ';
  registerInput(outlet, 'reg-password').value = 'long-enough-password';
  registerInput(outlet, 'reg-confirm').value = 'long-enough-password';
  await submit(outlet);
  expect(seen.find(call => call.url === '/api/auth/register')?.body).toEqual({ email: 'a@b.co', password: 'long-enough-password' });
  expect(outlet.querySelector('[role="alert"]')?.textContent).toContain('need a database');
  expect(outlet.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  expect(window.location.hash).not.toContain('check-email');
  stubFetch({ '/api/auth/register': { status: 201, json: { userId: 'user-1' } } });
  await submit(outlet);
  expect(window.location.hash).toBe('#/check-email?email=a%40b.co');
  expect(window.localStorage.length).toBe(0);
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

test('an incomplete reset remains an actionable error inside the original account composition', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/reset-password');
  expect(outlet.querySelector('.fresh-auth-shell')).not.toBeNull();
  expect(outlet.textContent).toContain('no token');
  expect(outlet.querySelector('button[type="submit"]')).toBeNull();
});

test('create-org without a ticket explains the recovery path', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/create-org');
  expect(outlet.textContent).toContain('single-use ticket');
});
