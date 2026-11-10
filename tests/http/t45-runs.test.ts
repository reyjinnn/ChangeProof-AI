import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

import {
  ChangeProofError,
  MissingConfigurationError,
  type LifecycleRun,
  type RunEvent,
  type SearchResult,
  type TenantContext,
} from '../../src/core/index.js';
import type { RunsDeps } from '../../src/http/routes-runs.js';
import type { LifecycleStore } from '../../src/modules/lifecycle/index.js';
import type { QueriesStore } from '../../src/modules/queries/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import { composeGitHubInstall, composePublicSite, type InstallationConnectComposition } from '../../src/orchestrator/index.js';
import { createMapSecretBroker } from '../../src/modules/github/index.js';

// Run-journey HTTP proof (T-45): the real server over stub stores with
// sentinel ids. No database — the native suite proves the real stores;
// the no-deps server answers 503 on every runs path.
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const manifestPath = join(rootDir, 'config', 'publicsite', 'manifest.json');

const HEX_64 = 'a'.repeat(64);
const NOW_ISO = '2026-11-02T00:00:00.000Z';
// Mirrors the store's tenant-scope suffix so the fake keeps the real id shape.
const FAKE_SCOPE = createHash('sha256').update('tenant-acme').digest('hex').slice(0, 12);

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

const run: LifecycleRun = {
  schemaVersion: '1',
  runId: 'run-1',
  tenantId: 'tenant-acme',
  projectId: 'project-1',
  draftId: 'draft-1',
  draftRevision: 2,
  idempotencyKey: HEX_64,
  state: 'queued',
  version: 0,
  jobId: 'job-1',
  reservationId: 'res-1',
  submitDigest: HEX_64,
  repositoryIds: ['repo-1'],
  createdAt: NOW_ISO,
};

const submittedEvent: RunEvent = {
  schemaVersion: '1',
  runId: 'run-1',
  seq: 1,
  kind: 'submitted',
  payload: { submitDigest: HEX_64 },
  createdAt: NOW_ISO,
};

function unknown(what: string): ChangeProofError {
  return new ChangeProofError(`${what} is unknown or not shared with you.`);
}

