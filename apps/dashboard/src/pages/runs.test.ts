import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { pollConfig, registerRunPages } from './runs.js';

const realFetch = globalThis.fetch;
const seen: string[] = [];
const posted: { url: string; body: unknown }[] = [];

type StubHit = { status: number; json: unknown } | ((url: string) => { status: number; json: unknown });

function stubFetch(routes: Record<string, StubHit>): void {
  seen.length = 0;
  posted.length = 0;
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
    seen.push(url);
    if ((init?.method ?? 'GET') !== 'GET' && init?.body !== undefined) {
      if (typeof init.body !== 'string') throw new Error('Stub fetch expects string bodies.');
    posted.push({ url, body: JSON.parse(init.body) as unknown });
    }
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const hit = routes[path] ?? routes[url];
    const resolved = typeof hit === 'function' ? hit(url) : hit;
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
  pollConfig.intervalMs = 5;
  pollConfig.maxFailures = 3;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
  window.location.hash = '';
  pollConfig.intervalMs = 2500;
  pollConfig.maxFailures = 5;
});

function boot(): HTMLElement {
  registerRunPages();
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
  projectGrants: ['project-1'],
  repositoryGrants: ['repo-1'],
  expiresAt: '2030-01-01T00:00:00.000Z',
};

const RUN_SEARCH = {
  schemaVersion: '1',
  hits: [
    {
      kind: 'run',
      id: 'run-1',
      projectId: 'project-1',
      title: 'run-1',
      snippet: 'queued',
      createdAt: '2026-11-02T00:00:00.000Z',
    },
  ],
  totalCount: 1,
  cursor: 1,
};

const PROJECT_SEARCH = {
  schemaVersion: '1',
  hits: [
    {
      kind: 'project',
      id: 'project-1',
      title: 'checkout',
      snippet: 'checkout',
      createdAt: '2026-11-02T00:00:00.000Z',
    },
  ],
  totalCount: 1,
  cursor: 1,
};

const TEMPLATES = [
  {
    id: 'bugfix-run',
    title: 'Bug fix run',
    description: 'Restore a broken workflow.',
    requiresLogin: true,
    fields: [
      { name: 'intent', label: 'Intent', help: 'What should work again?' },
      { name: 'failure', label: 'Failure', help: 'What breaks today?' },
    ],
  },
];

function runRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1',
    runId: 'run-1',
    tenantId: 'acme',
    projectId: 'project-1',
    draftId: 'draft-1',
    draftRevision: 2,
    idempotencyKey: 'a'.repeat(64),
    state: 'queued',
    version: 0,
    jobId: 'job-1',
    reservationId: 'res-1',
    submitDigest: 'b'.repeat(64),
    repositoryIds: ['repo-1'],
    createdAt: '2026-11-02T00:00:00.000Z',
    ...overrides,
  };
}

test('guests see a login card on every run route, with no data calls', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  for (const hash of ['#/runs', '#/runs/new', '#/run?id=run-1']) {
    const outlet = boot();
    await renderRoute(outlet, hash);
    await settle(outlet, 'needs a login');
    expect(outlet.querySelector('a[href="#/login"]')).not.toBeNull();
  }
  expect(seen.some((url) => url === '/api/search')).toBe(false);
  expect(seen.some((url) => url.startsWith('/api/runs/'))).toBe(false);
});

test('run lists render runs and projects from search', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/search': (url) => ({ status: 200, json: url.includes('scope') ? RUN_SEARCH : RUN_SEARCH }),
  });
  const outlet = boot();
  await renderRoute(outlet, '#/runs');
  await settle(outlet, 'run-1');
  expect(outlet.querySelector('a[href="#/run?id=run-1"]')).not.toBeNull();
  expect(posted.filter((call) => call.url === '/api/search')).toHaveLength(2);
});

test('empty runs explain the next step instead of a blank page', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/search': { status: 200, json: { schemaVersion: '1', hits: [], totalCount: 0, cursor: 0 } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/runs');
  await settle(outlet, 'No runs yet');
  expect(outlet.querySelector('a[href="#/runs/new"]')).not.toBeNull();
});

