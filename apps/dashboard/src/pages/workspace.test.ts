import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { registerRoute, renderRoute, routePaths } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerWorkspacePages } from './workspace.js';

const realFetch = globalThis.fetch;

type StubHit = { status: number; json: unknown } | ((url: string, body: unknown) => { status: number; json: unknown });

function stubFetch(routes: Record<string, StubHit>): void {
  globalThis.fetch = vi.fn((input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = String(input);
    let body: unknown;
    if ((init?.method ?? 'GET') !== 'GET' && init?.body !== undefined) {
      if (typeof init.body !== 'string') throw new Error('Stub fetch expects string bodies.');
      body = JSON.parse(init.body) as unknown;
    }
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const hit = routes[path] ?? routes[url];
    const resolved = typeof hit === 'function' ? hit(url, body) : hit;
    if (resolved === undefined) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Unknown in this tenant.' } }), { status: 404 }));
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
  registerWorkspacePages();
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

async function settle(host: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 80 && !host.textContent.includes(text); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function required<T extends HTMLElement>(element: T | null, what: string): T {
  if (element === null) throw new Error(`Missing ${what}.`);
  return element;
}

const SESSION = { authenticated: true, userId: 'user-owner', tenantId: 'acme', role: 'owner', grantVersion: 3 };

const RUNS = [
  { runId: 'RUN-0143', title: 'Checkout total mismatch', state: 'running', result: null, updatedAt: '2026-11-02T10:00:00.000Z' },
  { runId: 'RUN-0142', title: 'Inventory event lag', state: 'queued', result: null, updatedAt: '2026-11-02T09:00:00.000Z' },
  { runId: 'RUN-0141', title: 'Login redirect loop', state: 'succeeded', result: 'fixed', updatedAt: '2026-11-01T10:00:00.000Z' },
];

const BILLING = { used: 412, limit: 1000, tier: 'Free' };

const CONNECTIONS = [
  { id: 'conn-1', fullName: 'acme/storefront', status: 'active', webhook: { state: 'healthy', lastDelivery: '2026-11-02T10:00:00.000Z' }, updatedAt: '2026-11-02T10:00:00.000Z' },
];

function dashboardStubs(): Record<string, StubHit> {
  return {
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/runs': { status: 200, json: RUNS },
    '/api/billing/summary': { status: 200, json: BILLING },
    '/api/github/connections': { status: 200, json: CONNECTIONS },
  };
}

test('registers all nine workspace routes', () => {
  registerWorkspacePages();
  for (const path of ['/dashboard', '/projects', '/project-detail', '/repositories', '/capabilities', '/environments', '/telemetry', '/characterization', '/project-settings']) {
    expect(routePaths()).toContain(path);
  }
});

test('dashboard renders overview grid, stats, recent runs, and mobile list', async () => {
  stubFetch(dashboardStubs());
  const outlet = boot();
  await renderRoute(outlet, '#/dashboard');
  await settle(outlet, 'Workspace overview');
  expect(outlet.textContent).toContain('Quick actions');
  expect(outlet.textContent).toContain('File a run');
  expect(outlet.textContent).toContain('Active runs');
  expect(outlet.textContent).toContain('Credits used');
  expect(outlet.textContent).toContain('412 / 1000');
  expect(outlet.textContent).toContain('Checkout total mismatch');
  expect(outlet.textContent).toContain('All runs');
  expect(outlet.querySelector('.overview-grid')).not.toBeNull();
  expect(outlet.querySelector('.welcome-panel.workspace-focus')).not.toBeNull();
  expect(outlet.querySelector('.workspace-live-summary')).not.toBeNull();
  expect(outlet.querySelectorAll('.quick-action').length).toBe(3);
  expect(outlet.querySelectorAll('.stats .stat').length).toBe(4);
  expect(outlet.querySelector('.dashboard-run-table')).not.toBeNull();
  expect(outlet.querySelectorAll('.dashboard-mobile-runs .mobile-run').length).toBe(3);
  expect(outlet.querySelector('.workspace-live-summary')?.textContent).toContain('Repository connections active');
});

test('dashboard uses singular copy for one run and honest empty connections', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/runs': {
      status: 200,
      json: [
        { runId: 'RUN-0143', title: 'Checkout total mismatch', state: 'queued', result: null, updatedAt: '2026-11-02T10:00:00.000Z' },
      ],
    },
    '/api/billing/summary': { status: 200, json: BILLING },
    '/api/github/connections': { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/dashboard');
  await settle(outlet, 'Workspace overview');
  expect(outlet.textContent).toContain('1 run needs attention.');
  expect(outlet.querySelector('.workspace-live-summary')?.textContent).toContain('No GitHub connections yet');
  expect(outlet.querySelector('.workspace-live-summary')?.textContent).not.toContain('connections active');
});

test('dashboard fails closed when the run list is unreachable', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/runs': { status: 500, json: { ok: false, error: { code: 'boom', message: 'Run store is down.' } } },
    '/api/billing/summary': { status: 200, json: BILLING },
    '/api/github/connections': { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/dashboard');
  await settle(outlet, 'Recent runs unavailable');
  expect(outlet.textContent).toContain('Run store is down.');
  expect(outlet.textContent).toContain('Retry');
  // Static regions still render; run-derived values stay honest blanks.
  expect(outlet.textContent).toContain('Quick actions');
  expect(outlet.textContent).toContain('Run list unavailable');
  expect(outlet.textContent).not.toContain('Checkout total mismatch');
});

test('dashboard guests see a login card, never workspace data', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/dashboard');
  await settle(outlet, 'Workspace needs a login');
  expect(outlet.textContent).not.toContain('Quick actions');
});

test('projects list renders cards from search plus a create card', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/search': {
      status: 200,
      json: {
        hits: [
          { kind: 'project', id: 'proj-1', title: 'Storefront', snippet: 'Checkout monorepo', createdAt: '2026-10-01T00:00:00.000Z' },
        ],
        totalCount: 1,
        cursor: 0,
      },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/projects');
  await settle(outlet, 'Storefront');
  expect(outlet.querySelector('.pagehead.project-heading')).not.toBeNull();
  expect(outlet.querySelectorAll('.project-grid .project-card').length).toBe(2);
  expect(outlet.querySelector('.project-card .project-mark')).not.toBeNull();
  expect(outlet.querySelector('.project-card .metric-row')).not.toBeNull();
  expect(outlet.querySelector('.project-card .bottom-actions')).not.toBeNull();
  expect(outlet.querySelector('.project-card.create-card')).not.toBeNull();
  // Filter drawer opens with a text field.
  const filterButton = [...outlet.querySelectorAll('button')].find((button) => button.textContent === 'Filter');
  required(filterButton ?? null, 'Filter button').click();
  await settle(document.body, 'Filter projects');
  expect(document.getElementById('project-filter-text')).not.toBeNull();
});

test('projects empty state stays honest and keeps the create card', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/search': { status: 200, json: { hits: [], totalCount: 0, cursor: 0 } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/projects');
  await settle(outlet, 'No projects yet');
  expect(outlet.querySelector('.project-card.create-card')).not.toBeNull();
});

