import { afterEach, expect, test, vi } from 'vitest';

import { apiDelete, apiGet, apiPost, ApiRequestError } from './api.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('ok envelope resolves with data', async () => {
  globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse(200, { ok: true, data: { a: 1 } })));
  await expect(apiGet<{ a: number }>('/api/x')).resolves.toEqual({ a: 1 });
});

test('fail envelope throws with code and message', async () => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(jsonResponse(403, { ok: false, error: { code: 'denied', message: 'No.' } })),
  );
  const error = await apiGet('/api/x').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiRequestError);
  expect((error as ApiRequestError).failure).toMatchObject({ status: 403, code: 'denied', offline: false });
});

test('network failure surfaces as offline, never a verdict', async () => {
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
  const error = await apiGet('/api/x').catch((e: unknown) => e);
  expect((error as ApiRequestError).failure.offline).toBe(true);
  expect((error as ApiRequestError).failure.status).toBe(0);
});

test('mutations send JSON with the CSRF marker header', async () => {
  const seen: RequestInit[] = [];
  globalThis.fetch = vi.fn((url: unknown, init?: RequestInit) => {
    if (url === undefined) throw new Error('fetch without URL');
    if (init !== undefined) seen.push(init);
    return Promise.resolve(jsonResponse(200, { ok: true, data: null }));
  });
  await apiPost('/api/x', { a: 1 });
  await apiDelete('/api/x');
  expect(seen).toHaveLength(2);
  for (const init of seen) {
    expect(new Headers(init.headers).get('X-Requested-With')).toBe('ChangeProofUI');
  }
  expect(seen[0]?.body).toBe('{"a":1}');
});

test.each([
  { status: 503, body: { ok: true, data: { state: 'succeeded' } } },
  { status: 200, body: { ok: true } },
  { status: 403, body: { ok: false, error: 'unreadable failure' } },
])('rejects an inconsistent or unreadable response ($status) as a typed failure', async ({ status, body }) => {
  globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse(status, body)));
  await expect(apiGet('/api/x')).rejects.toBeInstanceOf(ApiRequestError);
});