test('offline lists fail with a retry that re-fetches', async () => {
  seen.length = 0;
  posted.length = 0;
  let attempts = 0;
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
    seen.push(url);
    if (url === '/api/auth/session' && attempts === 0) {
      attempts += 1;
      return Promise.reject(new TypeError('down'));
    }
    if ((init?.method ?? 'GET') !== 'GET' && init?.body !== undefined) {
      if (typeof init.body !== 'string') throw new Error('Stub fetch expects string bodies.');
    posted.push({ url, body: JSON.parse(init.body) as unknown });
    }
    const data = url === '/api/search' ? RUN_SEARCH : SESSION;
    return Promise.resolve(new Response(JSON.stringify({ ok: true, data }), { status: 200 }));
  });
  const outlet = boot();
  await renderRoute(outlet, '#/runs');
  await settle(outlet, 'Runs unavailable');
  const retry = [...outlet.querySelectorAll('button')].find((button) => button.textContent === 'Retry');
  if (retry === undefined) throw new Error('Missing retry button.');
  retry.click();
  await settle(outlet, 'Runs');
  expect(seen.filter((url) => url === '/api/auth/session').length).toBeGreaterThanOrEqual(2);
});

test('denied search shows the obstacle; dead sessions redirect', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/search': { status: 403, json: { ok: false, error: { code: 'forbidden', message: 'No.' } } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/runs');
  await settle(outlet, 'Access denied');
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/search': { status: 401, json: { ok: false, error: { code: 'session_expired', message: 'Expired.' } } },
  });
  const outlet2 = boot();
  await renderRoute(outlet2, '#/runs');
  for (let i = 0; i < 30 && window.location.hash !== '#/session-expired'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(window.location.hash).toBe('#/session-expired');
});

test('state filter re-searches with the chosen run state', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/search': { status: 200, json: RUN_SEARCH },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/runs');
  await settle(outlet, 'run-1');
  const select = outlet.querySelector<HTMLSelectElement>('#run-filter-state');
  expect(select).not.toBeNull();
  required(select, '#run-filter-state').value = 'failed';
  required(outlet.querySelector<HTMLFormElement>('#run-filter'), '#run-filter').requestSubmit();
  await settle(outlet, 'run-1');
  const bodies = posted.filter((call) => call.url === '/api/search').map((call) => call.body as Record<string, unknown>);
  expect(bodies.some((body) => body['scope'] === 'runs' && body['runState'] === 'failed')).toBe(true);
});

function formStubs(session: unknown = SESSION): void {
  stubFetch({
    '/api/auth/session': { status: 200, json: session },
    '/api/site/templates': { status: 200, json: TEMPLATES },
    '/api/search': { status: 200, json: PROJECT_SEARCH },
    '/api/projects': { status: 201, json: { projectId: 'project-9', name: 'fresh' } },
    '/api/drafts': { status: 201, json: { draftId: 'draft-9', revision: 1 } },
  });
}

async function openForm(hash = '#/runs/new'): Promise<HTMLElement> {
  const outlet = boot();
  await renderRoute(outlet, hash);
  await settle(outlet, 'File a run');
  return outlet;
}

