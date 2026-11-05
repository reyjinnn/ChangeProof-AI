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

afterEach(async () => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
  // Reset the remembered modal backdrop deterministically: flush any queued
  // native hashchange first, then record /landing through the real listener.
  window.location.hash = '#/landing';
  window.dispatchEvent(new Event('hashchange'));
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
});

function boot(): HTMLElement {
  registerAuthPages();
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

async function submit(): Promise<void> {
  document.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

async function waitFor(text: string): Promise<void> {
  for (let i = 0; i < 40 && !document.body.textContent.includes(text); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The open signin dialog; modal forms live here, not in the outlet. */
function modal(): HTMLElement {
  return required(document.querySelector<HTMLElement>('.signin-dialog'));
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected element to exist');
  return value;
}

test('login validates empty fields and focuses the first problem', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  expect(modal().querySelector('#signinTitle')?.textContent).toBe('ChangeProof AI sign in');
  await submit();
  expect(modal().querySelector('#login-email-error')?.textContent).toContain('email address');
  expect(document.activeElement?.id).toBe('login-email');
  expect(seen.some((call) => call.url === '/api/auth/login')).toBe(false);
  expect(outlet.hasAttribute('inert')).toBe(true);
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
  await submit();
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
  await submit();
  const login = seen.find((call) => call.url === '/api/auth/login');
  expect(login?.body).not.toHaveProperty('returnTarget');
});

test('github login reports its unavailable state honestly', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  await waitFor('GitHub login');
  expect(modal().textContent).toContain('no authorized GitHub OAuth App');
  expect(modal().querySelector('a[href*="github"]')).toBeNull();
  expect(modal().querySelector('button[type="submit"]')?.textContent).toBe('Sign in →');
});

test('register rejects a short password without a request', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  expect(document.getElementById('reg-confirm')).not.toBeNull();
  (document.getElementById('reg-name') as HTMLInputElement).value = 'Ada Lovelace';
  (document.getElementById('reg-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('reg-password') as HTMLInputElement).value = 'short';
  (document.getElementById('reg-confirm') as HTMLInputElement).value = 'short';
  (document.getElementById('reg-terms') as HTMLInputElement).checked = true;
  await submit();
  expect(modal().querySelector('#reg-password-error')?.textContent).toContain('between 10 and 128');
  expect(document.activeElement?.id).toBe('reg-password');
  expect(seen.some((call) => call.url === '/api/auth/register')).toBe(false);
  expect(outlet.hasAttribute('inert')).toBe(true);
});

test('register blocks a mismatched confirmation without a request', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  (document.getElementById('reg-name') as HTMLInputElement).value = 'Ada Lovelace';
  (document.getElementById('reg-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('reg-password') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reg-confirm') as HTMLInputElement).value = 'different-password';
  (document.getElementById('reg-terms') as HTMLInputElement).checked = true;
  await submit();
  expect(modal().querySelector('#reg-confirm-error')?.textContent).toContain('do not match');
  expect(document.activeElement?.id).toBe('reg-confirm');
  expect(seen.some((call) => call.url === '/api/auth/register')).toBe(false);
  expect(outlet.hasAttribute('inert')).toBe(true);
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

test('login floats over the backdrop as a labelled dialog', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  registerRoute({
    path: '/landing',
    title: 'Landing',
    render: (target) => {
      target.replaceChildren(document.createTextNode('Backdrop page'));
    },
  });
  await renderRoute(outlet, '#/login');
  const overlay = required(document.querySelector('.signin-overlay'));
  expect(overlay.getAttribute('data-route')).toBe('/login');
  expect(outlet.textContent).toContain('Backdrop page');
  expect(outlet.hasAttribute('inert')).toBe(true);
  expect(document.body.classList.contains('signin-modal-route')).toBe(true);
  const dialog = modal();
  expect(dialog.tagName).toBe('SECTION');
  expect(dialog.getAttribute('role')).toBe('dialog');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.getAttribute('aria-labelledby')).toBe('signinTitle');
  expect(dialog.querySelector('.signin-close')?.getAttribute('aria-label')).toBe('Close sign in');
  expect(dialog.querySelector('#signinTitle')?.textContent).toBe('ChangeProof AI sign in');
  expect(dialog.querySelector('.signin-brand-mark svg')).not.toBeNull();
  expect(dialog.querySelector('#freshLoginForm')).not.toBeNull();
  expect(dialog.querySelector('.password-wrap #login-password')).not.toBeNull();
  expect((document.getElementById('login-email') as HTMLInputElement).placeholder).toBe('name@company.com');
  expect((document.getElementById('login-password') as HTMLInputElement).placeholder).toBe('Enter your password');
  const toggle = required(dialog.querySelector<HTMLButtonElement>('button.password-toggle'));
  expect(toggle.getAttribute('aria-label')).toBe('Show password');
  expect((document.getElementById('login-password') as HTMLInputElement).type).toBe('password');
  toggle.click();
  expect((document.getElementById('login-password') as HTMLInputElement).type).toBe('text');
  expect(toggle.getAttribute('aria-label')).toBe('Hide password');
  expect(dialog.querySelector('.auth-form-options label')?.textContent).toContain('Remember me');
  expect(dialog.querySelector('.auth-form-options a[href="#/forgot-password"]')).not.toBeNull();
  expect(dialog.querySelector('.auth-divider')?.textContent).toBe('OR');
  expect(dialog.querySelector('.auth-switch a[href="#/register"]')?.textContent).toBe('Sign up now');
  expect(dialog.querySelector('button[type="submit"]')?.textContent).toBe('Sign in →');
});

test('signin dialog closes by button, backdrop press, and Escape', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  required(document.querySelector<HTMLButtonElement>('.signin-close')).click();
  expect(document.querySelector('.signin-overlay')).toBeNull();
  expect(document.body.classList.contains('signin-modal-route')).toBe(false);
  expect(outlet.hasAttribute('inert')).toBe(false);
  expect(window.location.hash).toBe('#/landing');

  await renderRoute(outlet, '#/register');
  expect(document.querySelector('.signin-overlay')?.getAttribute('data-route')).toBe('/register');
  required(document.querySelector('.signin-overlay')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(document.querySelector('.signin-overlay')).toBeNull();
  expect(window.location.hash).toBe('#/landing');

  await renderRoute(outlet, '#/forgot-password');
  expect(document.querySelector('.signin-overlay')?.getAttribute('data-route')).toBe('/forgot-password');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('.signin-overlay')).toBeNull();
  expect(window.location.hash).toBe('#/landing');
});

test('signin dialog remembers the last public backdrop', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  registerRoute({
    path: '/pricing',
    title: 'Pricing',
    render: (target) => {
      target.replaceChildren(document.createTextNode('Pricing backdrop'));
    },
  });
  window.location.hash = '#/pricing';
  window.dispatchEvent(new Event('hashchange'));
  await renderRoute(outlet, '#/login');
  expect(outlet.textContent).toContain('Pricing backdrop');
  required(document.querySelector<HTMLButtonElement>('.signin-close')).click();
  expect(window.location.hash).toBe('#/pricing');
});

