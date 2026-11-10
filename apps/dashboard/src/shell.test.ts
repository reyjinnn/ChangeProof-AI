import { afterEach, beforeEach, expect, test } from 'vitest';

import { refreshShell, renderShell, shellModeFor } from './shell.js';
import { parseHash, registerRoute, renderRoute } from './routes.js';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset['theme'] = 'light';
});

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
  window.localStorage.clear();
});

function boot(): void {
  const app = document.createElement('div');
  document.body.appendChild(app);
  renderShell(app);
}

test('parseHash splits path and query without guessing', () => {
  expect(parseHash('#/runs/abc?cursor=3')).toEqual({ path: '/runs/abc', params: new Map([['cursor', '3']]) });
  expect(parseHash('')).toEqual({ path: '/', params: new Map() });
  expect(parseHash('#')).toEqual({ path: '/', params: new Map() });
});

test('shell renders landmarks, skip link, portals, and announcer', () => {
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  expect(document.body.classList.contains('modern-design')).toBe(true);
  expect(document.querySelector('.skip-link')?.getAttribute('href')).toBe('#outlet');
  expect(document.querySelector('nav[aria-label="Primary"]')).not.toBeNull();
  // Mockup nesting (main#outlet > #content): the landmark carries the id
  // for skip-link/focus while the outlet carries the page rules.
  expect(document.querySelector('main#outlet > div#content')).toBe(outlet);
  expect(outlet.parentElement?.tagName).toBe('MAIN');
  const publicNav = document.getElementById('publicNav');
  const publicFooter = document.getElementById('publicFooter');
  if (publicNav === null || publicFooter === null) throw new Error('Public chrome landmarks are missing.');
  expect(publicNav.compareDocumentPosition(outlet) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(outlet.compareDocumentPosition(publicFooter) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  for (const id of ['drawerRoot', 'modalRoot', 'notificationRoot', 'accountRoot', 'sidebarTooltipRoot', 'toast']) {
    expect(document.getElementById(id), id).not.toBeNull();
  }
  expect(document.getElementById('toast')?.getAttribute('role')).toBe('status');
  expect(document.getElementById('announcer')?.getAttribute('aria-live')).toBe('polite');
});

test('sidebar has brand row, three nav groups, and org foot (mockup order, no meter)', () => {
  boot();
  expect(document.querySelector('.side-brand-row .brand')).not.toBeNull();
  expect(document.getElementById('menuClose')).not.toBeNull();
  expect(document.querySelector('.sidebar-collapse[data-modern="sidebar-toggle"]')).not.toBeNull();
  expect([...document.querySelectorAll('#nav .nav-section')].map((el) => el.textContent)).toEqual([
    'WORKSPACE',
    'ORGANIZATION',
    'RESOURCES',
  ]);
  expect(document.querySelector('#nav a[href="#/dashboard"]')).not.toBeNull();
  expect(document.querySelector('#nav a[href="#/runs"]')).not.toBeNull();
  expect(document.querySelector('#nav a[href="#/settings"]')).not.toBeNull();
  expect(document.getElementById('planMeter')).toBeNull();
  expect(document.querySelector('#nav a[href="#/audit"]')?.textContent).toContain('Activity log');
  expect(document.querySelector('#nav a[href="#/repositories"]')?.textContent).toContain('GitHub connections');
  expect(document.querySelector('#nav a[href="#/new-run"]')).toBeNull();
  expect(document.querySelector('.sidebar-foot .organization')).not.toBeNull();
  expect(document.getElementById('orgLabel')).not.toBeNull();
});

test('sidebar brand uses the product mark', () => {
  boot();
  const brand = document.querySelector('.side-brand-row .brand');
  expect(brand?.querySelector('.cp-brandmark svg')?.getAttribute('viewBox')).toBe('0 0 64 64');
  expect(brand?.querySelector('.brandmark')).toBeNull();
  expect(document.getElementById('planMeter')).toBeNull();



});

test('topbar has context capsule and profile capsule controls', () => {
  boot();
  expect(document.getElementById('topSection')).not.toBeNull();
  expect(document.querySelector('.top-context .context-parent')?.textContent).toContain('Workspace');
  expect(document.querySelector('.search-trigger kbd')).not.toBeNull();
  expect(document.querySelector('.header-help')).not.toBeNull();
  expect(document.querySelector('[data-modern="notifications"]')).not.toBeNull();
  expect(document.getElementById('notificationDot')).not.toBeNull();
  expect(document.querySelector('.theme-toggle')).not.toBeNull();
  expect(document.querySelector('.top-avatar .avatar-circle')).not.toBeNull();
  expect(document.querySelector('.top-avatar .avatar-label')).not.toBeNull();
});

test('theme toggle flips the theme and persists it', () => {
  boot();
  const toggle = document.querySelector('.theme-toggle');
  if (!(toggle instanceof HTMLButtonElement)) throw new Error('Theme toggle is missing.');
  toggle.click();
  expect(document.documentElement.dataset['theme']).toBe('dark');
  expect(window.localStorage.getItem('changeproof-modern-theme')).toBe('dark');
  expect(toggle.getAttribute('aria-label')).toBe('Switch to light mode');
});

test('sidebar collapse persists across renders', () => {
  boot();
  const collapse = document.querySelector('.sidebar-collapse');
  if (!(collapse instanceof HTMLButtonElement)) throw new Error('Collapse button is missing.');
  collapse.click();
  expect(document.body.classList.contains('is-collapsed')).toBe(true);
  expect(window.localStorage.getItem('changeproof-sidebar-collapsed')).toBe('1');
});

test('Escape closes floating panels', () => {
  boot();
  const bell = document.querySelector('[data-modern="notifications"]');
  if (!(bell instanceof HTMLButtonElement)) throw new Error('Notifications button is missing.');
  bell.click();
  expect(document.querySelector('.notification-stack')).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.querySelector('.notification-stack')).toBeNull();
});

test('shell modes follow the route', () => {
  expect(shellModeFor('/')).toBe('public');
  expect(shellModeFor('/pricing')).toBe('public');
  expect(shellModeFor('/p/sample')).toBe('public');
  expect(shellModeFor('/login')).toBe('auth');
  expect(shellModeFor('/register')).toBe('auth');
  expect(shellModeFor('/dashboard')).toBe('workspace');
  expect(shellModeFor('/runs')).toBe('workspace');
});

test('refreshShell toggles public, landing, and auth classes', () => {
  boot();
  refreshShell('/pricing');
  expect(document.body.classList.contains('public-website')).toBe(true);
  expect(document.body.classList.contains('clarity-landing')).toBe(false);
  expect(document.getElementById('sidebar')?.hasAttribute('hidden')).toBe(true);
  refreshShell('/');
  expect(document.body.classList.contains('clarity-landing')).toBe(true);
  refreshShell('/login');
  expect(document.body.classList.contains('auth-page')).toBe(true);
  expect(document.body.classList.contains('public-website')).toBe(false);
  refreshShell('/runs');
  expect(document.body.classList.contains('public-website')).toBe(false);
  expect(document.body.classList.contains('auth-page')).toBe(false);
  expect(document.getElementById('sidebar')?.hasAttribute('hidden')).toBe(false);
  expect(document.querySelector('#content .app-footnote')).not.toBeNull();
});

test('unknown hash renders not-found, never a blank outlet', async () => {
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  await renderRoute(outlet, '#/nope');
  expect(outlet.textContent).toContain('Page not found');
  expect(outlet.querySelector('a[href="#/"]')).not.toBeNull();
});

test('route render announces, titles, and focuses the heading', async () => {
  registerRoute({
    path: '/probe-focus',
    title: 'Probe',
    render: (outlet) => {
      const heading = document.createElement('h1');
      heading.textContent = 'Probe page';
      outlet.appendChild(heading);
    },
  });
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  await renderRoute(outlet, '#/probe-focus');
  expect(document.title).toBe('Probe — ChangeProof AI');
  expect(document.getElementById('announcer')?.textContent).toBe('Loaded: Probe.');
  expect(document.activeElement?.textContent).toBe('Probe page');
});

test('following a navigation link also resets the mobile trigger state', async () => {
  registerRoute({ path: '/drawer-destination', title: 'Destination', render: (outlet) => { outlet.textContent = 'Destination'; } });
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  const menu = document.querySelector<HTMLButtonElement>('.menu-button');
  menu?.click();
  expect(menu?.getAttribute('aria-expanded')).toBe('true');
  await renderRoute(outlet, '#/drawer-destination');
  expect(menu?.getAttribute('aria-expanded')).toBe('false');
  expect(document.body.classList.contains('nav-open')).toBe(false);
});
