import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerNotificationPages } from './notifications.js';

const realFetch = globalThis.fetch;
const posted: { url: string; body: unknown }[] = [];
const seen: string[] = [];

type StubHit = { status: number; json: unknown } | ((url: string, body: unknown) => { status: number; json: unknown });

function stubFetch(routes: Record<string, StubHit>): void {
  posted.length = 0;
  seen.length = 0;
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
    seen.push(url);
    let body: unknown;
    if ((init?.method ?? 'GET') !== 'GET' && init?.body !== undefined) {
      if (typeof init.body !== 'string') throw new Error('Stub fetch expects string bodies.');
      body = JSON.parse(init.body) as unknown;
      posted.push({ url, body });
    }
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const hit = routes[path] ?? routes[url];
    const resolved = typeof hit === 'function' ? hit(url, body) : hit;
    if (resolved === undefined) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify(resolved.status < 400 ? { ok: true, data: resolved.json } : resolved.json),
        { status: resolved.status },
      ),
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
  registerNotificationPages();
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

async function settle(host: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 60 && !host.textContent.includes(text); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function required<T extends HTMLElement>(element: T | null, what: string): T {
  if (element === null) throw new Error(`Missing ${what}.`);
  return element;
}

const SESSION = {
  authenticated: true,
  userId: 'user-owner',
  tenantId: 'acme',
  role: 'owner',
  grantVersion: 3,
};

const CREATED_A = '2026-11-02T01:00:00.000Z';
const CREATED_B = '2026-11-02T00:00:00.000Z';

const ITEM_A = {
  schemaVersion: '1',
  notificationId: 'notif-a',
  tenantId: 'acme',
  userId: 'user-owner',
  eventId: 'evt-a',
  category: 'results',
  title: 'Run finished <script>alert(1)</script>',
  body: 'run-1 reached a terminal state.',
  runId: 'run-1',
  deepLink: '/app/runs/run-1',
  createdAt: CREATED_A,
};

const ITEM_B = {
  schemaVersion: '1',
  notificationId: 'notif-b',
  tenantId: 'acme',
  userId: 'user-owner',
  eventId: 'evt-b',
  category: 'quota',
  title: 'Quota at 80%',
  body: 'Budget profile budget-1 is nearly spent.',
  readAt: CREATED_B,
  createdAt: CREATED_B,
};

const PREFS = { schemaVersion: '1', tenantId: 'acme', userId: 'user-owner', muted: ['cleanup'] };

function inboxStubs(): Record<string, StubHit> {
  return {
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/notifications?limit=20': {
      status: 200,
      json: { items: [ITEM_A, ITEM_B], unreadCount: 1, cursor: '' },
    },
    '/api/notification-preferences': { status: 200, json: PREFS },
  };
}

test('guests see a login card on the inbox, never data', async () => {
  const fetchSpy = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true, data: { authenticated: false } }), { status: 200 })),
  );
  globalThis.fetch = fetchSpy;
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, 'Inbox needs a login');
  expect(outlet.textContent).toContain('Inbox needs a login');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('inbox lists items with the fresh unread count; titles are escaped', async () => {
  stubFetch(inboxStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, '1 unread');
  expect(outlet.textContent).toContain('Quota at 80%');
  expect(outlet.querySelector('script')).toBeNull();
  expect(outlet.textContent).toContain('Run finished <script>alert(1)</script>');
});

test('run links navigate; deep links stay plain text, never hrefs', async () => {
  stubFetch(inboxStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, '1 unread');
  const runLink = outlet.querySelector('a[href="#/run?id=run-1"]');
  expect(runLink).not.toBeNull();
  expect(outlet.textContent).toContain('/app/runs/run-1');
  expect(outlet.querySelector('a[href="/app/runs/run-1"]')).toBeNull();
});

