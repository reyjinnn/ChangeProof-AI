import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * WP3-21 / T2-5 — live PostgreSQL/RLS proof (NEG3-21, FR3-29).
 *
 * Native check, reported separately from the pure suite: `pnpm test` excludes
 * `tests/native/**`; run with `pnpm test:identity:native` against a disposable
 * PostgreSQL 16 container (see the report for the exact commands). The test
 * fails closed without DATABASE_URL — a skipped native row is a missing check,
 * never a pass. Tables, policies and the application role come from the
 * reviewed migration `infra/postgres/V1__identity_tenancy.sql`, never from
 * ad-hoc test DDL.
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL is required (e.g. postgresql://postgres:<pw>@127.0.0.1:55432/postgres). ' +
      'Start the disposable probe container first; see docs/phase-reports/phase-2.md.',
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '..', '..', 'infra', 'postgres', 'V1__identity_tenancy.sql'), 'utf8');

const admin = new Pool({ connectionString: databaseUrl });
const appUrl = new URL(databaseUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

async function withTenant<T>(tenantId: string, work: (query: (text: string) => Promise<{ rows: { id: string }[] }>) => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query(`SET app.current_tenant = '${tenantId}'`);
    const query = async (text: string): Promise<{ rows: { id: string }[] }> => {
      const result = await client.query(text);
      return { rows: result.rows as { id: string }[] };
    };
    return await work(query);
  } finally {
    // Pool context reset: the tenant setting must never leak to the next checkout.
    await client.query('RESET app.current_tenant');
    client.release();
  }
}

beforeAll(async () => {
  await admin.query(migration);
  await admin.query(`DELETE FROM repository_grants`);
  await admin.query(`DELETE FROM memberships`);
  await admin.query(`DELETE FROM projects`);
  await admin.query(`DELETE FROM tenants`);
  await admin.query(`INSERT INTO tenants (id) VALUES ('tenant-a'), ('tenant-b')`);
  await admin.query(
    `INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ` +
      `('tenant-a', 'user-1', 'owner', 3), ('tenant-a', 'user-2', 'member', 3), ` +
      `('tenant-b', 'user-9', 'owner', 1)`,
  );
  await admin.query(
    `INSERT INTO projects (id, tenant_id) VALUES ` +
      `('proj-a1', 'tenant-a'), ('proj-a2', 'tenant-a'), ('proj-b1', 'tenant-b')`,
  );
  await admin.query(
    `INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ` +
      `('tenant-a', 'repo-a1', 'proj-a1'), ('tenant-b', 'repo-b1', 'proj-b1')`,
  );
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('row-level security isolates tenants on real PostgreSQL', () => {
  it('shows each tenant exactly its own projects', async () => {
    const a = await withTenant('tenant-a', (query) => query(`SELECT id FROM projects ORDER BY id`));
    const b = await withTenant('tenant-b', (query) => query(`SELECT id FROM projects ORDER BY id`));

    expect(a.rows.map((row) => row.id)).toEqual(['proj-a1', 'proj-a2']);
    expect(b.rows.map((row) => row.id)).toEqual(['proj-b1']);
  });

  it('shows each tenant exactly its own memberships and grants', async () => {
    const memberships = await withTenant('tenant-a', (query) =>
      query(`SELECT tenant_id AS id FROM memberships ORDER BY user_id`),
    );
    const grants = await withTenant('tenant-b', (query) =>
      query(`SELECT repository_id AS id FROM repository_grants`),
    );

    expect(memberships.rows.map((row) => row.id)).toEqual(['tenant-a', 'tenant-a']);
    expect(grants.rows.map((row) => row.id)).toEqual(['repo-b1']);
  });

  it('shows zero rows when the tenant setting is absent (fail closed, no leak)', async () => {
    const client = await appPool.connect();
    try {
      const projects = await client.query(`SELECT id FROM projects`);
      const tenants = await client.query(`SELECT id FROM tenants`);
      expect(projects.rows).toEqual([]);
      expect(tenants.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('resets the tenant setting on release so pooled checkouts start unset', async () => {
    await withTenant('tenant-a', (query) => query(`SELECT id FROM projects`));

    const client = await appPool.connect();
    try {
      const setting = await client.query(`SELECT current_setting('app.current_tenant', true) AS value`);
      const value = (setting.rows as { value: string | null }[])[0]?.value;
      expect(value).toBeNull();
    } finally {
      client.release();
    }
  });

  it('keeps concurrent tenants isolated on parallel pooled checkouts', async () => {
    const [a, b] = await Promise.all([
      withTenant('tenant-a', (query) => query(`SELECT id FROM projects ORDER BY id`)),
      withTenant('tenant-b', (query) => query(`SELECT id FROM projects ORDER BY id`)),
    ]);

    expect(a.rows.map((row) => row.id)).toEqual(['proj-a1', 'proj-a2']);
    expect(b.rows.map((row) => row.id)).toEqual(['proj-b1']);
  });

  it('runs application queries as a role that cannot bypass RLS or run DDL', async () => {
    const role = await admin.query(
      `SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'app_user'`,
    );
    expect((role.rows as { bypass: boolean }[])[0]?.bypass).toBe(false);

    const client = await appPool.connect();
    try {
      await expect(client.query(`CREATE TABLE probe_escalation (id TEXT)`)).rejects.toThrow();
    } finally {
      client.release();
    }
  });
});
