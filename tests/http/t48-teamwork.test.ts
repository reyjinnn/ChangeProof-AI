import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

import {
  ChangeProofError,
  type AccessRequest,
  type Comment,
  type OperatorActionReceipt,
  type OperatorIncident,
  type ShareRecord,
  type SupportTicket,
  type TenantContext,
  type Thread,
} from '../../src/core/index.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import type { TeamworkDeps } from '../../src/http/routes-teamwork.js';
import type { CollaborationStore } from '../../src/modules/collaboration/index.js';
import type { SupportStore } from '../../src/modules/support/index.js';
import { composePublicSite } from '../../src/orchestrator/index.js';

// Teamwork HTTP proof (T-48): the real server over stub stores with
// sentinel ids. No database — the native suite proves the real stores;
// the no-deps server answers 503 on every teamwork path.
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..', '..');
const manifestPath = join(rootDir, 'config', 'publicsite', 'manifest.json');

const NOW_ISO = '2026-11-02T00:00:00.000Z';
const HEX_64 = 'd'.repeat(64);

const ownerCtx: TenantContext = {
  schemaVersion: '1',
  tenantId: 'tenant-acme',
  userId: 'user-owner',
  sessionId: 'sess-owner',
  role: 'owner',
  projectGrants: ['project-1'],
  repositoryGrants: ['repo-1'],
  grantVersion: 3,
  expiresAt: '2026-11-03T00:00:00.000Z',
  authoritySource: 'server',
};

const ticket: SupportTicket = {
  schemaVersion: '1',
  ticketId: 'ticket-1',
  tenantId: 'tenant-acme',
  reporterId: 'user-owner',
  category: 'bug',
  summary: 'Checkout 500s',
  context: 'Pay step fails.',
  status: 'open',
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
};

const accessRequest: AccessRequest = {
  schemaVersion: '1',
  requestId: 'accreq-1',
  tenantId: 'tenant-acme',
  requesterId: 'user-member',
  resourceType: 'run',
  resourceId: 'run-1',
  reason: 'Review the fix.',
  status: 'pending',
  expiresAt: '2026-11-09T00:00:00.000Z',
  createdAt: NOW_ISO,
};

const incident: OperatorIncident = {
  schemaVersion: '1',
  incidentId: 'inc-1',
  component: 'queue',
  status: 'open',
  summary: 'Backlog growing.',
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
};

const receipt: OperatorActionReceipt = {
  schemaVersion: '1',
  actionId: 'act-1',
  tenantId: 'tenant-acme',
  targetJobId: 'job-1',
  kind: 'drain',
  leaseEpoch: 4,
  reason: 'Stuck lease.',
  operatorId: 'user-operator',
  createdAt: NOW_ISO,
};

const thread: Thread = {
  schemaVersion: '1',
  threadId: 'thread-1',
  tenantId: 'tenant-acme',
  runId: 'run-1',
  candidateDigest: HEX_64,
  audience: 'internal',
  status: 'open',
  audienceHistory: [],
  createdAt: NOW_ISO,
};

const comment: Comment = {
  schemaVersion: '1',
  commentId: 'comment-1',
  threadId: 'thread-1',
  tenantId: 'tenant-acme',
  authorId: 'user-owner',
  body: 'Looks right.',
  version: 1,
  outdated: false,
  createdAt: NOW_ISO,
};

const share: ShareRecord = {
  schemaVersion: '1',
  shareId: 'share-1',
  threadId: 'thread-1',
  tenantId: 'tenant-acme',
  sharedWith: 'user-member',
  grantedBy: 'user-owner',
  createdAt: NOW_ISO,
};

function unknown(what: string): ChangeProofError {
  return new ChangeProofError(`${what} is unknown.`);
}

function operatorOnly(): ChangeProofError {
  return new ChangeProofError('Only the operator console may take this action; owners stay out (NEG3-34).');
}

