import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute } from '../routes.js';
import { renderShell } from '../shell.js';

const realFetch = globalThis.fetch;
const posted: { url: string; body: unknown }[] = [];

function stubFetch(handler: (url: string, body: unknown) => { status: number; json: unknown }): void {
  posted.length = 0;
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
    let body: unknown;
    if ((init?.method ?? 'GET') !== 'GET' && init?.body !== undefined) {
      if (typeof init.body !== 'string') throw new Error('Stub fetch expects string bodies.');
      body = JSON.parse(init.body) as unknown;
      posted.push({ url, body });
    }
    const resolved = handler(url, body);
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

function boot(): void {
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  renderShell(app);
}

function trigger(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>('#palette-trigger');
  if (found === null) throw new Error('Missing palette trigger.');
  return found;
}

function press(target: EventTarget, key: string, options: { ctrlKey?: boolean; metaKey?: boolean } = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ctrlKey: options.ctrlKey ?? false, metaKey: options.metaKey ?? false }),
  );
}

async function settle(text: string): Promise<void> {
  for (let i = 0; i < 60 && !document.body.textContent.includes(text); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const HITS = {
  schemaVersion: '1',
  hits: [
    { kind: 'run', id: 'run-1', projectId: 'project-1', title: 'run run-1 (queued)', snippet: 'state=queued', createdAt: '2026-11-02T00:00:00.000Z' },
    { kind: 'project', id: 'project-1', title: 'checkout', snippet: 'project project-1', createdAt: '2026-11-02T00:00:00.000Z' },
    { kind: 'audit-event', id: 'run-1:3', projectId: 'project-1', title: 'artifact on run-1', snippet: '{"digest":"ab"}', createdAt: '2026-11-02T00:00:00.000Z' },
  ],
  totalCount: 3,
  cursor: 3,
};

test('topbar carries a search trigger; Ctrl+K opens the palette focused', () => {
  boot();
  const button = trigger();
  expect(button.textContent).toContain('Ctrl+K');
  press(document, 'k', { ctrlKey: true });
  expect(document.querySelector('.modal-backdrop')).not.toBeNull();
  expect(document.activeElement?.id).toBe('palette-q');
});

test('Escape closes the palette and returns focus to the trigger', () => {
  boot();
  const button = trigger();
  button.focus();
  press(document, 'k', { ctrlKey: true });
  expect(document.querySelector('.modal-backdrop')).not.toBeNull();
  press(document, 'Escape');
  expect(document.querySelector('.modal-backdrop')).toBeNull();
  expect(document.activeElement).toBe(button);
});

test('submitting searches the API and links each hit type', async () => {
  stubFetch((url) => {
    if (url === '/api/search') return { status: 200, json: HITS };
    return { status: 404, json: { ok: false } };
  });
  boot();
  press(document, 'k', { ctrlKey: true });
  const input = document.querySelector<HTMLInputElement>('#palette-q');
  if (input === null) throw new Error('Missing palette input.');
  input.value = 'checkout';
  const scope = document.querySelector<HTMLSelectElement>('#palette-scope');
  if (scope === null) throw new Error('Missing palette scope.');
  scope.value = 'runs';
  document.querySelector<HTMLFormElement>('#palette-form')?.requestSubmit();
  await settle('3 matches');
  expect(posted).toEqual([
    { url: '/api/search', body: { schemaVersion: '1', scope: 'runs', text: 'checkout', limit: 10 } },
  ]);
  expect(document.querySelector('.modal-backdrop a[href="#/run?id=run-1"]')).not.toBeNull();
  expect(document.querySelector('.modal-backdrop a[href="#/runs"]')).not.toBeNull();
});

test('empty results, guest, and offline states stay actionable', async () => {
  let mode: 'empty' | 'guest' | 'offline' = 'empty';
  stubFetch(() => {
    if (mode === 'empty') {
      return { status: 200, json: { schemaVersion: '1', hits: [], totalCount: 0, cursor: 0 } };
    }
    return { status: 401, json: { ok: false, error: { code: 'session_required', message: 'Login is required.' } } };
  });
  boot();
  press(document, 'k', { ctrlKey: true });
  document.querySelector<HTMLFormElement>('#palette-form')?.requestSubmit();
  await settle('No matches');
  mode = 'guest';
  document.querySelector<HTMLFormElement>('#palette-form')?.requestSubmit();
  await settle('Log in to search');
  expect(document.querySelector('.modal-backdrop a[href="#/login"]')).not.toBeNull();
});