const lifecycle: LifecycleStore = {
  createProject: (_actor, input) => Promise.resolve({ projectId: 'project-9', name: input.name }),
  saveDraftRevision: (_actor, input) =>
    input.projectId === 'project-missing'
      ? Promise.reject(unknown('Project'))
      : Promise.resolve({ draftId: input.draftId ?? 'draft-9', revision: 1 }),
  getDraft: (_actor, input) =>
    input.draftId === 'draft-missing'
      ? Promise.reject(unknown('Draft'))
      : Promise.resolve({
          schemaVersion: '1' as const,
          draftId: input.draftId,
          tenantId: 'tenant-acme',
          projectId: 'project-1',
          revision: input.revision ?? 2,
          body: { intent: 'restore checkout', notes: 'stub' },
          createdAt: NOW_ISO,
        }),
  submitRun: (_actor, input) =>
    input.projectId === 'project-missing'
      ? Promise.reject(unknown('Project'))
      : Promise.resolve({
          runId: 'run-2',
          jobId: 'job-2',
          reservationId: 'res-2',
          submitDigest: HEX_64,
          duplicate: false as const,
        }),
  getRun: (_actor, input) => (input.runId === 'run-missing' ? Promise.reject(unknown('Run')) : Promise.resolve(run)),
  pollEvents: (_actor, input) =>
    input.runId === 'run-missing'
      ? Promise.reject(unknown('Run'))
      : Promise.resolve({ events: input.afterSeq >= 1 ? [] : [submittedEvent], cursor: 1 }),
  recordRunEvent: () => Promise.reject(new Error('workers only: never over HTTP')),
  cancelRun: (_actor, input) =>
    input.runId === 'run-missing'
      ? Promise.reject(unknown('Run'))
      : input.runId === 'run-done'
        ? Promise.reject(new ChangeProofError('Run is already succeeded; only queued or running runs cancel.'))
        : Promise.resolve({ state: 'cancelled' }),
  retryRun: (_actor, input) =>
    input.runId === 'run-missing'
      ? Promise.reject(unknown('Run'))
      : input.runId === 'run-queued'
        ? Promise.reject(new ChangeProofError('Only failed or cancelled runs retry; this run is queued.'))
        : Promise.resolve({
            runId: 'run-3',
            jobId: 'job-3',
            reservationId: 'res-3',
            submitDigest: HEX_64,
            duplicate: false as const,
          }),
  applyRepoRevocation: () => Promise.reject(new Error('control-plane only: never over HTTP')),
  downloadArtifact: (_actor, input) =>
    input.runId === 'run-missing'
      ? Promise.reject(unknown('Run'))
      : Promise.resolve({ digest: input.digest, bytes: new TextEncoder().encode('stub-evidence-bytes') }),
  listRuns: () =>
    Promise.resolve({
      runs: [{ runId: 'run-1', projectId: 'project-1', state: 'queued', createdAt: NOW_ISO }],
    }),
  getProject: (_actor, input) =>
    input.projectId === 'project-missing'
      ? Promise.reject(unknown('Project'))
      : Promise.resolve({
          projectId: input.projectId,
          name: 'checkout project',
          description: 'Restores the checkout flow.',
          repositories: [{ id: 'repo-1', name: 'repo-1', ownership: 'granted', status: 'active' }],
          readiness: [{ label: 'Repository access', status: 'ready' }],
          baseline: { revision: 'abc1234', pinnedAt: NOW_ISO },
        }),
  updateProject: (_actor, input) =>
    input.projectId === 'project-missing'
      ? Promise.reject(unknown('Project'))
      : input.projectId === 'project-forbidden'
        ? Promise.reject(new ChangeProofError('Request is not authorized for this project.'))
        : Promise.resolve({
            projectId: input.projectId,
            name: input.name ?? 'checkout project',
            description: input.description ?? 'Restores the checkout flow.',
          }),
  getEnvironment: () =>
    Promise.resolve({
      profileId: 'env-1',
      name: 'default',
      revision: 1,
      dataset: 'ds-1',
      migration: 'mig-1',
      services: [],
      journal: null,
      reset: null,
      boundary: { isolation: null, egress: null, dependencyFetch: null, mounts: null, cleanup: null },
      resources: { wallTime: null, attempts: null, creditCap: null },
    }),
  saveEnvironment: (_actor, input) =>
    input.name === ''
      ? Promise.reject(new ChangeProofError('Profile name must not be empty; refusing.'))
      : Promise.resolve({ profileId: 'env-2', revision: 2 }),
  listConnections: () => Promise.resolve({ connections: [] }),
  registerConnections: (_actor, input) =>
    Promise.resolve({
      connectionIds: input.repositories.map((repo) => `conn-${input.installationId}-${repo.id}-${FAKE_SCOPE}`),
    }),
  revokeConnection: (_actor, input) =>
    input.connectionId === 'conn-missing'
      ? Promise.reject(unknown('Connection'))
      : Promise.resolve({ connectionId: input.connectionId, status: 'revoked' }),
  getTelemetryCorpus: () => Promise.resolve({ files: [], gaps: [] }),
  registerTelemetryFile: (_actor, input) => Promise.resolve({ fileId: 'file-1', name: input.name }),
};

const searchResult: SearchResult = {
  schemaVersion: '1',
  hits: [
    {
      kind: 'run',
      id: 'run-1',
      projectId: 'project-1',
      title: 'run-1',
      snippet: 'queued',
      createdAt: NOW_ISO,
    },
  ],
  totalCount: 1,
  cursor: 1,
};

const queries: QueriesStore = {
  search: () => Promise.resolve(searchResult),
  exportAudit: () =>
    Promise.resolve({
      rows: [
        { runId: 'run-1', seq: 1, kind: 'submitted', payload: { submitDigest: HEX_64 }, createdAt: NOW_ISO },
      ],
      cursor: 1,
      manifest: {
        schemaVersion: '1' as const,
        exportId: 'exp-1',
        scope: 'audit' as const,
        rowCount: 1,
        digest: HEX_64,
        createdAt: NOW_ISO,
      },
    }),
  requestReproduction: () => Promise.reject(new Error('not exposed over HTTP in T-45')),
  bumpGrantEpoch: () => Promise.reject(new Error('control-plane only: never over HTTP')),
  invalidateTenantCache: () => {
    throw new Error('control-plane only: never over HTTP');
  },
  cacheStats: () => {
    throw new Error('control-plane only: never over HTTP');
  },
};