test('login still shows the GitHub note when the backdrop renders slowly', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  registerRoute({
    path: '/landing',
    title: 'Landing',
    render: async (target) => {
      await gate;
      target.replaceChildren(document.createTextNode('Slow backdrop'));
    },
  });
  const rendering = renderRoute(outlet, '#/login');
  // Let the providers lookup resolve while the backdrop is still pending.
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  await rendering;
  await waitFor('GitHub login');
  expect(outlet.textContent).toContain('Slow backdrop');
  expect(modal().textContent).toContain('no authorized GitHub OAuth App');
});

test('login surfaces server failures in #authError and restores the button', async () => {
  stubFetch({
    '/api/auth/providers': { status: 200, json: { email: true, github: false } },
    '/api/auth/login': {
      status: 401,
      json: { ok: false, error: { code: 'invalid_credentials', message: 'Invalid email or password.' } },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  (document.getElementById('login-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('login-password') as HTMLInputElement).value = 'long-enough-password';
  await submit();
  const box = required(modal().querySelector<HTMLElement>('#authError'));
  expect(box.hidden).toBe(false);
  expect(box.textContent).toContain('Invalid email or password.');
  const submitButton = required(modal().querySelector<HTMLButtonElement>('button[type="submit"]'));
  expect(submitButton.textContent).toBe('Sign in →');
  expect(submitButton.disabled).toBe(false);
});

test('login shows the GitHub button only when the server advertises it', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: true } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login');
  await waitFor('Continue with GitHub');
  const button = required(modal().querySelector<HTMLButtonElement>('button.github-auth'));
  expect(button.textContent).toContain('Continue with GitHub');
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  button.click();
  expect(assign).toHaveBeenCalledWith('/api/auth/github/start?origin=login');
});

test('login passes tenant and remember-me hints to the GitHub start', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: true } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login?tenant=acme');
  await waitFor('Continue with GitHub');
  (document.getElementById('login-remember') as HTMLInputElement).checked = true;
  const button = required(modal().querySelector<HTMLButtonElement>('button.github-auth'));
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  button.click();
  expect(assign).toHaveBeenCalledWith('/api/auth/github/start?origin=login&tenant=acme&remember=1');
});

test('login surfaces a GitHub callback failure without a request', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: true } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login?githubError=email_taken');
  const box = required(modal().querySelector<HTMLElement>('#authError'));
  expect(box.hidden).toBe(false);
  expect(box.textContent).toContain('already has a password account');
  expect(seen.some((call) => call.url === '/api/auth/login')).toBe(false);
});