test('project detail needs a selection and renders topology plus readiness', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/projects/proj-1': {
      status: 200,
      json: {
        name: 'Storefront',
        description: 'Checkout monorepo',
        repositories: [{ id: 'repo-1', name: 'storefront', role: 'Producer', status: 'ready' }],
        readiness: [{ label: 'Tests green', status: 'ready' }],
        baseline: { revision: 'base@9', pinnedAt: '2026-11-01T00:00:00.000Z' },
      },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/project-detail');
  await settle(outlet, 'No project selected');
  await renderRoute(outlet, '#/project-detail?id=proj-1');
  await settle(outlet, 'Repository topology');
  expect(outlet.textContent).toContain('Storefront');
  expect(outlet.textContent).toContain('Readiness checklist');
  expect(outlet.textContent).toContain('Tests green');
  expect(outlet.textContent).toContain('base@9');
  expect(outlet.querySelector('.route-tabs')).not.toBeNull();
  expect(outlet.querySelector('.map-flow .repo-node')).not.toBeNull();
  // Repo node opens a drawer with details.
  required(outlet.querySelector<HTMLElement>('.repo-node'), 'repo node').click();
  await settle(document.body, 'repo-1');
});

test('project detail surfaces fetch failures with a retry', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: SESSION } });
  const outlet = boot();
  await renderRoute(outlet, '#/project-detail?id=proj-nope');
  await settle(outlet, 'Project unavailable');
  expect(outlet.textContent).toContain('Unknown in this tenant.');
});