let connectFailure: Error | undefined;
const connectCalls: string[] = [];
const githubConnect: InstallationConnectComposition = {
  connect: (installationId: string) => {
    connectCalls.push(installationId);
    if (connectFailure !== undefined) return Promise.reject(connectFailure);
    return Promise.resolve({
      installationId,
      repositories: [
        { id: '1438299201', fullName: 'reyjinnn/ChangeProof-AI', isPrivate: false },
        { id: '1', fullName: 'reyjinnn/pilot', isPrivate: true },
      ],
    });
  },
};

const githubInstall = composeGitHubInstall({
  secrets: createMapSecretBroker(new Map([['install-state-secret', 'install-state-secret-32-chars-min!']])),
  stateSecretRef: 'install-state-secret',
  appSlug: 'changeproof-ai',
});

function deps(): RunsDeps {
  return {
    session: {
      deriveContext: (input) =>
        input.sessionId === 'sess-good' ? Promise.resolve(ctx) : Promise.reject(new ChangeProofError('nope')),
    },
    lifecycle: { store: lifecycle },
    githubConnect,
    githubInstall,
    queries: { store: queries },
  };
}

let handle: HttpHandle | undefined;
let bare: HttpHandle | undefined;
let base = '';
let bareBase = '';

beforeAll(async () => {
  handle = createHttpServer({ publicSite: composePublicSite(), manifestPath, runs: deps() });
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
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const response = await fetch(`${options.root ?? base}${path}`, {
    method,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // Bytes (artifact download) stay text for the assertion below.
  }
  return { status: response.status, body, headers: response.headers };
}

async function callManual(
  method: string,
  path: string,
  options: { headers?: Record<string, string> } = {},
): Promise<{ status: number; location: string | null; cookies: string[] }> {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  await response.text();
  return {
    status: response.status,
    location: response.headers.get('location'),
    cookies: response.headers.getSetCookie(),
  };
}

function installCookies(nonce: string): Record<string, string> {
  return { ...UI, Cookie: `cp_session=sess-good; cp_install=${nonce}` };
}

async function startInstall(): Promise<{ state: string; nonce: string }> {
  const started = await callManual('GET', '/api/github/install/start', { headers: authed });
  expect(started.status).toBe(302);
  const location = new URL(started.location ?? '');
  expect(`${location.origin}${location.pathname}`).toBe('https://github.com/apps/changeproof-ai/installations/new');
  const setCookie = started.cookies.find((entry) => entry.startsWith('cp_install=')) ?? '';
  expect(setCookie).toContain('Path=/api/github/install');
  const nonce = decodeURIComponent(setCookie.split(';')[0]?.split('=')[1] ?? '');
  expect(nonce).not.toBe('');
  return { state: location.searchParams.get('state') ?? '', nonce };
}

function corrupt(state: string): string {
  const last = state.endsWith('0') ? '1' : '0';
  return `${state.slice(0, -1)}${last}`;
}


const SUBMIT = {
  projectId: 'project-1',
  repositoryIds: ['repo-1'],
  sourceRefs: ['src/checkout.ts'],
  intentRef: 'intent-1',
  executionMode: 'real_runtime',
  invariantRefs: ['inv-1'],
  verificationPlanRef: 'plan-1',
  budgetProfileId: 'budget-1',
  publicationConsent: false,
  idempotencyKey: HEX_64,
  expectedGrantVersion: 3,
  draftId: 'draft-1',
  draftRevision: 2,
  requestedBudget: 50,
};

test('projects create over a session, refuse guests', async () => {
  const created = await call('POST', '/api/projects', { headers: authed, body: { name: 'checkout' } });
  expect(created.status).toBe(201);
  expect(created.body).toEqual({ ok: true, data: { projectId: 'project-9', name: 'checkout' } });
  const guest = await call('POST', '/api/projects', { headers: UI, body: { name: 'checkout' } });
  expect(guest.status).toBe(401);
  const empty = await call('POST', '/api/projects', { headers: authed, body: { name: '' } });
  expect(empty.status).toBe(400);
});

test('drafts save and read back, unknown drafts 404 without disclosure', async () => {
  const saved = await call('POST', '/api/drafts', {
    headers: authed,
    body: { projectId: 'project-1', body: { intent: 'restore checkout' } },
  });
  expect(saved.status).toBe(201);
  const read = await call('GET', '/api/drafts/draft-1?revision=2', { headers: authed });
  expect(read.status).toBe(200);
  const missing = await call('GET', '/api/drafts/draft-missing', { headers: authed });
  expect(missing.status).toBe(404);
  expect((missing.body as { error: { message: string } }).error.message).not.toMatch(/tenant|project-1/);
  const bad = await call('POST', '/api/drafts', { headers: authed, body: { projectId: 'project-1', body: {} } });
  expect(bad.status).toBe(400);
});

test('runs submit immutably and read back exactly', async () => {
  const submitted = await call('POST', '/api/runs', { headers: authed, body: SUBMIT });
  expect(submitted.status).toBe(201);
  expect(submitted.body).toEqual({
    ok: true,
    data: { runId: 'run-2', jobId: 'job-2', reservationId: 'res-2', submitDigest: HEX_64, duplicate: false },
  });
  const read = await call('GET', '/api/runs/run-1', { headers: authed });
  expect(read.status).toBe(200);
  expect((read.body as { data: { state: string } }).data.state).toBe('queued');
  const missing = await call('GET', '/api/runs/run-missing', { headers: authed });
  expect(missing.status).toBe(404);
  const noKey = await call('POST', '/api/runs', {
    headers: authed,
    body: { ...SUBMIT, idempotencyKey: undefined },
  });
  expect(noKey.status).toBe(400);
});

test('events poll with a cursor and refuse bad cursors', async () => {
  const first = await call('GET', '/api/runs/run-1/events?afterSeq=0&limit=10', { headers: authed });
  expect(first.status).toBe(200);
  expect((first.body as { data: { cursor: number } }).data.cursor).toBe(1);
  const caughtUp = await call('GET', '/api/runs/run-1/events?afterSeq=1&limit=10', { headers: authed });
  expect((caughtUp.body as { data: { events: unknown[] } }).data.events).toEqual([]);
  const bad = await call('GET', '/api/runs/run-1/events?afterSeq=0&limit=500', { headers: authed });
  expect(bad.status).toBe(400);
  const missing = await call('GET', '/api/runs/run-missing/events?afterSeq=0&limit=10', { headers: authed });
  expect(missing.status).toBe(404);
});

test('cancel and retry enforce run states', async () => {
  const cancelled = await call('POST', '/api/runs/run-1/cancel', { headers: authed, body: {} });
  expect(cancelled.status).toBe(200);
  const terminal = await call('POST', '/api/runs/run-done/cancel', { headers: authed, body: {} });
  expect(terminal.status).toBe(400);
  const retried = await call('POST', '/api/runs/run-1/retry', { headers: authed, body: { idempotencyKey: HEX_64 } });
  expect(retried.status).toBe(201);
  const early = await call('POST', '/api/runs/run-queued/retry', { headers: authed, body: { idempotencyKey: HEX_64 } });
  expect(early.status).toBe(400);
  const noKey = await call('POST', '/api/runs/run-1/retry', { headers: authed, body: {} });
  expect(noKey.status).toBe(400);
});

test('artifacts download as bytes behind the session', async () => {
  const downloaded = await call('GET', `/api/runs/run-1/artifacts/${HEX_64}`, { headers: authed });
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers.get('content-type')).toContain('application/octet-stream');
  expect(downloaded.body).toBe('stub-evidence-bytes');
  const guest = await call('GET', `/api/runs/run-1/artifacts/${HEX_64}`);
  expect(guest.status).toBe(401);
  const missing = await call('GET', `/api/runs/run-missing/artifacts/${HEX_64}`, { headers: authed });
  expect(missing.status).toBe(404);
});

test('search lists runs and projects with validated queries', async () => {
  const found = await call('POST', '/api/search', {
    headers: authed,
    body: { schemaVersion: '1', scope: 'runs', limit: 20 },
  });
  expect(found.status).toBe(200);
  expect((found.body as { data: SearchResult }).data.totalCount).toBe(1);
  const blank = await call('POST', '/api/search', {
    headers: authed,
    body: { schemaVersion: '1', scope: 'runs', text: '   ', limit: 20 },
  });
  expect(blank.status).toBe(400);
  const guest = await call('POST', '/api/search', {
    headers: UI,
    body: { schemaVersion: '1', scope: 'runs', limit: 20 },
  });
  expect(guest.status).toBe(401);
});

test('runs paths fail closed without the marker, without the database, and on unknown paths', async () => {
  const noMarker = await call('POST', '/api/projects', {
    headers: { 'Content-Type': 'application/json', Cookie: 'cp_session=sess-good' },
    body: { name: 'x' },
  });
  expect(noMarker.status).toBe(403);
  const noDb = await call('GET', '/api/runs/run-1', { headers: authed, root: bareBase });
  expect(noDb.status).toBe(503);
  const unknownEndpoint = await call('GET', '/api/runs/run-1/merge', { headers: authed });
  expect(unknownEndpoint.status).toBe(404);
});

test('runs list for the dashboard behind the session', async () => {
  const listed = await call('GET', '/api/runs', { headers: authed });
  expect(listed.status).toBe(200);
  const runs = (listed.body as { data: { runs: { runId: string; title: string; state: string; updatedAt: string }[] } })
    .data.runs;
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ runId: 'run-1', state: 'queued', updatedAt: NOW_ISO });
  expect(typeof runs[0]?.title).toBe('string');
  const guest = await call('GET', '/api/runs', { headers: UI });
  expect(guest.status).toBe(401);
});

