import { afterEach, beforeEach, expect, test } from 'vitest';

import { renderShell } from './shell.js';
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

test('parseHash splits path and query without guessing', () => {
  expect(parseHash('#/runs/abc?cursor=3')).toEqual({ path: '/runs/abc', params: new Map([['cursor', '3']]) });
  expect(parseHash('')).toEqual({ path: '/', params: new Map() });
  expect(parseHash('#')).toEqual({ path: '/', params: new Map() });
});

test('shell renders landmarks, skip link, and announcer', () => {
  const app = document.createElement('div');
  document.body.appendChild(app);
  const { outlet } = renderShell(app);
  expect(document.querySelector('.skip-link')?.getAttribute('href')).toBe('#outlet');
  expect(document.querySelector('nav[aria-label="Primary"]')).not.toBeNull();
  expect(document.querySelector('main#outlet')).toBe(outlet);
  expect(document.getElementById('announcer')?.getAttribute('aria-live')).toBe('polite');
});

function needTopbarButton(fragment: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('.topbar button')].find((b) => b.textContent.includes(fragment));
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Topbar button "${fragment}" is missing.`);
  return found;
}

test('theme toggle flips the theme and persists it', () => {
  const app = document.createElement('div');
  document.body.appendChild(app);
  renderShell(app);
  const toggle = needTopbarButton('mode');
  toggle.click();
  expect(document.documentElement.dataset['theme']).toBe('dark');
  expect(window.localStorage.getItem('changeproof-modern-theme')).toBe('dark');
  expect(toggle.textContent).toBe('Light mode');
});

test('sidebar collapse persists across renders', () => {
  const app = document.createElement('div');
  document.body.appendChild(app);
  renderShell(app);
  const collapse = needTopbarButton('sidebar');
  collapse.click();
  expect(document.body.classList.contains('sidebar-collapsed')).toBe(true);
  expect(window.localStorage.getItem('changeproof-sidebar-collapsed')).toBe('1');
});

test('Escape closes the mobile drawer and returns focus to the menu', () => {
  const app = document.createElement('div');
  document.body.appendChild(app);
  renderShell(app);
  const menu = document.querySelector('.menu-button');
  if (!(menu instanceof HTMLButtonElement)) throw new Error('Menu button is missing.');
  menu.click();
  expect(document.body.classList.contains('nav-open')).toBe(true);
  expect(menu.getAttribute('aria-expanded')).toBe('true');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.body.classList.contains('nav-open')).toBe(false);
  expect(document.activeElement).toBe(menu);
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
