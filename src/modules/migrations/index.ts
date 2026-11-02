import { z } from 'zod';

import { ChangeProofError } from '../../core/index.js';

import {
  IntegrityReportSchema,
  MigrationIntegrityError,
  type IntegrityCheck,
  type IntegrityReport,
} from './transfer.js';

export * from './transfer.js';

/**
 * Online migration runner (WP3-10 slice, FR3-11).
 *
 * Expand -> backfill -> transition -> contract over a populated table with
 * active writers. The manifest is the frozen, trusted description: chunked,
 * checkpointed backfill with a high-water mark, an acknowledged journal for
 * reconciliation, and a verify-before-contract gate. Every chunk commits its
 * rows and its progress atomically, so the before/after-commit crash windows
 * merge into one documented case: resume replays from the durable
 * checkpoint and the idempotent backfill makes replay a no-op (FR3-11.10).
 *
 * SQL injection posture: values are always parameters; table/column names
 * come from the trusted manifest and must match the identifier grammar.
 */

export interface MigrationDbResult {
  readonly rows: Record<string, unknown>[];
  readonly rowCount: number | null;
}

export interface MigrationDbClient {
  query(text: string, params?: readonly unknown[]): Promise<MigrationDbResult>;
  release(): void;
}

export interface MigrationDb {
  query(text: string, params?: readonly unknown[]): Promise<MigrationDbResult>;
  connect(): Promise<MigrationDbClient>;
}

export class MigrationStateError extends ChangeProofError {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationStateError';
  }
}

export class HistoryRewriteError extends ChangeProofError {
  readonly versions: readonly string[];

  constructor(versions: readonly string[]) {
    super(
      `Applied migration history was rewritten for versions: ${versions.join(', ')}. ` +
        'Applied migrations are append-only; a fixed migration is a new version.',
    );
    this.name = 'HistoryRewriteError';
    this.versions = versions;
  }
}

const SqlIdentifierSchema = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'expected a plain SQL identifier')
  .max(63);
export type SqlIdentifier = z.infer<typeof SqlIdentifierSchema>;

export const MigrationManifestSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  migrationId: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(128),
  table: SqlIdentifierSchema,
  idColumn: SqlIdentifierSchema,
  batchSize: z.number().int().positive().max(100_000),
  expandSql: z.array(z.string().min(1)).max(20),
  backfillSql: z
    .string()
    .min(1)
    .refine((sql) => sql.includes('$1') && sql.includes('$2'), {
      message: 'backfillSql must take the high-water bounds $1 (exclusive) and $2 (inclusive)',
    }),
  remainingSql: z.string().min(1),
  contractSql: z.array(z.string().min(1)).min(1).max(20),
  journal: z.strictObject({
    table: SqlIdentifierSchema,
    seqColumn: SqlIdentifierSchema,
    idColumn: SqlIdentifierSchema,
    kindColumn: SqlIdentifierSchema,
    rowColumn: SqlIdentifierSchema,
    tenantColumn: SqlIdentifierSchema,
  }),
  verify: z.strictObject({
    nullColumns: z.array(SqlIdentifierSchema).max(32),
    sumChecks: z
      .array(
        z.strictObject({
          oldColumn: SqlIdentifierSchema,
          newColumn: SqlIdentifierSchema,
          factor: z.number().positive(),
        }),
      )
      .max(16),
    tenantColumn: SqlIdentifierSchema.optional(),
  }),
  history: z
    .strictObject({
      table: SqlIdentifierSchema,
      versionColumn: SqlIdentifierSchema,
      checksumColumn: SqlIdentifierSchema,
      baseline: z
        .array(z.strictObject({ version: z.string().min(1), checksum: z.string().min(1) }))
        .max(500),
    })
    .optional(),
})
  .refine((manifest) => manifest.expandSql.length > 0 || manifest.history !== undefined, {
    message: 'an external-only expand must pin the applied-history baseline it verifies',
  });
export type MigrationManifest = z.infer<typeof MigrationManifestSchema>;

export interface AppliedHistoryRow {
  readonly version: string;
  readonly checksum: string;
}

/**
 * Applied migrations are append-only: every baseline row must still be
 * present with the same checksum. New rows are the only allowed change.
 */
export function assertHistoryAppendOnly(
  baseline: readonly AppliedHistoryRow[],
  current: readonly AppliedHistoryRow[],
): void {
  const byVersion = new Map(current.map((row) => [row.version, row.checksum] as const));
  const rewritten: string[] = [];
  for (const row of baseline) {
    if (byVersion.get(row.version) !== row.checksum) rewritten.push(row.version);
  }
  if (rewritten.length > 0) {
    throw new HistoryRewriteError([...rewritten].sort());
  }
}