test('projects read and patch; unknown ids 404 without disclosure, foreign projects 403', async () => {
  const read = await call('GET', '/api/projects/project-1', { headers: authed });
  expect(read.status).toBe(200);
  expect((read.body as { data: { name: string } }).data.name).toBe('checkout project');
  const missing = await call('GET', '/api/projects/project-missing', { headers: authed });
  expect(missing.status).toBe(404);
  expect((missing.body as { error: { message: string } }).error.message).not.toMatch(/tenant-acme|user-owner/);
  const patched = await call('PATCH', '/api/projects/project-1', {
    headers: authed,
    body: { name: 'renamed', description: 'new words' },
  });
  expect(patched.status).toBe(200);
  const forbidden = await call('PATCH', '/api/projects/project-forbidden', {
    headers: authed,
    body: { name: 'x' },
  });
  expect(forbidden.status).toBe(403);
  const patchMissing = await call('PATCH', '/api/projects/project-missing', { headers: authed, body: { name: 'x' } });
  expect(patchMissing.status).toBe(404);
  const empty = await call('PATCH', '/api/projects/project-1', { headers: authed, body: {} });
  expect(empty.status).toBe(400);
  const badName = await call('PATCH', '/api/projects/project-1', { headers: authed, body: { name: '' } });
  expect(badName.status).toBe(400);
});

