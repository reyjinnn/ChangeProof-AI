import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  ChangeProofError,
  DraftBodySchema,
  IdSchema,
  InstantSchema,
  LifecycleRunSchema,
  LifecycleSubmitSchema,
  RawByteHash,
  RunCursorSchema,
  RunEventKindSchema,
  RunEventSchema,
  Sha256Schema,
  submitDigestFor,
  type DraftRevision,
  type LifecycleRun,
  type LifecycleSubmit,
  type RunEvent,
  type RunEventKind,
  type TenantContext,
} from '../../core/index.js';
import type {
  LifecycleEvidencePort,
  LifecycleJobsPort,
  LifecycleSessionPort,
  LifecycleUsagePort,
  SupportAccessPort,
} from '../../core/ports/index.js';

import { assertArtifactNotTombstonedClient, assertTenantUnfencedClient } from './deletion-store.js';

/**
 * PostgreSQL-backed run lifecycle (WP3-25, FR3-31/35).
 *
 * Projects, draft revisions, immutable submits, run state, and the ordered
 * event history live in `infra/postgres/V6` and are reached only with bound
 * parameters. Every session call re-derives the context through the session
 * port first, so a revoked session, removed membership, or stale grant fails
 * before any work starts; repository effects additionally re-read the V1
 * grant rows inside the effect transaction (NEG3-22). Unknown runs, drafts,
 * and artifacts refuse with a generic message that discloses nothing about
 * other tenants. Reservations and queue entries are idempotent by stable
 * effect identity, so a retried submit can never double-bill or double-enqueue.
 *
 * Out of this slice: HTTP/streaming transport (phase-6 serves this store),
 * worker-lease fencing across the boundary (jobs checkpoints own it; events
 * here match tenant+job and CAS the run state), and operator support-access
 * scoping (WP3-30; operator memberships read like viewers here).
 */

export interface LifecycleDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface LifecycleDbClient {
  query(text: string, params?: readonly unknown[]): Promise<LifecycleDbResult>;
  release(): void;
}

export interface LifecycleDb {
  query(text: string, params?: readonly unknown[]): Promise<LifecycleDbResult>;
  connect(): Promise<LifecycleDbClient>;
}

export interface LifecyclePorts {
  readonly session: LifecycleSessionPort;
  readonly usage: LifecycleUsagePort;
  readonly jobs: LifecycleJobsPort;
  readonly evidence: LifecycleEvidencePort;
}

export interface LifecycleActor {
  readonly sessionId: string;
  readonly nowIso: string;
}

export interface CreateProjectInput {
  readonly name: string;
}

export interface SaveDraftInput {
  readonly projectId: string;
  readonly draftId?: string;
  readonly body: unknown;
}

export interface GetDraftInput {
  readonly draftId: string;
  readonly revision?: number;
}

export interface GetRunInput {
  readonly runId: string;
}

export interface PollEventsInput {
  readonly runId: string;
  readonly afterSeq: number;
  readonly limit: number;
}

export interface RecordRunEventInput {
  readonly tenantId: string;
  readonly jobId: string;
  readonly runId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly nowIso: string;
}

export interface CancelRunInput {
  readonly runId: string;
}

export interface RetryRunInput {
  readonly runId: string;
  readonly idempotencyKey: string;
}

export interface ApplyRepoRevocationInput {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly nowIso: string;
}

export interface DownloadArtifactInput {
  readonly runId: string;
  readonly digest: string;
}

export interface ListRunsInput {
  readonly limit?: number;
}

export interface RunSummary {
  readonly runId: string;
  readonly projectId: string;
  readonly state: string;
  readonly createdAt: string;
}

export interface GetProjectInput {
  readonly projectId: string;
}

export interface ProjectRepository {
  readonly id: string;
  readonly name: string;
  readonly ownership: string;
  readonly status: string;
}

export interface ProjectReadiness {
  readonly label: string;
  readonly status: string;
}

export interface ProjectBaseline {
  readonly revision: string;
  readonly pinnedAt: string;
}

export interface ProjectDetail {
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly repositories: readonly ProjectRepository[];
  readonly readiness: readonly ProjectReadiness[];
  readonly baseline: ProjectBaseline | null;
}

export interface UpdateProjectInput {
  readonly projectId: string;
  readonly name?: string;
  readonly description?: string;
}

export interface EnvironmentService {
  readonly name: string;
  readonly engine: string;
  readonly ownership: string;
  readonly network: string;
}

export interface EnvironmentBoundary {
  readonly isolation: string | null;
  readonly egress: string | null;
  readonly dependencyFetch: string | null;
  readonly mounts: string | null;
  readonly cleanup: string | null;
}

export interface EnvironmentResources {
  readonly wallTime: string | null;
  readonly attempts: string | null;
  readonly creditCap: string | null;
}

export interface EnvironmentProfile {
  readonly profileId: string | null;
  readonly name: string | null;
  readonly revision: number | null;
  readonly dataset: string | null;
  readonly migration: string | null;
  readonly services: readonly EnvironmentService[];
  readonly journal: string | null;
  readonly reset: string | null;
  readonly boundary: EnvironmentBoundary;
  readonly resources: EnvironmentResources;
}

export interface SaveEnvironmentInput {
  readonly name: string;
  readonly dataset?: string;
  readonly migration?: string;
}

export interface GithubConnection {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly webhookState: string | null;
  readonly lastDelivery: string | null;
  readonly updatedAt: string;
}

export interface RegisterConnectionsInput {
  readonly installationId: string;
  readonly repositories: readonly { id: string; fullName: string }[];
}

export interface RevokeConnectionInput {
  readonly connectionId: string;
}

export interface CorpusFile {
  readonly name: string;
  readonly kind: string;
  readonly sizeBytes: number;
  readonly addedAt: string;
}

export interface CoverageGap {
  readonly area: string;
  readonly detail: string;
}

export interface TelemetryCorpus {
  readonly files: readonly CorpusFile[];
  readonly gaps: readonly CoverageGap[];
}

export interface RegisterTelemetryInput {
  readonly name: string;
  readonly sizeBytes: number;
  readonly kind: string;
  readonly label?: string;
}

