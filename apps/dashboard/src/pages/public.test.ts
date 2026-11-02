import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { PublicRoute } from '../../../../src/core/contracts/schemas/publicsite.js';

import { renderRoute, registerRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { classifyDestination, registerPublicPages, validateReturnTarget } from './public.js';

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
      new Response(JSON.stringify(hit.status === 200 ? { ok: true, data: hit.json } : hit.json), {
        status: hit.status,
      }),
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

test('CTA destinations classify to in-app hashes or outside links', () => {
  expect(classifyDestination('/pricing', 'public')).toEqual({ kind: 'public', hash: '#/p/pricing' });
  expect(classifyDestination('/app', 'requires-login')).toEqual({ kind: 'login', hash: '#/login?return=%2Fapp' });
  expect(classifyDestination('https://example.com/x', 'public')).toEqual({
    kind: 'external',
    url: 'https://example.com/x',
  });
});

test('return targets admit same-app paths only', () => {
  expect(validateReturnTarget('/app/projects/new?template=x')).toEqual({
    valid: true,
    target: '/app/projects/new?template=x',
  });
  expect(validateReturnTarget('/app').valid).toBe(true);
  for (const evil of [undefined, '', 'https://evil.example/', 'javascript:alert(1)', '/etc/passwd', '/app x']) {
    expect(validateReturnTarget(evil).valid, String(evil)).toBe(false);
  }
});

const PRICING: PublicRoute = {
  path: '/pricing',
  title: 'Pricing',
  summary: 'Plans and versions.',
  section: 'product',
  ctas: [
    { label: 'Start', destination: '/', kind: 'public' },
    { label: 'Workspace', destination: '/app', kind: 'requires-login' },
  ],
};

const HELP: PublicRoute = { path: '/help', title: 'Help', summary: 'Help.', section: 'docs', ctas: [] };

function boot(): HTMLElement {
  registerPublicPages([PRICING], [], []);
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

test('generic page renders title, summary, and working CTA hrefs', async () => {
  stubFetch({ '/api/site/routes?path=%2Fpricing': { status: 200, json: PRICING } });
  const outlet = boot();
  await renderRoute(outlet, '#/p/pricing');
  expect(outlet.querySelector('h1')?.textContent).toBe('Pricing');
  const hrefs = [...outlet.querySelectorAll('.cta-row a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual(['#/p/', '#/login?return=%2Fapp']);
});

test('template apply refusal lands on the login notice with its return', async () => {
  const template = {
    id: 'bugfix-run',
    title: 'Bug fix run',
    description: 'Fix one failure.',
    requiresLogin: true,
    fields: [{ name: 'intent', label: 'What should change', help: 'One sentence.' }],
  };
  stubFetch({
    '/api/site/templates/bugfix-run': { status: 200, json: template },
    '/api/site/templates/bugfix-run/apply': {
      status: 401,
      json: {
        ok: false,
        error: { code: 'login_required', message: 'Login first.' },
        gate: { applied: false, requiresLogin: true, loginThenReturnTo: '/app/projects/new?template=bugfix-run' },
      },
    },
  });
  registerPublicPages([], ['bugfix-run'], []);
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  await renderRoute(outlet, '#/p/templates/bugfix-run');
  expect(outlet.querySelector('h1')?.textContent).toBe('Bug fix run');
  const apply = outlet.querySelector('.button.primary');
  if (!(apply instanceof HTMLButtonElement)) throw new Error('Apply button is missing.');
  apply.click();
  for (let i = 0; i < 10 && !window.location.hash.startsWith('#/login'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(window.location.hash).toBe('#/login?return=%2Fapp%2Fprojects%2Fnew%3Ftemplate%3Dbugfix-run');
});

test('login notice echoes validated destinations as text, never links', async () => {
  registerPublicPages([], [], []);
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  await renderRoute(outlet, '#/login?return=%2Fapp%2Fx');
  expect(outlet.textContent).toContain('/app/x');
  expect(outlet.querySelector('a[href="/app/x"]')).toBeNull();
  await renderRoute(outlet, '#/login?return=https%3A%2F%2Fevil.example%2F');
  expect(outlet.textContent).not.toContain('evil.example');
  expect(outlet.textContent).toContain('This step needs a login.');
});

test('empty FAQ search fails on the field without a request', async () => {
  stubFetch({
    '/api/site/routes?path=%2Fhelp': {
      status: 200,
      json: { path: '/help', title: 'Help', summary: 'Help.', section: 'docs', ctas: [] },
    },
    '/api/site/faqs': { status: 200, json: [] },
  });
  registerPublicPages([HELP], [], []);
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  await renderRoute(outlet, '#/p/help');
  const form = outlet.querySelector('form[role="search"]');
  expect(form).not.toBeNull();
  form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  expect(outlet.querySelector('.error-text')?.textContent).toContain('at least one word');
  expect(seen.some((url) => url.includes('/api/site/faq?'))).toBe(false);
});