test('login reveals the organization field on a choose-tenant callback', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: true } } });
  const outlet = boot();
  await renderRoute(outlet, '#/login?githubError=choose_tenant');
  await waitFor('several organizations');
  expect((document.getElementById('login-tenant') as HTMLInputElement).style.display).not.toBe('none');
});

test('register surfaces a GitHub callback failure and starts with its origin', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: true } } });
  const outlet = boot();
  await renderRoute(outlet, '#/register?githubError=provider_error');
  const box = required(modal().querySelector<HTMLElement>('#authError'));
  expect(box.hidden).toBe(false);
  expect(box.textContent).toContain('could not be reached');
  await waitFor('Continue with GitHub');
  const button = required(modal().querySelector<HTMLButtonElement>('button.github-auth'));
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  button.click();
  expect(assign).toHaveBeenCalledWith('/api/auth/github/start?origin=register');
});

test('register renders name and terms, then posts only the strict server body', async () => {
  stubFetch({
    '/api/auth/providers': { status: 200, json: { email: true, github: false } },
    '/api/auth/register': { status: 201, json: { userId: 'user-1' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  expect(modal().querySelector('#freshRegisterForm')).not.toBeNull();
  expect(modal().querySelector('#reg-name')).not.toBeNull();
  expect(modal().querySelector('#reg-password-hint')?.textContent).toContain('10 and 128');
  expect(modal().querySelector('.terms-check a[href="#/terms"]')).not.toBeNull();
  expect(modal().querySelector('.terms-check a[href="#/privacy"]')).not.toBeNull();
  expect(modal().querySelector('.auth-switch a[href="#/login"]')?.textContent).toBe('Sign in');
  expect(modal().querySelector('button[type="submit"]')?.textContent).toBe('Create account →');
  (document.getElementById('reg-name') as HTMLInputElement).value = 'Ada Lovelace';
  (document.getElementById('reg-email') as HTMLInputElement).value = 'ada@example.co';
  (document.getElementById('reg-password') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reg-confirm') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reg-terms') as HTMLInputElement).checked = true;
  await submit();
  const call = seen.find((entry) => entry.url === '/api/auth/register');
  expect(call?.body).toEqual({ email: 'ada@example.co', password: 'long-enough-password' });
  expect(window.location.hash.startsWith('#/check-email?email=ada%40example.co')).toBe(true);
  expect(window.location.hash).toContain('name=Ada%20Lovelace');
});

test('register requires a full name and focuses it', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  (document.getElementById('reg-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('reg-password') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reg-confirm') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reg-terms') as HTMLInputElement).checked = true;
  await submit();
  expect(modal().querySelector('#reg-name-error')?.textContent).toContain('full name');
  expect(document.activeElement?.id).toBe('reg-name');
  expect(seen.some((call) => call.url === '/api/auth/register')).toBe(false);
});

test('register blocks submit until terms are accepted', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/register');
  (document.getElementById('reg-name') as HTMLInputElement).value = 'Ada Lovelace';
  (document.getElementById('reg-email') as HTMLInputElement).value = 'a@b.co';
  (document.getElementById('reg-password') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reg-confirm') as HTMLInputElement).value = 'long-enough-password';
  await submit();
  expect(required(modal().querySelector<HTMLElement>('#authError')).hidden).toBe(false);
  expect(modal().querySelector('#authError')?.textContent).toContain('Terms of Use');
  expect(seen.some((call) => call.url === '/api/auth/register')).toBe(false);
});

test('forgot-password sends a reset mail and shows a success notice', async () => {
  stubFetch({ '/api/auth/password/forgot': { status: 200, json: {} } });
  const outlet = boot();
  await renderRoute(outlet, '#/forgot-password');
  expect(modal().querySelector('.auth-success-icon')).not.toBeNull();
  expect(modal().querySelector('.mini-label')?.textContent).toBe("LET'S GET YOU BACK IN");
  expect(modal().querySelector('h1')?.textContent).toBe('Forgot password?');
  expect(modal().querySelector('h1')?.getAttribute('id')).toBe('signinTitle');
  expect((document.getElementById('forgot-email') as HTMLInputElement).placeholder).toBe('name@company.com');
  expect(modal().querySelector('button[type="submit"]')?.textContent).toBe('Send reset link →');
  (document.getElementById('forgot-email') as HTMLInputElement).value = 'a@b.co';
  await submit();
  expect(modal().querySelector('.success-notice')?.textContent).toContain('reset mail is on its way');
  expect(seen.find((call) => call.url === '/api/auth/password/forgot')?.body).toEqual({ email: 'a@b.co' });
  expect(modal().querySelector('.auth-back[href="#/login"]')?.textContent).toContain('Back to sign in');
  expect(outlet.hasAttribute('inert')).toBe(true);
});

test('forgot-password validates empty email without a request', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/forgot-password');
  await submit();
  expect(modal().querySelector('#forgot-email-error')?.textContent).toContain('email address');
  expect(seen.some((call) => call.url === '/api/auth/password/forgot')).toBe(false);
  expect(outlet.hasAttribute('inert')).toBe(true);
});

test('check-email tags the address and resends without an input', async () => {
  stubFetch({ '/api/auth/verify/resend': { status: 200, json: {} } });
  const outlet = boot();
  await renderRoute(outlet, '#/check-email?email=a%40b.co&name=Ada');
  expect(document.querySelector('.signin-overlay')?.getAttribute('data-route')).toBe('/check-email');
  expect(modal().querySelector('.auth-email-tag')?.textContent).toBe('a@b.co');
  expect(modal().textContent).toContain('Thanks, Ada.');
  expect(modal().querySelector('#resend-email')).toBeNull();
  expect(modal().querySelector('.auth-back[href="#/login"]')?.textContent).toContain('Back to sign in');
  required(modal().querySelector<HTMLButtonElement>('button.resend-email')).click();
  await waitFor('fresh verification mail is on its way');
  expect(seen.find((call) => call.url === '/api/auth/verify/resend')?.body).toEqual({ email: 'a@b.co' });
});

test('check-email renders hostile query text as text, not markup', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/check-email?email=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  expect(modal().querySelector('img')).toBeNull();
  expect(modal().querySelector('.auth-email-tag')?.textContent).toContain('<img src=x onerror=alert(1)>');
});

test('check-email without an address keeps the resend form', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/check-email');
  expect(modal().querySelector('#resend-email')).not.toBeNull();
  await submit();
  expect(modal().querySelector('#resend-email-error')?.textContent).toContain('email address');
  expect(seen.some((call) => call.url === '/api/auth/verify/resend')).toBe(false);
  expect(outlet.hasAttribute('inert')).toBe(true);
});