function fill(outlet: HTMLElement, id: string, value: string): void {
  const input = outlet.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
  if (input === null) throw new Error(`Missing field #${id}.`);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

test('template choice prefills intent and notes from its fields', async () => {
  formStubs();
  const outlet = await openForm();
  fill(outlet, 'run-template', 'bugfix-run');
  fill(outlet, 'tpl-intent', 'checkout works again');
  fill(outlet, 'tpl-failure', '500 on pay');
  expect(required(outlet.querySelector<HTMLTextAreaElement>('#draft-intent'), '#draft-intent').value).toBe('');
  required(outlet.querySelector<HTMLSelectElement>('#run-template'), '#run-template').dispatchEvent(new Event('change', { bubbles: true }));
  await settle(outlet, 'checkout works again');
  expect(required(outlet.querySelector<HTMLTextAreaElement>('#draft-intent'), '#draft-intent').value).toBe('checkout works again');
  expect(required(outlet.querySelector<HTMLTextAreaElement>('#draft-notes'), '#draft-notes').value).toContain('500 on pay');
});

test('inline project creation fills the project field', async () => {
  formStubs();
  const outlet = await openForm();
  fill(outlet, 'new-project-name', 'fresh');
  required(outlet.querySelector<HTMLButtonElement>('#create-project'), '#create-project').click();
  await settle(outlet, 'project-9');
  expect(required(outlet.querySelector<HTMLInputElement>('#run-project'), '#run-project').value).toBe('project-9');
});

test('draft save shows the revision and records a resumable recent', async () => {
  formStubs();
  const outlet = await openForm();
  fill(outlet, 'run-project', 'project-1');
  fill(outlet, 'draft-intent', 'restore checkout');
  required(outlet.querySelector<HTMLButtonElement>('#save-draft'), '#save-draft').click();
  await settle(outlet, 'revision 1');
  expect(outlet.textContent).toContain('draft-9');
  const recent = window.localStorage.getItem('changeproof-draft:acme:user-owner:recent-drafts');
  expect(recent).toContain('draft-9');
  const resume = outlet.querySelector('a[href="#/runs/new?draft=draft-9"]');
  expect(resume).not.toBeNull();
});

test('empty intent blocks the draft save without a request', async () => {
  formStubs();
  const outlet = await openForm();
  fill(outlet, 'run-project', 'project-1');
  required(outlet.querySelector<HTMLButtonElement>('#save-draft'), '#save-draft').click();
  await settle(outlet, 'Describe the intent');
  expect(posted.some((call) => call.url === '/api/drafts')).toBe(false);
});

test('resume query prefills the form from the saved revision', async () => {
  formStubs();
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/site/templates': { status: 200, json: TEMPLATES },
    '/api/search': { status: 200, json: PROJECT_SEARCH },
    '/api/drafts/draft-9': {
      status: 200,
      json: {
        schemaVersion: '1',
        draftId: 'draft-9',
        tenantId: 'acme',
        projectId: 'project-1',
        revision: 4,
        body: { intent: 'saved intent', notes: 'saved notes', budgetCap: 77 },
        createdAt: '2026-11-02T00:00:00.000Z',
      },
    },
  });
  const outlet = await openForm('#/runs/new?draft=draft-9');
  await settle(outlet, 'revision 4');
  expect(required(outlet.querySelector<HTMLTextAreaElement>('#draft-intent'), '#draft-intent').value).toBe('saved intent');
  expect(required(outlet.querySelector<HTMLInputElement>('#draft-budget'), '#draft-budget').value).toBe('77');
});

function fillSubmit(outlet: HTMLElement): void {
  fill(outlet, 'run-project', 'project-1');
  const repo = outlet.querySelector<HTMLInputElement>('input[name="repo"][value="repo-1"]');
  if (repo === null) throw new Error('Missing repo checkbox.');
  repo.checked = true;
  fill(outlet, 'submit-sources', 'src/checkout.ts');
  fill(outlet, 'submit-intent', 'intent-1');
  fill(outlet, 'submit-invariants', 'inv-1');
  fill(outlet, 'submit-plan', 'plan-1');
  fill(outlet, 'submit-budget-profile', 'budget-1');
  fill(outlet, 'submit-budget', '50');
}

test('submit files immutably and shows the receipt with a run link', async () => {
  formStubs();
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/site/templates': { status: 200, json: TEMPLATES },
    '/api/search': { status: 200, json: PROJECT_SEARCH },
    '/api/drafts': { status: 201, json: { draftId: 'draft-9', revision: 1 } },
    '/api/runs': {
      status: 201,
      json: { runId: 'run-7', jobId: 'job-7', reservationId: 'res-7', submitDigest: 'c'.repeat(64), duplicate: false },
    },
  });
  const outlet = await openForm();
  fill(outlet, 'draft-intent', 'restore checkout');
  fillSubmit(outlet);
  required(outlet.querySelector<HTMLButtonElement>('#submit-run'), '#submit-run').click();
  await settle(outlet, 'Run filed');
  expect(outlet.querySelector('a[href="#/run?id=run-7"]')).not.toBeNull();
  expect(outlet.textContent).toContain('New run');
  expect(outlet.querySelector('#submit-run')).toBeNull();
  const submit = posted.find((call) => call.url === '/api/runs')?.body as Record<string, unknown>;
  expect(submit['expectedGrantVersion']).toBe(3);
  expect(submit['draftId']).toBe('draft-9');
  expect(String(submit['idempotencyKey'])).toMatch(/^[0-9a-f]{64}$/);
});

test('duplicate submits name the earlier run instead of filing twice', async () => {
  formStubs();
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/site/templates': { status: 200, json: TEMPLATES },
    '/api/search': { status: 200, json: PROJECT_SEARCH },
    '/api/drafts': { status: 201, json: { draftId: 'draft-9', revision: 1 } },
    '/api/runs': {
      status: 200,
      json: { runId: 'run-7', jobId: 'job-7', reservationId: 'res-7', submitDigest: 'c'.repeat(64), duplicate: true },
    },
  });
  const outlet = await openForm();
  fill(outlet, 'draft-intent', 'restore checkout');
  fillSubmit(outlet);
  required(outlet.querySelector<HTMLButtonElement>('#submit-run'), '#submit-run').click();
  await settle(outlet, 'Duplicate of an earlier submit');
});

