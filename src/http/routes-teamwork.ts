import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import {
  AccessResourceSchema,
  ChangeProofError,
  CommentBodySchema,
  IdSchema,
  NonEmptyStringSchema,
  SanitizedTextSchema,
  Sha256Schema,
  ThreadAudienceSchema,
  TicketCategorySchema,
  TicketStatusSchema,
} from '../core/index.js';
import type { LifecycleSessionPort } from '../core/ports/index.js';
import type { CollaborationComposition, SupportComposition } from '../orchestrator/index.js';
import { actingContext, HttpRouteError, parseBody, pathSegment } from './context.js';
import { sendCreated, sendFail, sendOk } from './respond.js';

/**
 * Teamwork routes (T-48, WP3-30): support tickets, access requests and
 * grants, tenant-visible incidents, the operator console
 * (incidents/targets/actions), and run discussion threads with
 * comments, history, audience, and shares.
 *
 * Thin JSON over the composed stores; role gates live in the stores
 * and map here to 403 without disclosing what was refused. Internal
 * scope/audit calls and worker-only candidate revisions are never
 * exposed.
 */

export interface TeamworkDeps {
  readonly session: LifecycleSessionPort;
  readonly support: SupportComposition;
  readonly collaboration: CollaborationComposition;
}

const PageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50),
  cursor: z.string().max(300).optional(),
});
const TicketListQuery = PageQuery.extend({ status: TicketStatusSchema.optional() });
const ThreadListQuery = z.strictObject({ runId: IdSchema });
const TicketBody = z.strictObject({
  category: TicketCategorySchema,
  summary: NonEmptyStringSchema,
  context: SanitizedTextSchema,
  runId: IdSchema.optional(),
});
const AccessRequestBody = z.strictObject({
  resourceType: AccessResourceSchema,
  resourceId: IdSchema,
  reason: SanitizedTextSchema,
  ttlMs: z.number().int().min(60_000),
});
const DecideBody = z.strictObject({ decision: z.enum(['approve', 'deny']) });
const IncidentBody = z.strictObject({
  component: NonEmptyStringSchema,
  summary: SanitizedTextSchema,
  queueImpact: z.string().max(500).optional(),
  modelImpact: z.string().max(500).optional(),
});
const InspectBody = z.strictObject({ tenantId: IdSchema, jobId: IdSchema });
const FencedBody = z.strictObject({
  tenantId: IdSchema,
  jobId: IdSchema,
  expectedEpoch: z.number().int().positive(),
  reason: SanitizedTextSchema,
});
const ThreadBody = z.strictObject({
  runId: IdSchema,
  candidateDigest: Sha256Schema,
  artifactRef: NonEmptyStringSchema.optional(),
  diffLocation: NonEmptyStringSchema.optional(),
  audience: ThreadAudienceSchema,
});
const CommentBody = z.strictObject({ body: CommentBodySchema });
const AudienceBody = z.strictObject({ audience: ThreadAudienceSchema });
const ShareBody = z.strictObject({ userId: IdSchema });

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
      if (error.message.includes('unknown')) {
        throw new HttpRouteError(404, 'not_found', error.message);
      }
      if (
        error.message.includes('Only ') ||
        error.message.includes('no tenant authority') ||
        error.message.includes('no thread authority') ||
        error.message.includes('does not hold') ||
        error.message.includes('Approver ')
      ) {
        throw new HttpRouteError(403, 'forbidden', error.message);
      }
    }
    throw error;
  }
}

export function isTeamworkPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/support/') ||
    pathname.startsWith('/api/operator/') ||
    pathname === '/api/threads' ||
    pathname.startsWith('/api/threads/') ||
    pathname.startsWith('/api/comments/')
  );
}