const PROGRESS_TABLE = 'changeproof_migration_progress';

interface ProgressRow {
  highWaterMark: number;
  chunksCompleted: number;
  initialCounts: { total: number; byTenant: Record<string, number> };
  journalSeq: number;
  status: string;
}

const ProgressRowSchema = z.strictObject({
  high_water_mark: z.coerce.number().int(),
  chunks_completed: z.coerce.number().int(),
  initial_counts: z.strictObject({ total: z.number(), byTenant: z.record(z.string(), z.number()) }),
  journal_seq: z.coerce.number(),
  status: z.string(),
});

export class MigrationRunner {
  private readonly db: MigrationDb;
  private readonly manifest: MigrationManifest;

  constructor(db: MigrationDb, manifest: MigrationManifest) {
    this.db = db;
    this.manifest = MigrationManifestSchema.parse(manifest);
  }

  /** Expand: run DDL, then prove applied framework history was not rewritten. */
  async expand(): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      try {
        for (const statement of this.manifest.expandSql) {
          await client.query(statement);
        }
        if (this.manifest.history !== undefined) {
          const history = this.manifest.history;
          const rows = await client.query(
            `SELECT ${history.versionColumn} AS version, ${history.checksumColumn} AS checksum FROM ${history.table} ORDER BY ${history.versionColumn}`,
          );
          assertHistoryAppendOnly(
            history.baseline,
            rows.rows.map((row) => ({
              version: String(row['version']),
              checksum: String(row['checksum']),
            })),
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Run one idempotent chunk: capture the baseline on the first chunk,
   * backfill (high-water-mark, high-water-mark + batch], advance the
   * checkpoint. Chunk rows and progress commit atomically.
   */
  async runNextChunk(): Promise<{ done: boolean; chunksCompleted: number; highWaterMark: number }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE} (` +
            'migration_id TEXT PRIMARY KEY, high_water_mark BIGINT NOT NULL DEFAULT 0, ' +
            'chunks_completed INTEGER NOT NULL DEFAULT 0, initial_counts JSONB NOT NULL DEFAULT ' +
            `'{"total":0,"byTenant":{}}', journal_seq BIGINT NOT NULL DEFAULT 0, ` +
            `status TEXT NOT NULL DEFAULT 'running', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
        );
        const existing = await client.query(
          `SELECT high_water_mark, chunks_completed, initial_counts, journal_seq, status FROM ${PROGRESS_TABLE} WHERE migration_id = $1 FOR UPDATE`,
          [this.manifest.migrationId],
        );
        let progress: ProgressRow;
        if (existing.rows.length === 0) {
          const initial = await this.captureBaseline(client);
          await client.query(
            `INSERT INTO ${PROGRESS_TABLE} (migration_id, high_water_mark, chunks_completed, initial_counts, journal_seq, status) VALUES ($1, 0, 0, $2, $3, 'running')`,
            [this.manifest.migrationId, JSON.stringify(initial.counts), initial.journalSeq],
          );
          progress = {
            highWaterMark: 0,
            chunksCompleted: 0,
            initialCounts: initial.counts,
            journalSeq: initial.journalSeq,
            status: 'running',
          };
        } else {
          const parsed = ProgressRowSchema.parse(existing.rows[0]);
          progress = {
            highWaterMark: parsed.high_water_mark,
            chunksCompleted: parsed.chunks_completed,
            initialCounts: parsed.initial_counts,
            journalSeq: parsed.journal_seq,
            status: parsed.status,
          };
        }
        if (progress.status !== 'running') {
          await client.query('COMMIT');
          return { done: true, chunksCompleted: progress.chunksCompleted, highWaterMark: progress.highWaterMark };
        }
        const low = progress.highWaterMark;
        const high = progress.highWaterMark + this.manifest.batchSize;
        await client.query(this.manifest.backfillSql, [low, high]);
        const remaining = await this.remainingCount(client);
        const done = remaining === 0;
        await client.query(
          `UPDATE ${PROGRESS_TABLE} SET high_water_mark = $1, chunks_completed = chunks_completed + 1, status = $2, updated_at = NOW() WHERE migration_id = $3`,
          [high, done ? 'complete' : 'running', this.manifest.migrationId],
        );
        await client.query('COMMIT');
        return { done, chunksCompleted: progress.chunksCompleted + 1, highWaterMark: high };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /** Run chunks until none remain or the bound is hit. */
  async runToCompletion(maxChunks = 10_000): Promise<{ completed: boolean; chunksCompleted: number }> {
    let chunksCompleted = 0;
    for (let chunk = 0; chunk < maxChunks; chunk++) {
      const result = await this.runNextChunk();
      chunksCompleted = result.chunksCompleted;
      if (result.done) return { completed: true, chunksCompleted };
    }
    return { completed: false, chunksCompleted };
  }

  /** Reconcile the migrated table against the baseline plus journal. Never throws on mismatch. */
  async verifyIntegrity(): Promise<IntegrityReport> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        const progress = await this.requireProgress(client);
        const checks = await this.runChecks(client, progress);
        await client.query('COMMIT');
        return IntegrityReportSchema.parse({
          schemaVersion: '1',
          migrationId: this.manifest.migrationId,
          passed: checks.every((check) => check.passed),
          checks,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Contract: verify and run contract DDL in one transaction. A failed
   * verification rolls everything back and throws with the report.
   */
  async contract(): Promise<IntegrityReport> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        const progress = await this.requireProgress(client);
        if (progress.status === 'contracted') {
          throw new MigrationStateError(
            `Migration "${this.manifest.migrationId}" is already contracted; contract is one-shot.`,
          );
        }
        if (progress.status !== 'complete') {
          throw new MigrationStateError(
            `Migration "${this.manifest.migrationId}" backfill is not complete; refusing contract.`,
          );
        }
        const checks = await this.runChecks(client, progress);
        const report = IntegrityReportSchema.parse({
          schemaVersion: '1',
          migrationId: this.manifest.migrationId,
          passed: checks.every((check) => check.passed),
          checks,
        });
        if (!report.passed) {
          throw new MigrationIntegrityError(report);
        }
        for (const statement of this.manifest.contractSql) {
          await client.query(statement);
        }
        await client.query(`UPDATE ${PROGRESS_TABLE} SET status = 'contracted', updated_at = NOW() WHERE migration_id = $1`, [
          this.manifest.migrationId,
        ]);
        await client.query('COMMIT');
        return report;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  private async captureBaseline(client: MigrationDbClient): Promise<{
    counts: { total: number; byTenant: Record<string, number> };
    journalSeq: number;
  }> {
    const { table, journal } = this.manifest;
    const total = await client.query(`SELECT COUNT(*)::TEXT AS count FROM ${table}`);
    const counts: { total: number; byTenant: Record<string, number> } = {
      total: Number(Object.values(total.rows[0] ?? { count: '0' })[0]),
      byTenant: {},
    };
    if (this.manifest.verify.tenantColumn !== undefined) {
      const perTenant = await client.query(
        `SELECT ${this.manifest.verify.tenantColumn} AS tenant, COUNT(*)::TEXT AS count FROM ${table} GROUP BY ${this.manifest.verify.tenantColumn}`,
      );
      for (const row of perTenant.rows) {
        counts.byTenant[String(row['tenant'])] = Number(row['count']);
      }
    }
    const seq = await client.query(
      `SELECT COALESCE(MAX(${journal.seqColumn}), 0)::TEXT AS seq FROM ${journal.table}`,
    );
    return { counts, journalSeq: Number(Object.values(seq.rows[0] ?? { seq: '0' })[0]) };
  }

  private async remainingCount(client: MigrationDbClient): Promise<number> {
    const result = await client.query(this.manifest.remainingSql);
    const first = result.rows[0];
    if (first === undefined) return 0;
    const value = Number(Object.values(first)[0]);
    if (!Number.isInteger(value) || value < 0) {
      throw new MigrationStateError('remainingSql must return an integer count.');
    }
    return value;
  }

  private async requireProgress(client: MigrationDbClient): Promise<ProgressRow> {
    const existing = await client.query(
      `SELECT high_water_mark, chunks_completed, initial_counts, journal_seq, status FROM ${PROGRESS_TABLE} WHERE migration_id = $1`,
      [this.manifest.migrationId],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      throw new MigrationStateError(
        `Migration "${this.manifest.migrationId}" has no checkpoint; run the backfill before verifying.`,
      );
    }
    return {
      highWaterMark: Number(row['high_water_mark']),
      chunksCompleted: Number(row['chunks_completed']),
      initialCounts: row['initial_counts'] as ProgressRow['initialCounts'],
      journalSeq: Number(row['journal_seq']),
      status: String(row['status']),
    };
  }

  private async runChecks(client: MigrationDbClient, progress: ProgressRow): Promise<IntegrityCheck[]> {
    const { table, journal, verify } = this.manifest;
    const checks: IntegrityCheck[] = [];
    const deltas = await client.query(
      `SELECT ${journal.kindColumn} AS kind, ${journal.tenantColumn} AS tenant, COUNT(*)::TEXT AS count FROM ${journal.table} WHERE ${journal.seqColumn} > $1 GROUP BY ${journal.kindColumn}, ${journal.tenantColumn}`,
      [progress.journalSeq],
    );
    let inserts = 0;
    let deletes = 0;
    const tenantDelta: Record<string, number> = {};
    for (const row of deltas.rows) {
      const kind = String(row['kind']);
      const count = Number(row['count']);
      const tenant = String(row['tenant']);
      if (kind !== 'insert' && kind !== 'update' && kind !== 'delete') {
        checks.push({
          name: 'journal_kinds',
          expected: 'insert/update/delete only',
          actual: kind,
          passed: false,
          detail: `Unexpected journal kind "${kind}" after the baseline snapshot.`,
        });
      }
      if (kind === 'insert') inserts += count;
      if (kind === 'delete') deletes += count;
      tenantDelta[tenant] = (tenantDelta[tenant] ?? 0) + (kind === 'insert' ? count : kind === 'delete' ? -count : 0);
    }
    if (!checks.some((check) => check.name === 'journal_kinds')) {
      checks.push({ name: 'journal_kinds', expected: 'insert/update/delete only', actual: 'insert/update/delete only', passed: true });
    }
    const expectedTotal = progress.initialCounts.total + inserts - deletes;
    const actualTotal = await client.query(`SELECT COUNT(*)::TEXT AS count FROM ${table}`);
    const actualTotalCount = Number(Object.values(actualTotal.rows[0] ?? { count: '-1' })[0]);
    checks.push({
      name: 'row_counts',
      expected: String(expectedTotal),
      actual: String(actualTotalCount),
      passed: expectedTotal === actualTotalCount,
    });
    if (verify.tenantColumn !== undefined) {
      const perTenant = await client.query(
        `SELECT ${verify.tenantColumn} AS tenant, COUNT(*)::TEXT AS count FROM ${table} GROUP BY ${verify.tenantColumn}`,
      );
      const actualByTenant: Record<string, number> = {};
      for (const row of perTenant.rows) {
        actualByTenant[String(row['tenant'])] = Number(row['count']);
      }
      const tenants = new Set([...Object.keys(progress.initialCounts.byTenant), ...Object.keys(actualByTenant)]);
      const mismatched: string[] = [];
      for (const tenant of tenants) {
        const expected = (progress.initialCounts.byTenant[tenant] ?? 0) + (tenantDelta[tenant] ?? 0);
        if ((actualByTenant[tenant] ?? 0) !== expected) mismatched.push(tenant);
      }
      checks.push({
        name: 'tenant_mapping',
        expected: JSON.stringify(progress.initialCounts.byTenant),
        actual: JSON.stringify(actualByTenant),
        passed: mismatched.length === 0,
        detail: mismatched.length === 0 ? undefined : `Mismatched tenants: ${mismatched.sort().join(', ')}`,
      });
    }
    for (const column of verify.nullColumns) {
      const nulls = await client.query(`SELECT COUNT(*)::TEXT AS count FROM ${table} WHERE ${column} IS NULL`);
      const nullCount = Number(Object.values(nulls.rows[0] ?? { count: '-1' })[0]);
      checks.push({
        name: `no_nulls:${column}`,
        expected: '0',
        actual: String(nullCount),
        passed: nullCount === 0,
      });
    }
    for (const sum of verify.sumChecks) {
      const equal = await client.query(
        `SELECT (SELECT COALESCE(SUM(${sum.oldColumn}), 0) FROM ${table}) = (SELECT COALESCE(SUM(${sum.newColumn} * $1), 0) FROM ${table}) AS equal`,
        [sum.factor],
      );
      const isEqual = (equal.rows[0])?.['equal'] === true;
      checks.push({
        name: `exact_sum:${sum.oldColumn}->${sum.newColumn}`,
        expected: 'equal',
        actual: isEqual ? 'equal' : 'different',
        passed: isEqual,
      });
    }
    const presence: { kind: string; want: 'present' | 'absent' }[] = [
      { kind: 'insert', want: 'present' },
      { kind: 'update', want: 'present' },
      { kind: 'delete', want: 'absent' },
    ];
    for (const { kind, want } of presence) {
      const missing = await client.query(
        `SELECT COUNT(*)::TEXT AS count FROM ${journal.table} j LEFT JOIN ${table} t ON t.${this.manifest.idColumn} = j.${journal.rowColumn} ` +
          `WHERE j.${journal.seqColumn} > $1 AND j.${journal.kindColumn} = $2 AND ` +
          (want === 'present' ? `t.${this.manifest.idColumn} IS NULL` : `t.${this.manifest.idColumn} IS NOT NULL`),
        [progress.journalSeq, kind],
      );
      const count = Number(Object.values(missing.rows[0] ?? { count: '-1' })[0]);
      checks.push({
        name: `journal_${kind}_${want}`,
        expected: '0',
        actual: String(count),
        passed: count === 0,
      });
    }
    return checks;
  }
}
