import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

import {
  ChangeProofError,
  type NotificationPreferences,
  type NotificationRecord,
  type TenantContext,
} from '../../src/core/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import type { NotificationsDeps } from '../../src/http/routes-notifications.js';
import type { NotificationsStore } from '../../src/modules/notifications/index.js';
import { composePublicSite } from '../../src/orchestrator/index.js';

// Notifications HTTP proof (T-47): the real server over a stub store
// with sentinel ids. No database — the native suite proves the real
// store; the no-deps server answers 503 on every notifications path.
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const manifestPath = join(rootDir, 'config', 'publicsite', 'manifest.json');

const NOW_ISO = '2026-11-02T00:00:00.000Z';

const ctx: TenantContext = {
  schemaVersion: '1',
  tenantId: 'tenant-acme',
  userId: 'user-owner',
  sessionId: 'sess-good',
  role: 'owner',
  projectGrants: ['project-1'],
  repositoryGrants: ['repo-1'],
  grantVersion: 3,
  expiresAt: '2026-11-03T00:00:00.000Z',
  authoritySource: 'server',
};

const item: NotificationRecord = {
  schemaVersion: '1',
  notificationId: 'notif-1',
  tenantId: 'tenant-acme',
  userId: 'user-owner',
  eventId: 'evt-1',
  category: 'results',
  title: 'Run finished',
  body: 'run-1 reached a terminal state.',
  runId: 'run-1',
  createdAt: NOW_ISO,
};

const prefs: NotificationPreferences = {
  schemaVersion: '1',
  tenantId: 'tenant-acme',
  userId: 'user-owner',
  muted: [],
};

function unknown(): ChangeProofError {
  return new ChangeProofError('Notification is unknown.');
}

const notifications: NotificationsStore = {
  publishFromEvent: () => Promise.reject(new Error('workers only: never over HTTP')),
  listNotifications: (_actor, input) =>
    input.cursor === 'broken'
      ? Promise.reject(new ChangeProofError('Notification cursor is unreadable; refusing to page.'))
      : Promise.resolve({ items: input.unreadOnly === true ? [] : [item], unreadCount: 1, cursor: '' }),
  markRead: (_actor, input) =>
    input.notificationId === 'notif-missing' ? Promise.reject(unknown()) : Promise.resolve(),
  markDismissed: (_actor, input) =>
    input.notificationId === 'notif-missing' ? Promise.reject(unknown()) : Promise.resolve(),
  markAllRead: () => Promise.resolve({ marked: 2 }),
  getPreferences: () => Promise.resolve(prefs),
  setPreferences: (_actor, input) =>
    Promise.resolve({ ...prefs, muted: [...input.muted] as NotificationPreferences['muted'] }),
  claimOutboxBatch: () => Promise.reject(new Error('workers only: never over HTTP')),
  ackOutbox: () => Promise.reject(new Error('workers only: never over HTTP')),
};

function deps(): NotificationsDeps {
  return {
    session: {
      deriveContext: (input) =>
        input.sessionId === 'sess-good'
          ? Promise.resolve(ctx)
          : input.sessionId === 'sess-operator'
            ? Promise.resolve({ ...ctx, sessionId: 'sess-operator', role: 'operator' })
            : Promise.reject(new ChangeProofError('nope')),
    },
    notifications: { store: notifications },
  };
}

let handle: HttpHandle | undefined;
let bare: HttpHandle | undefined;
let base = '';
let bareBase = '';

beforeAll(async () => {
  handle = createHttpServer({ publicSite: composePublicSite(), manifestPath, notifications: deps() });
  await new Promise<void>((resolve) => handle?.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
  base = `http://127.0.0.1:${address.port}`;
  bare = createHttpServer({ publicSite: composePublicSite(), manifestPath });
  await new Promise<void>((resolve) => bare?.server.listen(0, '127.0.0.1', resolve));
  const bareAddress = bare.server.address();
  if (typeof bareAddress !== 'object' || bareAddress === null) throw new Error('Bare server did not bind.');
  bareBase = `http://127.0.0.1:${bareAddress.port}`;
}, 30_000);

afterAll(async () => {
  await handle?.close();
  await bare?.close();
});

const UI = { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI' };
const authed = { ...UI, Cookie: 'cp_session=sess-good' };

async function call(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown; root?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${options.root ?? base}${path}`, {
    method,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: await response.json() };
}

test('inbox lists over a session, refuses guests', async () => {
  const listed = await call('GET', '/api/notifications?limit=20', { headers: authed });
  expect(listed.status).toBe(200);
  expect(listed.body).toEqual({ ok: true, data: { items: [item], unreadCount: 1, cursor: '' } });
  const guest = await call('GET', '/api/notifications?limit=20');
  expect(guest.status).toBe(401);
});

test('inbox paging validates limit and cursor', async () => {
  const badLimit = await call('GET', '/api/notifications?limit=99', { headers: authed });
  expect(badLimit.status).toBe(400);
  const badCursor = await call('GET', '/api/notifications?limit=20&cursor=broken', { headers: authed });
  expect(badCursor.status).toBe(400);
  const unread = await call('GET', '/api/notifications?limit=20&unreadOnly=true', { headers: authed });
  expect(unread.status).toBe(200);
  expect(unread.body).toEqual({ ok: true, data: { items: [], unreadCount: 1, cursor: '' } });
});

test('read and dismiss flip one row, unknown ids stay quiet', async () => {
  const read = await call('POST', '/api/notifications/notif-1/read', { headers: authed, body: {} });
  expect(read.status).toBe(200);
  const dismissed = await call('POST', '/api/notifications/notif-1/dismiss', { headers: authed, body: {} });
  expect(dismissed.status).toBe(200);
  const missing = await call('POST', '/api/notifications/notif-missing/read', { headers: authed, body: {} });
  expect(missing.status).toBe(404);
  const guest = await call('POST', '/api/notifications/notif-1/read', { headers: UI, body: {} });
  expect(guest.status).toBe(401);
});

test('read-all reports its count', async () => {
  const done = await call('POST', '/api/notifications/read-all', { headers: authed, body: {} });
  expect(done.status).toBe(200);
  expect(done.body).toEqual({ ok: true, data: { marked: 2 } });
});

test('preferences round-trip, unknown categories refuse', async () => {
  const current = await call('GET', '/api/notification-preferences', { headers: authed });
  expect(current.status).toBe(200);
  const saved = await call('POST', '/api/notification-preferences', {
    headers: authed,
    body: { muted: ['quota', 'cleanup'] },
  });
  expect(saved.status).toBe(200);
  expect(saved.body).toEqual({ ok: true, data: { ...prefs, muted: ['quota', 'cleanup'] } });
  const bogus = await call('POST', '/api/notification-preferences', {
    headers: authed,
    body: { muted: ['everything'] },
  });
  expect(bogus.status).toBe(400);
});

test('worker-only calls have no HTTP route', async () => {
  const publish = await call('POST', '/api/notifications/publish', { headers: authed, body: {} });
  expect(publish.status).toBe(404);
  const claim = await call('POST', '/api/notifications/outbox/claim', { headers: authed, body: {} });
  expect(claim.status).toBe(404);
});

test('no-deps server answers 503 on notifications paths', async () => {
  const listed = await call('GET', '/api/notifications?limit=20', { headers: authed, root: bareBase });
  expect(listed.status).toBe(503);
  const saved = await call('POST', '/api/notification-preferences', {
    headers: authed,
    body: { muted: [] },
    root: bareBase,
  });
  expect(saved.status).toBe(503);
});