test('reset-password mismatch shows #authError without a request', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/reset-password?token=tok');
  expect(outlet.querySelector('#freshResetForm')).not.toBeNull();
  (document.getElementById('reset-password') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reset-confirm') as HTMLInputElement).value = 'different-password';
  await submit();
  expect(required(outlet.querySelector<HTMLElement>('#authError')).hidden).toBe(false);
  expect(outlet.querySelector('#authError')?.textContent).toContain('do not match');
  expect((document.getElementById('reset-confirm') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  expect(seen.some((call) => call.url === '/api/auth/password/reset')).toBe(false);
});

test('reset-password alias #/recover renders the same form and succeeds', async () => {
  stubFetch({ '/api/auth/password/reset': { status: 200, json: {} } });
  const outlet = boot();
  await renderRoute(outlet, '#/recover?token=tok');
  expect(outlet.querySelector('#freshResetForm')).not.toBeNull();
  (document.getElementById('reset-password') as HTMLInputElement).value = 'long-enough-password';
  (document.getElementById('reset-confirm') as HTMLInputElement).value = 'long-enough-password';
  await submit();
  await waitFor('Password changed');
  expect(outlet.querySelector('a[href="#/login"]')).not.toBeNull();
  expect(seen.find((call) => call.url === '/api/auth/password/reset')?.body).toEqual({
    token: 'tok',
    newPassword: 'long-enough-password',
  });
});

test('verify alias #/verify mints a ticket for #/orgs/claim', async () => {
  stubFetch({ '/api/auth/verify': { status: 200, json: { claimTicket: 'ticket-alias' } } });
  const outlet = boot();
  await renderRoute(outlet, '#/verify?token=tok');
  await waitFor('Email verified');
  expect(outlet.querySelector('.success-notice')).not.toBeNull();
  await renderRoute(outlet, '#/orgs/claim');
  expect(outlet.querySelector('#orgForm')).not.toBeNull();
  expect(outlet.querySelector('#org-slug')).not.toBeNull();
});

test('create-org renders the stepper and posts only slug plus ticket', async () => {
  stubFetch({
    '/api/auth/verify': { status: 200, json: { claimTicket: 'ticket-9' } },
    '/api/orgs': { status: 201, json: { tenantId: 'acme' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/verify-email?token=tok');
  await waitFor('Email verified');
  await renderRoute(outlet, '#/create-org');
  expect(outlet.querySelector('nav.stepper a.active[href="#create-org"]')).not.toBeNull();
  expect(outlet.textContent).toContain('Tenant boundary');
  (document.getElementById('org-name') as HTMLInputElement).value = 'Acme Corp';
  (document.getElementById('org-slug') as HTMLInputElement).value = 'acme';
  await submit();
  expect(seen.find((call) => call.url === '/api/orgs')?.body).toEqual({ tenantId: 'acme', ticket: 'ticket-9' });
  await waitFor('Organization created');
  expect(outlet.textContent).toContain('Acme Corp (acme)');
  expect(outlet.querySelector('a[href="#/login?tenant=acme"]')).not.toBeNull();
});

test('onboarding shows permissions and an honest blocked state without fake repos', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/onboarding');
  expect(outlet.querySelector('nav.stepper a.active[href="#onboarding"]')).not.toBeNull();
  expect(outlet.textContent).toContain('Permissions requested');
  expect(outlet.textContent).toContain('Pull requests');
  await waitFor('not connected yet');
  expect(outlet.querySelectorAll('.repo-choice').length).toBe(0);
  expect(outlet.querySelector('.github-auth')).toBeNull();
  expect(outlet.textContent).toContain('Security note');
});

test('onboarding recheck keeps sign-in out of the install step', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/onboarding');
  await waitFor('Check again');
  // Sign-in alone never unlocks repository selection: no install button.
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: true, githubApp: false } } });
  const recheck = required([...outlet.querySelectorAll('button')].find((button) => button.textContent === 'Check again'));
  recheck.click();
  await waitFor('not connected yet');
  expect(outlet.querySelector('button.github-auth')).toBeNull();
});

