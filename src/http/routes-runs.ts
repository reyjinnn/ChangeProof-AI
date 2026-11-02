import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import {
  ChangeProofError,
  DraftBodySchema,
  ExecutionModeSchema,
  IdSchema,
  NonEmptyStringSchema,
  SearchQuerySchema,
  Sha256Schema,
} from '../core/index.js';
import type { LifecycleSessionPort } from '../core/ports/index.js';
import type { LifecycleComposition, QueriesComposition } from '../orchestrator/index.js';
import { actingContext, HttpRouteError, parseBody, pathSegment } from './context.js';
import { sendBytes, sendCreated, sendFail, sendOk } from './respond.js';

/**
 * Run-journey routes (T-45, WP3-25).
 *
 * Thin JSON over the composed lifecycle + queries stores: projects,
 * draft revisions, immutable submits, run reads, event polling,
 * cancel/retry, artifact bytes, and grant-scoped search. The server
 * derives tenant/actor/request identity from the session; the client
 * supplies the idempotency key (stable across its own retries) and
 * the grant version it read (stale grants refuse loudly). Unknown
 * ids answer 404 without disclosure; worker- and control-plane-only
 * calls are never exposed here.
 */

export interface RunsDeps {
  readonly session: LifecycleSessionPort;
  readonly lifecycle: LifecycleComposition;
  readonly queries: QueriesComposition;
}

const ProjectBody = z.strictObject({ name: z.string().trim().min(1).max(200) });
const DraftBody = z.strictObject({
  projectId: IdSchema,
  draftId: IdSchema.optional(),
  body: DraftBodySchema,
});
const DraftQuery = z.strictObject({ revision: z.coerce.number().int().positive().optional() });
const SubmitBody = z.strictObject({
  projectId: IdSchema,
  repositoryIds: z.array(IdSchema).min(1),
  sourceRefs: z.array(NonEmptyStringSchema).min(1),
  intentRef: IdSchema,
  executionMode: ExecutionModeSchema,
  invariantRefs: z.array(IdSchema).min(1),
  verificationPlanRef: IdSchema,
  budgetProfileId: IdSchema,
  publicationConsent: z.boolean(),
  idempotencyKey: Sha256Schema,
  expectedGrantVersion: z.number().int().nonnegative(),
  draftId: IdSchema,
  draftRevision: z.number().int().positive(),
  requestedBudget: z.number().positive(),
});
const EventsQuery = z.strictObject({
  afterSeq: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(100),
});
const RetryBody = z.strictObject({ idempotencyKey: Sha256Schema });

function queryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/** Store refusals map to status without leaking which tenant owns what. */
async function orMapped<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ChangeProofError) {
      if (error.message.includes('unknown or not shared') || error.message.includes('is unknown for this run')) {
        throw new HttpRouteError(404, 'not_found', error.message);
      }
      if (
        error.message.includes('not authorized') ||
        error.message.includes('may read but not change') ||
        error.message.includes('no tenant authority')
      ) {
        throw new HttpRouteError(403, 'forbidden', error.message);
      }
    }
    throw error;
  }
}

export function isRunsPath(pathname: string): boolean {
  return (
    pathname === '/api/projects' ||
    pathname.startsWith('/api/projects/') ||
    pathname === '/api/drafts' ||
    pathname.startsWith('/api/drafts/') ||
    pathname === '/api/runs' ||
    pathname.startsWith('/api/runs/') ||
    pathname === '/api/search'
  );
}