test('environments read and save revisions behind the session', async () => {
  const read = await call('GET', '/api/environments', { headers: authed });
  expect(read.status).toBe(200);
  expect((read.body as { data: { dataset: string } }).data.dataset).toBe('ds-1');
  const saved = await call('POST', '/api/environments', {
    headers: authed,
    body: { name: 'staging', dataset: 'ds-2', migration: 'mig-2' },
  });
  expect(saved.status).toBe(201);
  const bad = await call('POST', '/api/environments', { headers: authed, body: { name: '', dataset: 'x' } });
  expect(bad.status).toBe(400);
  const guest = await call('POST', '/api/environments', { headers: UI, body: { name: 'x' } });
  expect(guest.status).toBe(401);
  const noMarker = await call('POST', '/api/environments', {
    headers: { 'Content-Type': 'application/json', Cookie: 'cp_session=sess-good' },
    body: { name: 'x' },
  });
  expect(noMarker.status).toBe(403);
});

test('connecting an installation verifies live, then stores one row per repo', async () => {
  connectFailure = undefined;
  connectCalls.length = 0;
  const done = await call('POST', '/api/github/connections', { headers: authed, body: { installationId: '178697398' } });
  expect(done.status).toBe(201);
  expect(connectCalls).toEqual(['178697398']);
  expect(done.body).toEqual({
    ok: true,
    data: {
      installationId: '178697398',
      connectionIds: [`conn-178697398-1438299201-${FAKE_SCOPE}`, `conn-178697398-1-${FAKE_SCOPE}`],
      repositoryCount: 2,
    },
  });
});

