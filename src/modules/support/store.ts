import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  AccessRequestSchema,
  AccessResourceSchema,
  ChangeProofError,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  OperatorActionReceiptSchema,
  OperatorIncidentSchema,
  SanitizedTextSchema,
  SupportTicketSchema,
  TicketCategorySchema,
  TicketStatusSchema,
  type AccessRequest,
  type OperatorActionReceipt,
  type OperatorIncident,
  type SupportTicket,
  type TenantContext,
} from '../../core/index.js';
import type { LifecycleSessionPort, SupportGrantScope } from '../../core/ports/index.js';

/**
 * PostgreSQL-backed support (WP3-30, FR3-41).
 *
 * Tickets, access requests, scoped grants, access audit, operator incidents,
 * and fenced operator actions live in `infra/postgres/V8` and are reached
 * only with bound parameters. Every session call re-derives the context
 * first. A request is never a grant: approvals mint a separate scoped,
 * expiring grant row, and every grant-authorized read is logged. Owners
 * cannot reach the operator console — incidents and drain/quarantine actions
 * require the operator role, while operators hold no tenant authority outside
 * an active grant. Drain and quarantine fence against the live jobs lease
 * epoch; a stale epoch refuses. Incident rows are platform-wide status
 * without customer source.
 */

export interface SupportDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface SupportDbClient {
  query(text: string, params?: readonly unknown[]): Promise<SupportDbResult>;
  release(): void;
}

export interface SupportDb {
  query(text: string, params?: readonly unknown[]): Promise<SupportDbResult>;
  connect(): Promise<SupportDbClient>;
}

export interface SupportActor {
  readonly sessionId: string;
  readonly nowIso: string;
}

export interface CreateTicketInput {
  readonly category: string;
  readonly summary: string;
  readonly context: string;
  readonly runId?: string;
}

export interface ListTicketsInput {
  readonly limit: number;
  readonly cursor?: string;
  readonly status?: string;
}

export interface TicketRefInput {
  readonly ticketId: string;
}

export interface RequestAccessInput {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly reason: string;
  readonly ttlMs: number;
}

export interface DecideAccessInput {
  readonly requestId: string;
  readonly decision: 'approve' | 'deny';
}

export interface RevokeGrantInput {
  readonly grantId: string;
}

export interface ReportIncidentInput {
  readonly component: string;
  readonly summary: string;
  readonly queueImpact?: string;
  readonly modelImpact?: string;
}

export interface IncidentRefInput {
  readonly incidentId: string;
}

export interface ListIncidentsInput {
  readonly limit: number;
  readonly cursor?: string;
}

export interface FencedActionInput {
  readonly tenantId: string;
  readonly jobId: string;
  readonly expectedEpoch: number;
  readonly reason: string;
}

export interface InspectTargetInput {
  readonly tenantId: string;
  readonly jobId: string;
}

export interface ListActionsInput {
  readonly limit: number;
  readonly cursor?: string;
}

export interface LogAccessInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly grantId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly nowIso: string;
}

export interface SupportDeps {
  readonly session: LifecycleSessionPort;
  readonly jobs: {
    requestJobCancel(input: { tenantId: string; jobId: string; nowIso: string }): Promise<void>;
  };
}