const support: SupportStore = {
  createTicket: () => Promise.resolve(ticket),
  listTickets: () => Promise.resolve({ items: [ticket], cursor: '' }),
  // Stubs mirror the real store's role gate so the HTTP 403 mapping is
  // proven here; the gate itself is proven natively against real roles.
  triageTicket: (_actor, input) =>
    input.ticketId === 'ticket-missing'
      ? Promise.reject(unknown('Ticket'))
      : Promise.resolve({ ...ticket, status: 'triaged' as const }),
  resolveTicket: (_actor, input) =>
    input.ticketId === 'ticket-missing'
      ? Promise.reject(unknown('Ticket'))
      : Promise.resolve({ ...ticket, status: 'resolved' as const }),
  closeTicket: (_actor, input) =>
    input.ticketId === 'ticket-missing'
      ? Promise.reject(unknown('Ticket'))
      : Promise.resolve({ ...ticket, status: 'closed' as const }),
  requestAccess: () => Promise.resolve(accessRequest),
  decideAccess: (_actor, input) =>
    input.requestId === 'accreq-missing'
      ? Promise.reject(unknown('Access request'))
      : Promise.resolve({ requestId: input.requestId, status: input.decision === 'approve' ? 'approved' : 'denied', grantId: input.decision === 'approve' ? 'grant-1' : null }),
  revokeGrant: (_actor, input) =>
    input.grantId === 'grant-missing' ? Promise.reject(unknown('Support grant')) : Promise.resolve(),
  listActiveScopes: () => Promise.reject(new Error('internal only: never over HTTP')),
  logAccess: () => Promise.reject(new Error('internal only: never over HTTP')),
  reportIncident: (actor) =>
    actor.sessionId === 'sess-operator' ? Promise.resolve(incident) : Promise.reject(operatorOnly()),
  listIncidents: () => Promise.resolve({ items: [incident], cursor: '' }),
  acknowledgeIncident: (actor, input) =>
    actor.sessionId !== 'sess-operator'
      ? Promise.reject(operatorOnly())
      : input.incidentId === 'inc-missing'
        ? Promise.reject(unknown('Incident'))
        : Promise.resolve({ ...incident, status: 'mitigating' as const }),
  resolveIncident: (actor, input) =>
    actor.sessionId !== 'sess-operator'
      ? Promise.reject(operatorOnly())
      : input.incidentId === 'inc-missing'
        ? Promise.reject(unknown('Incident'))
        : Promise.resolve({ ...incident, status: 'resolved' as const }),
  drainTarget: (actor) =>
    actor.sessionId === 'sess-operator' ? Promise.resolve(receipt) : Promise.reject(operatorOnly()),
  quarantineTarget: (actor) =>
    actor.sessionId === 'sess-operator'
      ? Promise.resolve({ ...receipt, actionId: 'act-2', kind: 'quarantine' as const })
      : Promise.reject(operatorOnly()),
  inspectTarget: (actor) =>
    actor.sessionId === 'sess-operator'
      ? Promise.resolve({ tenantId: 'tenant-acme', state: 'running', epoch: 4 })
      : Promise.reject(operatorOnly()),
  listOperatorActions: () => Promise.resolve({ items: [receipt], cursor: '' }),
};

const collaboration: CollaborationStore = {
  createThread: () => Promise.resolve(thread),
  listThreads: () => Promise.resolve({ threads: [thread] }),
  postComment: () => Promise.resolve(comment),
  editComment: (_actor, input) =>
    input.commentId === 'comment-missing' ? Promise.reject(unknown('Comment')) : Promise.resolve({ ...comment, version: 2 }),
  listComments: (_actor, input) =>
    input.threadId === 'thread-missing' ? Promise.reject(unknown('Thread')) : Promise.resolve({ comments: [comment] }),
  commentHistory: (_actor, input) =>
    input.commentId === 'comment-missing'
      ? Promise.reject(unknown('Comment'))
      : Promise.resolve({ versions: [{ version: 1, body: 'Looks right.', editedAt: NOW_ISO }] }),
  resolveThread: (_actor, input) =>
    input.threadId === 'thread-missing'
      ? Promise.reject(unknown('Thread'))
      : Promise.resolve({ ...thread, status: 'resolved' as const }),
  changeAudience: (_actor, input) =>
    input.threadId === 'thread-missing' ? Promise.reject(unknown('Thread')) : Promise.resolve(thread),
  shareThread: () => Promise.resolve(share),
  revokeShare: (_actor, input) =>
    input.shareId === 'share-missing' ? Promise.reject(unknown('Share')) : Promise.resolve(),
  recordCandidateRevision: () => Promise.reject(new Error('workers only: never over HTTP')),
};