export interface LifecycleStore {
  createProject(actor: LifecycleActor, input: CreateProjectInput): Promise<{ projectId: string; name: string }>;
  saveDraftRevision(actor: LifecycleActor, input: SaveDraftInput): Promise<{ draftId: string; revision: number }>;
  getDraft(actor: LifecycleActor, input: GetDraftInput): Promise<DraftRevision>;
  submitRun(
    actor: LifecycleActor,
    input: LifecycleSubmit,
  ): Promise<{ runId: string; jobId: string; reservationId: string; submitDigest: string; duplicate: boolean }>;
  getRun(actor: LifecycleActor, input: GetRunInput): Promise<LifecycleRun>;
  pollEvents(
    actor: LifecycleActor,
    input: PollEventsInput,
  ): Promise<{ events: readonly RunEvent[]; cursor: number }>;
  recordRunEvent(input: RecordRunEventInput): Promise<{ seq: number }>;
  cancelRun(actor: LifecycleActor, input: CancelRunInput): Promise<{ state: string }>;
  retryRun(
    actor: LifecycleActor,
    input: RetryRunInput,
  ): Promise<{ runId: string; jobId: string; reservationId: string; submitDigest: string; duplicate: boolean }>;
  applyRepoRevocation(input: ApplyRepoRevocationInput): Promise<{ cancelledRunIds: readonly string[] }>;
  downloadArtifact(actor: LifecycleActor, input: DownloadArtifactInput): Promise<{ digest: string; bytes: Uint8Array }>;
  listRuns(actor: LifecycleActor, input: ListRunsInput): Promise<{ runs: readonly RunSummary[] }>;
  getProject(actor: LifecycleActor, input: GetProjectInput): Promise<ProjectDetail>;
  updateProject(
    actor: LifecycleActor,
    input: UpdateProjectInput,
  ): Promise<{ projectId: string; name: string; description: string | null }>;
  getEnvironment(actor: LifecycleActor): Promise<EnvironmentProfile>;
  saveEnvironment(actor: LifecycleActor, input: SaveEnvironmentInput): Promise<{ profileId: string; revision: number }>;
  listConnections(actor: LifecycleActor): Promise<{ connections: readonly GithubConnection[] }>;
  revokeConnection(
    actor: LifecycleActor,
    input: RevokeConnectionInput,
  ): Promise<{ connectionId: string; status: string }>;
  registerConnections(
    actor: LifecycleActor,
    input: RegisterConnectionsInput,
  ): Promise<{ connectionIds: readonly string[] }>;
  getTelemetryCorpus(actor: LifecycleActor): Promise<TelemetryCorpus>;
  registerTelemetryFile(actor: LifecycleActor, input: RegisterTelemetryInput): Promise<{ fileId: string; name: string }>;
}

const DraftRowSchema = z.object({
  draft_id: z.string(),
  tenant_id: z.string(),
  project_id: z.string(),
  revision: z.number(),
  body: z.unknown(),
  created_at: z.date(),
});

const RunRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  project_id: z.string(),
  draft_id: z.string(),
  draft_revision: z.number(),
  idempotency_key: z.string(),
  state: z.string(),
  version: z.number(),
  job_id: z.string().nullable(),
  reservation_id: z.string().nullable(),
  submit_digest: z.string(),
  submit: z.unknown(),
  repository_ids: z.unknown(),
  created_at: z.date(),
});

const EventRowSchema = z.object({
  run_id: z.string(),
  seq: z.number(),
  kind: z.string(),
  payload: z.unknown(),
  created_at: z.date(),
});

const RepoGrantRowSchema = z.object({ repository_id: z.string() });

const ProjectRowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable().optional(),
});

const RunSummaryRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  state: z.string(),
  created_at: z.date(),
});

const EnvRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  dataset: z.string().nullable(),
  migration: z.string().nullable(),
  revision: z.number(),
});

const ConnectionRowSchema = z.object({
  id: z.string(),
  repository: z.string(),
  status: z.string(),
  webhook_state: z.string().nullable(),
  last_delivery_at: z.date().nullable(),
  updated_at: z.date(),
});

const CorpusRowSchema = z.object({
  name: z.string(),
  kind: z.string(),
  size_bytes: z.coerce.number(),
  created_at: z.date(),
});

/** Pre-V12 probe databases keep working: reads treat missing tables as empty. */
async function tableExists(client: LifecycleDbClient, table: string): Promise<boolean> {
  const found = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`]);
  return (found.rows[0] as { reg: string | null }).reg !== null;
}

async function hasColumn(client: LifecycleDbClient, table: string, column: string): Promise<boolean> {
  const found = await client.query(
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return found.rows.length > 0;
}

/** Self-create the V12 workspace tables on probe databases that predate them. */
async function ensureWorkspaceTables(client: LifecycleDbClient): Promise<void> {
  if (
    (await tableExists(client, 'environment_profiles')) &&
    (await tableExists(client, 'github_connections')) &&
    (await tableExists(client, 'telemetry_corpus'))
  ) {
    return;
  }
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS environment_profiles (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, dataset TEXT NULL, migration TEXT NULL, revision INTEGER NOT NULL CHECK (revision > 0), created_at TIMESTAMPTZ NOT NULL)`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS github_connections (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, repository TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired', 'failed')), webhook_state TEXT NULL, last_delivery_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS telemetry_corpus (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('log', 'trace', 'metric')), size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0), label TEXT NULL, created_at TIMESTAMPTZ NOT NULL)`,
    );
  } catch (error) {
    if (errorCode(error) === '42501') {
      throw new ChangeProofError(
        'Workspace tables are missing and this role cannot create them; apply infra/postgres/V12__workspace.sql.',
      );
    }
    throw error;
  }
}

const EMPTY_BOUNDARY: EnvironmentBoundary = {
  isolation: null,
  egress: null,
  dependencyFetch: null,
  mounts: null,
  cleanup: null,
};

const EMPTY_RESOURCES: EnvironmentResources = { wallTime: null, attempts: null, creditCap: null };

