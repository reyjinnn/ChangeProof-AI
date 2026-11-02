import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerThreadPages } from './threads.js';

const realFetch = globalThis.fetch;
const posted: { url: string; body: unknown }[] = [];

type StubHit = { status: number; json: unknown } | ((url: string, body: unknown) => { status: number; json: unknown });

function stubFetch(routes: Record<string, StubHit>): void {
  posted.length = 0;
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
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
  registerThreadPages();
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

const CREATED = '2026-11-02T00:00:00.000Z';
const DIGEST = 'd'.repeat(64);

const RUN = {
  runId: 'run-1',
  state: 'succeeded',
  version: 2,
  submitDigest: DIGEST,
};

const THREAD = {
  schemaVersion: '1',
  threadId: 'thread-1',
  tenantId: 'acme',
  runId: 'run-1',
  candidateDigest: DIGEST,
  audience: 'internal',
  status: 'open',
  audienceHistory: [],
  createdAt: CREATED,
};

const COMMENT = {
  schemaVersion: '1',
  commentId: 'comment-1',
  threadId: 'thread-1',
  tenantId: 'acme',
  authorId: 'user-owner',
  body: '<b>bold?</b> looks right',
  version: 1,
  outdated: false,
  createdAt: CREATED,
};

function threadStubs(): Record<string, StubHit> {
  return {
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/runs/run-1': { status: 200, json: RUN },
    '/api/threads?runId=run-1': { status: 200, json: { threads: [THREAD] } },
    '/api/threads/thread-1/comments': { status: 200, json: { comments: [COMMENT] } },
  };
}

test('threads need a run link; no data is fetched', async () => {
  const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
  globalThis.fetch = fetchSpy;
  const outlet = boot();
  await renderRoute(outlet, '#/threads');
  expect(outlet.textContent).toContain('Discussions need a run');
  expect(outlet.querySelector('a[href="#/runs"]')).not.toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('threads list with comments; markup renders as text, never elements', async () => {
  stubFetch(threadStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/threads?run=run-1');
  await settle(outlet, 'looks right');
  expect(outlet.textContent).toContain('<b>bold?</b> looks right');
  const article = required(outlet.querySelector<HTMLElement>('article[data-comment="comment-1"]'), 'comment article');
  expect(article.querySelector('b')).toBeNull();
  expect(article.querySelector('script')).toBeNull();
});

test('outdated comments carry the label; history shows superseded versions', async () => {
  stubFetch({
    ...threadStubs(),
    '/api/threads/thread-1/comments': { status: 200, json: { comments: [{ ...COMMENT, outdated: true }] } },
    '/api/comments/comment-1/history': {
      status: 200,
      json: { versions: [{ version: 1, body: 'First look.', editedAt: CREATED }] },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/threads?run=run-1');
  await settle(outlet, 'outdated');
  expect(outlet.textContent).toContain('outdated');
  required(outlet.querySelector<HTMLButtonElement>('button[data-history="comment-1"]'), 'history button').click();
  await settle(outlet, 'First look.');
});

test('creating a thread prefills the run digest; posting refreshes comments', async () => {
  stubFetch({
    ...threadStubs(),
    '/api/threads': { status: 201, json: { ...THREAD, threadId: 'thread-9' } },
    '/api/threads/thread-1/comments': (_url: string, body: unknown) => {
      if (body !== undefined) return { status: 201, json: { ...COMMENT, commentId: 'comment-9' } };
      return { status: 200, json: { comments: [COMMENT] } };
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/threads?run=run-1');
  await settle(outlet, 'thread-1');
  expect(required(outlet.querySelector<HTMLInputElement>('#thread-digest'), 'digest field').value).toBe(DIGEST);
  required(outlet.querySelector<HTMLButtonElement>('#thread-create'), 'create button').click();
  await settle(outlet, 'thread-9');
  const box = required(outlet.querySelector<HTMLTextAreaElement>('textarea[data-post="thread-1"]'), 'post box');
  box.value = 'Another look.';
  required(outlet.querySelector<HTMLButtonElement>('button[data-send="thread-1"]'), 'send button').click();
  await settle(outlet, 'comment-9');
});

test('active-markup posts surface the server refusal', async () => {
  stubFetch({
    ...threadStubs(),
    '/api/threads/thread-1/comments': (_url: string, body: unknown) => {
      if (body !== undefined) {
        return {
          status: 400,
          json: { ok: false, error: { code: 'bad_request', message: 'Comment carries active markup; plain text only.' } },
        };
      }
      return { status: 200, json: { comments: [COMMENT] } };
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/threads?run=run-1');
  await settle(outlet, 'thread-1');
  required(outlet.querySelector<HTMLTextAreaElement>('textarea[data-post="thread-1"]'), 'post box').value =
    '<script>alert(1)</script>';
  required(outlet.querySelector<HTMLButtonElement>('button[data-send="thread-1"]'), 'send button').click();
  await settle(outlet, 'active markup');
});

test('resolve, audience, share, and revoke act per thread', async () => {
  stubFetch({
    ...threadStubs(),
    '/api/threads/thread-1/resolve': { status: 200, json: { ...THREAD, status: 'resolved' } },
    '/api/threads/thread-1/audience': { status: 200, json: { ...THREAD, audience: 'reviewer' } },
    '/api/threads/thread-1/share': {
      status: 201,
      json: {
        schemaVersion: '1',
        shareId: 'share-9',
        threadId: 'thread-1',
        tenantId: 'acme',
        sharedWith: 'user-member',
        grantedBy: 'user-owner',
        createdAt: CREATED,
      },
    },
    '/api/threads/shares/share-9/revoke': { status: 200, json: { shareId: 'share-9' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/threads?run=run-1');
  await settle(outlet, 'thread-1');
  required(outlet.querySelector<HTMLButtonElement>('button[data-resolve="thread-1"]'), 'resolve button').click();
  await settle(outlet, 'resolved');
  expect(posted.map((entry) => entry.url)).toContain('/api/threads/thread-1/resolve');
});
