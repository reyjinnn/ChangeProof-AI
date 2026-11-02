import { ChangeProofError, IdSchema, InstantSchema, NonEmptyStringSchema } from '../../core/index.js';

import { assertComponentHealthy, assertNotDraining, assertWorkerUsable } from './operations.js';

/**
 * Durable service-operations store (WP3-26, FR3-36, NEG3-26).
 *
 * Persists the global drain flag, worker quarantine set, and component
 * outage records. Tables self-create on first use, and every gate treats a
 * missing table as "no operations state" — databases that predate the
 * V11 deploy migration keep working unchanged, while databases with
 * operations state enforce drain, quarantine, and outage blocks.
 */

export interface OpsDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface OpsDbClient {
  query(text: string, params?: readonly unknown[]): Promise<OpsDbResult>;
  release(): void;
}

export interface OpsDb {
  query(text: string, params?: readonly unknown[]): Promise<OpsDbResult>;
  connect(): Promise<OpsDbClient>;
}

async function tableExists(client: OpsDbClient, table: string): Promise<boolean> {
  const found = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`]);
  return (found.rows[0] as { reg: string | null }).reg !== null;
}

function permissioned(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42501';
}

async function ensureOpsTables(client: OpsDbClient): Promise<void> {
  if (
    (await tableExists(client, 'ops_drain')) &&
    (await tableExists(client, 'ops_quarantine')) &&
    (await tableExists(client, 'ops_outages'))
  ) {
    return;
  }
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ops_drain (id INTEGER PRIMARY KEY CHECK (id = 1), draining BOOLEAN NOT NULL, changed_at TIMESTAMPTZ NOT NULL)`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS ops_quarantine (worker_id TEXT PRIMARY KEY, reason TEXT NOT NULL, quarantined_at TIMESTAMPTZ NOT NULL)`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS ops_outages (component TEXT PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL, resolved_at TIMESTAMPTZ, probe_receipt TEXT)`,
    );
  } catch (error) {
    if (permissioned(error)) {
      throw new ChangeProofError(
        'Operations tables are missing and this role cannot create them; apply infra/postgres/V11__service_operations.sql.',
      );
    }
    throw error;
  }
}

/**
 * Gate for use inside an existing transaction (admit/claim paths). Missing
 * tables mean no operations state, so databases that predate V11 behave
 * exactly as before.
 */
export async function assertOpsAdmissibleClient(
  client: OpsDbClient,
  input: { workerId?: string; component?: string },
): Promise<void> {
  if (await tableExists(client, 'ops_drain')) {
    const found = await client.query(`SELECT draining FROM ops_drain WHERE id = 1`);
    assertNotDraining((found.rows[0] as { draining: boolean } | undefined)?.draining ?? false);
  }
  if (input.workerId !== undefined && (await tableExists(client, 'ops_quarantine'))) {
    const found = await client.query(`SELECT worker_id FROM ops_quarantine WHERE worker_id = $1`, [
      IdSchema.parse(input.workerId),
    ]);
    assertWorkerUsable(
      new Set(found.rows.map((row) => (row as { worker_id: string }).worker_id)),
      input.workerId,
    );
  }
  if (input.component !== undefined && (await tableExists(client, 'ops_outages'))) {
    const found = await client.query(
      `SELECT component, started_at FROM ops_outages WHERE component = $1 AND resolved_at IS NULL`,
      [NonEmptyStringSchema.parse(input.component)],
    );
    const row = found.rows[0] as { component: string; started_at: Date } | undefined;
    assertComponentHealthy(
      row === undefined ? null : { component: row.component, startedAt: row.started_at.toISOString() },
      null,
    );
  }
}

export interface OpsStore {
  setDraining(input: { draining: boolean; nowIso: string }): Promise<void>;
  isDraining(): Promise<boolean>;
  quarantineWorker(input: { workerId: string; reason: string; nowIso: string }): Promise<void>;
  releaseWorker(workerId: string): Promise<void>;
  quarantinedWorkers(): Promise<readonly string[]>;
  recordOutage(input: { component: string; nowIso: string }): Promise<void>;
  resolveOutage(input: { component: string; checkedAt: string; probeReceipt: string }): Promise<void>;
  openOutage(component: string): Promise<{ component: string; startedAt: string } | null>;
  /** Composite gate for admission/claim paths; safe on databases without ops tables. */
  assertAdmissible(input: { workerId?: string; component?: string }): Promise<void>;
}

