import { afterEach, expect, test } from 'vitest';

import { h } from './components.js';
import { currentRouteEpoch, isCurrentRouteEpoch, registerRoute, renderRoute } from './routes.js';

afterEach(() => {
  document.body.replaceChildren();
});

test('shared polish follows public/auth/workspace boundaries without changing route destinations', async () => {
  const shell = h('div', { id: 'shell' }); document.body.append(shell);
  const outlet = outletWithAnnouncer(); shell.append(outlet);
  for (const path of ['/p/guides', '/login', '/projects']) registerRoute({ path, title: path, render: host => { host.append(h('h1', {}, [path])); } });
  await renderRoute(outlet, '#/login');
  expect(document.body.classList.contains('auth-refined')).toBe(true);
  expect(shell.classList.contains('workspace-refined')).toBe(false);
  await renderRoute(outlet, '#/projects');
  expect(document.body.classList.contains('auth-refined')).toBe(false);
  expect(shell.classList.contains('workspace-refined')).toBe(true);
  expect(shell.dataset['workspacePage']).toBe('/projects');
  await renderRoute(outlet, '#/p/guides');
  expect(shell.classList.contains('workspace-refined')).toBe(false);
  expect(shell.dataset['workspacePage']).toBe('');
});

test('public errors retain a page heading and a return to the public landing', async () => {
  const outlet = outletWithAnnouncer();
  await renderRoute(outlet, '#/p/missing-design-screen');
  expect(outlet.querySelector('h1')?.textContent).toBe('Page not found');
  expect(outlet.querySelector('a')?.getAttribute('href')).toBe('#/p/');
});

test('documented /app return targets and run resource links resolve to their actual screens', async () => {
  const outlet = outletWithAnnouncer();
  registerRoute({ path: '/projects/new', title: 'Connect project', render: (host, ctx) => { host.textContent = `Project ${ctx.params.get('template') ?? ''}`; } });
  registerRoute({ path: '/run', title: 'Run', render: (host, ctx) => { host.textContent = `Run ${ctx.params.get('id') ?? ''}`; } });
  registerRoute({ path: '/runs/new', title: 'New run', render: host => { host.textContent = 'New run form'; } });
  await renderRoute(outlet, '#/app/projects/new?template=bugfix-run');
  expect(outlet.textContent).toBe('Project bugfix-run');
  await renderRoute(outlet, '#/runs/run-1');
  expect(outlet.textContent).toBe('Run run-1');
  await renderRoute(outlet, '#/runs/new');
  expect(outlet.textContent).toBe('New run form');
});

function outletWithAnnouncer(): HTMLElement {
  const announcer = document.createElement('p');
  announcer.id = 'announcer';
  const outlet = document.createElement('main');
  outlet.id = 'content';
  outlet.tabIndex = -1;
  document.body.append(announcer, outlet);
  return outlet;
}

test('a superseded render leaves nav, announcement, and focus to the newer route', async () => {
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  registerRoute({
    path: '/slow-t44',
    title: 'Slow page',
    render: (outlet) => {
      outlet.replaceChildren(h('h1', {}, ['Slow page']));
      return slowGate;
    },
  });
  registerRoute({
    path: '/fast-t44',
    title: 'Fast page',
    render: (outlet) => {
      outlet.replaceChildren(h('h1', {}, ['Fast page']));
    },
  });
  const outlet = outletWithAnnouncer();
  const slow = renderRoute(outlet, '#/slow-t44');
  await renderRoute(outlet, '#/fast-t44');
  releaseSlow();
  await slow;
  expect(document.getElementById('announcer')?.textContent).toBe('Loaded: Fast page.');
  expect(document.activeElement?.textContent).toBe('Fast page');
});

test('epoch helpers track the latest render', async () => {
  registerRoute({
    path: '/epoch-t44',
    title: 'Epoch',
    render: (outlet) => {
      outlet.textContent = 'Epoch';
    },
  });
  const outlet = outletWithAnnouncer();
  await renderRoute(outlet, '#/epoch-t44');
  const seen = currentRouteEpoch();
  expect(isCurrentRouteEpoch(seen)).toBe(true);
  expect(isCurrentRouteEpoch(seen - 1)).toBe(false);
});

test('the default entry opens the public site while an explicit workspace link stays in the workspace', async () => {
  registerRoute({ path: '/p/', title: 'Public', render: (outlet) => { outlet.append(h('h1', {}, ['Public'])); } });
  registerRoute({ path: '/', title: 'Workspace', render: (outlet) => { outlet.append(h('h1', {}, ['Workspace'])); } });
  const outlet = outletWithAnnouncer();
  await renderRoute(outlet, '');
  expect(outlet.querySelector('h1')?.textContent).toBe('Public');
  expect(document.body.classList.contains('public-surface')).toBe(true);
  await renderRoute(outlet, '#/');
  expect(outlet.querySelector('h1')?.textContent).toBe('Workspace');
  expect(document.body.classList.contains('public-surface')).toBe(false);
});

test('malformed query encoding does not crash navigation', async () => {
  registerRoute({ path: '/readable-query', title: 'Readable', render: (outlet) => { outlet.append(h('h1', {}, ['Readable'])); } });
  const outlet = outletWithAnnouncer();
  await expect(renderRoute(outlet, '#/readable-query?q=%E0%A4%A')).resolves.toBeUndefined();
  expect(outlet.querySelector('h1')?.textContent).toBe('Readable');
});

test('a missing public deep link returns to the public landing, not the workspace', async () => {
  const outlet = outletWithAnnouncer();
  await renderRoute(outlet, '#/p/missing-public-screen');
  expect(outlet.querySelector('a')?.getAttribute('href')).toBe('#/p/');
  expect(document.body.classList.contains('public-surface')).toBe(true);
});