test('repositories show connections with webhook details and honest empty state', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/github/connections': { status: 200, json: CONNECTIONS },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/repositories');
  await settle(outlet, 'Repository connections');
  expect(outlet.textContent).toContain('acme/storefront');
  expect(outlet.textContent).toContain('healthy');
  expect(outlet.querySelector('.compact-detail')).not.toBeNull();
  expect(outlet.textContent).toContain('Revoke access');
});

test('repositories empty state names the next safe step', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/github/connections': { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/repositories');
  await settle(outlet, 'No connections');
  expect(outlet.textContent).toContain('Install the GitHub App');
});

test('connect form verifies an installation, then lists its repositories', async () => {
  let connected = false;
  let posted: unknown;
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/github/connections': (_url: string, body: unknown) => {
      if (body !== undefined) {
        posted = body;
        connected = true;
        return { status: 201, json: { installationId: '178697398', connectionIds: ['conn-1'], repositoryCount: 1 } };
      }
      return { status: 200, json: connected ? CONNECTIONS : [] };
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/repositories');
  await settle(outlet, 'No connections');
  const field = outlet.querySelector<HTMLInputElement>('#connect-installation-id');
  if (field === null) throw new Error('connect input missing');
  field.value = '178697398';
  const button = [...outlet.querySelectorAll('button')].find((el) => el.textContent === 'Connect');
  if (button === undefined) throw new Error('connect button missing');
  button.click();
  await settle(outlet, 'acme/storefront');
  expect(posted).toEqual({ installationId: '178697398' });
  expect(outlet.textContent).toContain('Connected 1 repositories');
});

test('connect refuses a malformed id locally and surfaces server failures', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/github/connections': { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/repositories');
  await settle(outlet, 'No connections');
  const field = outlet.querySelector<HTMLInputElement>('#connect-installation-id');
  if (field === null) throw new Error('connect input missing');
  field.value = 'abc';
  const button = [...outlet.querySelectorAll('button')].find((el) => el.textContent === 'Connect');
  if (button === undefined) throw new Error('connect button missing');
  button.click();
  await settle(outlet, 'Enter the numeric installation id');
});

test('connect surfaces an unknown installation honestly', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/github/connections': (_url: string, body: unknown) =>
      body !== undefined
        ? {
            status: 404,
            json: {
              ok: false,
              error: {
                code: 'installation_not_found',
                message: 'That installation is unknown to this GitHub App; check the id and retry.',
              },
            },
          }
        : { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/repositories');
  await settle(outlet, 'No connections');
  const field = outlet.querySelector<HTMLInputElement>('#connect-installation-id');
  if (field === null) throw new Error('connect input missing');
  field.value = '999';
  const button = [...outlet.querySelectorAll('button')].find((el) => el.textContent === 'Connect');
  if (button === undefined) throw new Error('connect button missing');
  button.click();
  await settle(outlet, 'unknown to this GitHub App');
});

test('capabilities separate target level from proven level', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/support/capabilities': {
      status: 200,
      json: [{ ecosystem: 'typescript', framework: 'next', version: '15', feature: 'api-routes', changeType: 'contract', targetLevel: 'L3', provenLevel: 'none' }],
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/capabilities');
  await settle(outlet, 'Capability matrix');
  expect(outlet.textContent).toContain('typescript');
  expect(outlet.textContent).toContain('L3');
  expect(outlet.textContent).toContain('none');
  expect(outlet.textContent).toContain('Targets are not proof');
  const levelsButton = [...outlet.querySelectorAll('button')].find((button) => button.textContent === 'Understand levels');
  required(levelsButton ?? null, 'Understand levels button').click();
  await settle(document.body, 'Understand support levels');
});

