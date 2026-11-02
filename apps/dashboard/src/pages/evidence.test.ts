import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { buildEvidenceExport, registerEvidencePages } from './evidence.js';

const realFetch = globalThis.fetch;

type StubHit =
  | { status: number; json: unknown }
  | { status: number; bytes: Uint8Array }
  | ((url: string) => { status: number; json: unknown } | { status: number; bytes: Uint8Array });

function stubFetch(routes: Record<string, StubHit>): void {
  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const hit = routes[path] ?? routes[url];
    const resolved = typeof hit === 'function' ? hit(url) : hit;
    if (resolved === undefined) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
    }
    if ('bytes' in resolved) {
      return Promise.resolve(
        new Response(resolved.bytes as BodyInit, {
          status: resolved.status,
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
      );
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
  registerEvidencePages();
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

async function settle(outlet: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 60 && !outlet.textContent.includes(text); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const SESSION = {
  authenticated: true,
  userId: 'user-owner',
  tenantId: 'acme',
  role: 'owner',
  grantVersion: 3,
  projectGrants: ['project-1'],
  repositoryGrants: ['repo-1'],
};

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

const RUN = {
  runId: 'run-1',
  projectId: 'project-1',
  state: 'succeeded',
  version: 2,
  submitDigest: 'c'.repeat(64),
  repositoryIds: ['repo-1'],
  createdAt: '2026-11-01T00:00:00.000Z',
};

function eventsPayload() {
  return {
    events: [
      { seq: 1, kind: 'submitted', payload: { by: 'owner' }, createdAt: RUN.createdAt },
      {
        seq: 2,
        kind: 'artifact',
        payload: { digest: DIGEST_A, note: '<script>alert(1)</script>' },
        createdAt: RUN.createdAt,
      },
      { seq: 3, kind: 'artifact', payload: { digest: DIGEST_B }, createdAt: RUN.createdAt },
      { seq: 4, kind: 'note', payload: { digest: 'not-an-artifact' }, createdAt: RUN.createdAt },
    ],
    cursor: 4,
  };
}

function libraryStubs() {
  return {
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/runs/run-1': { status: 200, json: RUN },
    '/api/runs/run-1/events?afterSeq=0&limit=100': { status: 200, json: eventsPayload() },
    '/api/auth/providers': { status: 200, json: { email: true, github: false } },
  };
}

test('evidence library needs a run link; no data is fetched', async () => {
  const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
  globalThis.fetch = fetchSpy;
  const outlet = boot();
  await renderRoute(outlet, '#/evidence');
  expect(outlet.textContent).toContain('Evidence needs a run');
  expect(outlet.querySelector('a[href="#/runs"]')).not.toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('guests see a login card on evidence routes, never data', async () => {
  const fetchSpy = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true, data: { authenticated: false } }), { status: 200 })),
  );
  globalThis.fetch = fetchSpy;
  const outlet = boot();
  await renderRoute(outlet, '#/evidence?run=run-1');
  await settle(outlet, 'Evidence needs a login');
  expect(outlet.textContent).toContain('Evidence needs a login');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('library lists artifact events only, with view, download, and copy controls', async () => {
  stubFetch(libraryStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/evidence?run=run-1');
  await settle(outlet, DIGEST_A.slice(0, 12));
  expect(outlet.textContent).toContain(DIGEST_B.slice(0, 12));
  expect(outlet.textContent).not.toContain('not-an-artifact');
  const view = outlet.querySelector(`a[href="#/evidence/view?run=run-1&digest=${DIGEST_A}"]`);
  expect(view).not.toBeNull();
  const download = outlet.querySelector(`a[href="/api/runs/run-1/artifacts/${DIGEST_A}"]`);
  expect(download).not.toBeNull();
  expect(outlet.querySelector('button[data-copy-digest]')).not.toBeNull();
});

test('library shows digests, never raw payload markup (NEG3-35 shape)', async () => {
  stubFetch(libraryStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/evidence?run=run-1');
  await settle(outlet, DIGEST_A.slice(0, 12));
  expect(outlet.querySelector('script')).toBeNull();
  expect(outlet.textContent).not.toContain('<script>alert(1)</script>');
  expect(outlet.textContent).toContain(DIGEST_A);
});

test('publication panel is honest about the missing authorized App', async () => {
  stubFetch(libraryStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/evidence?run=run-1');
  await settle(outlet, 'no authorized GitHub App');
  expect(outlet.textContent).toContain('no authorized GitHub App');
});

test('evidence export snapshot carries run, artifacts, and provenance', () => {
  const snapshot = JSON.parse(
    buildEvidenceExport({
      run: RUN,
      artifacts: [{ seq: 2, digest: DIGEST_A, createdAt: RUN.createdAt }],
      exportedAt: '2026-11-02T00:00:00.000Z',
    }),
  ) as { kind: string; runId: string; artifacts: unknown[]; provenance: string };
  expect(snapshot.kind).toBe('changeproof-evidence-export');
  expect(snapshot.runId).toBe('run-1');
  expect(snapshot.artifacts).toHaveLength(1);
  expect(snapshot.provenance).toContain('Client-side snapshot of server data');
});

test('viewer needs a complete link; invalid digests never fetch', async () => {
  const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
  globalThis.fetch = fetchSpy;
  const outlet = boot();
  await renderRoute(outlet, '#/evidence/view?run=run-1');
  expect(outlet.textContent).toContain('Evidence link is incomplete');
  await renderRoute(outlet, '#/evidence/view?run=run-1&digest=xyz');
  expect(outlet.textContent).toContain('not a valid artifact digest');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('viewer renders text bytes escaped with the full digest', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    [`/api/runs/run-1/artifacts/${DIGEST_A}`]: {
      status: 200,
      bytes: new TextEncoder().encode('evidence line 1\n<script>alert(1)</script>'),
    },
  });
  const outlet = boot();
  await renderRoute(outlet, `#/evidence/view?run=run-1&digest=${DIGEST_A}`);
  await settle(outlet, 'evidence line 1');
  expect(outlet.querySelector('script')).toBeNull();
  expect(outlet.textContent).toContain(DIGEST_A);
  expect(outlet.textContent).toContain('verified by the server');
});

test('viewer refuses oversized and binary bytes as preview, keeps the download', async () => {
  const big = new Uint8Array(300 * 1024).fill(65);
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    [`/api/runs/run-1/artifacts/${DIGEST_A}`]: { status: 200, bytes: big },
    [`/api/runs/run-1/artifacts/${DIGEST_B}`]: {
      status: 200,
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
    },
  });
  const outlet = boot();
  await renderRoute(outlet, `#/evidence/view?run=run-1&digest=${DIGEST_A}`);
  await settle(outlet, 'too large to preview');
  expect(outlet.querySelector(`a[href="/api/runs/run-1/artifacts/${DIGEST_A}"]`)).not.toBeNull();
  await renderRoute(outlet, `#/evidence/view?run=run-1&digest=${DIGEST_B}`);
  await settle(outlet, 'not plain text');
  expect(outlet.querySelector(`a[href="/api/runs/run-1/artifacts/${DIGEST_B}"]`)).not.toBeNull();
});

test('tampered artifact shows the explicit integrity error (NEG3-33)', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    [`/api/runs/run-1/artifacts/${DIGEST_A}`]: {
      status: 400,
      json: {
        ok: false,
        error: {
          code: 'bad_request',
          message: `Evidence artifact ${DIGEST_A} failed integrity verification: stored bytes do not match their digest.`,
        },
      },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, `#/evidence/view?run=run-1&digest=${DIGEST_A}`);
  await settle(outlet, 'integrity check');
  expect(outlet.textContent).toContain('failed integrity verification');
});

test('unknown and unshared artifacts fail closed without disclosure', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    [`/api/runs/run-1/artifacts/${DIGEST_A}`]: {
      status: 404,
      json: { ok: false, error: { code: 'not_found', message: 'Artifact is unknown for this run.' } },
    },
    [`/api/runs/run-1/artifacts/${DIGEST_B}`]: {
      status: 403,
      json: { ok: false, error: { code: 'forbidden', message: 'Artifact is not shared with you.' } },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, `#/evidence/view?run=run-1&digest=${DIGEST_A}`);
  await settle(outlet, 'Artifact unknown');
  await renderRoute(outlet, `#/evidence/view?run=run-1&digest=${DIGEST_B}`);
  await settle(outlet, 'not shared with you');
});

test('expired session on evidence routes redirects to session-expired', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/runs/run-1': {
      status: 401,
      json: { ok: false, error: { code: 'unauthorized', message: 'Login is required for this action.' } },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/evidence?run=run-1');
  await settle(outlet, 'Session expired');
  expect(window.location.hash).toBe('#/session-expired');
});