test('connect refuses bad ids quietly and unknown installations honestly', async () => {
  connectFailure = undefined;
  const malformed = await call('POST', '/api/github/connections', { headers: authed, body: { installationId: '../x' } });
  expect(malformed.status).toBe(400);
  connectFailure = new ChangeProofError('GitHub installation is unknown or not shared with this App; refusing.');
  const unknown = await call('POST', '/api/github/connections', { headers: authed, body: { installationId: '999' } });
  expect(unknown.status).toBe(404);
  expect(JSON.stringify(unknown.body)).toContain('installation_not_found');
  connectFailure = new MissingConfigurationError('CP_GITHUB_APP_KEY_FILE', 'secret broker ref "github-app-key"', 'test');
  const unconfigured = await call('POST', '/api/github/connections', {
    headers: authed,
    body: { installationId: '178697398' },
  });
  expect(unconfigured.status).toBe(503);
  connectFailure = undefined;
});

test('install start redirects a logged-in user to the GitHub App page', async () => {
  const { state } = await startInstall();
  expect(state.startsWith('v1.')).toBe(true);
  const guest = await callManual('GET', '/api/github/install/start', { headers: UI });
  expect(guest.status).toBe(401);
});

test('install callback connects the installation and lands back with a count', async () => {
  connectFailure = undefined;
  connectCalls.length = 0;
  const { state, nonce } = await startInstall();
  const done = await callManual(
    'GET',
    `/api/github/install/callback?installation_id=178697398&setup_action=install&state=${encodeURIComponent(state)}`,
    { headers: installCookies(nonce) },
  );
  expect(done.status).toBe(302);
  expect(done.location).toBe('/#/repositories?connected=2');
  expect(connectCalls).toEqual(['178697398']);
});

test('install callback refuses forged, foreign, cancelled, and incomplete installs', async () => {
  const { state, nonce } = await startInstall();
  const forged = await callManual(
    'GET',
    `/api/github/install/callback?installation_id=178697398&setup_action=install&state=${encodeURIComponent(corrupt(state))}`,
    { headers: installCookies(nonce) },
  );
  expect(forged.location).toBe('/#/repositories?githubError=state_invalid');
  const wrongBrowser = await callManual(
    'GET',
    `/api/github/install/callback?installation_id=178697398&setup_action=install&state=${encodeURIComponent(state)}`,
    { headers: authed },
  );
  expect(wrongBrowser.location).toBe('/#/repositories?githubError=state_invalid');
  const guest = await callManual(
    'GET',
    `/api/github/install/callback?installation_id=178697398&setup_action=install&state=${encodeURIComponent(state)}`,
    { headers: { ...UI, Cookie: `cp_install=${nonce}` } },
  );
  expect(guest.location).toBe('/#/repositories?githubError=login_required');
  const cancelled = await callManual('GET', `/api/github/install/callback?state=${encodeURIComponent(state)}`, {
    headers: installCookies(nonce),
  });
  expect(cancelled.location).toBe('/#/repositories?githubError=cancelled');
  const requested = await callManual(
    'GET',
    `/api/github/install/callback?installation_id=178697398&setup_action=request&state=${encodeURIComponent(state)}`,
    { headers: installCookies(nonce) },
  );
  expect(requested.location).toBe('/#/repositories?githubError=setup_rejected');
  connectFailure = new ChangeProofError('GitHub installation is unknown or not shared with this App; refusing.');
  const unknown = await callManual(
    'GET',
    `/api/github/install/callback?installation_id=999&setup_action=install&state=${encodeURIComponent(state)}`,
    { headers: installCookies(nonce) },
  );
  expect(unknown.location).toBe('/#/repositories?githubError=installation_not_found');
  connectFailure = undefined;
});