const capabilities = {
  listRecords: () => [
    {
      schemaVersion: '2' as const,
      key: {
        ecosystem: 'typescript' as const,
        language: 'typescript',
        framework: 'express',
        versionRange: '>=4.21.0 <5.0.0',
        componentKind: 'backend' as const,
        changeCategory: 'api-contract' as const,
        featureRestrictions: [],
        runnerProfile: 'node-24',
        adapterVersion: '1.1.0',
      },
      targetLevel: 'L3' as const,
      provenLevel: 'none' as const,
      certificationStatus: 'uncertified' as const,
      evidenceRefs: [],
      limitations: [],
      toolchainIdentities: {},
    },
    {
      schemaVersion: '2' as const,
      key: {
        ecosystem: 'python' as const,
        language: 'python',
        framework: 'django',
        versionRange: '>=5.0 <6.0',
        componentKind: 'backend' as const,
        changeCategory: 'schema' as const,
        featureRestrictions: [],
        runnerProfile: 'python-3.12',
        adapterVersion: '1.0.0',
      },
      targetLevel: 'L2' as const,
      provenLevel: 'none' as const,
      certificationStatus: 'uncertified' as const,
      evidenceRefs: [],
      limitations: [],
      toolchainIdentities: {},
    },
  ],
};

function deps(): TeamworkDeps {
  return {
    session: {
      deriveContext: (input) =>
        input.sessionId === 'sess-owner'
          ? Promise.resolve(ownerCtx)
          : input.sessionId === 'sess-operator'
            ? Promise.resolve({ ...ownerCtx, sessionId: 'sess-operator', userId: 'user-operator', role: 'operator' })
            : Promise.reject(new ChangeProofError('nope')),
    },
    support: { store: support },
    collaboration: { store: collaboration },
    capabilities,
  };
}

let handle: HttpHandle | undefined;
let bare: HttpHandle | undefined;
let base = '';
let bareBase = '';