test('capabilities failures stay visible with a retry', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: SESSION } });
  const outlet = boot();
  await renderRoute(outlet, '#/capabilities');
  await settle(outlet, 'Capabilities unavailable');
  expect(outlet.textContent).toContain('Retry');
});

test('environments render service mapping, boundary, and the edit drawer', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/environments': {
      status: 200,
      json: {
        services: [{ name: 'orders-service', engine: 'Spring Boot', ownership: 'Producer', network: 'private per-run' }],
        dataset: 'seed@3a77',
        migration: 'mig@V12',
        boundary: { isolation: 'VM per job', egress: 'denied', dependencyFetch: 'Allowlisted broker', mounts: 'Read-only', cleanup: 'Full' },
        resources: { wallTime: '90 minutes', attempts: '3', creditCap: '60 cr' },
      },
    },
    '/api/environments-save': { status: 200, json: {} },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/environments');
  await settle(outlet, 'Service mapping');
  expect(outlet.textContent).toContain('orders-service');
  expect(outlet.textContent).toContain('seed@3a77');
  expect(outlet.textContent).toContain('VM per job');
  const editButton = [...outlet.querySelectorAll('button')].find((button) => button.textContent === 'Edit profile');
  required(editButton ?? null, 'Edit profile button').click();
  await settle(document.body, 'Edit environment profile');
  expect(document.getElementById('environmentForm')).not.toBeNull();
});

test('telemetry shows corpus, gaps, and the add drawer with a file input', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/telemetry/corpus': {
      status: 200,
      json: { files: [{ name: 'checkout.log', kind: 'log', sizeBytes: 2048, addedAt: '2026-11-02T00:00:00.000Z' }], gaps: [{ area: 'payments', detail: 'No traces' }] },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/telemetry');
  await settle(outlet, 'Telemetry corpus');
  expect(outlet.textContent).toContain('checkout.log');
  expect(outlet.textContent).toContain('2 KB');
  expect(outlet.textContent).toContain('No traces');
  const addButton = [...outlet.querySelectorAll('button')].find((button) => button.textContent === 'Add telemetry');
  required(addButton ?? null, 'Add telemetry button').click();
  await settle(document.body, 'Add telemetry');
  expect(document.getElementById('telemetry-file')).not.toBeNull();
});

test('characterization is diagnosis-only and project settings load the form', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/projects/proj-1': { status: 200, json: { name: 'Storefront', description: 'Checkout monorepo', repositories: [], readiness: [] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/characterization');
  await settle(outlet, 'Diagnosis only, by design');
  expect(outlet.textContent).toContain('never modifies code');
  await renderRoute(outlet, '#/project-settings?id=proj-1');
  await settle(outlet, 'Project settings');
  expect(document.getElementById('projectSettingsForm')).not.toBeNull();
  expect((required(document.getElementById('project-settings-name') as HTMLInputElement | null, 'settings name')).value).toBe('Storefront');
});

test('project tabs carry the project id across the family', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/projects/proj-1': { status: 200, json: { name: 'Storefront', repositories: [], readiness: [] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/project-detail?id=proj-1');
  await settle(outlet, 'Repository topology');
  const tabsNav = required(outlet.querySelector<HTMLElement>('.route-tabs'), 'project tabs');
  expect(tabsNav.querySelectorAll('a').length).toBe(7);
  expect(tabsNav.querySelector('a[aria-current="page"]')?.textContent).toBe('Overview');
  expect(tabsNav.innerHTML).toContain('#/environments?id=proj-1');
});

test('malicious API strings render as text, never markup (NEG3-21)', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/search': { status: 200, json: { hits: [{ kind: 'project', id: 'proj-evil', title: payload, snippet: payload, createdAt: '2026-10-01' }], totalCount: 1, cursor: 0 } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/projects');
  await settle(outlet, payload);
  expect(outlet.querySelector('img')).toBeNull();
  expect(outlet.textContent).toContain(payload);
});
