import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  CanonicalObjectHash,
  ChangeProofError,
  ExportManifestSchema,
  IdSchema,
  InstantSchema,
  SearchQuerySchema,
  SearchResultSchema,
  Sha256Schema,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
  type TenantContext,
} from '../../core/index.js';
import type {
  LifecycleReproPort,
  LifecycleSessionPort,
  SupportAccessPort,
  SupportGrantScope,
} from '../../core/ports/index.js';

/**
 * PostgreSQL-backed search, export, and reproduction (WP3-29, FR3-40).
 *
 * Queries run against the lifecycle tables in `infra/postgres/V6` with the
 * grant epoch in V7, reached only with bound parameters. Every search
 * re-derives the context first, then filters candidates by the current
 * project grants plus a fresh re-read of the repository grant rows; counts,
 * snippets, and exports are computed after filtering, so a revoked grant
 * removes the run from results, counts, cache, and exports alike (NEG3-32).
 * The result cache binds (tenant, user, grant version, grant epoch, query):
 * a new grant version or a bumped epoch misses, and revocation paths clear
 * the tenant slice explicitly. Exports stamp a sha256 manifest over the
 * canonical rows. Reproduction delegates to the lifecycle retry path through
 * the repro port — one budgeted re-execution authority, not two.
 */

export interface QueriesDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface QueriesDbClient {
  query(text: string, params?: readonly unknown[]): Promise<QueriesDbResult>;
  release(): void;
}

export interface QueriesDb {
  query(text: string, params?: readonly unknown[]): Promise<QueriesDbResult>;
  connect(): Promise<QueriesDbClient>;
}

export interface QueriesActor {
  readonly sessionId: string;
  readonly nowIso: string;
}

export interface ExportAuditInput {
  readonly projectId?: string;
  readonly runId?: string;
  readonly after: number;
  readonly limit: number;
}

export interface ExportAuditResult {
  readonly rows: readonly {
    readonly runId: string;
    readonly seq: number;
    readonly kind: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }[];
  readonly cursor: number;
  readonly manifest: {
    readonly schemaVersion: '1';
    readonly exportId: string;
    readonly scope: 'audit';
    readonly rowCount: number;
    readonly digest: string;
    readonly createdAt: string;
  };
}

export interface RequestReproductionInput {
  readonly runId: string;
  readonly idempotencyKey: string;
}

export interface QueriesDeps {
  readonly session: LifecycleSessionPort;
  readonly repro: LifecycleReproPort;
}

export interface QueriesStore {
  search(actor: QueriesActor, query: SearchQuery): Promise<SearchResult>;
  exportAudit(actor: QueriesActor, input: ExportAuditInput): Promise<ExportAuditResult>;
  requestReproduction(
    actor: QueriesActor,
    input: RequestReproductionInput,
  ): Promise<{ runId: string; jobId: string; reservationId: string; submitDigest: string; duplicate: boolean }>;
  bumpGrantEpoch(tenantId: string): Promise<{ epoch: number }>;
  invalidateTenantCache(tenantId: string): void;
  cacheStats(): { hits: number; misses: number };
}

const ProjectRowSchema = z.object({ id: z.string(), name: z.string().nullable(), created_at: z.date() });

const RunRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  state: z.string(),
  submit_digest: z.string(),
  repository_ids: z.unknown(),
  created_at: z.date(),
});

const AuditRowSchema = z.object({
  run_id: z.string(),
  seq: z.number(),
  kind: z.string(),
  payload: z.unknown(),
  created_at: z.date(),
  project_id: z.string(),
});

const MAX_CACHE_ENTRIES = 500;

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface QueriesOptions {
  /**
   * Support-access authority (WP3-30). Operators search and export only
   * through covering active grants, and each covering grant is logged.
   * Membership roles never consult this port.
   */
  readonly support?: SupportAccessPort;
}

