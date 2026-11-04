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

test('the pricing composition has working original CTA destinations', async () => {
  stubFetch({ '/api/site/routes?path=%2Fpricing': { status: 200, json: PRICING } });
  const outlet = boot();
  await renderRoute(outlet, '#/p/pricing');
  expect(outlet.querySelector('h1')?.textContent).toBe('Start small. Stay in control.');
  expect(outlet.querySelector('.public-price-feature a')?.getAttribute('href')).toBe('#/register');
  expect(outlet.querySelector('a[href="#/p/product"]')).not.toBeNull();
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

test('a late public content response cannot replace the page the user navigated to', async () => {
  let release!: (value: Response) => void;
  globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
  const outlet = boot();
  const pending = renderRoute(outlet, '#/p/pricing');
  registerRoute({ path: '/newer-ui', title: 'Newer', render: (host) => { host.textContent = 'Newer page'; } });
  await renderRoute(outlet, '#/newer-ui');
  release(new Response(JSON.stringify({ ok: true, data: PRICING }), { status: 200 }));
  await pending;
  expect(outlet.textContent).toBe('Newer page');
});

test('the architecture walkthrough supports arrow-key tab navigation', async () => {
  const home: PublicRoute = { path: '/', title: 'ChangeProof AI', summary: 'Product preview.', section: 'product', ctas: [] };
  stubFetch({ '/api/site/routes?path=%2F': { status: 200, json: home } });
  registerPublicPages([home], [], []);
  const outlet = boot();
  await renderRoute(outlet, '#/p/');
  const tabs = [...outlet.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  tabs[0]?.focus();
  tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
  expect(tabs[1]?.tabIndex).toBe(0);
  expect(tabs[0]?.tabIndex).toBe(-1);
  expect(document.activeElement).toBe(tabs[1]);
  expect(outlet.querySelector('[role="tablist"]')?.getAttribute('aria-orientation')).toBe('vertical');
  tabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tabs[2]);
  tabs[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tabs[1]);
  tabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tabs[0]);
  tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tabs.at(-1));
});

test('the landing keeps the reference hero, two real CTAs and technology identities without claiming a live connection', async () => {
  const home: PublicRoute = { path: '/', title: 'ChangeProof AI', summary: 'Product preview.', section: 'product', ctas: [] };
  stubFetch({ '/api/site/routes?path=%2F': { status: 200, json: home } });
  registerPublicPages([home], [], []);
  const outlet = boot();
  await renderRoute(outlet, '#/p/');
  expect(outlet.querySelector('h1')?.textContent).toBe('Every change.One proof.');
  expect(outlet.querySelector('h1 mark')?.textContent).toBe('proof.');
  expect(outlet.querySelector('.reyn-design .public-nav')).not.toBeNull();
  expect([...outlet.querySelectorAll('.cp-identity-hero .modern-cta-pair a')].map(a => a.getAttribute('href'))).toEqual(['#/p/pricing', '#/register']);
  expect(outlet.querySelectorAll('.cp-tech-group:not([aria-hidden]) img')).toHaveLength(9);
  expect(outlet.textContent).not.toContain('GitHub connected. Evidence collected.');
  expect(outlet.textContent).toContain('Muse and Modal are unavailable in this demo');
});

test('How it works has a registered public deep link with the intended verification content', async () => {
  stubFetch({ '/api/site/routes?path=%2Fverification': { status: 200, json: { path: '/verification', title: 'Verification', summary: 'Independent checks.', section: 'product', ctas: [] } } });
  registerPublicPages([], [], []);
  const outlet = boot();
  await renderRoute(outlet, '#/p/how-it-works');
  expect(outlet.textContent).not.toContain('Page not found');
  expect(outlet.textContent).toContain('Check independently');
});