test('submit validation blocks without a request', async () => {
  formStubs();
  const outlet = await openForm();
  fill(outlet, 'run-project', 'project-1');
  fill(outlet, 'draft-intent', 'restore checkout');
  required(outlet.querySelector<HTMLButtonElement>('#submit-run'), '#submit-run').click();
  await settle(outlet, 'Grant at least one repository');
  expect(posted.some((call) => call.url === '/api/runs')).toBe(false);
});

test('viewers and repo-less tenants get a disabled submit with the reason', async () => {
  formStubs({ ...SESSION, role: 'viewer' });
  const outlet = await openForm();
  await settle(outlet, 'cannot submit');
  expect(required(outlet.querySelector<HTMLButtonElement>('#submit-run'), '#submit-run').disabled).toBe(true);
  formStubs({ ...SESSION, repositoryGrants: [] });
  const outlet2 = await openForm();
  await settle(outlet2, 'No repositories are granted');
  expect(required(outlet2.querySelector<HTMLButtonElement>('#submit-run'), '#submit-run').disabled).toBe(true);
});

test('secret-shaped account ids keep drafts in memory instead of throwing', async () => {
  formStubs({ ...SESSION, userId: 'user-token-1' });
  const outlet = await openForm();
  fill(outlet, 'run-project', 'project-1');
  fill(outlet, 'draft-intent', 'restore checkout');
  required(outlet.querySelector<HTMLButtonElement>('#save-draft'), '#save-draft').click();
  await settle(outlet, 'revision 1');
  expect(posted.some((call) => call.url === '/api/drafts')).toBe(true);
});

function eventRow(seq: number, kind: string, payload: unknown = {}): Record<string, unknown> {
  return {
    schemaVersion: '1',
    runId: 'run-1',
    seq,
    kind,
    payload,
    createdAt: '2026-11-02T00:00:00.000Z',
  };
}

async function openDetail(stubs: Record<string, StubHit>, hash = '#/run?id=run-1'): Promise<HTMLElement> {
  stubFetch({ '/api/auth/session': { status: 200, json: SESSION }, ...stubs });
  const outlet = boot();
  await renderRoute(outlet, hash);
  return outlet;
}

test('run detail shows the exact state and streams events until terminal', async () => {
  let polls = 0;
  const outlet = await openDetail({
    '/api/runs/run-1': { status: 200, json: runRow() },
    '/api/runs/run-1/events?afterSeq=0&limit=50': {
      status: 200,
      json: { events: [eventRow(1, 'submitted')], cursor: 1 },
    },
    '/api/runs/run-1/events?afterSeq=1&limit=50': () => {
      polls += 1;
      return polls === 1
        ? { status: 200, json: { events: [eventRow(2, 'started')], cursor: 2 } }
        : { status: 200, json: { events: [], cursor: 2 } };
    },
    '/api/runs/run-1/events?afterSeq=2&limit=50': { status: 200, json: { events: [], cursor: 2 } },
  });
  await settle(outlet, 'queued');
  expect(outlet.textContent).toContain('version 0');
  await settle(outlet, 'started');
  expect(outlet.textContent).toContain('submitted');
});

test('terminal runs stop polling and say so', async () => {
  const outlet = await openDetail({
    '/api/runs/run-1': { status: 200, json: runRow({ state: 'failed', version: 2 }) },
    '/api/runs/run-1/events?afterSeq=0&limit=50': {
      status: 200,
      json: { events: [eventRow(1, 'submitted'), eventRow(2, 'failed', { reason: 'infra down' })], cursor: 2 },
    },
  });
  await settle(outlet, 'Final state reached');
  const calls = seen.filter((url) => url.includes('/events?')).length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(seen.filter((url) => url.includes('/events?')).length).toBe(calls);
  expect(outlet.textContent).toContain('infra down');
});

test('leaving the run page stops its poll loop', async () => {
  const outlet = await openDetail({
    '/api/runs/run-1': { status: 200, json: runRow() },
    '/api/runs/run-1/events?afterSeq=0&limit=50': {
      status: 200,
      json: { events: [eventRow(1, 'submitted')], cursor: 1 },
    },
    '/api/runs/run-1/events?afterSeq=1&limit=50': { status: 200, json: { events: [], cursor: 1 } },
    '/api/search': { status: 200, json: RUN_SEARCH },
  });
  await settle(outlet, 'queued');
  await renderRoute(outlet, '#/runs');
  await settle(outlet, 'run-1');
  const calls = seen.filter((url) => url.includes('/events?')).length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(seen.filter((url) => url.includes('/events?')).length).toBe(calls);
});

