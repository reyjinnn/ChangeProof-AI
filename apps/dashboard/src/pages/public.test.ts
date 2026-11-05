import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { PublicRoute } from '../../../../src/core/contracts/schemas/publicsite.js';

import { renderRoute, registerRoute, routePaths } from '../routes.js';
import { renderShell } from '../shell.js';
import { renderPublicChrome } from './public-chrome.js';
import { classifyDestination, registerPublicPages, validateReturnTarget } from './public.js';

const realFetch = globalThis.fetch;
const seen: string[] = [];
const posted: { url: string; body: unknown }[] = [];

function stubFetch(routes: Record<string, { status: number; json: unknown }>): void {
  seen.length = 0;
  posted.length = 0;
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
    seen.push(url);
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    if (init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new Error('Stub fetch expects string bodies.');
      posted.push({ url: path, body: JSON.parse(init.body) as unknown });
    }
    const hit = routes[path];
    if (hit === undefined) return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(hit.status === 200 || hit.status === 201 ? { ok: true, data: hit.json } : hit.json), {
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

function bootFixed(): HTMLElement {
  registerPublicPages([], [], []);
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

test('generic page renders title, summary, and working CTA hrefs', async () => {
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

test('public module does not own /login (auth does)', async () => {
  stubFetch({});
  registerPublicPages([], [], []);
  expect(routePaths()).not.toContain('/login');
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  await renderRoute(outlet, '#/login');
  expect(outlet.textContent).toContain('Page not found');
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

/* --- Public chrome (Progress UI 3). --- */

const FIXED_PATHS = [
  '/',
  '/landing',
  '/product',
  '/how-it-works',
  '/pricing',
  '/documentation',
  '/security',
  '/enterprise',
  '/self-hosted',
  '/templates',
  '/integrations',
  '/sample-report',
  '/status',
  '/changelog',
  '/roadmap',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
];

test('all fixed public routes are registered', () => {
  stubFetch({});
  registerPublicPages([], [], []);
  for (const path of FIXED_PATHS) expect(routePaths(), path).toContain(path);
});

test('chrome fills public nav and footer on public routes', async () => {
  stubFetch({});
  const outlet = bootFixed();
  await renderRoute(outlet, '#/product');
  const nav = document.getElementById('publicNav');
  expect(nav?.querySelector('.public-brand')?.textContent).toContain('ChangeProof');
  const labels = [...(nav?.querySelectorAll('.public-links a') ?? [])].map((a) => a.textContent);
  expect(labels).toEqual(['Product', 'Pricing', 'Documentation', 'Sign in', 'Get started free']);
  expect(nav?.querySelector('.nav-product')?.getAttribute('href')).toBe('#/product');
  expect(nav?.querySelector('.nav-price')?.getAttribute('href')).toBe('#/pricing');
  expect(nav?.querySelector('.nav-documentation')?.getAttribute('href')).toBe('#/guides');
  expect(nav?.querySelector('.public-brand svg')).not.toBeNull();
  expect(nav?.querySelector('.public-login')?.getAttribute('href')).toBe('#/login');
  expect(nav?.querySelector('.public-links .primary')?.getAttribute('href')).toBe('#/register');
  expect(nav?.querySelector('.public-links .primary svg')).not.toBeNull();
  expect(outlet.querySelector('.preview-brand svg')?.getAttribute('viewBox')).toBe('0 0 64 64');
  expect(nav?.querySelector('[data-evidence="theme"]')).not.toBeNull();
  const footer = document.getElementById('publicFooter');
  expect(footer?.querySelectorAll('.footer-col').length).toBe(4);
  expect(footer?.querySelector('.footer-follow')).not.toBeNull();
  expect(footer?.querySelector('.footer-legal')?.textContent).toContain('© 2026 ChangeProof AI');
  expect(footer?.querySelector('.footer-wordmark')?.textContent).toBe('ChangeProof');
  for (const anchor of footer?.querySelectorAll('.footer-col a') ?? []) {
    expect(anchor.getAttribute('href')).toMatch(/^#\//);
  }
});

test('theme toggle flips dataset theme and persists the choice', async () => {
  stubFetch({});
  const outlet = bootFixed();
  await renderRoute(outlet, '#/product');
  renderPublicChrome();
  document.documentElement.dataset['theme'] = 'light';
  renderPublicChrome();
  const toggle = document.querySelector('#publicNav [data-evidence="theme"]');
  if (!(toggle instanceof HTMLButtonElement)) throw new Error('Theme toggle is missing.');
  toggle.click();
  expect(document.documentElement.dataset['theme']).toBe('dark');
  expect(window.localStorage.getItem('changeproof-modern-theme')).toBe('dark');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
});

/* --- Landing page. --- */

const PRICING_SNAPSHOT = {
  pricingVersion: '2026-11-01',
  currency: 'USD',
  tiers: [
    { id: 'free', name: 'Free capped tier', notes: 'Start with visible limits.' },
    { id: 'team', name: 'Team', notes: 'Shared budgets and review.' },
  ],
};

test('landing renders hero, orbits, tech strip, and final CTA', async () => {
  stubFetch({ '/api/site/pricing': { status: 200, json: PRICING_SNAPSHOT } });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/');
  const hero = outlet.querySelector('.cp-identity-hero');
  expect(hero).not.toBeNull();
  expect(hero?.querySelector('canvas.cp-ghost-fibers')).not.toBeNull();
  expect(hero?.querySelector('.cp-ghost-shade')).not.toBeNull();
  expect(hero?.querySelectorAll('.hero-orbit').length).toBe(2);
  expect(hero?.querySelector('.modern-release')).not.toBeNull();
  expect(hero?.querySelector('h1')?.textContent).toContain('Every change.');
  expect(hero?.querySelector('h1')?.textContent).toContain('One proof.');
  expect(hero?.querySelectorAll('h1 mark').length).toBe(1);
  expect(hero?.querySelector('h1 mark')?.textContent).toBe('proof.');
  expect(hero?.querySelector('.modern-cta-pair .primary')?.textContent).toBe('Get started free');
  expect(hero?.querySelector('.modern-hero-sub')).not.toBeNull();
  const ctaHrefs = [...(hero?.querySelectorAll('.modern-cta-pair a') ?? [])].map((a) => a.getAttribute('href'));
  expect(ctaHrefs).toEqual(['#/dashboard', '#/register']);
  expect(outlet.querySelector('.cp-workflow-logo svg')?.getAttribute('viewBox')).toBe('0 0 64 64');
  const logos = outlet.querySelectorAll('.cp-tech-strip .cp-tech-logo');
  expect(logos.length).toBe(16);
  const names = [...logos].map((logo) => logo.textContent);
  expect(names).not.toContain('Java');
  for (const logo of logos) {
    const img = logo.querySelector('.cp-tech-mark img');
    expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(img?.getAttribute('alt')).toBe('');
  }
  expect(outlet.querySelector('.cp-tech-mark.cp-tech-github img')).not.toBeNull();
  expect(outlet.querySelector('.final-cta')).not.toBeNull();
  expect(outlet.querySelector('.final-cta .modern-cta-pair .primary')?.getAttribute('href')).toBe('#/register');
});

test('#/landing renders the same landing page', async () => {
  stubFetch({ '/api/site/pricing': { status: 200, json: PRICING_SNAPSHOT } });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/landing');
  expect(outlet.querySelector('.cp-identity-hero')).not.toBeNull();
  expect(outlet.querySelector('.proof-story')).not.toBeNull();
  expect(outlet.querySelector('#capability-folders')).not.toBeNull();
});

test('proof story tabs switch panels with click and arrow keys', async () => {
  stubFetch({ '/api/site/pricing': { status: 200, json: PRICING_SNAPSHOT } });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/landing');
  const tabs = [...outlet.querySelectorAll('[data-proof-tab]')];
  expect(tabs.length).toBe(3);
  const candidate = outlet.querySelector('[data-proof-tab="candidate"]');
  if (!(candidate instanceof HTMLButtonElement)) throw new Error('Candidate tab is missing.');
  candidate.click();
  expect(candidate.getAttribute('aria-selected')).toBe('true');
  expect(outlet.querySelector('[data-proof-panel="candidate"]')?.hasAttribute('hidden')).toBe(false);
  expect(outlet.querySelector('[data-proof-panel="impact"]')?.hasAttribute('hidden')).toBe(true);
  candidate.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(outlet.querySelector('[data-proof-tab="evidence"]')?.getAttribute('aria-selected')).toBe('true');
  expect(outlet.querySelector('[data-proof-panel="evidence"]')?.hasAttribute('hidden')).toBe(false);
});

test('capability folder sheets open areas and Escape closes', async () => {
  stubFetch({ '/api/site/pricing': { status: 200, json: PRICING_SNAPSHOT } });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/landing');
  const folder = outlet.querySelector('.cp-workflow-folder');
  expect(folder).not.toBeNull();
  expect(outlet.querySelectorAll('[data-cp-area]').length).toBe(4);
  const sheet = outlet.querySelector('[data-cp-area="1"]');
  if (!(sheet instanceof HTMLButtonElement)) throw new Error('Repair sheet is missing.');
  sheet.click();
  expect(folder?.classList.contains('is-open')).toBe(true);
  expect(outlet.querySelector('#cp-workflow-area-1')?.hasAttribute('hidden')).toBe(false);
  expect(outlet.querySelector('#cp-workflow-area-0')?.hasAttribute('hidden')).toBe(true);
  expect(outlet.querySelector('.cp-capability-flap')?.getAttribute('aria-label')).toContain('REPAIR');
  sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(folder?.classList.contains('is-open')).toBe(false);
});

test('landing pricing cards come from the API snapshot', async () => {
  stubFetch({ '/api/site/pricing': { status: 200, json: PRICING_SNAPSHOT } });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/landing');
  const cards = outlet.querySelectorAll('.pricing-section .price-card');
  expect(cards.length).toBe(2);
  expect(cards[0]?.querySelector('h3')?.textContent).toBe('Free capped tier');
  expect(outlet.querySelector('.pricing-section')?.textContent).toContain('2026-11-01');
});

test('landing survives pricing outages with an honest note', async () => {
  stubFetch({});
  const outlet = bootFixed();
  await renderRoute(outlet, '#/landing');
  expect(outlet.querySelector('.cp-identity-hero')).not.toBeNull();
  expect(outlet.querySelector('.pricing-section')?.textContent).toContain('unavailable right now');
});

test('final CTA later button stays honest without navigating', async () => {
  stubFetch({ '/api/site/pricing': { status: 200, json: PRICING_SNAPSHOT } });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/landing');
  const later = outlet.querySelector('.final-cta [data-evidence="later"]');
  if (!(later instanceof HTMLButtonElement)) throw new Error('Later button is missing.');
  later.click();
  expect(outlet.querySelector('.final-cta p')?.textContent).toContain("When you're ready");
});

/* --- Fixed sub-pages. --- */

test('product page uses the public shell with breadcrumb, grid, note, related', async () => {
  stubFetch({});
  const outlet = bootFixed();
  await renderRoute(outlet, '#/product');
  const page = outlet.querySelector('.public-page > .modern-container');
  expect(page).not.toBeNull();
  expect(outlet.querySelector('.public-breadcrumb')?.textContent).toContain('Home');
  expect(outlet.querySelector('.public-page-hero h1')).not.toBeNull();
  expect(outlet.querySelectorAll('.public-info-grid .public-info-card').length).toBeGreaterThan(0);
  expect(outlet.querySelector('.public-note')).not.toBeNull();
  expect(outlet.querySelector('.public-related')).not.toBeNull();
});

test('every fixed page renders a hero and resolving related links', async () => {
  stubFetch({
    '/api/site/pricing': { status: 200, json: PRICING_SNAPSHOT },
    '/api/site/faqs': { status: 200, json: [] },
    '/api/site/templates': { status: 200, json: [] },
    '/api/site/samples': { status: 200, json: [] },
    '/api/health': { status: 200, json: { status: 'ok', service: 'changeproof', contentVersion: 'v1' } },
    '/api/site/changelog': { status: 200, json: { design: [], releases: [] } },
    '/api/site/roadmap': { status: 200, json: [] },
  });
  const outlet = bootFixed();
  const paths = routePaths();
  for (const path of FIXED_PATHS) {
    if (path === '/' || path === '/landing') continue;
    await renderRoute(outlet, `#${path}`);
    expect(outlet.querySelector('h1'), path).not.toBeNull();
    const related = [...outlet.querySelectorAll('.public-related a')].map((a) => a.getAttribute('href'));
    expect(related.length, path).toBeGreaterThan(0);
    for (const href of related) {
      expect(href, `${path} -> ${href}`).toMatch(/^#\//);
      expect(paths, `${path} -> ${href}`).toContain((href ?? '').slice(1));
    }
  }
});

test('pricing page renders API tiers as text, never markup', async () => {
  stubFetch({
    '/api/site/pricing': {
      status: 200,
      json: {
        pricingVersion: 'v9',
        currency: 'USD',
        tiers: [{ id: 'x', name: '<img src=x onerror=alert(1)>', notes: '<b>bold</b> notes' }],
      },
    },
  });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/pricing');
  expect(outlet.querySelector('img')).toBeNull();
  expect(outlet.querySelector('b')).toBeNull();
  expect(outlet.querySelector('.public-info-card h2')?.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(outlet.querySelector('.public-info-card p')?.textContent).toBe('<b>bold</b> notes');
});

test('contact form posts a ticket and reports its id', async () => {
  stubFetch({
    '/api/support/tickets': {
      status: 201,
      json: { ticketId: 'ticket-9', status: 'open', category: 'question', summary: 'Hi', context: 'Help' },
    },
  });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/contact');
  const summary = outlet.querySelector('#contact-summary');
  const context = outlet.querySelector('#contact-context');
  const category = outlet.querySelector('#contact-category');
  if (!(summary instanceof HTMLInputElement) || !(context instanceof HTMLTextAreaElement)) {
    throw new Error('Contact fields are missing.');
  }
  if (!(category instanceof HTMLSelectElement)) throw new Error('Contact category is missing.');
  summary.value = 'Cannot verify a run';
  context.value = 'The status page says ok but runs fail.';
  category.value = 'bug';
  outlet.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20 && posted.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(posted.map((entry) => entry.url)).toContain('/api/support/tickets');
  expect(posted[0]?.body).toEqual({
    category: 'bug',
    summary: 'Cannot verify a run',
    context: 'The status page says ok but runs fail.',
  });
  for (let i = 0; i < 20 && !outlet.textContent.includes('ticket-9'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(outlet.textContent).toContain('ticket-9');
});

test('empty contact submit fails on the form without a request', async () => {
  stubFetch({});
  const outlet = bootFixed();
  await renderRoute(outlet, '#/contact');
  outlet.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  expect(outlet.querySelector('.error-text')?.textContent).toContain('both required');
  expect(posted.length).toBe(0);
});

test('status page shows live health data', async () => {
  stubFetch({
    '/api/health': { status: 200, json: { status: 'ok', service: 'changeproof', contentVersion: '2026-11-03' } },
  });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/status');
  expect(outlet.textContent).toContain('OK');
  expect(outlet.textContent).toContain('2026-11-03');
});

test('changelog keeps releases and design notes separate', async () => {
  stubFetch({
    '/api/site/changelog': {
      status: 200,
      json: {
        releases: [{ date: '2026-10-01', kind: 'release', version: '1.2.0', title: 'Shipped', body: 'Things.' }],
        design: [{ date: '2026-10-02', kind: 'design', title: 'Exploring', body: 'Ideas.' }],
      },
    },
  });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/changelog');
  const entries = outlet.querySelectorAll('.public-release');
  expect(entries.length).toBe(2);
  const eyebrows = [...outlet.querySelectorAll('.public-page-content .section-eyebrow')].map((node) => node.textContent);
  expect(eyebrows).toEqual(['Releases', 'Design notes']);
  expect(outlet.textContent).toContain('1.2.0');
});

test('roadmap renders statuses with evidence refs', async () => {
  stubFetch({
    '/api/site/roadmap': {
      status: 200,
      json: [{ id: 'a', title: 'OpenAPI deltas', status: 'in-qualification', evidenceRef: 'ev-1' }],
    },
  });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/roadmap');
  expect(outlet.querySelector('.public-info-card h2')?.textContent).toBe('OpenAPI deltas');
  expect(outlet.textContent).toContain('in-qualification');
  expect(outlet.textContent).toContain('ev-1');
});

test('templates page lists plans with disclosure details', async () => {
  stubFetch({
    '/api/site/templates': {
      status: 200,
      json: [
        {
          id: 'bugfix-run',
          title: 'Bug fix run',
          description: 'Fix one failure.',
          requiresLogin: true,
          fields: [{ name: 'intent', label: 'Intent', help: 'One sentence.' }],
        },
      ],
    },
  });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/templates');
  expect(outlet.querySelector('.public-info-card h2')?.textContent).toBe('Bug fix run');
  expect(outlet.querySelector('details.public-template-detail summary')?.textContent).toBe('See plan contents');
  expect(outlet.textContent).toContain('One sentence.');
});

test('sample report page links to sample details', async () => {
  stubFetch({
    '/api/site/samples': {
      status: 200,
      json: [
        {
          id: 's1',
          title: 'Order totals',
          summary: 'A totals change.',
          provenance: {
            datasetId: 'demo',
            datasetVersion: '1',
            capturedAt: '2026-01-01',
            synthetic: true,
            source: 'static-sample-dataset',
            label: 'Synthetic sample',
          },
        },
      ],
    },
  });
  registerPublicPages([], [], ['s1']);
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  await renderRoute(outlet, '#/sample-report');
  expect(outlet.querySelector('.public-info-card h2')?.textContent).toBe('Order totals');
  expect(outlet.querySelector('.public-info-card a')?.getAttribute('href')).toBe('#/p/samples/s1');
});

test('documentation FAQ search filters the list live', async () => {
  stubFetch({
    '/api/site/faqs': {
      status: 200,
      json: [
        { id: 'a', question: 'How do budgets work?', answer: 'Caps apply.', topics: ['billing'], updatedAt: '2026-01-01' },
        { id: 'b', question: 'How do retries work?', answer: 'Bounded.', topics: ['runs'], updatedAt: '2026-01-01' },
      ],
    },
  });
  const outlet = bootFixed();
  await renderRoute(outlet, '#/documentation');
  expect(outlet.querySelectorAll('details.public-faq').length).toBe(2);
  const input = outlet.querySelector('[data-public-search="faq"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('FAQ search is missing.');
  input.value = 'budgets';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const items = [...outlet.querySelectorAll('details.public-faq')];
  expect(items.filter((item) => !item.hasAttribute('hidden')).length).toBe(1);
  input.value = 'nothing matches this';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(outlet.querySelector('.public-no-results')?.hasAttribute('hidden')).toBe(false);
});
