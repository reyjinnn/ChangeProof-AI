import { z } from 'zod';

import {
  ByokCredentialSchema,
  ChangeProofError,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  Sha256Schema,
  type ByokCredential,
  type SecretBrokerPort,
  type TenantContext,
} from '../../core/index.js';

/**
 * BYOK credential lifecycle (WP3-31, FR3-43).
 *
 * The store holds metadata only — ref, tenant, provider, model, key
 * fingerprint, status. Key material lives in the injected secret broker and
 * is read at call time; provision/rotate verify the broker holds the value
 * and then discard it, so a metadata row can never outrun the secret it
 * names. Rotation bumps the version without a reset path; revocation is
 * terminal and checked on every broker read through
 * `createRevocationCheckedBroker`.
 *
 * Authority: only owner/admin mutate, and only inside their own tenant;
 * reads admit owner/admin/member. Viewers and the platform operator role
 * carry no BYOK authority (NEG3-21, NEG3-37).
 */

export interface DistributionDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface DistributionDbClient {
  query(text: string, params?: readonly unknown[]): Promise<DistributionDbResult>;
  release(): void;
}

export interface DistributionDb {
  query(text: string, params?: readonly unknown[]): Promise<DistributionDbResult>;
  connect(): Promise<DistributionDbClient>;
}

const CredentialRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  provider: z.string(),
  model: z.string(),
  fingerprint: z.string(),
  status: z.string(),
  rotation_version: z.number(),
  created_at: z.unknown(),
  rotated_at: z.unknown(),
  revoked_at: z.unknown(),
});

export interface ByokActor {
  readonly authoritySource: string;
  readonly role: string;
  readonly tenantId: string;
}

export function assertByokAuthority(context: ByokActor, tenantId: string): void {
  if (context.authoritySource !== 'server') {
    throw new ChangeProofError(
      'Tenant context is not server-derived; opaque IDs and payloads are not permission.',
    );
  }
  if (context.role !== 'owner' && context.role !== 'admin') {
    throw new ChangeProofError('BYOK credential changes require an owner or admin; refusing.');
  }
  if (context.tenantId !== tenantId) {
    throw new ChangeProofError('Request is not authorized for this tenant.');
  }
}

export function assertByokRead(context: ByokActor, tenantId: string): void {
  if (context.authoritySource !== 'server') {
    throw new ChangeProofError(
      'Tenant context is not server-derived; opaque IDs and payloads are not permission.',
    );
  }
  if (context.role !== 'owner' && context.role !== 'admin' && context.role !== 'member') {
    throw new ChangeProofError('BYOK credential reads require a tenant member; refusing.');
  }
  if (context.tenantId !== tenantId) {
    throw new ChangeProofError('Request is not authorized for this tenant.');
  }
}

/** Narrow reader so the checked broker stays unit-testable without a database. */
export interface ByokStatusReader {
  getCredential(input: { context: TenantContext; refId: string }): Promise<ByokCredential>;
}

/**
 * Broker wrapper that refuses revoked refs. The status check runs on every
 * read against current store state — a revocation lands immediately, even
 * when the underlying broker still holds the old value.
 */
export function createRevocationCheckedBroker(
  inner: SecretBrokerPort,
  reader: ByokStatusReader,
  context: TenantContext,
): SecretBrokerPort {
  return {
    readCredential: async (refId: string): Promise<string> => {
      const record = await reader.getCredential({ context, refId });
      if (record.status === 'revoked') {
        throw new ChangeProofError(
          `BYOK credential "${refId}" is revoked; refusing to serve a value.`,
        );
      }
      return inner.readCredential(refId);
    },
  };
}