test('the landing contains every original section in order and exactly three workflow steps', async () => {
  const home: PublicRoute = { path: '/', title: 'ChangeProof AI', summary: 'Preview.', section: 'product', ctas: [] };
  stubFetch({ '/api/site/routes?path=%2F': { status: 200, json: home } });
  registerPublicPages([home], [], []);
  const outlet = boot();
  await renderRoute(outlet, '#/p/');
  expect(outlet.querySelectorAll('[role="tab"]')).toHaveLength(3);
  const sections = [...outlet.querySelectorAll('.proof-story, .cp-capabilities, .pricing-section, .final-cta')];
  expect(sections.map(section => section.querySelector('h2')?.textContent.replace(/\s+/g, ' '))).toEqual([
    'Follow the change.See the proof.',
    'A workflow worthopening up.',
    'Start small.Stay in control.',
    'Ready to verifyyour changes?',
  ]);
  expect(outlet.querySelector('.cp-workflow-front')).not.toBeNull();
  const folder = outlet.querySelector<HTMLButtonElement>('.cp-workflow-front');
  folder?.click();
  expect(folder?.getAttribute('aria-expanded')).toBe('true');
  outlet.querySelector<HTMLButtonElement>('[data-cp-area="0"]')?.click();
  expect(outlet.querySelector<HTMLElement>('#cp-workflow-area-0')?.hidden).toBe(false);
  expect(outlet.querySelector('.footer-col')).not.toBeNull();
  for (const link of outlet.querySelectorAll('a[href^="#"]')) expect(link.getAttribute('href')).toMatch(/^#\//);
});

test('Product retains its four feature areas and dedicated preview', async () => {
  const product: PublicRoute = { path: '/product', title: 'Product', summary: 'Product.', section: 'product', ctas: [] };
  stubFetch({ '/api/site/routes?path=%2Fproduct': { status: 200, json: product } });
  registerPublicPages([product], [], []);
  const outlet = boot();
  await renderRoute(outlet, '#/p/product');
  expect(outlet.querySelector('h1')?.textContent).toBe('Clear changes. Confident decisions.');
  expect(outlet.querySelector('.landing-pilot')).toBeNull();
  for (const title of ['Understand the impact', 'Check the candidate', 'Review the evidence', 'Bring context to your team', 'Evidence at every step.']) expect(outlet.textContent).toContain(title);
});

test('the Landing pilot keeps its graph explicitly illustrative and its original workflow controls', async () => {
  const home: PublicRoute = { path: '/', title: 'ChangeProof AI', summary: 'Preview.', section: 'product', ctas: [] };
  stubFetch({ '/api/site/routes?path=%2F': { status: 200, json: home } });
  registerPublicPages([home], [], []);
  const outlet = boot();
  await renderRoute(outlet, '#/p/');
  expect(outlet.querySelector('.landing-pilot')).not.toBeNull();
  expect(outlet.querySelector('[data-pilot-graph]')?.textContent).toContain('Illustrative');
  expect(outlet.querySelectorAll('[role="tab"]')).toHaveLength(3);
  expect(outlet.textContent).toContain('An unresolved edge stays visible');
  expect(outlet.textContent).toContain('Muse and Modal are unavailable');
});

test('the illustrative verification panel numbers every check and separates incomplete proof from its step', async () => {
  const home: PublicRoute = { path: '/', title: 'ChangeProof AI', summary: 'Preview.', section: 'product', ctas: [] };
  stubFetch({ '/api/site/routes?path=%2F': { status: 200, json: home } });
  registerPublicPages([home], [], []);
  const outlet = boot();
  await renderRoute(outlet, '#/p/');
  const rows = [...outlet.querySelectorAll('.pilot-evidence-row')];
  expect(rows.map(row => row.querySelector('.pilot-evidence-step')?.textContent)).toEqual(['01', '02', '03']);
  expect(rows[2]?.querySelector('.pilot-evidence-state')?.textContent).toContain('Incomplete');
  expect(rows[2]?.getAttribute('data-proof-state')).toBe('incomplete');
  expect(rows.slice(0, 2).every(row => row.getAttribute('data-proof-state') === 'required')).toBe(true);
  expect(rows.map(row => row.textContent).join(' ')).not.toMatch(/passed|verified successfully/i);
  expect(outlet.querySelector('.pilot-evidence-checks')?.tagName).toBe('OL');
  expect(outlet.textContent).toContain('not live AI repair evidence');
});

test('Landing exposes the real Workspace Overview route without guessing authentication or replacing existing CTAs', async () => {
  const home: PublicRoute = { path: '/', title: 'ChangeProof AI', summary: 'Preview.', section: 'product', ctas: [] };
  stubFetch({ '/api/site/routes?path=%2F': { status: 200, json: home } });
  registerPublicPages([home], [], []);
  const outlet = boot();
  await renderRoute(outlet, '#/p/');
  const entry = outlet.querySelector<HTMLAnchorElement>('.cp-identity-hero [data-open-workspace]');
  expect(entry?.textContent).toContain('Open workspace');
  expect(entry?.getAttribute('href')).toBe('#/');
  expect(outlet.querySelector('.pilot-public-menu a[href="#/"]')?.textContent).toBe('Open workspace');
  expect(outlet.querySelector('.cp-identity-hero a[href="#/register"]')).not.toBeNull();
  expect(outlet.querySelector('.cp-identity-hero a[href="#/p/pricing"]')).not.toBeNull();
  expect(seen.some(url => url.includes('/api/auth'))).toBe(false);
});

test('Pricing keeps the original free card, budget explanation and three numbered steps without inventing prices', async () => {
  stubFetch({ '/api/site/routes?path=%2Fpricing': { status: 200, json: PRICING } });
  const outlet = boot();
  await renderRoute(outlet, '#/p/pricing');
  expect(outlet.querySelector('h1')?.textContent).toBe('Start small. Stay in control.');
  expect(outlet.textContent).toContain('Free capped tier.');
  expect(outlet.querySelectorAll('.public-steps li')).toHaveLength(3);
  expect(outlet.textContent).toContain('Your budget stays in your control.');
  expect(outlet.textContent).not.toMatch(/\$\d/);
});

test('Product polish keeps feature content but labels its explanatory illustration without fabricated run receipts', async () => {
  stubFetch({ '/api/site/routes?path=%2Fproduct': { status: 200, json: { path: '/product', title: 'Product', summary: 'Product.', section: 'product', ctas: [] } } });
  registerPublicPages([], [], []);
  const outlet = boot(); await renderRoute(outlet, '#/p/product');
  expect(outlet.querySelector('.public-refined')).not.toBeNull();
  expect(outlet.querySelectorAll('[data-feature-index]')).toHaveLength(4);
  const features = [...outlet.querySelectorAll('[data-feature-index]')];
  expect(features.map(feature => feature.querySelector('.feature-number')?.textContent)).toEqual(['01', '02', '03', '04']);
  expect(features.every(feature => feature.querySelector('h2') !== null && feature.querySelector('p') !== null && feature.querySelector('a') !== null)).toBe(true);
  expect(outlet.querySelector('[data-product-illustration]')?.textContent).toContain('Illustrative');
  const sketch = outlet.querySelector('[data-product-illustration]');
  expect(sketch?.querySelector('.contract-diff-header')?.textContent).toContain('Not executed');
  expect(sketch?.querySelectorAll('.diff-line-number')).toHaveLength(4);
  expect(sketch?.querySelector('[data-diff=removed] code')?.textContent).toBe('  id: string;');
  expect(sketch?.querySelector('[data-diff=added] code')?.textContent).toBe('  id: OrderId;');
  expect(sketch?.textContent).toContain('Independent checks must establish its result.');
  expect(sketch?.textContent).not.toMatch(/passed|successfully|execution complete/i);
  expect(outlet.querySelector('.public-product-preview')?.textContent).not.toMatch(/RUN-0142|00:04|NORTHWIND/);
});

test('Pricing polish explains reservation flow without manufacturing an account balance', async () => {
  stubFetch({ '/api/site/routes?path=%2Fpricing': { status: 200, json: PRICING } });
  registerPublicPages([], [], []); const outlet = boot(); await renderRoute(outlet, '#/p/pricing');
  expect(outlet.querySelector('[data-budget-concepts]')?.getAttribute('aria-label')).toContain('not an account balance');
  expect(outlet.querySelectorAll('.public-price-details .public-steps li')).toHaveLength(3);
  expect(outlet.querySelector('[data-budget-concepts]')?.textContent).not.toMatch(/\$|\d+ credits/);
});

test('Changelog keeps design notes separate from releases and gives each entry its own date/title/body', async () => {
  stubFetch({
    '/api/site/routes?path=%2Fchangelog': { status: 200, json: { path: '/changelog', title: 'Product notes', summary: 'Published notes.', section: 'product', ctas: [] } },
    '/api/site/changelog': { status: 200, json: { design: [
      { title: 'Plan revision 2', body: 'A specification note, not a shipped release.', date: '2026-10-24' },
      { title: 'Public site draft', body: 'An illustrative content draft.', date: '2026-11-02' },
    ], releases: [] } },
  });
  registerPublicPages([], [], []);
  const outlet = boot(); await renderRoute(outlet, '#/p/changelog');
  const groups = [...outlet.querySelectorAll('.public-release')];
  expect(groups.map(group => group.querySelector('h2')?.textContent)).toEqual(['Design notes', 'Releases']);
  const entries = [...(groups[0]?.querySelectorAll('.release-entry') ?? [])];
  expect(entries.map(entry => [...entry.children].map(child => child.tagName))).toEqual([['TIME', 'H3', 'P'], ['TIME', 'H3', 'P']]);
  expect(entries.map(entry => entry.querySelector('time')?.getAttribute('datetime'))).toEqual(['2026-10-24', '2026-11-02']);
  expect(entries.map(entry => entry.querySelector('h3')?.textContent)).toEqual(['Plan revision 2', 'Public site draft']);
  expect(groups[1]?.textContent).toContain('Nothing published here yet.');
  expect(groups[1]?.querySelector('.release-entry')).toBeNull();
});
