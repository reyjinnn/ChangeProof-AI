import { ChangeProofError, IdSchema, InstantSchema, NonEmptyStringSchema, Sha256Schema } from '../../core/index.js';

import { applyTombstonesOnRestore, assertNotFenced, assertPurgeDue, type Tombstone } from './deletion.js';

/**
 * Durable deletion fence and tombstone store (WP3-26, FR3-35/36, NEG3-27).
 *
 * Persists tenant-scoped deletion fences and tombstones. Tables self-create
 * on first use, and every gate treats a missing table as "no deletion
 * state" — databases that predate the V11 deploy migration keep working
 * unchanged, while fenced tenants refuse new effects, tombstoned artifacts
 * refuse download, and restore replays tombstones before serving traffic.
 */

export interface DeletionDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface DeletionDbClient {
  query(text: string, params?: readonly unknown[]): Promise<DeletionDbResult>;
  release(): void;
}

export interface DeletionDb {
  query(text: string, params?: readonly unknown[]): Promise<DeletionDbResult>;
  connect(): Promise<DeletionDbClient>;
}

async function tableExists(client: DeletionDbClient, table: string): Promise<boolean> {
  const found = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`]);
  return (found.rows[0] as { reg: string | null }).reg !== null;
}

async function ensureDeletionTables(client: DeletionDbClient): Promise<void> {
  if ((await tableExists(client, 'deletion_fences')) && (await tableExists(client, 'deletion_tombstones'))) {
    return;
  }
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS deletion_fences (tenant_id TEXT NOT NULL, scope TEXT NOT NULL, fenced_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (tenant_id, scope))`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS deletion_tombstones (tenant_id TEXT NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, tombstoned_at TIMESTAMPTZ NOT NULL, purge_after TIMESTAMPTZ NOT NULL, PRIMARY KEY (tenant_id, subject_kind, subject_id))`,
    );
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '42501') {
      throw new ChangeProofError(
        'Deletion tables are missing and this role cannot create them; apply infra/postgres/V11__service_operations.sql.',
      );
    }
    throw error;
  }
}

/** Gate for use inside an existing tenant transaction (submit/download paths). */
export async function assertTenantUnfencedClient(
  client: DeletionDbClient,
  tenantId: string,
  scope: string,
): Promise<void> {
  if (!(await tableExists(client, 'deletion_fences'))) {
    return;
  }
  const found = await client.query(
    `SELECT tenant_id AS "tenantId", scope FROM deletion_fences WHERE tenant_id = $1 AND scope = $2`,
    [IdSchema.parse(tenantId), NonEmptyStringSchema.parse(scope)],
  );
  assertNotFenced(
    found.rows.map((row) => row as { tenantId: string; scope: string }),
    tenantId,
    scope,
  );
}

/** Gate for use before serving an artifact from any tenant transaction. */
export async function assertArtifactNotTombstonedClient(
  client: DeletionDbClient,
  tenantId: string,
  digest: string,
): Promise<void> {
  if (!(await tableExists(client, 'deletion_tombstones'))) {
    return;
  }
  const found = await client.query(
    `SELECT 1 FROM deletion_tombstones WHERE tenant_id = $1 AND subject_kind = 'artifact' AND subject_id = $2`,
    [IdSchema.parse(tenantId), Sha256Schema.parse(digest)],
  );
  if (found.rows.length > 0) {
    throw new ChangeProofError('Artifact was deleted; tombstones are honored and it stays deleted (NEG3-27).');
  }
}

export interface DeletionStore {
  fenceScope(input: { tenantId: string; scope: string; nowIso: string }): Promise<void>;
  unfenceScope(input: { tenantId: string; scope: string }): Promise<void>;
  recordTombstone(input: {
    tenantId: string;
    subjectKind: string;
    subjectId: string;
    nowIso: string;
    purgeAfter: string;
  }): Promise<void>;
  listTombstones(tenantId: string): Promise<readonly Tombstone[]>;
  restoreWithTombstones(tenantId: string, backupSubjects: readonly Tombstone[]): Promise<Tombstone[]>;
  purgeTombstone(input: { tenantId: string; subjectKind: string; subjectId: string; nowIso: string }): Promise<boolean>;
}

export function createDeletionStore(db: DeletionDb): DeletionStore {
  async function inTenant<T>(tenantId: string, work: (client: DeletionDbClient) => Promise<T>): Promise<T> {
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

  return {
    async fenceScope(input): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      const scope = NonEmptyStringSchema.parse(input.scope);
      const nowIso = InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        await ensureDeletionTables(client);
        await client.query(
          `INSERT INTO deletion_fences (tenant_id, scope, fenced_at) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, scope) DO UPDATE SET fenced_at = $3::timestamptz`,
          [tenantId, scope, nowIso],
        );
      });
    },

    async unfenceScope(input): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      const scope = NonEmptyStringSchema.parse(input.scope);
      return inTenant(tenantId, async (client) => {
        if (!(await tableExists(client, 'deletion_fences'))) {
          return;
        }
        await client.query(`DELETE FROM deletion_fences WHERE tenant_id = $1 AND scope = $2`, [tenantId, scope]);
      });
    },

    async recordTombstone(input): Promise<void> {
      const tenantId = IdSchema.parse(input.tenantId);
      const subjectKind = NonEmptyStringSchema.parse(input.subjectKind);
      const subjectId = NonEmptyStringSchema.parse(input.subjectId);
      const nowIso = InstantSchema.parse(input.nowIso);
      const purgeAfter = InstantSchema.parse(input.purgeAfter);
      return inTenant(tenantId, async (client) => {
        await ensureDeletionTables(client);
        await client.query(
          `INSERT INTO deletion_tombstones (tenant_id, subject_kind, subject_id, tombstoned_at, purge_after)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, subject_kind, subject_id) DO UPDATE SET tombstoned_at = $4::timestamptz, purge_after = $5::timestamptz`,
          [tenantId, subjectKind, subjectId, nowIso, purgeAfter],
        );
      });
    },

    async listTombstones(tenantId: string): Promise<readonly Tombstone[]> {
      const id = IdSchema.parse(tenantId);
      return inTenant(tenantId, async (client) => {
        if (!(await tableExists(client, 'deletion_tombstones'))) {
          return [];
        }
        const found = await client.query(
          `SELECT tenant_id AS "tenantId", subject_kind AS "subjectKind", subject_id AS "subjectId" FROM deletion_tombstones WHERE tenant_id = $1 ORDER BY subject_kind, subject_id`,
          [id],
        );
        return found.rows.map((row) => row as Tombstone);
      });
    },

    async restoreWithTombstones(tenantId: string, backupSubjects: readonly Tombstone[]): Promise<Tombstone[]> {
      const id = IdSchema.parse(tenantId);
      const survivors = backupSubjects.filter((subject) => subject.tenantId === id);
      for (const subject of backupSubjects) {
        if (subject.tenantId !== id) {
          throw new ChangeProofError('Restore input mixes tenants; refusing a cross-tenant restore.');
        }
      }
      const tombstones = await this.listTombstones(id);
      return applyTombstonesOnRestore(survivors, tombstones);
    },

    async purgeTombstone(input): Promise<boolean> {
      const tenantId = IdSchema.parse(input.tenantId);
      const subjectKind = NonEmptyStringSchema.parse(input.subjectKind);
      const subjectId = NonEmptyStringSchema.parse(input.subjectId);
      const nowIso = InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        if (!(await tableExists(client, 'deletion_tombstones'))) {
          return false;
        }
        const found = await client.query(
          `SELECT purge_after FROM deletion_tombstones WHERE tenant_id = $1 AND subject_kind = $2 AND subject_id = $3`,
          [tenantId, subjectKind, subjectId],
        );
        const row = found.rows[0] as { purge_after: Date } | undefined;
        if (row === undefined) {
          return false;
        }
        assertPurgeDue(row.purge_after.toISOString(), nowIso);
        await client.query(
          `DELETE FROM deletion_tombstones WHERE tenant_id = $1 AND subject_kind = $2 AND subject_id = $3`,
          [tenantId, subjectKind, subjectId],
        );
        return true;
      });
    },
  };
}