test('onboarding names the missing selection API when the App connects', async () => {
  stubFetch({ '/api/auth/providers': { status: 200, json: { email: true, github: true, githubApp: true } } });
  const outlet = boot();
  await renderRoute(outlet, '#/onboarding');
  await waitFor('not exposed by the API yet');
  expect(outlet.querySelectorAll('.repo-choice').length).toBe(0);
});

test('new-project prompts for login when unauthenticated', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/new-project');
  await waitFor('Login is required');
  expect(outlet.querySelector('nav.stepper a.active[href="#new-project"]')).not.toBeNull();
  expect(outlet.querySelector('#projectForm')).toBeNull();
  expect(outlet.querySelector('.card.permission-block a[href="#/login"]')).not.toBeNull();
  expect(seen.some((call) => call.url === '/api/projects')).toBe(false);
});

test('new-project renders the form and posts only the strict server body', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: { authenticated: true } },
    '/api/projects': { status: 201, json: { projectId: 'project-9', name: 'Northwind' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/new-project');
  await waitFor('Initial readiness');
  expect(outlet.querySelector('#projectForm')).not.toBeNull();
  expect(outlet.querySelector('#project-description')).not.toBeNull();
  (document.getElementById('project-name') as HTMLInputElement).value = 'Northwind';
  (document.getElementById('project-description') as HTMLInputElement).value = 'Order flow';
  (document.getElementById('project-consent') as HTMLInputElement).checked = true;
  await submit();
  expect(seen.find((call) => call.url === '/api/projects')?.body).toEqual({ name: 'Northwind' });
  await waitFor('Project created');
  expect(outlet.textContent).toContain('Northwind — Order flow');
  expect(outlet.querySelector('a[href="#/runs/new"]')).not.toBeNull();
});