beforeAll(async () => {
  handle = createHttpServer({ publicSite: composePublicSite(), manifestPath, teamwork: deps() });
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
const owner = { ...UI, Cookie: 'cp_session=sess-owner' };
const operator = { ...UI, Cookie: 'cp_session=sess-operator' };

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

test('tickets file, list, and transition; guests refused', async () => {
  const filed = await call('POST', '/api/support/tickets', {
    headers: owner,
    body: { category: 'bug', summary: 'Checkout 500s', context: 'Pay step fails.' },
  });
  expect(filed.status).toBe(201);
  const listed = await call('GET', '/api/support/tickets?limit=20', { headers: owner });
  expect(listed.status).toBe(200);
  const triaged = await call('POST', '/api/support/tickets/ticket-1/triage', { headers: owner, body: {} });
  expect(triaged.status).toBe(200);
  const missing = await call('POST', '/api/support/tickets/ticket-missing/triage', { headers: owner, body: {} });
  expect(missing.status).toBe(404);
  const guest = await call('GET', '/api/support/tickets?limit=20');
  expect(guest.status).toBe(401);
});

test('access requests decide and revoke; unknown ids stay quiet', async () => {
  const requested = await call('POST', '/api/support/access-requests', {
    headers: owner,
    body: { resourceType: 'run', resourceId: 'run-1', reason: 'Review the fix.', ttlMs: 3_600_000 },
  });
  expect(requested.status).toBe(201);
  const approved = await call('POST', '/api/support/access-requests/accreq-1/decide', {
    headers: owner,
    body: { decision: 'approve' },
  });
  expect(approved.status).toBe(200);
  expect(approved.body).toEqual({ ok: true, data: { requestId: 'accreq-1', status: 'approved', grantId: 'grant-1' } });
  const revoked = await call('POST', '/api/support/grants/grant-1/revoke', { headers: owner, body: {} });
  expect(revoked.status).toBe(200);
  const missing = await call('POST', '/api/support/grants/grant-missing/revoke', { headers: owner, body: {} });
  expect(missing.status).toBe(404);
});

test('incidents list for tenants; operator writes refuse owners with 403', async () => {
  const listed = await call('GET', '/api/support/incidents?limit=20', { headers: owner });
  expect(listed.status).toBe(200);
  const reported = await call('POST', '/api/operator/incidents', {
    headers: operator,
    body: { component: 'queue', summary: 'Backlog growing.' },
  });
  expect(reported.status).toBe(201);
  const ownerReport = await call('POST', '/api/operator/incidents', {
    headers: owner,
    body: { component: 'queue', summary: 'Backlog growing.' },
  });
  expect(ownerReport.status).toBe(403);
  const ownerDrain = await call('POST', '/api/operator/targets/drain', {
    headers: owner,
    body: { tenantId: 'tenant-acme', jobId: 'job-1', expectedEpoch: 4, reason: 'Nope.' },
  });
  expect(ownerDrain.status).toBe(403);
});

test('operator targets inspect, drain, and quarantine with receipts', async () => {
  const inspected = await call('POST', '/api/operator/targets/inspect', {
    headers: operator,
    body: { tenantId: 'tenant-acme', jobId: 'job-1' },
  });
  expect(inspected.status).toBe(200);
  const drained = await call('POST', '/api/operator/targets/drain', {
    headers: operator,
    body: { tenantId: 'tenant-acme', jobId: 'job-1', expectedEpoch: 4, reason: 'Stuck lease.' },
  });
  expect(drained.status).toBe(200);
  expect(drained.body).toEqual({ ok: true, data: receipt });
  const actions = await call('GET', '/api/operator/actions?limit=20', { headers: operator });
  expect(actions.status).toBe(200);
});

test('threads carry comments, history, audience, and shares', async () => {
  const created = await call('POST', '/api/threads', {
    headers: owner,
    body: { runId: 'run-1', candidateDigest: HEX_64, audience: 'internal' },
  });
  expect(created.status).toBe(201);
  const listed = await call('GET', '/api/threads?runId=run-1', { headers: owner });
  expect(listed.status).toBe(200);
  const posted = await call('POST', '/api/threads/thread-1/comments', {
    headers: owner,
    body: { body: 'Looks right.' },
  });
  expect(posted.status).toBe(201);
  const comments = await call('GET', '/api/threads/thread-1/comments', { headers: owner });
  expect(comments.status).toBe(200);
  const history = await call('GET', '/api/comments/comment-1/history', { headers: owner });
  expect(history.status).toBe(200);
  const shared = await call('POST', '/api/threads/thread-1/share', {
    headers: owner,
    body: { userId: 'user-member' },
  });
  expect(shared.status).toBe(201);
  const resolved = await call('POST', '/api/threads/thread-1/resolve', { headers: owner, body: {} });
  expect(resolved.status).toBe(200);
  const missing = await call('GET', '/api/threads/thread-missing/comments', { headers: owner });
  expect(missing.status).toBe(404);
});

test('worker-only calls have no HTTP route; bare server 503s', async () => {
  const record = await call('POST', '/api/threads/thread-1/revision', { headers: owner, body: {} });
  expect(record.status).toBe(404);
  const bareTickets = await call('GET', '/api/support/tickets?limit=20', { headers: owner, root: bareBase });
  expect(bareTickets.status).toBe(503);
  const bareThreads = await call('GET', '/api/threads?runId=run-1', { headers: owner, root: bareBase });
  expect(bareThreads.status).toBe(503);
});

test('capability matrix reports target next to proven, never merged', async () => {
  const matrix = await call('GET', '/api/support/capabilities', { headers: owner });
  expect(matrix.status).toBe(200);
  const records = (
    matrix.body as {
      data: {
        capabilities: {
          ecosystem: string;
          framework: string;
          version: string;
          feature: string;
          changeType: string;
          targetLevel: string;
          provenLevel: string;
        }[];
      };
    }
  ).data.capabilities;
  expect(records).toHaveLength(2);
  expect(records[0]).toEqual({
    ecosystem: 'typescript',
    framework: 'express',
    version: '>=4.21.0 <5.0.0',
    feature: 'backend',
    changeType: 'api-contract',
    targetLevel: 'L3',
    provenLevel: 'none',
  });
  const guest = await call('GET', '/api/support/capabilities');
  expect(guest.status).toBe(401);
  const bare = await call('GET', '/api/support/capabilities', { headers: owner, root: bareBase });
  expect(bare.status).toBe(503);
});