export function createOpsStore(db: OpsDb): OpsStore {
  return {
    async setDraining(input): Promise<void> {
      const nowIso = InstantSchema.parse(input.nowIso);
      const client = await db.connect();
      try {
        await ensureOpsTables(client);
        await client.query(
          `INSERT INTO ops_drain (id, draining, changed_at) VALUES (1, $1, $2)
           ON CONFLICT (id) DO UPDATE SET draining = $1, changed_at = $2::timestamptz`,
          [input.draining, nowIso],
        );
      } finally {
        client.release();
      }
    },

    async isDraining(): Promise<boolean> {
      const client = await db.connect();
      try {
        if (!(await tableExists(client, 'ops_drain'))) {
          return false;
        }
        const found = await client.query(`SELECT draining FROM ops_drain WHERE id = 1`);
        return (found.rows[0] as { draining: boolean } | undefined)?.draining ?? false;
      } finally {
        client.release();
      }
    },

    async quarantineWorker(input): Promise<void> {
      const workerId = IdSchema.parse(input.workerId);
      const reason = NonEmptyStringSchema.parse(input.reason);
      const nowIso = InstantSchema.parse(input.nowIso);
      const client = await db.connect();
      try {
        await ensureOpsTables(client);
        await client.query(
          `INSERT INTO ops_quarantine (worker_id, reason, quarantined_at) VALUES ($1, $2, $3)
           ON CONFLICT (worker_id) DO UPDATE SET reason = $2, quarantined_at = $3::timestamptz`,
          [workerId, reason, nowIso],
        );
      } finally {
        client.release();
      }
    },

    async releaseWorker(workerId: string): Promise<void> {
      const id = IdSchema.parse(workerId);
      const client = await db.connect();
      try {
        if (!(await tableExists(client, 'ops_quarantine'))) {
          return;
        }
        await client.query(`DELETE FROM ops_quarantine WHERE worker_id = $1`, [id]);
      } finally {
        client.release();
      }
    },

    async quarantinedWorkers(): Promise<readonly string[]> {
      const client = await db.connect();
      try {
        if (!(await tableExists(client, 'ops_quarantine'))) {
          return [];
        }
        const found = await client.query(`SELECT worker_id FROM ops_quarantine ORDER BY worker_id`);
        return found.rows.map((row) => (row as { worker_id: string }).worker_id);
      } finally {
        client.release();
      }
    },

    async recordOutage(input): Promise<void> {
      const component = NonEmptyStringSchema.parse(input.component);
      const nowIso = InstantSchema.parse(input.nowIso);
      const client = await db.connect();
      try {
        await ensureOpsTables(client);
        await client.query(
          `INSERT INTO ops_outages (component, started_at) VALUES ($1, $2)
           ON CONFLICT (component) DO UPDATE SET started_at = $1::timestamptz, resolved_at = NULL, probe_receipt = NULL`,
          [component, nowIso],
        );
      } finally {
        client.release();
      }
    },

    async resolveOutage(input): Promise<void> {
      const component = NonEmptyStringSchema.parse(input.component);
      const checkedAt = InstantSchema.parse(input.checkedAt);
      const receipt = NonEmptyStringSchema.parse(input.probeReceipt);
      const client = await db.connect();
      try {
        if (!(await tableExists(client, 'ops_outages'))) {
          throw new ChangeProofError(`Component "${component}" has no recorded outage; nothing to resolve.`);
        }
        const found = await client.query(`SELECT started_at FROM ops_outages WHERE component = $1`, [component]);
        const row = found.rows[0] as { started_at: Date } | undefined;
        if (row === undefined) {
          throw new ChangeProofError(`Component "${component}" has no recorded outage; nothing to resolve.`);
        }
        assertComponentHealthy(
          { component, startedAt: row.started_at.toISOString() },
          { component, checkedAt, healthy: true },
        );
        await client.query(
          `UPDATE ops_outages SET resolved_at = $1::timestamptz, probe_receipt = $2 WHERE component = $3`,
          [checkedAt, receipt, component],
        );
      } finally {
        client.release();
      }
    },

    async openOutage(component: string): Promise<{ component: string; startedAt: string } | null> {
      const name = NonEmptyStringSchema.parse(component);
      const client = await db.connect();
      try {
        if (!(await tableExists(client, 'ops_outages'))) {
          return null;
        }
        const found = await client.query(
          `SELECT component, started_at FROM ops_outages WHERE component = $1 AND resolved_at IS NULL`,
          [name],
        );
        const row = found.rows[0] as { component: string; started_at: Date } | undefined;
        return row === undefined ? null : { component: row.component, startedAt: row.started_at.toISOString() };
      } finally {
        client.release();
      }
    },

    async assertAdmissible(input): Promise<void> {
      const client = await db.connect();
      try {
        if (await tableExists(client, 'ops_drain')) {
          const found = await client.query(`SELECT draining FROM ops_drain WHERE id = 1`);
          assertNotDraining((found.rows[0] as { draining: boolean } | undefined)?.draining ?? false);
        }
        if (input.workerId !== undefined && (await tableExists(client, 'ops_quarantine'))) {
          const found = await client.query(`SELECT worker_id FROM ops_quarantine`);
          assertWorkerUsable(
            new Set(found.rows.map((row) => (row as { worker_id: string }).worker_id)),
            IdSchema.parse(input.workerId),
          );
        }
        if (input.component !== undefined && (await tableExists(client, 'ops_outages'))) {
          const found = await client.query(
            `SELECT component, started_at FROM ops_outages WHERE component = $1 AND resolved_at IS NULL`,
            [NonEmptyStringSchema.parse(input.component)],
          );
          const row = found.rows[0] as { component: string; started_at: Date } | undefined;
          assertComponentHealthy(
            row === undefined ? null : { component: row.component, startedAt: row.started_at.toISOString() },
            null,
          );
        }
      } finally {
        client.release();
      }
    },
  };
}