export async function handleTeamworkApi(
  deps: TeamworkDeps | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  url: URL,
  rawBody: string,
): Promise<void> {
  if (deps === undefined) {
    sendFail(response, 503, 'teamwork_unavailable', 'Teamwork services need a database; the server was started without one.');
    return;
  }
  const { pathname } = url;
  const nowIso = new Date().toISOString();
  const actor = async () => {
    const ctx = await actingContext(deps.session, request, nowIso);
    return { sessionId: ctx.sessionId, nowIso };
  };

  if (method === 'POST' && pathname === '/api/support/tickets') {
    const body = parseBody(TicketBody, rawBody);
    const ticket = await orMapped(
      deps.support.store.createTicket(await actor(), {
        category: body.category,
        summary: body.summary,
        context: body.context,
        ...(body.runId === undefined ? {} : { runId: body.runId }),
      }),
    );
    sendCreated(response, ticket);
    return;
  }
  if (method === 'GET' && pathname === '/api/support/tickets') {
    const query = TicketListQuery.parse(queryParams(url));
    const listed = await orMapped(
      deps.support.store.listTickets(await actor(), {
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.status === undefined ? {} : { status: query.status }),
      }),
    );
    sendOk(response, listed);
    return;
  }
  if (
    method === 'POST' &&
    pathname.startsWith('/api/support/tickets/') &&
    (pathname.endsWith('/triage') || pathname.endsWith('/resolve') || pathname.endsWith('/close'))
  ) {
    const acting = await actor();
    const ticketId = pathSegment(pathname, 4, 'Ticket');
    if (pathname.endsWith('/triage')) {
      sendOk(response, await orMapped(deps.support.store.triageTicket(acting, { ticketId })));
    } else if (pathname.endsWith('/resolve')) {
      sendOk(response, await orMapped(deps.support.store.resolveTicket(acting, { ticketId })));
    } else {
      sendOk(response, await orMapped(deps.support.store.closeTicket(acting, { ticketId })));
    }
    return;
  }
  if (method === 'POST' && pathname === '/api/support/access-requests') {
    const requested = await orMapped(
      deps.support.store.requestAccess(await actor(), parseBody(AccessRequestBody, rawBody)),
    );
    sendCreated(response, requested);
    return;
  }
  if (
    method === 'POST' &&
    pathname.startsWith('/api/support/access-requests/') &&
    pathname.endsWith('/decide')
  ) {
    const acting = await actor();
    const requestId = pathSegment(pathname, 4, 'Access request');
    const decided = await orMapped(
      deps.support.store.decideAccess(acting, { requestId, decision: parseBody(DecideBody, rawBody).decision }),
    );
    sendOk(response, decided);
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/support/grants/') && pathname.endsWith('/revoke')) {
    const acting = await actor();
    const grantId = pathSegment(pathname, 4, 'Support grant');
    await orMapped(deps.support.store.revokeGrant(acting, { grantId }));
    sendOk(response, { grantId });
    return;
  }
  if (method === 'GET' && pathname === '/api/support/incidents') {
    const query = PageQuery.parse(queryParams(url));
    const listed = await orMapped(
      deps.support.store.listIncidents(await actor(), {
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
    );
    sendOk(response, listed);
    return;
  }
  if (method === 'POST' && pathname === '/api/operator/incidents') {
    const body = parseBody(IncidentBody, rawBody);
    const reported = await orMapped(
      deps.support.store.reportIncident(await actor(), {
        component: body.component,
        summary: body.summary,
        ...(body.queueImpact === undefined ? {} : { queueImpact: body.queueImpact }),
        ...(body.modelImpact === undefined ? {} : { modelImpact: body.modelImpact }),
      }),
    );
    sendCreated(response, reported);
    return;
  }
  if (
    method === 'POST' &&
    pathname.startsWith('/api/operator/incidents/') &&
    (pathname.endsWith('/acknowledge') || pathname.endsWith('/resolve'))
  ) {
    const acting = await actor();
    const incidentId = pathSegment(pathname, 4, 'Incident');
    if (pathname.endsWith('/acknowledge')) {
      sendOk(response, await orMapped(deps.support.store.acknowledgeIncident(acting, { incidentId })));
    } else {
      sendOk(response, await orMapped(deps.support.store.resolveIncident(acting, { incidentId })));
    }
    return;
  }
  if (method === 'POST' && pathname === '/api/operator/targets/inspect') {
    const inspected = await orMapped(deps.support.store.inspectTarget(await actor(), parseBody(InspectBody, rawBody)));
    sendOk(response, inspected);
    return;
  }
  if (
    method === 'POST' &&
    (pathname === '/api/operator/targets/drain' || pathname === '/api/operator/targets/quarantine')
  ) {
    const acting = await actor();
    const body = parseBody(FencedBody, rawBody);
    if (pathname.endsWith('/drain')) {
      sendOk(response, await orMapped(deps.support.store.drainTarget(acting, body)));
    } else {
      sendOk(response, await orMapped(deps.support.store.quarantineTarget(acting, body)));
    }
    return;
  }
  if (method === 'GET' && pathname === '/api/operator/actions') {
    const query = PageQuery.parse(queryParams(url));
    const listed = await orMapped(
      deps.support.store.listOperatorActions(await actor(), {
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
    );
    sendOk(response, listed);
    return;
  }
  if (method === 'POST' && pathname === '/api/threads') {
    const body = parseBody(ThreadBody, rawBody);
    const created = await orMapped(
      deps.collaboration.store.createThread(await actor(), {
        runId: body.runId,
        candidateDigest: body.candidateDigest,
        audience: body.audience,
        ...(body.artifactRef === undefined ? {} : { artifactRef: body.artifactRef }),
        ...(body.diffLocation === undefined ? {} : { diffLocation: body.diffLocation }),
      }),
    );
    sendCreated(response, created);
    return;
  }
  if (method === 'GET' && pathname === '/api/threads') {
    const query = ThreadListQuery.parse(queryParams(url));
    const listed = await orMapped(deps.collaboration.store.listThreads(await actor(), { runId: query.runId }));
    sendOk(response, listed);
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/threads/shares/') && pathname.endsWith('/revoke')) {
    const acting = await actor();
    const shareId = pathSegment(pathname, 4, 'Share');
    await orMapped(deps.collaboration.store.revokeShare(acting, { shareId }));
    sendOk(response, { shareId });
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/threads/') && pathname.endsWith('/resolve')) {
    const acting = await actor();
    const threadId = pathSegment(pathname, 3, 'Thread');
    sendOk(response, await orMapped(deps.collaboration.store.resolveThread(acting, { threadId })));
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/threads/') && pathname.endsWith('/audience')) {
    const acting = await actor();
    const threadId = pathSegment(pathname, 3, 'Thread');
    const changed = await orMapped(
      deps.collaboration.store.changeAudience(acting, {
        threadId,
        audience: parseBody(AudienceBody, rawBody).audience,
      }),
    );
    sendOk(response, changed);
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/threads/') && pathname.endsWith('/share')) {
    const acting = await actor();
    const threadId = pathSegment(pathname, 3, 'Thread');
    const shared = await orMapped(
      deps.collaboration.store.shareThread(acting, { threadId, userId: parseBody(ShareBody, rawBody).userId }),
    );
    sendCreated(response, shared);
    return;
  }
  if (method === 'GET' && pathname.startsWith('/api/threads/') && pathname.endsWith('/comments')) {
    const acting = await actor();
    const threadId = pathSegment(pathname, 3, 'Thread');
    sendOk(response, await orMapped(deps.collaboration.store.listComments(acting, { threadId })));
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/threads/') && pathname.endsWith('/comments')) {
    const acting = await actor();
    const threadId = pathSegment(pathname, 3, 'Thread');
    const posted = await orMapped(
      deps.collaboration.store.postComment(acting, { threadId, body: parseBody(CommentBody, rawBody).body }),
    );
    sendCreated(response, posted);
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/comments/') && pathname.endsWith('/edit')) {
    const acting = await actor();
    const commentId = pathSegment(pathname, 3, 'Comment');
    const edited = await orMapped(
      deps.collaboration.store.editComment(acting, { commentId, body: parseBody(CommentBody, rawBody).body }),
    );
    sendOk(response, edited);
    return;
  }
  if (method === 'GET' && pathname.startsWith('/api/comments/') && pathname.endsWith('/history')) {
    const acting = await actor();
    const commentId = pathSegment(pathname, 3, 'Comment');
    sendOk(response, await orMapped(deps.collaboration.store.commentHistory(acting, { commentId })));
    return;
  }
  sendFail(response, 404, 'unknown_endpoint', `No API endpoint at "${pathname}".`);
}
