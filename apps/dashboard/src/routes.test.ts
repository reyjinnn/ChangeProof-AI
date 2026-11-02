import { afterEach, expect, test } from 'vitest';

import { h } from './components.js';
import { currentRouteEpoch, isCurrentRouteEpoch, registerRoute, renderRoute } from './routes.js';

afterEach(() => {
  document.body.replaceChildren();
});

function outletWithAnnouncer(): HTMLElement {
  const announcer = document.createElement('p');
  announcer.id = 'announcer';
  const outlet = document.createElement('main');
  outlet.id = 'outlet';
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
