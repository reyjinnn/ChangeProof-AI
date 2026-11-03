import { Pool } from 'pg';

/**
 * Native-test database isolation (tests only, never product code).
 *
 * Native files share one disposable PostgreSQL container but must never share
 * state: each file gets its own database, dropped and recreated in beforeAll,
 * plus its own Redis logical database. Scheduling (serial or parallel) then
 * cannot change results. Databases live and die with the probe container.
 */

export function databaseUrlFor(baseUrl: string, dbName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export function redisUrlFor(baseUrl: string, dbIndex: number): string {
  const url = new URL(baseUrl);
  url.pathname = `/${String(dbIndex)}`;
  return url.toString();
}

/** Deterministic seed pick without indexed access. */
export function pick<T>(values: readonly [T, ...T[]], index: number): T {
  const value = values[index % values.length];
  if (value === undefined) throw new Error('seed index out of bounds');
  return value;
}

/** Drop and recreate a probe database; FORCE disconnects crashed-run strays. */
export async function resetProbeDatabase(maintenanceUrl: string, dbName: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error('Probe database name is not a safe identifier.');
  }
  const admin = new Pool({ connectionString: maintenanceUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
}
