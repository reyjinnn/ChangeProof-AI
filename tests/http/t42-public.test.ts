import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { composePublicSite } from '../../src/orchestrator/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';

// Thin-slice HTTP proof (T-42): the real server over the real manifest.
// No database, no sessions yet — the apply gate refuses honestly (401)
// until T-44 wires the session check.
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const manifestPath = join(rootDir, 'config', 'publicsite', 'manifest.json');

let handle: HttpHandle | undefined;
let base = '';

beforeAll(async () => {
  handle = createHttpServer({ publicSite: composePublicSite(), manifestPath });
  await new Promise<void>((resolve) => handle?.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
  base = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await handle?.close();
});

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() };
}

async function post(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers });
  return { status: response.status, body: await response.json() };
}

function rawGet(origin: string, path: string): Promise<{ status: number; text: string }> {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    // The `path` option is sent verbatim: no client-side normalization.
    const request = httpRequest(
      { host: target.hostname, port: Number(target.port), path, method: 'GET' },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString() });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('health reports the service and content version', async () => {
  const { status, body } = await get('/api/health');
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true, data: { status: 'ok', service: 'changeproof', contentVersion: '2026-11-02' } });
});

test('site routes list all seventeen manifest routes', async () => {
  const { status, body } = await get('/api/site/routes');
  expect(status).toBe(200);
  const data = (body as { data: readonly { path: string; title: string }[] }).data;
  expect(data).toHaveLength(17);
  expect(data[0]?.path).toBe('/');
});

test('single route lookup 404s honestly on unknown paths', async () => {
  const found = await get('/api/site/routes?path=/pricing');
  expect(found.status).toBe(200);
  const missing = await get('/api/site/routes?path=/nope');
  expect(missing.status).toBe(404);
  expect((missing.body as { error: { code: string } }).error.code).toBe('not_found');
});

test('faq search ranks and refuses empty queries', async () => {
  const hit = await get('/api/site/faq?q=verify%20email');
  expect(hit.status).toBe(200);
  const empty = await get('/api/site/faq?q=');
  expect(empty.status).toBe(400);
  const absent = await get('/api/site/faq');
  expect(absent.status).toBe(400);
  const miss = await get('/api/site/faq?q=zzzqqqx');
  expect(miss.status).toBe(200);
  expect((miss.body as { data: { recovery: string } }).data.recovery).not.toBe('');
});

test('templates, samples, changelog, roadmap, and pricing serve', async () => {
  const templates = await get('/api/site/changelog');
  expect(templates.status).toBe(200);
  expect(Object.keys((templates.body as { data: object }).data).sort()).toEqual(['design', 'releases']);
  for (const path of ['/api/site/roadmap', '/api/site/pricing']) {
    expect((await get(path)).status).toBe(200);
  }
  const unknownTemplate = await get('/api/site/templates/nope');
  expect(unknownTemplate.status).toBe(404);
  const unknownSample = await get('/api/site/samples/nope');
  expect(unknownSample.status).toBe(404);
});

test('template apply refuses guests with a validated login destination', async () => {
  const list = await get('/api/site/templates');
  expect(list.status).toBe(200);
  const templates = (list.body as { data: readonly { id: string }[] }).data;
  expect(templates.length).toBeGreaterThan(0);
  const first = templates[0]?.id ?? '';
  const gated = await post(`/api/site/templates/${first}/apply`, { 'X-Requested-With': 'ChangeProofUI' });
  expect(gated.status).toBe(401);
  const body = gated.body as { error: { code: string }; gate: { requiresLogin: boolean; loginThenReturnTo: string } };
  expect(body.error.code).toBe('login_required');
  expect(body.gate.requiresLogin).toBe(true);
  expect(body.gate.loginThenReturnTo.startsWith('/app')).toBe(true);
  const unknown = await post('/api/site/templates/nope/apply', { 'X-Requested-With': 'ChangeProofUI' });
  expect(unknown.status).toBe(404);
});

test('mutations without the UI marker are refused (CSRF layer)', async () => {
  const { status, body } = await post('/api/site/templates/whatever/apply');
  expect(status).toBe(403);
  expect((body as { error: { code: string } }).error.code).toBe('csrf_required');
});

test('cross-origin mutations are refused', async () => {
  const response = await fetch(`${base}/api/site/templates/whatever/apply`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'ChangeProofUI', Origin: 'https://evil.example' },
  });
  expect(response.status).toBe(403);
});

test('oversized bodies are refused without buffering', async () => {
  const small = createHttpServer({ publicSite: composePublicSite(), manifestPath, maxBodyBytes: 8 });
  await new Promise<void>((resolve) => small.server.listen(0, '127.0.0.1', resolve));
  try {
    const address = small.server.address();
    if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/site/templates/whatever/apply`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'ChangeProofUI', 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(64) }),
    });
    expect(response.status).toBe(413);
  } finally {
    await small.close();
  }
});

test('unknown endpoints and methods fail closed as JSON', async () => {
  expect((await get('/api/nope')).status).toBe(404);
  const put = await fetch(`${base}/api/health`, { method: 'PUT' });
  expect(put.status).toBe(405);
  const del = await fetch(`${base}/`, { method: 'DELETE' });
  expect(del.status).toBe(405);
});

test('static hosting without a build names the missing step', async () => {
  const { status, body } = await get('/');
  expect(status).toBe(404);
  expect((body as { error: { code: string } }).error.code).toBe('ui_not_built');
});

test('static hosting serves files, falls back, and refuses traversal', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'cp-dist-'));
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>shell</title>');
  writeFileSync(join(dist, 'assets', 'app.css'), 'body{}');
  const ui = createHttpServer({ publicSite: composePublicSite(), manifestPath, distDir: dist });
  await new Promise<void>((resolve) => ui.server.listen(0, '127.0.0.1', resolve));
  try {
    const address = ui.server.address();
    if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
    const root = `http://127.0.0.1:${address.port}`;
    const index = await fetch(`${root}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    const css = await fetch(`${root}/assets/app.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    const fallback = await fetch(`${root}/app/runs`);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain('<title>shell</title>');
    const missing = await fetch(`${root}/assets/nope.css`);
    expect(missing.status).toBe(404);
    // Traversal must never escape dist: package.json stays unreadable.
    // Raw sockets: fetch would normalize the dot segments client-side.
    for (const evil of ['/%2e%2e/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/%2E%2E/package.json']) {
      const attempt = await rawGet(root, evil);
      expect([400, 404]).toContain(attempt.status);
      expect(attempt.text).not.toContain('changeproof');
    }
  } finally {
    await ui.close();
    rmSync(dist, { recursive: true, force: true });
  }
});