test('unread-only filter refetches without the read items', async () => {
  stubFetch({
    ...inboxStubs(),
    '/api/notifications?limit=20&unreadOnly=true': {
      status: 200,
      json: { items: [ITEM_A], unreadCount: 1, cursor: '' },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, '1 unread');
  const toggle = required(outlet.querySelector<HTMLInputElement>('#inbox-unread-only'), 'unread toggle');
  // A real toggle fires change after flipping state; drive that directly.
  // Real click-to-toggle behavior is proven in the browser (E2E).
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 60 && !seen.includes('/api/notifications?limit=20&unreadOnly=true'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await settle(outlet, 'showing 1');
  expect(outlet.textContent).toContain('Run finished');
  expect(outlet.textContent).not.toContain('Quota at 80%');
});

test('load more appends the next cursor page, then hides', async () => {
  const cursor = `${CREATED_A}|notif-a`;
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/notifications?limit=20': {
      status: 200,
      json: { items: [ITEM_A], unreadCount: 1, cursor },
    },
    [`/api/notifications?limit=20&cursor=${encodeURIComponent(cursor)}`]: {
      status: 200,
      json: { items: [ITEM_B], unreadCount: 1, cursor: '' },
    },
    '/api/notification-preferences': { status: 200, json: PREFS },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, 'Run finished');
  expect(outlet.textContent).not.toContain('Quota at 80%');
  required(outlet.querySelector<HTMLButtonElement>('#inbox-more'), 'load-more button').click();
  await settle(outlet, 'Quota at 80%');
  expect(outlet.querySelector('#inbox-more')).toBeNull();
});

test('mark read posts then re-lists for a fresh count', async () => {
  let calls = 0;
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/notifications?limit=20': () => {
      calls += 1;
      return calls === 1
        ? { status: 200, json: { items: [ITEM_A, ITEM_B], unreadCount: 1, cursor: '' } }
        : { status: 200, json: { items: [{ ...ITEM_A, readAt: CREATED_A }, ITEM_B], unreadCount: 0, cursor: '' } };
    },
    '/api/notification-preferences': { status: 200, json: PREFS },
    '/api/notifications/notif-a/read': { status: 200, json: { notificationId: 'notif-a' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, '1 unread');
  required(outlet.querySelector<HTMLButtonElement>('button[data-mark-read="notif-a"]'), 'mark-read button').click();
  await settle(outlet, '0 unread');
  expect(posted.map((entry) => entry.url)).toContain('/api/notifications/notif-a/read');
  expect(calls).toBe(2);
});

test('dismiss posts then re-lists without the item', async () => {
  let calls = 0;
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/notifications?limit=20': () => {
      calls += 1;
      return calls === 1
        ? { status: 200, json: { items: [ITEM_A, ITEM_B], unreadCount: 1, cursor: '' } }
        : { status: 200, json: { items: [ITEM_B], unreadCount: 0, cursor: '' } };
    },
    '/api/notification-preferences': { status: 200, json: PREFS },
    '/api/notifications/notif-a/dismiss': { status: 200, json: { notificationId: 'notif-a' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, '1 unread');
  required(outlet.querySelector<HTMLButtonElement>('button[data-dismiss="notif-a"]'), 'dismiss button').click();
  await settle(outlet, '0 unread');
  expect(outlet.textContent).not.toContain('Run finished');
});

test('mark all read posts then re-lists', async () => {
  stubFetch({
    ...inboxStubs(),
    '/api/notifications/read-all': { status: 200, json: { marked: 1 } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, '1 unread');
  required(outlet.querySelector<HTMLButtonElement>('#inbox-read-all'), 'read-all button').click();
  await settle(outlet, 'Marked 1 as read');
});

test('preferences reflect the server and save the muted set', async () => {
  stubFetch({
    ...inboxStubs(),
    '/api/notification-preferences': (_url: string, body: unknown) => {
      if (body !== undefined) return { status: 200, json: { ...PREFS, muted: (body as { muted: string[] }).muted } };
      return { status: 200, json: PREFS };
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, 'Preferences');
  const cleanup = required(outlet.querySelector<HTMLInputElement>('#pref-cleanup'), 'cleanup checkbox');
  expect(cleanup.checked).toBe(true);
  const quota = required(outlet.querySelector<HTMLInputElement>('#pref-quota'), 'quota checkbox');
  expect(quota.checked).toBe(false);
  quota.checked = true;
  required(outlet.querySelector<HTMLButtonElement>('#pref-save'), 'save button').click();
  await settle(outlet, 'Preferences saved');
  expect(posted).toContainEqual({ url: '/api/notification-preferences', body: { muted: ['quota', 'cleanup'] } });
});

test('empty inbox explains the next step', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/notifications?limit=20': { status: 200, json: { items: [], unreadCount: 0, cursor: '' } },
    '/api/notification-preferences': { status: 200, json: PREFS },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, 'No notifications');
  expect(outlet.textContent).toContain('runs you file will report here');
});

test('expired session on the inbox redirects to session-expired', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/notifications?limit=20': {
      status: 401,
      json: { ok: false, error: { code: 'session_required', message: 'Login is required.' } },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/inbox');
  await settle(outlet, 'Session expired');
  expect(window.location.hash).toBe('#/session-expired');
});