test('github connections list honestly empty and revoke refuses unknown ids', async () => {
  const listed = await call('GET', '/api/github/connections', { headers: authed });
  expect(listed.status).toBe(200);
  expect((listed.body as { data: { connections: unknown[] } }).data.connections).toEqual([]);
  const revoked = await call('POST', '/api/github/connections/conn-1/revoke', { headers: authed, body: {} });
  expect(revoked.status).toBe(200);
  const missing = await call('POST', '/api/github/connections/conn-missing/revoke', { headers: authed, body: {} });
  expect(missing.status).toBe(404);
  expect((missing.body as { error: { message: string } }).error.message).not.toMatch(/tenant-acme|user-owner/);
  const guest = await call('GET', '/api/github/connections', { headers: UI });
  expect(guest.status).toBe(401);
});

test('telemetry corpus reads metadata and registers files with validated kinds', async () => {
  const read = await call('GET', '/api/telemetry/corpus', { headers: authed });
  expect(read.status).toBe(200);
  expect((read.body as { data: { files: unknown[]; gaps: unknown[] } }).data).toEqual({ files: [], gaps: [] });
  const registered = await call('POST', '/api/telemetry/corpus', {
    headers: authed,
    body: { name: 'app.log', sizeBytes: 1024, kind: 'log', label: 'api' },
  });
  expect(registered.status).toBe(201);
  const badKind = await call('POST', '/api/telemetry/corpus', {
    headers: authed,
    body: { name: 'app.log', sizeBytes: 10, kind: 'screenshot' },
  });
  expect(badKind.status).toBe(400);
  const badSize = await call('POST', '/api/telemetry/corpus', {
    headers: authed,
    body: { name: 'app.log', sizeBytes: -1, kind: 'log' },
  });
  expect(badSize.status).toBe(400);
  const guest = await call('POST', '/api/telemetry/corpus', {
    headers: UI,
    body: { name: 'app.log', sizeBytes: 1, kind: 'log' },
  });
  expect(guest.status).toBe(401);
});

test('audit entries list from the event history with a bounded limit', async () => {
  const listed = await call('GET', '/api/audit/entries?limit=50', { headers: authed });
  expect(listed.status).toBe(200);
  const items = (
    listed.body as { data: { items: { time: string; actor: string; event: string; scope: string; receipt: string }[] } }
  ).data.items;
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ time: NOW_ISO, event: 'submitted', scope: 'run-1', receipt: 'run-1:1' });
  expect(typeof items[0]?.actor).toBe('string');
  const bad = await call('GET', '/api/audit/entries?limit=500', { headers: authed });
  expect(bad.status).toBe(400);
  const guest = await call('GET', '/api/audit/entries?limit=50', { headers: UI });
  expect(guest.status).toBe(401);
});

test('new workspace paths answer 503 without the database', async () => {
  for (const [method, path, body] of [
    ['GET', '/api/runs', undefined],
    ['GET', '/api/projects/project-1', undefined],
    ['PATCH', '/api/projects/project-1', { name: 'x' }],
    ['GET', '/api/environments', undefined],
    ['POST', '/api/environments', { name: 'x' }],
    ['GET', '/api/github/install/start', undefined],
    ['GET', '/api/github/install/callback', undefined],
    ['GET', '/api/github/connections', undefined],
    ['POST', '/api/github/connections', { installationId: '178697398' }],
    ['POST', '/api/github/connections/conn-1/revoke', {}],
    ['GET', '/api/telemetry/corpus', undefined],
    ['POST', '/api/telemetry/corpus', { name: 'a', sizeBytes: 1, kind: 'log' }],
    ['GET', '/api/audit/entries?limit=50', undefined],
  ] as const) {
    const answer = await call(method, path, { headers: authed, root: bareBase, ...(body === undefined ? {} : { body }) });
    expect(answer.status, `${method} ${path}`).toBe(503);
  }
});