test('new-project validates name and consent without requests', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: true } } });
  const outlet = boot();
  await renderRoute(outlet, '#/new-project');
  await waitFor('Initial readiness');
  await submit();
  expect(outlet.querySelector('#project-name-error')?.textContent).toContain('Name your project');
  (document.getElementById('project-name') as HTMLInputElement).value = 'Northwind';
  await submit();
  expect(outlet.querySelector('#authError')?.textContent).toContain('data permission');
  expect(seen.some((call) => call.url === '/api/projects')).toBe(false);
});

test('invite renders a permission block and accepts for signed-in users', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: { authenticated: true } },
    '/api/invitations/accept': { status: 200, json: { tenantId: 'acme', role: 'member' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/invite?token=tok');
  await waitFor('Invitation accepted');
  expect(outlet.querySelector('.card.permission-block')).not.toBeNull();
  expect(outlet.querySelector('.inset')?.textContent).toContain('acme');
  expect(seen.find((call) => call.url === '/api/invitations/accept')?.body).toEqual({ token: 'tok' });
  expect(outlet.querySelector('a[href="#/login?tenant=acme"]')).not.toBeNull();
});

test('invite prompts for login when unauthenticated', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/invite?token=tok');
  await waitFor('Log in to accept');
  expect(outlet.querySelector('.card.permission-block')).not.toBeNull();
  expect(seen.some((call) => call.url === '/api/invitations/accept')).toBe(false);
});

test('invite alias #/invitations/accept shares the same states', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/invitations/accept');
  expect(outlet.textContent).toContain('no token');
});

test('access-denied renders a permission block with real actions', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/access-denied');
  expect(outlet.querySelector('.card.permission-block h1')?.textContent).toBe('Access not available yet.');
  expect(outlet.querySelector('.card.permission-block .stat-icon')).not.toBeNull();
  expect(outlet.querySelector('a[href="#/runs"]')).not.toBeNull();
  expect(outlet.querySelector('a[href="#/team"]')).not.toBeNull();
});

test('session-expired renders a permission block with a sign-in action', async () => {
  stubFetch({});
  const outlet = boot();
  await renderRoute(outlet, '#/session-expired');
  expect(outlet.querySelector('.card.permission-block h1')?.textContent).toBe('Session expired');
  expect(outlet.querySelector('.card.permission-block a[href="#/login"]')).not.toBeNull();
});

test('auth flows never touch localStorage', async () => {
  stubFetch({ '/api/auth/verify': { status: 200, json: { claimTicket: 'ticket-mem' } } });
  const outlet = boot();
  await renderRoute(outlet, '#/verify-email?token=tok');
  await waitFor('Email verified');
  await renderRoute(outlet, '#/create-org');
  expect(outlet.querySelector('#org-slug')).not.toBeNull();
  expect(window.localStorage.length).toBe(0);
});
