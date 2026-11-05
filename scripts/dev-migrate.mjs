#!/usr/bin/env node
/**
 * Local-dev database setup: creates the target database (if missing) and
 * applies migration files in the order pinned by
 * `infra/selfhost/profiles/local-linux.json`.
 *
 * Reads DEV_ADMIN_URL / DEV_DB_NAME (defaults: the cp-dev-pg container and
 * its `changeproof` database), falling back to the repo-root `.env` for
 * keys missing from the process environment. `--only <file>` applies a
 * single profile-listed migration: use it for databases that already hold
 * earlier versions (replaying V1 would drop their tables). This is a
 * DEVELOPMENT helper only — the hosted migrator owns production DDL.
 * Nothing printed here ever carries a secret value.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

// .env fallback for keys the process environment does not set; explicit
// environment always wins. Values are never printed.
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const cut = line.indexOf('=');
    if (cut < 1) continue;
    const name = line.slice(0, cut).trim();
    const value = line.slice(cut + 1).trim();
    if (name !== '' && (process.env[name] ?? '') === '') process.env[name] = value;
  }
}

const ADMIN_URL =
  process.env['DEV_ADMIN_URL'] || 'postgresql://postgres:changeproof-dev@127.0.0.1:55432/postgres';
const DB_NAME = process.env['DEV_DB_NAME'] || 'changeproof';
try {
  if (new URL(ADMIN_URL).password === '') {
    console.error('dev-migrate: DEV_ADMIN_URL carries no password; fill it in and retry (never commit it).');
    process.exit(1);
  }
} catch {
  console.error('dev-migrate: DEV_ADMIN_URL is unreadable; refusing.');
  process.exit(1);
}
const onlyFlag = process.argv.indexOf('--only');
const ONLY = onlyFlag === -1 ? undefined : process.argv[onlyFlag + 1];

function databaseUrlFor(baseUrl, dbName) {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

const profile = JSON.parse(readFileSync(join(root, 'infra', 'selfhost', 'profiles', 'local-linux.json'), 'utf8'));
const listed = profile.migrationFiles;
const files =
  ONLY === undefined ? listed : (Array.isArray(listed) && listed.includes(ONLY) ? [ONLY] : undefined);
if (!Array.isArray(files) || files.length === 0) {
  console.error(
    ONLY === undefined
      ? 'dev-migrate: profile carries no migration files; refusing.'
      : `dev-migrate: "${ONLY}" is not a profile-listed migration; refusing.`,
  );
  process.exitCode = 1;
} else {
  const maintenance = new Pool({ connectionString: ADMIN_URL });
  try {
    const found = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (found.rows.length === 0) {
      await maintenance.query(`CREATE DATABASE "${DB_NAME}"`);
      process.stdout.write(`dev-migrate: created database "${DB_NAME}".\n`);
    }
  } finally {
    await maintenance.end();
  }
  const target = new Pool({ connectionString: databaseUrlFor(ADMIN_URL, DB_NAME) });
  try {
    for (const file of files) {
      const sql = readFileSync(join(root, 'infra', 'postgres', file), 'utf8');
      await target.query(sql);
      process.stdout.write(`dev-migrate: applied ${file}.\n`);
    }
    process.stdout.write('dev-migrate: done.\n');
  } catch (error) {
    console.error(`dev-migrate: failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await target.end();
  }
}