test('cancel and retry call through and refresh the state', async () => {
  const outlet = await openDetail({
    '/api/runs/run-1': { status: 200, json: runRow() },
    '/api/runs/run-1/events?afterSeq=0&limit=50': {
      status: 200,
      json: { events: [eventRow(1, 'submitted')], cursor: 1 },
    },
    '/api/runs/run-1/events?afterSeq=1&limit=50': { status: 200, json: { events: [], cursor: 1 } },
    '/api/runs/run-1/cancel': { status: 200, json: { state: 'cancelled' } },
  });
  await settle(outlet, 'queued');
  required(outlet.querySelector<HTMLButtonElement>('#cancel-run'), '#cancel-run').click();
  await settle(outlet, 'cancelled');
  expect(posted.some((call) => call.url === '/api/runs/run-1/cancel')).toBe(true);
  const failed = await openDetail({
    '/api/runs/run-9': { status: 200, json: runRow({ runId: 'run-9', state: 'failed', version: 2 }) },
    '/api/runs/run-9/events?afterSeq=0&limit=50': {
      status: 200,
      json: { events: [eventRow(1, 'submitted'), eventRow(2, 'failed')], cursor: 2 },
    },
    '/api/runs/run-9/retry': {
      status: 201,
      json: { runId: 'run-10', jobId: 'job-10', reservationId: 'res-10', submitDigest: 'd'.repeat(64), duplicate: false },
    },
  }, '#/run?id=run-9');
  await settle(outlet, 'failed');
  required(failed.querySelector<HTMLButtonElement>('#retry-run'), '#retry-run').click();
  await settle(failed, 'run-10');
  expect(failed.querySelector('a[href="#/run?id=run-10"]')).not.toBeNull();
});

test('artifact events link the authenticated download; review stays honest', async () => {
  const digest = 'e'.repeat(64);
  const outlet = await openDetail({
    '/api/runs/run-1': { status: 200, json: runRow({ state: 'succeeded', version: 3 }) },
    '/api/runs/run-1/events?afterSeq=0&limit=50': {
      status: 200,
      json: { events: [eventRow(1, 'submitted'), eventRow(2, 'artifact', { digest })], cursor: 2 },
    },
  });
  await settle(outlet, 'No assessment records');
  const link = outlet.querySelector(`a[href="/api/runs/run-1/artifacts/${digest}"]`);
  expect(link).not.toBeNull();
});

test('unknown runs 404 quietly; dead sessions redirect', async () => {
  const outlet = await openDetail({
    '/api/runs/run-nope': {
      status: 404,
      json: { ok: false, error: { code: 'not_found', message: 'Run is unknown or not shared with you.' } },
    },
  }, '#/run?id=run-nope');
  await settle(outlet, 'Run not found');
  expect(outlet.textContent).not.toContain('acme');
  const outlet2 = await openDetail({
    '/api/runs/run-1': {
      status: 401,
      json: { ok: false, error: { code: 'session_expired', message: 'Expired.' } },
    },
  });
  await renderRoute(outlet2, '#/run?id=run-1');
  for (let i = 0; i < 30 && window.location.hash !== '#/session-expired'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(window.location.hash).toBe('#/session-expired');
});

test('poll failures warn, then pause with a manual reconnect', async () => {
  const outlet = await openDetail({
    '/api/runs/run-1': { status: 200, json: runRow() },
    '/api/runs/run-1/events?afterSeq=0&limit=50': {
      status: 200,
      json: { events: [eventRow(1, 'submitted')], cursor: 1 },
    },
    '/api/runs/run-1/events?afterSeq=1&limit=50': {
      status: 500,
      json: { ok: false, error: { code: 'internal', message: 'Boom.' } },
    },
  });
  await settle(outlet, 'Polling paused');
  const reconnect = [...outlet.querySelectorAll('button')].find((button) => button.textContent === 'Reconnect now');
  expect(reconnect).toBeDefined();
});

test('missing run id fails closed without a request', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: SESSION } });
  const outlet = boot();
  await renderRoute(outlet, '#/run');
  await settle(outlet, 'Run link is incomplete');
  expect(seen.some((url) => url.startsWith('/api/runs/'))).toBe(false);
});