export interface SupportStore {
  createTicket(actor: SupportActor, input: CreateTicketInput): Promise<SupportTicket>;
  listTickets(
    actor: SupportActor,
    input: ListTicketsInput,
  ): Promise<{ items: readonly SupportTicket[]; cursor: string }>;
  triageTicket(actor: SupportActor, input: TicketRefInput): Promise<SupportTicket>;
  resolveTicket(actor: SupportActor, input: TicketRefInput): Promise<SupportTicket>;
  closeTicket(actor: SupportActor, input: TicketRefInput): Promise<SupportTicket>;
  requestAccess(actor: SupportActor, input: RequestAccessInput): Promise<AccessRequest>;
  decideAccess(
    actor: SupportActor,
    input: DecideAccessInput,
  ): Promise<{ requestId: string; status: string; grantId: string | null }>;
  revokeGrant(actor: SupportActor, input: RevokeGrantInput): Promise<void>;
  listActiveScopes(tenantId: string, userId: string, nowIso: string): Promise<readonly SupportGrantScope[]>;
  logAccess(input: LogAccessInput): Promise<void>;
  reportIncident(actor: SupportActor, input: ReportIncidentInput): Promise<OperatorIncident>;
  listIncidents(
    actor: SupportActor,
    input: ListIncidentsInput,
  ): Promise<{ items: readonly OperatorIncident[]; cursor: string }>;
  acknowledgeIncident(actor: SupportActor, input: IncidentRefInput): Promise<OperatorIncident>;
  resolveIncident(actor: SupportActor, input: IncidentRefInput): Promise<OperatorIncident>;
  drainTarget(actor: SupportActor, input: FencedActionInput): Promise<OperatorActionReceipt>;
  quarantineTarget(actor: SupportActor, input: FencedActionInput): Promise<OperatorActionReceipt>;
  inspectTarget(
    actor: SupportActor,
    input: InspectTargetInput,
  ): Promise<{ tenantId: string; state: string; epoch: number }>;
  listOperatorActions(
    actor: SupportActor,
    input: ListActionsInput,
  ): Promise<{ items: readonly OperatorActionReceipt[]; cursor: string }>;
}

const TicketRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  reporter_id: z.string(),
  category: z.string(),
  summary: z.string(),
  context: z.string(),
  run_id: z.string().nullable(),
  status: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

const AccessRequestRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  requester_id: z.string(),
  resource_type: z.string(),
  resource_id: z.string(),
  reason: z.string(),
  status: z.string(),
  expires_at: z.date(),
  decided_by: z.string().nullable(),
  decided_at: z.date().nullable(),
  created_at: z.date(),
});

const GrantRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  user_id: z.string(),
  request_id: z.string(),
  resource_type: z.string(),
  resource_id: z.string(),
  expires_at: z.date(),
  revoked_at: z.date().nullable(),
  created_at: z.date(),
});