export async function handleRunsApi(
  runs: RunsDeps | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  url: URL,
  rawBody: string,
): Promise<void> {
  if (runs === undefined) {
    sendFail(response, 503, 'runs_unavailable', 'Run services need a database; the server was started without one.');
    return;
  }
  const { pathname } = url;
  const nowIso = new Date().toISOString();

  if (method === 'POST' && pathname === '/api/projects') {
    const ctx = await actingContext(runs.session, request, nowIso);
    const body = parseBody(ProjectBody, rawBody);
    const created = await orMapped(
      runs.lifecycle.store.createProject({ sessionId: ctx.sessionId, nowIso }, { name: body.name }),
    );
    sendCreated(response, created);
    return;
  }
  if (method === 'POST' && pathname === '/api/drafts') {
    const ctx = await actingContext(runs.session, request, nowIso);
    const body = parseBody(DraftBody, rawBody);
    const saved = await orMapped(
      runs.lifecycle.store.saveDraftRevision(
        { sessionId: ctx.sessionId, nowIso },
        {
          projectId: body.projectId,
          ...(body.draftId === undefined ? {} : { draftId: body.draftId }),
          body: body.body,
        },
      ),
    );
    sendCreated(response, saved);
    return;
  }
  if (method === 'GET' && pathname.startsWith('/api/drafts/') && pathname.split('/').length === 4) {
    const ctx = await actingContext(runs.session, request, nowIso);
    const draftId = pathSegment(pathname, 3, 'Draft');
    const query = DraftQuery.parse(queryParams(url));
    const draft = await orMapped(
      runs.lifecycle.store.getDraft(
        { sessionId: ctx.sessionId, nowIso },
        { draftId, ...(query.revision === undefined ? {} : { revision: query.revision }) },
      ),
    );
    sendOk(response, draft);
    return;
  }
  if (method === 'POST' && pathname === '/api/runs') {
    const ctx = await actingContext(runs.session, request, nowIso);
    const body = parseBody(SubmitBody, rawBody);
    const submitted = await orMapped(
      runs.lifecycle.store.submitRun(
        { sessionId: ctx.sessionId, nowIso },
        {
          schemaVersion: '1',
          requestId: `req-${randomBytes(8).toString('hex')}`,
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          projectId: body.projectId,
          repositoryIds: body.repositoryIds,
          sourceRefs: body.sourceRefs,
          intentRef: body.intentRef,
          executionMode: body.executionMode,
          invariantRefs: body.invariantRefs,
          verificationPlanRef: body.verificationPlanRef,
          budgetProfileId: body.budgetProfileId,
          publicationConsent: body.publicationConsent,
          idempotencyKey: body.idempotencyKey,
          expectedGrantVersion: body.expectedGrantVersion,
          draftId: body.draftId,
          draftRevision: body.draftRevision,
          requestedBudget: body.requestedBudget,
        },
      ),
    );
    if (submitted.duplicate) {
      sendOk(response, submitted);
    } else {
      sendCreated(response, submitted);
    }
    return;
  }
  if (method === 'GET' && pathname.startsWith('/api/runs/') && pathname.split('/').length === 4) {
    const ctx = await actingContext(runs.session, request, nowIso);
    const runId = pathSegment(pathname, 3, 'Run');
    const run = await orMapped(runs.lifecycle.store.getRun({ sessionId: ctx.sessionId, nowIso }, { runId }));
    sendOk(response, run);
    return;
  }
  if (method === 'GET' && pathname.endsWith('/events') && pathname.startsWith('/api/runs/')) {
    const ctx = await actingContext(runs.session, request, nowIso);
    const runId = pathSegment(pathname, 3, 'Run');
    const query = EventsQuery.parse(queryParams(url));
    const page = await orMapped(
      runs.lifecycle.store.pollEvents(
        { sessionId: ctx.sessionId, nowIso },
        { runId, afterSeq: query.afterSeq, limit: query.limit },
      ),
    );
    sendOk(response, page);
    return;
  }
  if (method === 'POST' && pathname.endsWith('/cancel') && pathname.startsWith('/api/runs/')) {
    const ctx = await actingContext(runs.session, request, nowIso);
    const runId = pathSegment(pathname, 3, 'Run');
    const cancelled = await orMapped(runs.lifecycle.store.cancelRun({ sessionId: ctx.sessionId, nowIso }, { runId }));
    sendOk(response, cancelled);
    return;
  }
  if (method === 'POST' && pathname.endsWith('/retry') && pathname.startsWith('/api/runs/')) {
    const ctx = await actingContext(runs.session, request, nowIso);
    const runId = pathSegment(pathname, 3, 'Run');
    const body = parseBody(RetryBody, rawBody);
    const retried = await orMapped(
      runs.lifecycle.store.retryRun(
        { sessionId: ctx.sessionId, nowIso },
        { runId, idempotencyKey: body.idempotencyKey },
      ),
    );
    if (retried.duplicate) {
      sendOk(response, retried);
    } else {
      sendCreated(response, retried);
    }
    return;
  }
  if (method === 'GET' && pathname.includes('/artifacts/') && pathname.startsWith('/api/runs/')) {
    const ctx = await actingContext(runs.session, request, nowIso);
    const runId = pathSegment(pathname, 3, 'Run');
    const digest = pathSegment(pathname, 5, 'Artifact');
    const artifact = await orMapped(
      runs.lifecycle.store.downloadArtifact({ sessionId: ctx.sessionId, nowIso }, { runId, digest }),
    );
    sendBytes(response, artifact.bytes, artifact.digest);
    return;
  }
  if (method === 'POST' && pathname === '/api/search') {
    const ctx = await actingContext(runs.session, request, nowIso);
    const query = SearchQuerySchema.parse(parseBody(z.unknown(), rawBody));
    const result = await orMapped(
      runs.queries.store.search({ sessionId: ctx.sessionId, nowIso }, query),
    );
    sendOk(response, result);
    return;
  }
  sendFail(response, 404, 'unknown_endpoint', `No API endpoint at "${pathname}".`);
}