function randomId(prefix: string): string {
  return IdSchema.parse(`${prefix}-${randomBytes(8).toString('hex')}`);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function assertServerContext(context: { readonly authoritySource: string }): void {
  if (context.authoritySource !== 'server') {
    throw new ChangeProofError('Tenant context is not server-derived; refusing to authorize.');
  }
}

function assertCanMutate(context: TenantContext): void {
  assertServerContext(context);
  if (context.role !== 'owner' && context.role !== 'admin' && context.role !== 'member') {
    throw new ChangeProofError('This role may read but not change runs; owners, admins, and members may act.');
  }
}

function assertCanMutateWorkspace(context: TenantContext): void {
  assertServerContext(context);
  if (context.role !== 'owner' && context.role !== 'admin' && context.role !== 'member') {
    throw new ChangeProofError(
      'This role may read but not change workspace settings; owners, admins, and members may act.',
    );
  }
}

function assertCanRead(context: TenantContext): void {
  assertServerContext(context);
  if (context.role === 'operator') {
    throw new ChangeProofError(
      'Operator accounts carry no tenant authority here; tenant reads need audited support access (NEG3-34).',
    );
  }
}

function assertProjectGrant(context: TenantContext, projectId: string): void {
  assertServerContext(context);
  if (!context.projectGrants.includes(projectId)) {
    throw new ChangeProofError('Request is not authorized for this project.');
  }
}

function parseRunRow(row: unknown): LifecycleRun {
  const parsed = RunRowSchema.parse(row);
  return LifecycleRunSchema.parse({
    schemaVersion: '1',
    runId: parsed.id,
    tenantId: parsed.tenant_id,
    projectId: parsed.project_id,
    draftId: parsed.draft_id,
    draftRevision: parsed.draft_revision,
    idempotencyKey: parsed.idempotency_key,
    state: parsed.state,
    version: parsed.version,
    ...(parsed.job_id === null ? {} : { jobId: parsed.job_id }),
    ...(parsed.reservation_id === null ? {} : { reservationId: parsed.reservation_id }),
    submitDigest: parsed.submit_digest,
    repositoryIds: z.array(z.string()).parse(parsed.repository_ids),
    createdAt: parsed.created_at.toISOString(),
  });
}

function parseEventRow(row: unknown): RunEvent {
  const parsed = EventRowSchema.parse(row);
  return RunEventSchema.parse({
    schemaVersion: '1',
    runId: parsed.run_id,
    seq: parsed.seq,
    kind: parsed.kind,
    payload: parsed.payload,
    createdAt: parsed.created_at.toISOString(),
  });
}

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled']);

export interface LifecycleOptions {
  /**
   * Support-access authority (WP3-30). Operators hold no tenant authority
   * without it; with it, operator reads succeed only under a covering active
   * grant and are logged. Membership roles never consult this port.
   */
  readonly support?: SupportAccessPort;
}

export function createLifecycleStore(
  db: LifecycleDb,
  ports: LifecyclePorts,
  options: LifecycleOptions = {},
): LifecycleStore {
  async function inTenant<T>(tenantId: string, work: (client: LifecycleDbClient) => Promise<T>): Promise<T> {
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

  async function derive(actor: LifecycleActor): Promise<TenantContext> {
    const sessionId = IdSchema.parse(actor.sessionId);
    const nowIso = InstantSchema.parse(actor.nowIso);
    const context = await ports.session.deriveContext({ sessionId, nowIso });
    assertServerContext(context);
    return context;
  }

  /**
   * Operator reads need a covering active support grant and are logged;
   * membership roles keep the existing grant checks. Returns true when the
   * caller must apply membership checks (non-operator), false when a grant
   * already authorized the read.
   */
  async function authorizeOperatorRead(
    context: TenantContext,
    action: string,
    candidates: readonly { resourceType: 'run' | 'project' | 'repository' | 'evidence'; resourceId: string }[],
    nowIso: string,
  ): Promise<boolean> {
    if (context.role !== 'operator') {
      assertCanRead(context);
      return true;
    }
    const support = options.support;
    if (support === undefined) {
      throw new ChangeProofError('Operator accounts carry no tenant authority here (NEG3-34).');
    }
    const scopes = await support.listActiveScopes(context.tenantId, context.userId, nowIso);
    for (const candidate of candidates) {
      const covering = scopes.find(
        (scope) => scope.resourceType === candidate.resourceType && scope.resourceId === candidate.resourceId,
      );
      if (covering !== undefined) {
        await support.logAccess({
          tenantId: context.tenantId,
          userId: context.userId,
          grantId: covering.grantId,
          action,
          resourceType: candidate.resourceType,
          resourceId: candidate.resourceId,
          nowIso,
        });
        return false;
      }
    }
    throw new ChangeProofError('Operator accounts carry no tenant authority here (NEG3-34).');
  }

  async function requireProject(client: LifecycleDbClient, projectId: string): Promise<void> {
    const found = await client.query('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (found.rows.length === 0) {
      throw new ChangeProofError('Project is unknown or not shared with you.');
    }
  }

  async function requireRepos(client: LifecycleDbClient, repositoryIds: readonly string[]): Promise<void> {
    const found = await client.query('SELECT repository_id FROM repository_grants WHERE repository_id = ANY($1)', [
      [...repositoryIds],
    ]);
    const granted = new Set(found.rows.map((row) => RepoGrantRowSchema.parse(row).repository_id));
    for (const repositoryId of repositoryIds) {
      if (!granted.has(repositoryId)) {
        throw new ChangeProofError(
          'Request is not authorized for every required repository; a grant may have been revoked.',
        );
      }
    }
  }

  async function nextSeq(client: LifecycleDbClient, runId: string): Promise<number> {
    const current = await client.query('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM run_events WHERE run_id = $1', [
      runId,
    ]);
    const maxSeq = (current.rows[0] as { max_seq: number | string }).max_seq;
    return Number(maxSeq) + 1;
  }

  async function insertEvent(
    client: LifecycleDbClient,
    input: { tenantId: string; runId: string; kind: RunEventKind; payload: unknown; nowIso: string },
  ): Promise<number> {
    const payload = z.record(z.string(), z.unknown()).parse(input.payload);
    const seq = await nextSeq(client, input.runId);
    await client.query(
      'INSERT INTO run_events (tenant_id, run_id, seq, kind, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [input.tenantId, input.runId, seq, input.kind, JSON.stringify(payload), input.nowIso],
    );
    return seq;
  }

  async function findRunByKey(
    client: LifecycleDbClient,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<LifecycleRun | null> {
    const found = await client.query(
      'SELECT * FROM lifecycle_runs WHERE tenant_id = $1 AND idempotency_key = $2',
      [tenantId, idempotencyKey],
    );
    if (found.rows.length === 0) return null;
    return parseRunRow(found.rows[0]);
  }

  const store: LifecycleStore = {
    async createProject(actor, input) {
      const context = await derive(actor);
      assertCanMutate(context);
      const name = z.string().min(1).max(200).parse(input.name);
      const projectId = randomId('project');
      await inTenant(context.tenantId, async (client) => {
        await client.query('INSERT INTO projects (id, tenant_id, name, created_at) VALUES ($1, $2, $3, $4)', [
          projectId,
          context.tenantId,
          name,
          actor.nowIso,
        ]);
      });
      return { projectId, name };
    },

    async saveDraftRevision(actor, input) {
      const context = await derive(actor);
      assertCanMutate(context);
      const projectId = IdSchema.parse(input.projectId);
      assertProjectGrant(context, projectId);
      const body = DraftBodySchema.parse(input.body);
      return inTenant(context.tenantId, async (client) => {
        await requireProject(client, projectId);
        let draftId = input.draftId === undefined ? randomId('draft') : IdSchema.parse(input.draftId);
        if (input.draftId !== undefined) {
          const existing = await client.query(
            'SELECT draft_id FROM draft_revisions WHERE draft_id = $1 AND project_id = $2 LIMIT 1',
            [draftId, projectId],
          );
          if (existing.rows.length === 0) {
            throw new ChangeProofError('Draft is unknown or not shared with you.');
          }
        }
        const current = await client.query('SELECT COALESCE(MAX(revision), 0) AS max_rev FROM draft_revisions WHERE draft_id = $1', [
          draftId,
        ]);
        const revision = Number((current.rows[0] as { max_rev: number | string }).max_rev) + 1;
        // New draft ids are random; a collision retries once with a fresh id.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await client.query(
              'INSERT INTO draft_revisions (draft_id, tenant_id, project_id, revision, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
              [draftId, context.tenantId, projectId, revision, JSON.stringify(body), actor.nowIso],
            );
            return { draftId, revision };
          } catch (error) {
            if (errorCode(error) === '23505' && input.draftId === undefined) {
              draftId = randomId('draft');
              continue;
            }
            throw error;
          }
        }
        throw new ChangeProofError('Draft id collided twice; refusing to overwrite.');
      });
    },

    async getDraft(actor, input) {
      const context = await derive(actor);
      const draftId = IdSchema.parse(input.draftId);
      const row = await inTenant(context.tenantId, async (client) => {
        const found =
          input.revision === undefined
            ? await client.query(
                'SELECT * FROM draft_revisions WHERE draft_id = $1 ORDER BY revision DESC LIMIT 1',
                [draftId],
              )
            : await client.query('SELECT * FROM draft_revisions WHERE draft_id = $1 AND revision = $2', [
                draftId,
                input.revision,
              ]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Draft is unknown or not shared with you.');
        }
        return DraftRowSchema.parse(found.rows[0]);
      });
      const membership = await authorizeOperatorRead(
        context,
        'read:draft',
        [{ resourceType: 'project', resourceId: row.project_id }],
        actor.nowIso,
      );
      if (membership) {
        assertProjectGrant(context, row.project_id);
      }
      return {
        schemaVersion: '1' as const,
        draftId: row.draft_id,
        tenantId: row.tenant_id,
        projectId: row.project_id,
        revision: row.revision,
        body: DraftBodySchema.parse(row.body),
        createdAt: row.created_at.toISOString(),
      };
    },

    async submitRun(actor, input) {
      const submit = LifecycleSubmitSchema.parse(input);
      const context = await derive(actor);
      assertCanMutate(context);
      if (context.tenantId !== submit.tenantId || context.userId !== submit.actorId) {
        throw new ChangeProofError('Submit does not belong to this session; refusing to file it.');
      }
      if (context.grantVersion !== submit.expectedGrantVersion) {
        throw new ChangeProofError('Submit was built on a stale grant; refresh and resubmit.');
      }
      assertProjectGrant(context, submit.projectId);
      const digest = submitDigestFor(submit);
      const reservationId = randomId('res');
      const runId = randomId('run');
      const jobId = randomId('job');

      const existing = await inTenant(context.tenantId, async (client) => {
        await assertTenantUnfencedClient(client, context.tenantId, 'runs');
        await requireProject(client, submit.projectId);
        await requireRepos(client, submit.repositoryIds);
        const draft = await client.query(
          'SELECT draft_id FROM draft_revisions WHERE draft_id = $1 AND revision = $2 AND project_id = $3',
          [submit.draftId, submit.draftRevision, submit.projectId],
        );
        if (draft.rows.length === 0) {
          throw new ChangeProofError('Draft revision is unknown; submit against a saved revision.');
        }
        return findRunByKey(client, context.tenantId, submit.idempotencyKey);
      });
      if (existing !== null) {
        return {
          runId: existing.runId,
          jobId: existing.jobId ?? jobId,
          reservationId: existing.reservationId ?? reservationId,
          submitDigest: existing.submitDigest,
          duplicate: true as const,
        };
      }

      const effectId = createHash('sha256').update(`reserve:${submit.idempotencyKey}`, 'utf8').digest('hex');
      const reserved = await ports.usage.reserveRun({
        tenantId: context.tenantId,
        runId,
        reservationId,
        effectId,
        requested: submit.requestedBudget,
        nowIso: actor.nowIso,
      });
      const enqueued = await ports.jobs.enqueueRun({
        runId,
        jobId,
        tenantId: context.tenantId,
        idempotencyKey: submit.idempotencyKey,
        reservationId: reserved.reservationId,
        nowIso: actor.nowIso,
      });

      try {
        await inTenant(context.tenantId, async (client) => {
          await requireRepos(client, submit.repositoryIds);
          await client.query(
            'INSERT INTO lifecycle_runs (id, tenant_id, project_id, draft_id, draft_revision, idempotency_key, state, version, job_id, reservation_id, submit_digest, submit, repository_ids, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13)',
            [
              enqueued.runId,
              context.tenantId,
              submit.projectId,
              submit.draftId,
              submit.draftRevision,
              submit.idempotencyKey,
              'queued',
              enqueued.jobId,
              reserved.reservationId,
              digest,
              JSON.stringify(submit),
              JSON.stringify(submit.repositoryIds),
              actor.nowIso,
            ],
          );
          await insertEvent(client, {
            tenantId: context.tenantId,
            runId: enqueued.runId,
            kind: 'submitted',
            payload: { submitDigest: digest },
            nowIso: actor.nowIso,
          });
        });
      } catch (error) {
        if (errorCode(error) === '23505') {
          const raced = await inTenant(context.tenantId, (client) =>
            findRunByKey(client, context.tenantId, submit.idempotencyKey),
          );
          if (raced !== null) {
            return {
              runId: raced.runId,
              jobId: raced.jobId ?? enqueued.jobId,
              reservationId: raced.reservationId ?? reserved.reservationId,
              submitDigest: raced.submitDigest,
              duplicate: true as const,
            };
          }
        }
        throw error;
      }
      return {
        runId: enqueued.runId,
        jobId: enqueued.jobId,
        reservationId: reserved.reservationId,
        submitDigest: digest,
        duplicate: enqueued.duplicate,
      };
    },

    async getRun(actor, input) {
      const context = await derive(actor);
      const runId = IdSchema.parse(input.runId);
      const run = await inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM lifecycle_runs WHERE id = $1', [runId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Run is unknown or not shared with you.');
        }
        return parseRunRow(found.rows[0]);
      });
      const membership = await authorizeOperatorRead(
        context,
        'read:run',
        [
          { resourceType: 'run', resourceId: run.runId },
          { resourceType: 'project', resourceId: run.projectId },
        ],
        actor.nowIso,
      );
      if (membership) {
        assertProjectGrant(context, run.projectId);
      }
      return run;
    },

    async pollEvents(actor, input) {
      const cursor = RunCursorSchema.parse({ afterSeq: input.afterSeq, limit: input.limit });
      const context = await derive(actor);
      const runId = IdSchema.parse(input.runId);
      const run = await inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM lifecycle_runs WHERE id = $1', [runId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Run is unknown or not shared with you.');
        }
        return parseRunRow(found.rows[0]);
      });
      const membership = await authorizeOperatorRead(
        context,
        'read:events',
        [
          { resourceType: 'run', resourceId: run.runId },
          { resourceType: 'project', resourceId: run.projectId },
        ],
        actor.nowIso,
      );
      if (membership) {
        assertProjectGrant(context, run.projectId);
      }
      return inTenant(context.tenantId, async (client) => {
        const events = await client.query(
          'SELECT * FROM run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3',
          [runId, cursor.afterSeq, cursor.limit],
        );
        const parsed = events.rows.map((row) => parseEventRow(row));
        const last = parsed[parsed.length - 1];
        return { events: parsed, cursor: last === undefined ? cursor.afterSeq : last.seq };
      });
    },

    async recordRunEvent(input) {
      const tenantId = IdSchema.parse(input.tenantId);
      const jobId = IdSchema.parse(input.jobId);
      const runId = IdSchema.parse(input.runId);
      const kind = RunEventKindSchema.parse(input.kind);
      const nowIso = InstantSchema.parse(input.nowIso);
      if (kind === 'submitted' || kind === 'cancelled' || kind === 'revoked' || kind === 'retried') {
        throw new ChangeProofError(`Event kind "${kind}" is recorded by the store, not by workers.`);
      }
      return inTenant(tenantId, async (client) => {
        const found = await client.query('SELECT * FROM lifecycle_runs WHERE id = $1 FOR UPDATE', [runId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Run is unknown for this tenant.');
        }
        const run = parseRunRow(found.rows[0]);
        if (run.jobId !== jobId) {
          throw new ChangeProofError('Event job does not own this run; refusing to record.');
        }
        if (TERMINAL_STATES.has(run.state)) {
          throw new ChangeProofError(`Run is already ${run.state}; terminal runs take no more events.`);
        }
        const next =
          kind === 'started' ? 'running' : kind === 'succeeded' || kind === 'failed' ? kind : run.state;
        if (kind === 'started' && run.state !== 'queued') {
          throw new ChangeProofError(`Run cannot start from state "${run.state}".`);
        }
        if (next !== run.state) {
          const moved = await client.query(
            'UPDATE lifecycle_runs SET state = $1, version = version + 1 WHERE id = $2 AND version = $3',
            [next, runId, run.version],
          );
          if ((moved.rowCount ?? 0) === 0) {
            throw new ChangeProofError('Run changed under this event; refusing a lost update.');
          }
        }
        const seq = await insertEvent(client, { tenantId, runId, kind, payload: input.payload, nowIso });
        return { seq };
      });
    },

    async cancelRun(actor, input) {
      const context = await derive(actor);
      assertCanMutate(context);
      const runId = IdSchema.parse(input.runId);
      const target = await inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM lifecycle_runs WHERE id = $1 FOR UPDATE', [runId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Run is unknown or not shared with you.');
        }
        const run = parseRunRow(found.rows[0]);
        assertProjectGrant(context, run.projectId);
        if (run.state !== 'queued' && run.state !== 'running') {
          throw new ChangeProofError(`Run is already ${run.state}; only queued or running runs cancel.`);
        }
        await client.query('UPDATE lifecycle_runs SET state = $1, version = version + 1 WHERE id = $2', [
          'cancelled',
          runId,
        ]);
        await insertEvent(client, {
          tenantId: context.tenantId,
          runId,
          kind: 'cancelled',
          payload: { by: context.userId },
          nowIso: actor.nowIso,
        });
        return run;
      });
      if (target.jobId !== undefined) {
        await ports.jobs.requestJobCancel({ tenantId: context.tenantId, jobId: target.jobId, nowIso: actor.nowIso });
      }
      return { state: 'cancelled' };
    },

    async retryRun(actor, input) {
      const context = await derive(actor);
      assertCanMutate(context);
      const runId = IdSchema.parse(input.runId);
      const idempotencyKey = Sha256Schema.parse(input.idempotencyKey);
      const source = await inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM lifecycle_runs WHERE id = $1', [runId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Run is unknown or not shared with you.');
        }
        const run = parseRunRow(found.rows[0]);
        assertProjectGrant(context, run.projectId);
        return run;
      });
      if (source.state !== 'failed' && source.state !== 'cancelled') {
        throw new ChangeProofError(`Only failed or cancelled runs retry; this run is ${source.state}.`);
      }
      const stored = await inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT submit FROM lifecycle_runs WHERE id = $1', [runId]);
        return LifecycleSubmitSchema.parse((found.rows[0] as { submit: unknown }).submit);
      });
      const retried = await store.submitRun(actor, {
        ...stored,
        requestId: randomId('req'),
        idempotencyKey,
        expectedGrantVersion: context.grantVersion,
      });
      await inTenant(context.tenantId, async (client) => {
        await insertEvent(client, {
          tenantId: context.tenantId,
          runId,
          kind: 'retried',
          payload: { retriedAs: retried.runId },
          nowIso: actor.nowIso,
        });
      });
      return retried;
    },

    async applyRepoRevocation(input) {
      const tenantId = IdSchema.parse(input.tenantId);
      const repositoryId = IdSchema.parse(input.repositoryId);
      const nowIso = InstantSchema.parse(input.nowIso);
      const cancelled = await inTenant(tenantId, async (client) => {
        const queued = await client.query(
          "SELECT * FROM lifecycle_runs WHERE state = 'queued' AND repository_ids @> jsonb_build_array($1::text) FOR UPDATE",
          [repositoryId],
        );
        const cancelledRunIds: string[] = [];
        const jobIds: string[] = [];
        for (const row of queued.rows) {
          const run = parseRunRow(row);
          await client.query('UPDATE lifecycle_runs SET state = $1, version = version + 1 WHERE id = $2', [
            'cancelled',
            run.runId,
          ]);
          await insertEvent(client, {
            tenantId,
            runId: run.runId,
            kind: 'revoked',
            payload: { repositoryId },
            nowIso,
          });
          cancelledRunIds.push(run.runId);
          if (run.jobId !== undefined) jobIds.push(run.jobId);
        }
        return { cancelledRunIds, jobIds };
      });
      for (const jobId of cancelled.jobIds) {
        await ports.jobs.requestJobCancel({ tenantId, jobId, nowIso });
      }
      return { cancelledRunIds: cancelled.cancelledRunIds };
    },

    async downloadArtifact(actor, input) {
      const context = await derive(actor);
      const runId = IdSchema.parse(input.runId);
      const digest = Sha256Schema.parse(input.digest);
      const run = await inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM lifecycle_runs WHERE id = $1', [runId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Run is unknown or not shared with you.');
        }
        const parsed = parseRunRow(found.rows[0]);
        const linked = await client.query(
          "SELECT seq FROM run_events WHERE run_id = $1 AND kind = 'artifact' AND payload ->> 'digest' = $2 LIMIT 1",
          [runId, digest],
        );
        if (linked.rows.length === 0) {
          throw new ChangeProofError('Artifact is unknown for this run.');
        }
        await assertArtifactNotTombstonedClient(client, context.tenantId, digest);
        return parsed;
      });
      const membership = await authorizeOperatorRead(
        context,
        'read:artifact',
        [
          { resourceType: 'run', resourceId: run.runId },
          { resourceType: 'project', resourceId: run.projectId },
          { resourceType: 'evidence', resourceId: run.runId },
        ],
        actor.nowIso,
      );
      if (membership) {
        assertProjectGrant(context, run.projectId);
        await inTenant(context.tenantId, async (client) => {
          await requireRepos(client, run.repositoryIds);
        });
      }
      if (run.tenantId !== context.tenantId) {
        throw new ChangeProofError('Run is unknown or not shared with you.');
      }
      const bytes = ports.evidence.fetchArtifact(digest);
      const actual = RawByteHash.ofBytes(bytes).digest;
      if (actual !== digest) {
        throw new ChangeProofError('Artifact digest mismatch; refusing a tampered artifact (NEG3-33).');
      }
      return { digest, bytes };
    },

    async listRuns(actor, input) {
      const context = await derive(actor);
      const limit = input.limit === undefined ? 50 : z.number().int().min(1).max(100).parse(input.limit);
      const rows = await inTenant(context.tenantId, async (client) => {
        const found = await client.query(
          'SELECT id, project_id, state, created_at FROM lifecycle_runs ORDER BY created_at DESC, id DESC LIMIT $1',
          [limit],
        );
        return found.rows.map((row) => RunSummaryRowSchema.parse(row));
      });
      if (context.role === 'operator') {
        const support = options.support;
        if (support === undefined) {
          throw new ChangeProofError('Operator accounts carry no tenant authority here (NEG3-34).');
        }
        const scopes = await support.listActiveScopes(context.tenantId, context.userId, actor.nowIso);
        const visible = rows.filter((row) =>
          scopes.some(
            (scope) =>
              ((scope.resourceType === 'run' || scope.resourceType === 'evidence') &&
                scope.resourceId === row.id) ||
              (scope.resourceType === 'project' && scope.resourceId === row.project_id),
          ),
        );
        const used = new Map<string, { resourceType: string; resourceId: string }>();
        for (const row of visible) {
          const covering = scopes.find(
            (scope) =>
              ((scope.resourceType === 'run' || scope.resourceType === 'evidence') &&
                scope.resourceId === row.id) ||
              (scope.resourceType === 'project' && scope.resourceId === row.project_id),
          );
          if (covering !== undefined) {
            used.set(covering.grantId, { resourceType: covering.resourceType, resourceId: covering.resourceId });
          }
        }
        for (const [grantId, scope] of used) {
          await support.logAccess({
            tenantId: context.tenantId,
            userId: context.userId,
            grantId,
            action: 'read:runs',
            resourceType: scope.resourceType,
            resourceId: scope.resourceId,
            nowIso: actor.nowIso,
          });
        }
        return {
          runs: visible.map((row) => ({
            runId: row.id,
            projectId: row.project_id,
            state: row.state,
            createdAt: row.created_at.toISOString(),
          })),
        };
      }
      assertCanRead(context);
      return {
        runs: rows
          .filter((row) => context.projectGrants.includes(row.project_id))
          .map((row) => ({
            runId: row.id,
            projectId: row.project_id,
            state: row.state,
            createdAt: row.created_at.toISOString(),
          })),
      };
    },

    async getProject(actor, input) {
      const context = await derive(actor);
      const projectId = IdSchema.parse(input.projectId);
      const detail = await inTenant(context.tenantId, async (client) => {
        const described = await hasColumn(client, 'projects', 'description');
        const found = await client.query(
          described
            ? 'SELECT id, name, description FROM projects WHERE id = $1'
            : 'SELECT id, name FROM projects WHERE id = $1',
          [projectId],
        );
        if (found.rows.length === 0) {
          throw new ChangeProofError('Project is unknown or not shared with you.');
        }
        const row = ProjectRowSchema.parse(found.rows[0]);
        const grants = await client.query('SELECT repository_id FROM repository_grants WHERE project_id = $1', [
          projectId,
        ]);
        const statusByRepo = new Map<string, string>();
        if (await tableExists(client, 'github_connections')) {
          const connections = await client.query(
            'SELECT repository, status FROM github_connections WHERE tenant_id = $1',
            [context.tenantId],
          );
          for (const entry of connections.rows) {
            const parsed = z.object({ repository: z.string(), status: z.string() }).parse(entry);
            statusByRepo.set(parsed.repository, parsed.status);
          }
        }
        const drafts = await client.query('SELECT 1 AS ok FROM draft_revisions WHERE project_id = $1 LIMIT 1', [
          projectId,
        ]);
        const runs = await client.query('SELECT 1 AS ok FROM lifecycle_runs WHERE project_id = $1 LIMIT 1', [
          projectId,
        ]);
        return {
          row,
          repositories: grants.rows.map((entry) => {
            const repositoryId = RepoGrantRowSchema.parse(entry).repository_id;
            return {
              id: repositoryId,
              name: repositoryId,
              ownership: 'granted',
              status: statusByRepo.get(repositoryId) ?? 'unknown',
            };
          }),
          readiness: [
            { label: 'Repository access', status: grants.rows.length > 0 ? 'ready' : 'missing' },
            { label: 'Draft history', status: drafts.rows.length > 0 ? 'ready' : 'missing' },
            { label: 'Run history', status: runs.rows.length > 0 ? 'ready' : 'missing' },
          ],
        };
      });
      const membership = await authorizeOperatorRead(
        context,
        'read:project',
        [{ resourceType: 'project', resourceId: projectId }],
        actor.nowIso,
      );
      if (membership) {
        assertProjectGrant(context, projectId);
      }
      return {
        projectId: detail.row.id,
        name: detail.row.name ?? detail.row.id,
        description: detail.row.description ?? null,
        repositories: detail.repositories,
        readiness: detail.readiness,
        // No baseline backend exists yet: null renders as "No baseline pinned",
        // never an invented revision.
        baseline: null,
      };
    },

    async updateProject(actor, input) {
      const context = await derive(actor);
      assertCanMutateWorkspace(context);
      const projectId = IdSchema.parse(input.projectId);
      const name =
        input.name === undefined ? undefined : z.string().trim().min(1).max(200).parse(input.name);
      const description =
        input.description === undefined ? undefined : z.string().trim().max(2000).parse(input.description);
      if (name === undefined && description === undefined) {
        throw new ChangeProofError('Nothing to update; name or description is required.');
      }
      return inTenant(context.tenantId, async (client) => {
        assertProjectGrant(context, projectId);
        const found = await client.query('SELECT id FROM projects WHERE id = $1', [projectId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Project is unknown or not shared with you.');
        }
        if (name !== undefined) {
          await client.query('UPDATE projects SET name = $1 WHERE id = $2', [name, projectId]);
        }
        if (description !== undefined) {
          if (!(await hasColumn(client, 'projects', 'description'))) {
            throw new ChangeProofError(
              'Project descriptions need infra/postgres/V12__workspace.sql; refusing to drop the description.',
            );
          }
          await client.query('UPDATE projects SET description = $1 WHERE id = $2', [description, projectId]);
        }
        const reread = await client.query(
          (await hasColumn(client, 'projects', 'description'))
            ? 'SELECT id, name, description FROM projects WHERE id = $1'
            : 'SELECT id, name FROM projects WHERE id = $1',
          [projectId],
        );
        const row = ProjectRowSchema.parse(reread.rows[0]);
        return { projectId: row.id, name: row.name ?? row.id, description: row.description ?? null };
      });
    },

    async getEnvironment(actor) {
      const context = await derive(actor);
      assertCanRead(context);
      const row = await inTenant(context.tenantId, async (client) => {
        if (!(await tableExists(client, 'environment_profiles'))) return null;
        const found = await client.query(
          'SELECT id, name, dataset, migration, revision FROM environment_profiles WHERE tenant_id = $1 ORDER BY revision DESC, created_at DESC LIMIT 1',
          [context.tenantId],
        );
        if (found.rows.length === 0) return null;
        return EnvRowSchema.parse(found.rows[0]);
      });
      return {
        profileId: row?.id ?? null,
        name: row?.name ?? null,
        revision: row?.revision ?? null,
        dataset: row?.dataset ?? null,
        migration: row?.migration ?? null,
        // No service-mapping, journal, boundary, or resource backend exists
        // yet: empty and nulls render as "Not reported", never invented data.
        services: [],
        journal: null,
        reset: null,
        boundary: { ...EMPTY_BOUNDARY },
        resources: { ...EMPTY_RESOURCES },
      };
    },

    async saveEnvironment(actor, input) {
      const context = await derive(actor);
      assertCanMutateWorkspace(context);
      const name = z.string().trim().min(1).max(200).parse(input.name);
      const dataset =
        input.dataset === undefined || input.dataset.trim() === ''
          ? null
          : z.string().trim().max(500).parse(input.dataset);
      const migration =
        input.migration === undefined || input.migration.trim() === ''
          ? null
          : z.string().trim().max(500).parse(input.migration);
      const profileId = randomId('env');
      const revision = await inTenant(context.tenantId, async (client) => {
        await ensureWorkspaceTables(client);
        const current = await client.query(
          'SELECT COALESCE(MAX(revision), 0) AS max_rev FROM environment_profiles WHERE tenant_id = $1',
          [context.tenantId],
        );
        const next = Number((current.rows[0] as { max_rev: number | string }).max_rev) + 1;
        await client.query(
          'INSERT INTO environment_profiles (id, tenant_id, name, dataset, migration, revision, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [profileId, context.tenantId, name, dataset, migration, next, actor.nowIso],
        );
        return next;
      });
      return { profileId, revision };
    },

    async listConnections(actor) {
      const context = await derive(actor);
      assertCanRead(context);
      const rows = await inTenant(context.tenantId, async (client) => {
        if (!(await tableExists(client, 'github_connections'))) return [];
        const found = await client.query(
          'SELECT id, repository, status, webhook_state, last_delivery_at, updated_at FROM github_connections WHERE tenant_id = $1 ORDER BY updated_at DESC, id DESC',
          [context.tenantId],
        );
        return found.rows.map((row) => ConnectionRowSchema.parse(row));
      });
      return {
        connections: rows.map((row) => ({
          id: row.id,
          name: row.repository,
          status: row.status,
          webhookState: row.webhook_state,
          lastDelivery: row.last_delivery_at === null ? null : row.last_delivery_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
      };
    },

    async registerConnections(actor, input) {
      const context = await derive(actor);
      assertCanMutateWorkspace(context);
      if (!/^[1-9][0-9]*$/.test(input.installationId)) {
        throw new ChangeProofError('Installation id must be a positive integer; refusing.');
      }
      const repos = z
        .array(z.object({ id: IdSchema, fullName: z.string().min(1).max(400) }))
        .parse(input.repositories);
      if (repos.length === 0) {
        return { connectionIds: [] };
      }
      return inTenant(context.tenantId, async (client) => {
        if (!(await tableExists(client, 'github_connections'))) {
          throw new ChangeProofError('Workspace tables are missing; apply infra/postgres/V12__workspace.sql.');
        }
        // The id carries a tenant scope hash: without it, a second tenant
        // connecting the same installation collides on the global PK and the
        // upsert trips RLS on another tenant's row. Opaque by design.
        const scope = createHash('sha256').update(context.tenantId).digest('hex').slice(0, 12);
        const ids: string[] = [];
        for (const repo of repos) {
          const id = IdSchema.parse(`conn-${input.installationId}-${repo.id}-${scope}`);
          await client.query(
            `INSERT INTO github_connections (id, tenant_id, repository, status, webhook_state, last_delivery_at, created_at, updated_at)
             VALUES ($1, $2, $3, 'active', NULL, NULL, $4, $4)
             ON CONFLICT (id) DO UPDATE SET repository = EXCLUDED.repository, status = 'active', updated_at = EXCLUDED.updated_at`,
            [id, context.tenantId, repo.fullName, actor.nowIso],
          );
          ids.push(id);
        }
        return { connectionIds: ids };
      });
    },
    async revokeConnection(actor, input) {
      const context = await derive(actor);
      assertCanMutateWorkspace(context);
      const connectionId = IdSchema.parse(input.connectionId);
      return inTenant(context.tenantId, async (client) => {
        if (!(await tableExists(client, 'github_connections'))) {
          throw new ChangeProofError('Connection is unknown or not shared with you.');
        }
        const found = await client.query(
          'SELECT id, status FROM github_connections WHERE id = $1 AND tenant_id = $2',
          [connectionId, context.tenantId],
        );
        if (found.rows.length === 0) {
          throw new ChangeProofError('Connection is unknown or not shared with you.');
        }
        const status = z.object({ id: z.string(), status: z.string() }).parse(found.rows[0]).status;
        if (status !== 'revoked') {
          await client.query('UPDATE github_connections SET status = $1, updated_at = $2 WHERE id = $3', [
            'revoked',
            actor.nowIso,
            connectionId,
          ]);
        }
        return { connectionId, status: 'revoked' };
      });
    },

    async getTelemetryCorpus(actor) {
      const context = await derive(actor);
      assertCanRead(context);
      const rows = await inTenant(context.tenantId, async (client) => {
        if (!(await tableExists(client, 'telemetry_corpus'))) return [];
        const found = await client.query(
          'SELECT name, kind, size_bytes, created_at FROM telemetry_corpus WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC',
          [context.tenantId],
        );
        return found.rows.map((row) => CorpusRowSchema.parse(row));
      });
      return {
        files: rows.map((row) => ({
          name: row.name,
          kind: row.kind,
          sizeBytes: row.size_bytes,
          addedAt: row.created_at.toISOString(),
        })),
        // No gap-analysis backend exists yet: an empty list renders as
        // "No gap analysis reported" instead of assumed coverage.
        gaps: [],
      };
    },

    async registerTelemetryFile(actor, input) {
      const context = await derive(actor);
      assertCanMutateWorkspace(context);
      const name = z.string().trim().min(1).max(255).parse(input.name);
      const sizeBytes = z.number().int().min(0).max(1099511627776).parse(input.sizeBytes);
      const kind = z.enum(['log', 'trace', 'metric']).parse(input.kind);
      const label =
        input.label === undefined || input.label.trim() === ''
          ? null
          : z.string().trim().max(200).parse(input.label);
      const fileId = randomId('file');
      await inTenant(context.tenantId, async (client) => {
        await ensureWorkspaceTables(client);
        await client.query(
          'INSERT INTO telemetry_corpus (id, tenant_id, name, kind, size_bytes, label, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [fileId, context.tenantId, name, kind, sizeBytes, label, actor.nowIso],
        );
      });
      return { fileId, name };
    },
  };
  return store;
}
