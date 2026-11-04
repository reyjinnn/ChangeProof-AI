import { afterEach, expect, test, vi } from 'vitest';
import { registerRoute, renderRoute } from '../routes.js';
import { registerWorkspacePages } from './workspace.js';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
function boot(responses: Record<string, unknown>): { outlet: HTMLElement; calls: unknown[] } {
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined });
    return Promise.resolve(new Response(JSON.stringify({ ok: true, data: responses[url] }), { status: 200 }));
  }));
  const outlet = document.createElement('main'); document.body.append(outlet); registerWorkspacePages(); return { outlet, calls };
}
test('private project screens keep guests outside tenant data', async () => {
  const { outlet, calls } = boot({ '/api/auth/session': { authenticated: false } });
  await renderRoute(outlet, '#/projects');
  expect(outlet.textContent).toContain('Log in');
  expect(calls).toHaveLength(1);
  expect(outlet.textContent).not.toContain('Northwind');
});
test('project creation rejects empty input then sends only the documented name', async () => {
  const { outlet, calls } = boot({ '/api/auth/session': { authenticated: true }, '/api/projects': { projectId: 'p1' } });
  await renderRoute(outlet, '#/projects/new');
  const form = outlet.querySelector('form');
  form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  expect(calls).toHaveLength(1);
  const input = outlet.querySelector<HTMLInputElement>('#project-name');
  if (input === null) throw new Error('Project name missing');
  input.value = 'My project';
  form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => { expect(calls).toHaveLength(2); });
  expect(calls[1]).toEqual({ url: '/api/projects', body: { name: 'My project' } });
});
test('an unavailable graph preserves an explicit backend gap rather than fictional proof', async () => {
  const { outlet } = boot({ '/api/auth/session': { authenticated: true } });
  await renderRoute(outlet, '#/impact');
  expect(outlet.textContent).toContain('No impact-graph HTTP contract');
  expect(outlet.textContent).not.toContain('Northwind');
  expect(outlet.querySelectorAll('button:not([disabled])')).toHaveLength(0);
  expect(outlet.querySelector('a[href="#/runs"]')).not.toBeNull();
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status < 400 ? { ok: true, data } : data), { status });
}

const privateRoutes = ['#/projects', '#/projects/new', '#/impact'] as const;
const delayedResults = ['guest', 'authenticated', 'expired', 'unavailable', 'network failure'] as const;

for (const route of privateRoutes) {
  test.each(delayedResults)(`${route}: an outdated %s session cannot replace later navigation`, async result => {
    const { outlet } = boot({});
    const session = deferred<Response>();
    const fetch = vi.fn(() => session.promise);
    vi.stubGlobal('fetch', fetch);
    registerRoute({ path: '/latest-workspace-test', title: 'Latest', render: host => { host.textContent = 'Latest navigation'; } });

    const pending = renderRoute(outlet, route);
    await renderRoute(outlet, '#/latest-workspace-test');
    if (result === 'network failure') session.reject(new TypeError('Connection lost'));
    else if (result === 'expired') session.resolve(response({ ok: false, error: { code: 'session_expired', message: 'Session expired.' } }, 401));
    else if (result === 'unavailable') session.resolve(response({ ok: false, error: { code: 'unavailable', message: 'Session unavailable.' } }, 503));
    else session.resolve(response({ authenticated: result === 'authenticated' }));
    await pending;

    expect(outlet.textContent).toBe('Latest navigation');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.location.hash).not.toContain('login');
  });

  test(`${route}: a current expired session retains its error and retry can recover`, async () => {
    const { outlet } = boot({});
    let expired = true;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(expired
      ? response({ ok: false, error: { code: 'session_expired', message: 'Session expired.' } }, 401)
      : response({ authenticated: false }))));
    await renderRoute(outlet, route);
    expect(outlet.querySelector('[role="alert"]')?.textContent).toContain('Session expired.');
    const retry = outlet.querySelector('button');
    expect(retry?.textContent).toBe('Retry');
    expired = false;
    retry?.click();
    await vi.waitFor(() => { expect(outlet.textContent).toContain('Log in to your workspace'); });
    expect(outlet.querySelector('a[href="#/login"]')).not.toBeNull();
  });
}

test('an outdated project-search response cannot replace later navigation', async () => {
  const { outlet } = boot({});
  const search = deferred<Response>();
  const started = deferred<undefined>();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/auth/session') return Promise.resolve(response({ authenticated: true }));
    started.resolve(undefined);
    return search.promise;
  }));
  registerRoute({ path: '/after-project-search', title: 'Latest', render: host => { host.textContent = 'Latest navigation'; } });
  const pending = renderRoute(outlet, '#/projects');
  await started.promise;
  await renderRoute(outlet, '#/after-project-search');
  search.resolve(response({ hits: [], totalCount: 0 }));
  await pending;
  expect(outlet.textContent).toBe('Latest navigation');
});