function instantOf(value: unknown, field: string): string {
  if (typeof value === 'string') {
    return InstantSchema.parse(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  throw new ChangeProofError(`BYOK credential row has an unreadable ${field}; refusing.`);
}

function toCredential(row: z.infer<typeof CredentialRowSchema>): ByokCredential {
  const revokedAt = row.revoked_at;
  return ByokCredentialSchema.parse({
    schemaVersion: '1',
    refId: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    model: row.model,
    fingerprint: row.fingerprint,
    status: row.status,
    rotationVersion: row.rotation_version,
    createdAt: instantOf(row.created_at, 'created_at'),
    rotatedAt: instantOf(row.rotated_at, 'rotated_at'),
    ...(revokedAt === null || revokedAt === undefined
      ? {}
      : { revokedAt: instantOf(revokedAt, 'revoked_at') }),
  });
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export interface ByokStore {
  provisionCredential(input: {
    context: TenantContext;
    refId: string;
    provider: string;
    model: string;
    fingerprint: string;
    secrets: SecretBrokerPort;
    nowIso: string;
  }): Promise<{ refId: string; duplicate: boolean }>;
  rotateCredential(input: {
    context: TenantContext;
    refId: string;
    newFingerprint: string;
    secrets: SecretBrokerPort;
    nowIso: string;
  }): Promise<{ refId: string; rotationVersion: number }>;
  revokeCredential(input: {
    context: TenantContext;
    refId: string;
    nowIso: string;
  }): Promise<{ refId: string; revoked: boolean }>;
  getCredential(input: { context: TenantContext; refId: string }): Promise<ByokCredential>;
}

export function createByokStore(db: DistributionDb): ByokStore {
  async function inTenant<T>(
    tenantId: string,
    work: (client: DistributionDbClient) => Promise<T>,
  ): Promise<T> {
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

  async function findRow(
    client: DistributionDbClient,
    refId: string,
  ): Promise<z.infer<typeof CredentialRowSchema> | null> {
    const found = await client.query(`SELECT * FROM byok_credentials WHERE id = $1`, [refId]);
    const row = found.rows[0];
    if (row === undefined) {
      return null;
    }
    return CredentialRowSchema.parse(row);
  }

  return {
    async provisionCredential(input): Promise<{ refId: string; duplicate: boolean }> {
      const tenantId = IdSchema.parse(input.context.tenantId);
      assertByokAuthority(input.context, tenantId);
      const refId = IdSchema.parse(input.refId);
      const provider = NonEmptyStringSchema.parse(input.provider);
      const model = NonEmptyStringSchema.parse(input.model);
      const fingerprint = Sha256Schema.parse(input.fingerprint);
      const nowIso = InstantSchema.parse(input.nowIso);
      // The broker must hold the value before the metadata row exists; the
      // value itself is discarded here and never stored, logged, or returned.
      await input.secrets.readCredential(refId);
      return inTenant(tenantId, async (client) => {
        // A failed INSERT aborts the whole transaction, so the duplicate
        // check runs behind a savepoint: without it the follow-up SELECT
        // would fail with "current transaction is aborted".
        await client.query('SAVEPOINT provision_insert');
        try {
          await client.query(
            `INSERT INTO byok_credentials
               (id, tenant_id, provider, model, fingerprint, status, rotation_version, created_at, rotated_at, revoked_at)
             VALUES ($1, $2, $3, $4, $5, 'active', 1, $6, $6, NULL)`,
            [refId, tenantId, provider, model, fingerprint, nowIso],
          );
          await client.query('RELEASE SAVEPOINT provision_insert');
          return { refId, duplicate: false };
        } catch (error) {
          if (errorCode(error) !== '23505') {
            throw error;
          }
          await client.query('ROLLBACK TO SAVEPOINT provision_insert');
          const existing = await findRow(client, refId);
          if (existing === null) {
            throw new ChangeProofError('Credential provision raced; retry against current state.');
          }
          if (existing.status === 'revoked') {
            throw new ChangeProofError(
              'Credential ref is revoked; provision a new ref instead of reusing it.',
            );
          }
          if (
            existing.provider === provider &&
            existing.model === model &&
            existing.fingerprint === fingerprint
          ) {
            return { refId, duplicate: true };
          }
          throw new ChangeProofError(
            'Credential ref is already provisioned with different metadata; rotate it instead.',
          );
        }
      });
    },

    async rotateCredential(input): Promise<{ refId: string; rotationVersion: number }> {
      const tenantId = IdSchema.parse(input.context.tenantId);
      assertByokAuthority(input.context, tenantId);
      const refId = IdSchema.parse(input.refId);
      const fingerprint = Sha256Schema.parse(input.newFingerprint);
      const nowIso = InstantSchema.parse(input.nowIso);
      // The new value must already be readable: metadata never moves first.
      await input.secrets.readCredential(refId);
      return inTenant(tenantId, async (client) => {
        const updated = await client.query(
          `UPDATE byok_credentials
           SET fingerprint = $1, rotation_version = rotation_version + 1, rotated_at = $2
           WHERE id = $3 AND status = 'active'
           RETURNING rotation_version`,
          [fingerprint, nowIso, refId],
        );
        const row = updated.rows[0] as { rotation_version: number } | undefined;
        if (row !== undefined) {
          return { refId, rotationVersion: row.rotation_version };
        }
        const existing = await findRow(client, refId);
        if (existing === null) {
          throw new ChangeProofError('Credential ref is unknown in this tenant; refusing.');
        }
        throw new ChangeProofError('Credential ref is revoked; rotation is refused.');
      });
    },

    async revokeCredential(input): Promise<{ refId: string; revoked: boolean }> {
      const tenantId = IdSchema.parse(input.context.tenantId);
      assertByokAuthority(input.context, tenantId);
      const refId = IdSchema.parse(input.refId);
      const nowIso = InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const updated = await client.query(
          `UPDATE byok_credentials SET status = 'revoked', revoked_at = $1
           WHERE id = $2 AND status = 'active'`,
          [nowIso, refId],
        );
        if ((updated.rowCount ?? 0) > 0) {
          return { refId, revoked: true };
        }
        const existing = await findRow(client, refId);
        if (existing === null) {
          throw new ChangeProofError('Credential ref is unknown in this tenant; refusing.');
        }
        return { refId, revoked: false };
      });
    },

    async getCredential(input): Promise<ByokCredential> {
      const tenantId = IdSchema.parse(input.context.tenantId);
      assertByokRead(input.context, tenantId);
      const refId = IdSchema.parse(input.refId);
      return inTenant(tenantId, async (client) => {
        const existing = await findRow(client, refId);
        if (existing === null) {
          throw new ChangeProofError('Credential ref is unknown in this tenant; refusing.');
        }
        return toCredential(existing);
      });
    },
  };
}