export function createQueriesStore(db: QueriesDb, deps: QueriesDeps, options: QueriesOptions = {}): QueriesStore {
  const cache = new Map<string, SearchResult>();
  let hits = 0;
  let misses = 0;

  async function inTenant<T>(tenantId: string, work: (client: QueriesDbClient) => Promise<T>): Promise<T> {
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

  async function derive(actor: QueriesActor): Promise<TenantContext> {
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

  async function requireOperatorScopes(context: TenantContext, nowIso: string): Promise<readonly SupportGrantScope[]> {
    const support = options.support;
    if (support === undefined) {
      throw new ChangeProofError('Operator accounts carry no tenant authority here (NEG3-34).');
    }
    const scopes = await support.listActiveScopes(context.tenantId, context.userId, nowIso);
    if (scopes.length === 0) {
      throw new ChangeProofError('Operator accounts carry no tenant authority here (NEG3-34).');
    }
    return scopes;
  }

  async function currentEpoch(client: QueriesDbClient, tenantId: string): Promise<number> {
    const found = await client.query('SELECT epoch FROM tenant_grant_epochs WHERE tenant_id = $1', [tenantId]);
    if (found.rows.length === 0) return 0;
    return (found.rows[0] as { epoch: number }).epoch;
  }

  async function grantedRepos(client: QueriesDbClient): Promise<Set<string>> {
    const found = await client.query('SELECT repository_id FROM repository_grants');
    return new Set(found.rows.map((row) => (row as { repository_id: string }).repository_id));
  }

  return {
    async search(actor, input) {
      const query = SearchQuerySchema.parse(input);
      const context = await derive(actor);
      const nowIso = InstantSchema.parse(actor.nowIso);
      const operatorScopes =
        context.role === 'operator' ? await requireOperatorScopes(context, nowIso) : null;
      const after = query.afterSeq ?? 0;
      const usedGrants = new Map<string, { resourceType: string; resourceId: string }>();
      const result = await inTenant(context.tenantId, async (client) => {
        const epoch = await currentEpoch(client, context.tenantId);
        const key = [
          context.tenantId,
          context.userId,
          String(context.grantVersion),
          String(epoch),
          CanonicalObjectHash.of(query).digest,
        ].join('|');
        const cached = cache.get(key);
        if (cached !== undefined) {
          hits += 1;
          return cached;
        }
        misses += 1;
        const repos = await grantedRepos(client);
        const runVisible = (projectId: string, repositoryIds: readonly string[]): boolean => {
          if (!context.projectGrants.includes(projectId)) return false;
          return repositoryIds.every((repo) => repos.has(repo));
        };
        const operatorProjectVisible = async (projectId: string): Promise<boolean> => {
          if (operatorScopes === null) return false;
          for (const scope of operatorScopes) {
            if (scope.resourceType === 'project' && scope.resourceId === projectId) {
              usedGrants.set(scope.grantId, { resourceType: scope.resourceType, resourceId: scope.resourceId });
              return true;
            }
            if (scope.resourceType === 'run' || scope.resourceType === 'evidence') {
              const runRow = await client.query('SELECT project_id FROM lifecycle_runs WHERE id = $1', [
                scope.resourceId,
              ]);
              const runProject = (runRow.rows[0] as { project_id: string } | undefined)?.project_id;
              if (runProject === projectId) {
                usedGrants.set(scope.grantId, { resourceType: scope.resourceType, resourceId: scope.resourceId });
                return true;
              }
            }
            if (scope.resourceType === 'repository') {
              const grant = await client.query(
                'SELECT project_id FROM repository_grants WHERE repository_id = $1',
                [scope.resourceId],
              );
              const grantProject = (grant.rows[0] as { project_id: string } | undefined)?.project_id;
              if (grantProject === projectId) {
                usedGrants.set(scope.grantId, { resourceType: scope.resourceType, resourceId: scope.resourceId });
                return true;
              }
            }
          }
          return false;
        };
        // Operator visibility comes only from covering support grants.
        const operatorRunVisible = async (
          runId: string,
          projectId: string,
          repositoryIds: readonly string[],
        ): Promise<boolean> => {
          if (operatorScopes === null) return false;
          for (const scope of operatorScopes) {
            if (
              (scope.resourceType === 'run' || scope.resourceType === 'evidence') &&
              scope.resourceId === runId
            ) {
              usedGrants.set(scope.grantId, { resourceType: scope.resourceType, resourceId: scope.resourceId });
              return true;
            }
            if (scope.resourceType === 'project' && scope.resourceId === projectId) {
              usedGrants.set(scope.grantId, { resourceType: scope.resourceType, resourceId: scope.resourceId });
              return true;
            }
            if (scope.resourceType === 'repository' && repositoryIds.includes(scope.resourceId)) {
              const grant = await client.query(
                'SELECT project_id FROM repository_grants WHERE repository_id = $1',
                [scope.resourceId],
              );
              const grantProject = (grant.rows[0] as { project_id: string } | undefined)?.project_id;
              if (grantProject !== undefined && grantProject === projectId) {
                usedGrants.set(scope.grantId, { resourceType: scope.resourceType, resourceId: scope.resourceId });
                return true;
              }
            }
          }
          return false;
        };

        let hitsFound: SearchHit[] = [];
        if (query.scope === 'projects') {
          const pattern = query.text === undefined ? null : `%${escapeLike(query.text)}%`;
          const rows = await client.query(
            pattern === null
              ? 'SELECT id, name, created_at FROM projects ORDER BY id ASC'
              : 'SELECT id, name, created_at FROM projects WHERE id ILIKE $1 ESCAPE \'\\\' OR name ILIKE $1 ESCAPE \'\\\' ORDER BY id ASC',
            pattern === null ? [] : [pattern],
          );
          for (const row of rows.rows) {
            const parsed = ProjectRowSchema.parse(row);
            if (operatorScopes === null) {
              if (!context.projectGrants.includes(parsed.id)) continue;
            } else if (!(await operatorProjectVisible(parsed.id))) {
              continue;
            }
            if (query.projectId !== undefined && parsed.id !== query.projectId) continue;
            hitsFound.push({
              kind: 'project',
              id: parsed.id,
              title: parsed.name ?? parsed.id,
              snippet: `project ${parsed.id}`,
              createdAt: parsed.created_at.toISOString(),
            });
          }
        } else if (query.scope === 'runs') {
          const pattern = query.text === undefined ? null : `%${escapeLike(query.text)}%`;
          const rows = await client.query(
            pattern === null
              ? 'SELECT * FROM lifecycle_runs ORDER BY created_at ASC, id ASC'
              : 'SELECT * FROM lifecycle_runs WHERE id ILIKE $1 ESCAPE \'\\\' OR project_id ILIKE $1 ESCAPE \'\\\' ORDER BY created_at ASC, id ASC',
            pattern === null ? [] : [pattern],
          );
          for (const row of rows.rows) {
            const parsed = RunRowSchema.parse(row);
            const repositoryIds = z.array(z.string()).parse(parsed.repository_ids);
            if (operatorScopes === null) {
              if (!runVisible(parsed.project_id, repositoryIds)) continue;
            } else if (!(await operatorRunVisible(parsed.id, parsed.project_id, repositoryIds))) {
              continue;
            }
            if (query.projectId !== undefined && parsed.project_id !== query.projectId) continue;
            if (query.runState !== undefined && parsed.state !== query.runState) continue;
            hitsFound.push({
              kind: 'run',
              id: parsed.id,
              projectId: parsed.project_id,
              title: `run ${parsed.id} (${parsed.state})`,
              snippet: `state=${parsed.state} digest=${parsed.submit_digest.slice(0, 12)}`,
              createdAt: parsed.created_at.toISOString(),
            });
          }
        } else {
          const clauses: string[] = [];
          const params: unknown[] = [];
          if (query.eventKind !== undefined) {
            params.push(query.eventKind);
            clauses.push(`e.kind = $${params.length}`);
          }
          if (query.actor !== undefined) {
            params.push(`%${escapeLike(query.actor)}%`);
            clauses.push(`(e.payload ->> 'by') ILIKE $${params.length} ESCAPE '\\'`);
          }
          if (query.sinceIso !== undefined) {
            params.push(query.sinceIso);
            clauses.push(`e.created_at >= $${params.length}`);
          }
          if (query.untilIso !== undefined) {
            params.push(query.untilIso);
            clauses.push(`e.created_at <= $${params.length}`);
          }
          if (query.projectId !== undefined) {
            params.push(query.projectId);
            clauses.push(`r.project_id = $${params.length}`);
          }
          if (query.text !== undefined) {
            params.push(`%${escapeLike(query.text)}%`);
            clauses.push(`(e.kind ILIKE $${params.length} ESCAPE '\\' OR e.run_id ILIKE $${params.length} ESCAPE '\\')`);
          }
          const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
          const rows = await client.query(
            `SELECT e.run_id, e.seq, e.kind, e.payload, e.created_at, r.project_id FROM run_events e JOIN lifecycle_runs r ON r.id = e.run_id ${where} ORDER BY e.created_at ASC, e.run_id ASC, e.seq ASC`,
            params,
          );
          const repoCache = new Map<string, readonly string[]>();
          for (const row of rows.rows) {
            const parsed = AuditRowSchema.parse(row);
            let repositoryIds = repoCache.get(parsed.run_id);
            if (repositoryIds === undefined) {
              const runRow = await client.query('SELECT repository_ids FROM lifecycle_runs WHERE id = $1', [
                parsed.run_id,
              ]);
              repositoryIds = z
                .array(z.string())
                .parse((runRow.rows[0] as { repository_ids: unknown }).repository_ids);
              repoCache.set(parsed.run_id, repositoryIds);
            }
            if (operatorScopes === null) {
              if (!runVisible(parsed.project_id, repositoryIds)) continue;
            } else if (!(await operatorRunVisible(parsed.run_id, parsed.project_id, repositoryIds))) {
              continue;
            }
            const payloadText = JSON.stringify(parsed.payload);
            hitsFound.push({
              kind: 'audit-event',
              id: `${parsed.run_id}:${parsed.seq}`,
              projectId: parsed.project_id,
              title: `${parsed.kind} on ${parsed.run_id}`,
              snippet: payloadText.length <= 200 ? payloadText : `${payloadText.slice(0, 200)}…`,
              createdAt: parsed.created_at.toISOString(),
            });
          }
        }

        const totalCount = hitsFound.length;
        hitsFound = hitsFound.slice(after, after + query.limit);
        const assessed = SearchResultSchema.parse({
          schemaVersion: '1',
          hits: hitsFound,
          totalCount,
          cursor: after + hitsFound.length,
        });
        if (cache.size >= MAX_CACHE_ENTRIES) {
          const oldest = cache.keys().next();
          if (!oldest.done) cache.delete(oldest.value);
        }
        cache.set(key, assessed);
        return assessed;
      });
      if (options.support !== undefined) {
        for (const [grantId, scope] of usedGrants) {
          await options.support.logAccess({
            tenantId: context.tenantId,
            userId: context.userId,
            grantId,
            action: 'search',
            resourceType: scope.resourceType,
            resourceId: scope.resourceId,
            nowIso,
          });
        }
      }
      return result;
    },

    async exportAudit(actor, input) {
      const context = await derive(actor);
      const projectId = input.projectId === undefined ? undefined : IdSchema.parse(input.projectId);
      const runId = input.runId === undefined ? undefined : IdSchema.parse(input.runId);
      const after = z.number().int().nonnegative().parse(input.after);
      const limit = z.number().int().min(1).max(100).parse(input.limit);
      const nowIso = InstantSchema.parse(actor.nowIso);
      const operatorScopes =
        context.role === 'operator' ? await requireOperatorScopes(context, nowIso) : null;
      const used = new Map<string, { resourceType: string; resourceId: string }>();
      const exported = await inTenant(context.tenantId, async (client) => {
        if (operatorScopes === null && projectId !== undefined && !context.projectGrants.includes(projectId)) {
          throw new ChangeProofError('Export is not authorized for this project.');
        }
        if (operatorScopes !== null && projectId === undefined && runId === undefined) {
          throw new ChangeProofError('Operator exports need an explicit run or project scope; refusing a blanket export.');
        }
        const repos = await grantedRepos(client);
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (projectId !== undefined) {
          if (operatorScopes !== null) {
            const covering = operatorScopes.find(
              (scope) => scope.resourceType === 'project' && scope.resourceId === projectId,
            );
            if (covering === undefined) {
              throw new ChangeProofError('Export is not authorized for this project.');
            }
            used.set(covering.grantId, { resourceType: covering.resourceType, resourceId: covering.resourceId });
          }
          params.push(projectId);
          clauses.push(`r.project_id = $${params.length}`);
        }
        if (runId !== undefined) {
          const runRow = await client.query('SELECT project_id, repository_ids FROM lifecycle_runs WHERE id = $1', [
            runId,
          ]);
          if (runRow.rows.length === 0) {
            throw new ChangeProofError('Run is unknown or not shared with you.');
          }
          const parsed = runRow.rows[0] as { project_id: string; repository_ids: unknown };
          const repositoryIds = z.array(z.string()).parse(parsed.repository_ids);
          if (operatorScopes === null) {
            if (
              !context.projectGrants.includes(parsed.project_id) ||
              !repositoryIds.every((repo) => repos.has(repo))
            ) {
              throw new ChangeProofError('Export is not authorized for this run.');
            }
          } else {
            const covering = operatorScopes.find(
              (scope) =>
                ((scope.resourceType === 'run' || scope.resourceType === 'evidence') &&
                  scope.resourceId === runId) ||
                (scope.resourceType === 'project' && scope.resourceId === parsed.project_id),
            );
            if (covering === undefined) {
              throw new ChangeProofError('Export is not authorized for this run.');
            }
            used.set(covering.grantId, { resourceType: covering.resourceType, resourceId: covering.resourceId });
          }
          params.push(runId);
          clauses.push(`e.run_id = $${params.length}`);
        }
        const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
        const rows = await client.query(
          `SELECT e.run_id, e.seq, e.kind, e.payload, e.created_at, r.project_id, r.repository_ids FROM run_events e JOIN lifecycle_runs r ON r.id = e.run_id ${where} ORDER BY e.run_id ASC, e.seq ASC`,
          params,
        );
        const scoped: { runId: string; seq: number; kind: string; payload: unknown; createdAt: string }[] = [];
        for (const row of rows.rows) {
          const parsed = z
            .object({
              run_id: z.string(),
              seq: z.number(),
              kind: z.string(),
              payload: z.unknown(),
              created_at: z.date(),
              project_id: z.string(),
              repository_ids: z.unknown(),
            })
            .parse(row);
          const repositoryIds = z.array(z.string()).parse(parsed.repository_ids);
          if (operatorScopes === null) {
            if (!context.projectGrants.includes(parsed.project_id)) continue;
            if (!repositoryIds.every((repo) => repos.has(repo))) continue;
          } else {
            const covering = operatorScopes.find(
              (scope) =>
                ((scope.resourceType === 'run' || scope.resourceType === 'evidence') &&
                  scope.resourceId === parsed.run_id) ||
                (scope.resourceType === 'project' && scope.resourceId === parsed.project_id),
            );
            if (covering === undefined) continue;
            used.set(covering.grantId, { resourceType: covering.resourceType, resourceId: covering.resourceId });
          }
          scoped.push({
            runId: parsed.run_id,
            seq: parsed.seq,
            kind: parsed.kind,
            payload: parsed.payload,
            createdAt: parsed.created_at.toISOString(),
          });
        }
        const page = scoped.slice(after, after + limit);
        const digest = createHash('sha256').update(JSON.stringify(page), 'utf8').digest('hex');
        const manifest = {
          schemaVersion: '1' as const,
          exportId: `export-${randomBytes(8).toString('hex')}`,
          scope: 'audit' as const,
          rowCount: page.length,
          digest,
          createdAt: nowIso,
        };
        ExportManifestSchema.parse(manifest);
        return { rows: page, cursor: after + page.length, manifest };
      });
      if (options.support !== undefined) {
        for (const [grantId, scope] of used) {
          await options.support.logAccess({
            tenantId: context.tenantId,
            userId: context.userId,
            grantId,
            action: 'export',
            resourceType: scope.resourceType,
            resourceId: scope.resourceId,
            nowIso,
          });
        }
      }
      return exported;
    },

    async requestReproduction(actor, input) {
      const runId = IdSchema.parse(input.runId);
      const idempotencyKey = Sha256Schema.parse(input.idempotencyKey);
      return deps.repro.retryRun(
        { sessionId: IdSchema.parse(actor.sessionId), nowIso: InstantSchema.parse(actor.nowIso) },
        { runId, idempotencyKey },
      );
    },

    async bumpGrantEpoch(tenantId) {
      const id = IdSchema.parse(tenantId);
      return inTenant(id, async (client) => {
        const bumped = await client.query(
          'INSERT INTO tenant_grant_epochs (tenant_id, epoch) VALUES ($1, 1) ON CONFLICT (tenant_id) DO UPDATE SET epoch = tenant_grant_epochs.epoch + 1 RETURNING epoch',
          [id],
        );
        const epoch = (bumped.rows[0] as { epoch: number } | undefined)?.epoch ?? 0;
        for (const key of [...cache.keys()]) {
          if (key.startsWith(`${id}|`)) cache.delete(key);
        }
        return { epoch };
      });
    },

    invalidateTenantCache(tenantId) {
      const id = IdSchema.parse(tenantId);
      for (const key of [...cache.keys()]) {
        if (key.startsWith(`${id}|`)) cache.delete(key);
      }
    },

    cacheStats() {
      return { hits, misses };
    },
  };
}