const IncidentRowSchema = z.object({
  id: z.string(),
  component: z.string(),
  status: z.string(),
  summary: z.string(),
  queue_impact: z.string().nullable(),
  model_impact: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const ActionRowSchema = z.object({
  action_id: z.string(),
  tenant_id: z.string(),
  target_job_id: z.string(),
  kind: z.string(),
  lease_epoch: z.number(),
  reason: z.string(),
  operator_id: z.string(),
  created_at: z.date(),
});

const MAX_TTL_MS = 7 * 24 * 3_600_000;

function randomId(prefix: string): string {
  return IdSchema.parse(`${prefix}-${randomBytes(8).toString('hex')}`);
}

function parseTicket(row: unknown): SupportTicket {
  const parsed = TicketRowSchema.parse(row);
  return SupportTicketSchema.parse({
    schemaVersion: '1',
    ticketId: parsed.id,
    tenantId: parsed.tenant_id,
    reporterId: parsed.reporter_id,
    category: parsed.category,
    summary: parsed.summary,
    context: parsed.context,
    ...(parsed.run_id === null ? {} : { runId: parsed.run_id }),
    status: parsed.status,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function parseAccessRequest(row: unknown): AccessRequest {
  const parsed = AccessRequestRowSchema.parse(row);
  return AccessRequestSchema.parse({
    schemaVersion: '1',
    requestId: parsed.id,
    tenantId: parsed.tenant_id,
    requesterId: parsed.requester_id,
    resourceType: parsed.resource_type,
    resourceId: parsed.resource_id,
    reason: parsed.reason,
    status: parsed.status,
    expiresAt: parsed.expires_at.toISOString(),
    ...(parsed.decided_by === null ? {} : { decidedBy: parsed.decided_by }),
    ...(parsed.decided_at === null ? {} : { decidedAt: parsed.decided_at.toISOString() }),
    createdAt: parsed.created_at.toISOString(),
  });
}

function parseIncident(row: unknown): OperatorIncident {
  const parsed = IncidentRowSchema.parse(row);
  return OperatorIncidentSchema.parse({
    schemaVersion: '1',
    incidentId: parsed.id,
    component: parsed.component,
    status: parsed.status,
    summary: parsed.summary,
    ...(parsed.queue_impact === null ? {} : { queueImpact: parsed.queue_impact }),
    ...(parsed.model_impact === null ? {} : { modelImpact: parsed.model_impact }),
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function parseAction(row: unknown): OperatorActionReceipt {
  const parsed = ActionRowSchema.parse(row);
  return OperatorActionReceiptSchema.parse({
    schemaVersion: '1',
    actionId: parsed.action_id,
    tenantId: parsed.tenant_id,
    targetJobId: parsed.target_job_id,
    kind: parsed.kind,
    leaseEpoch: parsed.lease_epoch,
    reason: parsed.reason,
    operatorId: parsed.operator_id,
    createdAt: parsed.created_at.toISOString(),
  });
}

function parseCursor(cursor: string | undefined): { afterCreatedAt: string | null; afterId: string | null } {
  if (cursor === undefined || cursor === '') return { afterCreatedAt: null, afterId: null };
  const [afterCreatedAt, afterId] = cursor.split('|');
  if (afterCreatedAt === undefined || afterId === undefined || afterCreatedAt === '' || afterId === '') {
    throw new ChangeProofError('Cursor is unreadable; refusing to page.');
  }
  return { afterCreatedAt, afterId };
}

export function createSupportStore(db: SupportDb, deps: SupportDeps): SupportStore {
  async function inTenant<T>(tenantId: string, work: (client: SupportDbClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      try {
        await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async function inPlatform<T>(work: (client: SupportDbClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      try {
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async function derive(actor: SupportActor): Promise<TenantContext> {
    const context = await deps.session.deriveContext({
      sessionId: IdSchema.parse(actor.sessionId),
      nowIso: InstantSchema.parse(actor.nowIso),
    });
    const source: string = context.authoritySource;
    if (source !== 'server') {
      throw new ChangeProofError('Tenant context is not server-derived; refusing to authorize.');
    }
    return context;
  }

  function assertTenantMember(context: TenantContext): void {
    if (context.role === 'operator') {
      throw new ChangeProofError('Operator accounts carry no tenant authority here (NEG3-34).');
    }
  }

  function assertOwnerAdmin(context: TenantContext): void {
    if (context.role !== 'owner' && context.role !== 'admin') {
      throw new ChangeProofError('Only owners and admins may take this support action.');
    }
  }

  function assertOperator(context: TenantContext): void {
    if (context.role !== 'operator') {
      throw new ChangeProofError('Only the operator console may take this action; owners stay out (NEG3-34).');
    }
  }

  async function fencedAction(
    context: TenantContext,
    tenantId: string,
    kind: 'drain' | 'quarantine' | 'inspect',
    jobId: string,
    expectedEpoch: number | null,
    reason: string | null,
    nowIso: string,
  ): Promise<{ tenantId: string; state: string; epoch: number; receipt: OperatorActionReceipt | null }> {
    return inTenant(tenantId, async (client) => {
      const lease = await client.query('SELECT epoch FROM job_leases WHERE job_id = $1', [jobId]);
      const epoch = (lease.rows[0] as { epoch: number } | undefined)?.epoch;
      if (epoch === undefined) {
        throw new ChangeProofError('Target job has no live lease; refusing a blind operator action.');
      }
      const job = await client.query('SELECT tenant_id, state FROM jobs WHERE id = $1', [jobId]);
      const jobRow = job.rows[0] as { tenant_id: string; state: string } | undefined;
      if (jobRow?.tenant_id !== tenantId) {
        throw new ChangeProofError('Target job is unknown for this tenant.');
      }
      if (kind === 'inspect') {
        return { tenantId: jobRow.tenant_id, state: jobRow.state, epoch, receipt: null };
      }
      if (expectedEpoch === null || expectedEpoch !== epoch) {
        throw new ChangeProofError(
          `Lease epoch moved (live ${epoch}); the operator action fenced stale and refuses.`,
        );
      }
      const safeReason = SanitizedTextSchema.parse(reason ?? '');
      const actionId = randomId('act');
      await client.query(
        'INSERT INTO operator_actions (action_id, tenant_id, target_job_id, kind, lease_epoch, reason, operator_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [actionId, jobRow.tenant_id, jobId, kind, epoch, safeReason, context.userId, nowIso],
      );
      const receipt = OperatorActionReceiptSchema.parse({
        schemaVersion: '1',
        actionId,
        tenantId: jobRow.tenant_id,
        targetJobId: jobId,
        kind,
        leaseEpoch: epoch,
        reason: safeReason,
        operatorId: context.userId,
        createdAt: nowIso,
      });
      return { tenantId: jobRow.tenant_id, state: jobRow.state, epoch, receipt };
    });
  }

  return {
    async createTicket(actor, input) {
      const context = await derive(actor);
      assertTenantMember(context);
      const ticket = SupportTicketSchema.parse({
        schemaVersion: '1',
        ticketId: randomId('ticket'),
        tenantId: context.tenantId,
        reporterId: context.userId,
        category: TicketCategorySchema.parse(input.category),
        summary: NonEmptyStringSchema.parse(input.summary),
        context: SanitizedTextSchema.parse(input.context),
        ...(input.runId === undefined ? {} : { runId: IdSchema.parse(input.runId) }),
        status: 'open' as const,
        createdAt: actor.nowIso,
        updatedAt: actor.nowIso,
      });
      await inTenant(context.tenantId, async (client) => {
        if (ticket.runId !== undefined) {
          const run = await client.query('SELECT project_id FROM lifecycle_runs WHERE id = $1', [ticket.runId]);
          const projectId = (run.rows[0] as { project_id: string } | undefined)?.project_id;
          if (projectId === undefined || !context.projectGrants.includes(projectId)) {
            throw new ChangeProofError('Linked run is unknown or not shared with you.');
          }
        }
        await client.query(
          'INSERT INTO support_tickets (id, tenant_id, reporter_id, category, summary, context, run_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [
            ticket.ticketId,
            ticket.tenantId,
            ticket.reporterId,
            ticket.category,
            ticket.summary,
            ticket.context,
            ticket.runId ?? null,
            ticket.status,
            ticket.createdAt,
            ticket.updatedAt,
          ],
        );
      });
      return ticket;
    },

    async listTickets(actor, input) {
      const context = await derive(actor);
      assertTenantMember(context);
      const limit = z.number().int().min(1).max(50).parse(input.limit);
      const status = input.status === undefined ? undefined : TicketStatusSchema.parse(input.status);
      const { afterCreatedAt, afterId } = parseCursor(input.cursor);
      return inTenant(context.tenantId, async (client) => {
        const params: unknown[] = [];
        const clauses: string[] = [];
        if (context.role !== 'owner' && context.role !== 'admin') {
          params.push(context.userId);
          clauses.push(`reporter_id = $${params.length}`);
        }
        if (status !== undefined) {
          params.push(status);
          clauses.push(`status = $${params.length}`);
        }
        const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
        const rows = await client.query(
          `SELECT * FROM support_tickets ${where} ORDER BY created_at DESC, id DESC`,
          params,
        );
        const items = rows.rows
          .map((row) => parseTicket(row))
          .filter(
            (ticket) =>
              afterCreatedAt === null ||
              afterId === null ||
              ticket.createdAt < afterCreatedAt ||
              (ticket.createdAt === afterCreatedAt && ticket.ticketId < afterId),
          )
          .slice(0, limit);
        const last = items[items.length - 1];
        return { items, cursor: last === undefined ? '' : `${last.createdAt}|${last.ticketId}` };
      });
    },

    async triageTicket(actor, input) {
      const context = await derive(actor);
      assertOwnerAdmin(context);
      const ticketId = IdSchema.parse(input.ticketId);
      return inTenant(context.tenantId, async (client) => {
        const moved = await client.query(
          "UPDATE support_tickets SET status = 'triaged', updated_at = $2 WHERE id = $1 AND status = 'open' RETURNING *",
          [ticketId, actor.nowIso],
        );
        if (moved.rows.length === 0) {
          throw new ChangeProofError('Ticket is unknown or not open for triage.');
        }
        return parseTicket(moved.rows[0]);
      });
    },

    async resolveTicket(actor, input) {
      const context = await derive(actor);
      assertOwnerAdmin(context);
      const ticketId = IdSchema.parse(input.ticketId);
      return inTenant(context.tenantId, async (client) => {
        const moved = await client.query(
          "UPDATE support_tickets SET status = 'resolved', updated_at = $2 WHERE id = $1 AND status = 'triaged' RETURNING *",
          [ticketId, actor.nowIso],
        );
        if (moved.rows.length === 0) {
          throw new ChangeProofError('Ticket is unknown or not triaged for resolution.');
        }
        return parseTicket(moved.rows[0]);
      });
    },

    async closeTicket(actor, input) {
      const context = await derive(actor);
      assertOwnerAdmin(context);
      const ticketId = IdSchema.parse(input.ticketId);
      return inTenant(context.tenantId, async (client) => {
        const moved = await client.query(
          "UPDATE support_tickets SET status = 'closed', updated_at = $2 WHERE id = $1 AND status = 'resolved' RETURNING *",
          [ticketId, actor.nowIso],
        );
        if (moved.rows.length === 0) {
          throw new ChangeProofError('Ticket is unknown or not resolved for closing.');
        }
        return parseTicket(moved.rows[0]);
      });
    },

    async requestAccess(actor, input) {
      const context = await derive(actor);
      const resourceType = AccessResourceSchema.parse(input.resourceType);
      const resourceId = IdSchema.parse(input.resourceId);
      const reason = SanitizedTextSchema.parse(input.reason);
      const ttlMs = z.number().int().min(60_000).max(MAX_TTL_MS).parse(input.ttlMs);
      const nowIso = InstantSchema.parse(actor.nowIso);
      const expiresAt = new Date(Date.parse(nowIso) + ttlMs).toISOString();
      const request = AccessRequestSchema.parse({
        schemaVersion: '1',
        requestId: randomId('accreq'),
        tenantId: context.tenantId,
        requesterId: context.userId,
        resourceType,
        resourceId,
        reason,
        status: 'pending' as const,
        expiresAt,
        createdAt: nowIso,
      });
      await inTenant(context.tenantId, async (client) => {
        if (resourceType === 'run' || resourceType === 'evidence') {
          const run = await client.query('SELECT id FROM lifecycle_runs WHERE id = $1', [resourceId]);
          if (run.rows.length === 0) {
            throw new ChangeProofError('Requested resource is unknown.');
          }
        } else if (resourceType === 'project') {
          const project = await client.query('SELECT id FROM projects WHERE id = $1', [resourceId]);
          if (project.rows.length === 0) {
            throw new ChangeProofError('Requested resource is unknown.');
          }
        } else {
          const repo = await client.query('SELECT repository_id FROM repository_grants WHERE repository_id = $1', [
            resourceId,
          ]);
          if (repo.rows.length === 0) {
            throw new ChangeProofError('Requested resource is unknown.');
          }
        }
        await client.query(
          'INSERT INTO access_requests (id, tenant_id, requester_id, resource_type, resource_id, reason, status, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [
            request.requestId,
            request.tenantId,
            request.requesterId,
            request.resourceType,
            request.resourceId,
            request.reason,
            request.status,
            request.expiresAt,
            request.createdAt,
          ],
        );
      });
      return request;
    },

    async decideAccess(actor, input) {
      const context = await derive(actor);
      assertOwnerAdmin(context);
      const requestId = IdSchema.parse(input.requestId);
      const decision = z.enum(['approve', 'deny']).parse(input.decision);
      const nowIso = InstantSchema.parse(actor.nowIso);
      return inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM access_requests WHERE id = $1 FOR UPDATE', [requestId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Access request is unknown.');
        }
        const request = parseAccessRequest(found.rows[0]);
        if (request.status !== 'pending') {
          throw new ChangeProofError(`Access request is already ${request.status}.`);
        }
        // The approver must hold the entire requested scope themselves.
        if (request.resourceType === 'run' || request.resourceType === 'evidence') {
          const run = await client.query('SELECT project_id, repository_ids FROM lifecycle_runs WHERE id = $1', [
            request.resourceId,
          ]);
          const runRow = run.rows[0] as { project_id: string; repository_ids: unknown } | undefined;
          if (runRow === undefined || !context.projectGrants.includes(runRow.project_id)) {
            throw new ChangeProofError('Approver does not hold the requested scope; refusing.');
          }
          const repositoryIds = z.array(z.string()).parse(runRow.repository_ids);
          const granted = await client.query('SELECT repository_id FROM repository_grants WHERE repository_id = ANY($1)', [
            [...repositoryIds],
          ]);
          if (granted.rows.length !== repositoryIds.length) {
            throw new ChangeProofError('Approver does not hold the requested scope; refusing.');
          }
        } else if (request.resourceType === 'project') {
          if (!context.projectGrants.includes(request.resourceId)) {
            throw new ChangeProofError('Approver does not hold the requested scope; refusing.');
          }
        } else {
          const repo = await client.query('SELECT repository_id FROM repository_grants WHERE repository_id = $1', [
            request.resourceId,
          ]);
          if (repo.rows.length === 0 || !context.repositoryGrants.includes(request.resourceId)) {
            throw new ChangeProofError('Approver does not hold the requested scope; refusing.');
          }
        }
        if (decision === 'deny') {
          await client.query("UPDATE access_requests SET status = 'denied', decided_by = $2, decided_at = $3 WHERE id = $1", [
            requestId,
            context.userId,
            nowIso,
          ]);
          return { requestId, status: 'denied', grantId: null };
        }
        const grantId = randomId('grant');
        await client.query(
          "UPDATE access_requests SET status = 'approved', decided_by = $2, decided_at = $3 WHERE id = $1",
          [requestId, context.userId, nowIso],
        );
        await client.query(
          'INSERT INTO support_grants (id, tenant_id, user_id, request_id, resource_type, resource_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            grantId,
            context.tenantId,
            request.requesterId,
            requestId,
            request.resourceType,
            request.resourceId,
            request.expiresAt,
            nowIso,
          ],
        );
        return { requestId, status: 'approved', grantId };
      });
    },

    async revokeGrant(actor, input) {
      const context = await derive(actor);
      const grantId = IdSchema.parse(input.grantId);
      const nowIso = InstantSchema.parse(actor.nowIso);
      await inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM support_grants WHERE id = $1', [grantId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Support grant is unknown.');
        }
        const grant = GrantRowSchema.parse(found.rows[0]);
        const request = await client.query('SELECT decided_by FROM access_requests WHERE id = $1', [grant.request_id]);
        const decidedBy = (request.rows[0] as { decided_by: string | null } | undefined)?.decided_by;
        if (context.role !== 'owner' && context.role !== 'admin' && decidedBy !== context.userId) {
          throw new ChangeProofError('Only owners, admins, or the approver may revoke this grant.');
        }
        await client.query('UPDATE support_grants SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [
          grantId,
          nowIso,
        ]);
        await client.query("UPDATE access_requests SET status = 'revoked' WHERE id = $1", [grant.request_id]);
      });
    },

    async listActiveScopes(tenantId, userId, nowIso) {
      const tenant = IdSchema.parse(tenantId);
      const user = IdSchema.parse(userId);
      const at = InstantSchema.parse(nowIso);
      return inTenant(tenant, async (client) => {
        const member = await client.query('SELECT user_id FROM memberships WHERE user_id = $1', [user]);
        if (member.rows.length === 0) return [];
        const grants = await client.query(
          'SELECT id, resource_type, resource_id FROM support_grants WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2',
          [user, at],
        );
        return grants.rows.map((row) => {
          const parsed = z.object({ id: z.string(), resource_type: z.string(), resource_id: z.string() }).parse(row);
          return {
            grantId: parsed.id,
            resourceType: AccessResourceSchema.parse(parsed.resource_type),
            resourceId: parsed.resource_id,
          };
        });
      });
    },

    async logAccess(input) {
      const tenantId = IdSchema.parse(input.tenantId);
      const userId = IdSchema.parse(input.userId);
      const grantId = IdSchema.parse(input.grantId);
      const action = NonEmptyStringSchema.parse(input.action);
      const resourceType = NonEmptyStringSchema.parse(input.resourceType);
      const resourceId = IdSchema.parse(input.resourceId);
      const nowIso = InstantSchema.parse(input.nowIso);
      await inTenant(tenantId, async (client) => {
        const grant = await client.query('SELECT user_id FROM support_grants WHERE id = $1', [grantId]);
        const owner = (grant.rows[0] as { user_id: string } | undefined)?.user_id;
        if (owner === undefined || owner !== userId) {
          throw new ChangeProofError('Access log names a grant outside this tenant or user; refusing.');
        }
        await client.query(
          'INSERT INTO support_access_log (tenant_id, user_id, grant_id, action, resource_type, resource_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [tenantId, userId, grantId, action, resourceType, resourceId, nowIso],
        );
      });
    },

    async reportIncident(actor, input) {
      const context = await derive(actor);
      assertOperator(context);
      const incident = OperatorIncidentSchema.parse({
        schemaVersion: '1',
        incidentId: randomId('inc'),
        component: NonEmptyStringSchema.parse(input.component),
        status: 'open' as const,
        summary: SanitizedTextSchema.parse(input.summary),
        ...(input.queueImpact === undefined ? {} : { queueImpact: input.queueImpact }),
        ...(input.modelImpact === undefined ? {} : { modelImpact: input.modelImpact }),
        createdAt: actor.nowIso,
        updatedAt: actor.nowIso,
      });
      await inPlatform(async (client) => {
        await client.query(
          'INSERT INTO operator_incidents (id, component, status, summary, queue_impact, model_impact, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            incident.incidentId,
            incident.component,
            incident.status,
            incident.summary,
            incident.queueImpact ?? null,
            incident.modelImpact ?? null,
            incident.createdAt,
            incident.updatedAt,
          ],
        );
      });
      return incident;
    },

    async listIncidents(actor, input) {
      await derive(actor);
      const limit = z.number().int().min(1).max(50).parse(input.limit);
      const { afterCreatedAt, afterId } = parseCursor(input.cursor);
      return inPlatform(async (client) => {
        const rows = await client.query('SELECT * FROM operator_incidents ORDER BY created_at DESC, id DESC');
        const items = rows.rows
          .map((row) => parseIncident(row))
          .filter(
            (incident) =>
              afterCreatedAt === null ||
              afterId === null ||
              incident.createdAt < afterCreatedAt ||
              (incident.createdAt === afterCreatedAt && incident.incidentId < afterId),
          )
          .slice(0, limit);
        const last = items[items.length - 1];
        return { items, cursor: last === undefined ? '' : `${last.createdAt}|${last.incidentId}` };
      });
    },

    async acknowledgeIncident(actor, input) {
      const context = await derive(actor);
      assertOperator(context);
      const incidentId = IdSchema.parse(input.incidentId);
      return inPlatform(async (client) => {
        const moved = await client.query(
          "UPDATE operator_incidents SET status = 'mitigating', updated_at = $2 WHERE id = $1 AND status = 'open' RETURNING *",
          [incidentId, actor.nowIso],
        );
        if (moved.rows.length === 0) {
          throw new ChangeProofError('Incident is unknown or not open for acknowledgement.');
        }
        return parseIncident(moved.rows[0]);
      });
    },

    async resolveIncident(actor, input) {
      const context = await derive(actor);
      assertOperator(context);
      const incidentId = IdSchema.parse(input.incidentId);
      return inPlatform(async (client) => {
        const moved = await client.query(
          "UPDATE operator_incidents SET status = 'resolved', updated_at = $2 WHERE id = $1 AND status IN ('open', 'mitigating') RETURNING *",
          [incidentId, actor.nowIso],
        );
        if (moved.rows.length === 0) {
          throw new ChangeProofError('Incident is unknown or already resolved.');
        }
        return parseIncident(moved.rows[0]);
      });
    },

    async drainTarget(actor, input) {
      const context = await derive(actor);
      assertOperator(context);
      const tenantId = IdSchema.parse(input.tenantId);
      const jobId = IdSchema.parse(input.jobId);
      const expectedEpoch = z.number().int().positive().parse(input.expectedEpoch);
      const reason = SanitizedTextSchema.parse(input.reason);
      const nowIso = InstantSchema.parse(actor.nowIso);
      const fenced = await fencedAction(context, tenantId, 'drain', jobId, expectedEpoch, reason, nowIso);
      if (fenced.receipt === null) {
        throw new ChangeProofError('Drain produced no receipt; refusing an unaudited effect.');
      }
      await deps.jobs.requestJobCancel({ tenantId: fenced.tenantId, jobId, nowIso });
      return fenced.receipt;
    },

    async quarantineTarget(actor, input) {
      const context = await derive(actor);
      assertOperator(context);
      const tenantId = IdSchema.parse(input.tenantId);
      const jobId = IdSchema.parse(input.jobId);
      const expectedEpoch = z.number().int().positive().parse(input.expectedEpoch);
      const reason = SanitizedTextSchema.parse(input.reason);
      const nowIso = InstantSchema.parse(actor.nowIso);
      const fenced = await fencedAction(context, tenantId, 'quarantine', jobId, expectedEpoch, reason, nowIso);
      if (fenced.receipt === null) {
        throw new ChangeProofError('Quarantine produced no receipt; refusing an unaudited effect.');
      }
      return fenced.receipt;
    },

    async inspectTarget(actor, input) {
      const context = await derive(actor);
      assertOperator(context);
      const tenantId = IdSchema.parse(input.tenantId);
      const jobId = IdSchema.parse(input.jobId);
      const nowIso = InstantSchema.parse(actor.nowIso);
      const seen = await fencedAction(context, tenantId, 'inspect', jobId, null, null, nowIso);
      return { tenantId: seen.tenantId, state: seen.state, epoch: seen.epoch };
    },

    async listOperatorActions(actor, input) {
      const context = await derive(actor);
      if (context.role !== 'owner' && context.role !== 'admin' && context.role !== 'operator') {
        throw new ChangeProofError('Only owners, admins, and operators may audit operator actions.');
      }
      const limit = z.number().int().min(1).max(50).parse(input.limit);
      const { afterCreatedAt, afterId } = parseCursor(input.cursor);
      return inTenant(context.tenantId, async (client) => {
        const rows = await client.query('SELECT * FROM operator_actions ORDER BY created_at DESC, action_id DESC');
        const items = rows.rows
          .map((row) => parseAction(row))
          .filter(
            (action) =>
              afterCreatedAt === null ||
              afterId === null ||
              action.createdAt < afterCreatedAt ||
              (action.createdAt === afterCreatedAt && action.actionId < afterId),
          )
          .slice(0, limit);
        const last = items[items.length - 1];
        return { items, cursor: last === undefined ? '' : `${last.createdAt}|${last.actionId}` };
      });
    },
  };
}
