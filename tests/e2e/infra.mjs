// Disposable E2E infrastructure (T-44): PostgreSQL 16 + Mailpit,
// migrated from the reviewed infra/postgres files, torn down always.
// T-45 adds a disposable file-evidence directory per run.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PG_CONTAINER = 'cp-e2e-pg';
export const PG_PORT = '55434';
export const PG_PASSWORD = 'e2e-probe-pw-1';
export const MAIL_CONTAINER = 'cp-e2e-mail';
export const MAIL_API_PORT = '18025';
export const MAIL_SMTP_PORT = '11025';

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000, ...options }).trim();
}

export function dockerAvailable() {
  try {
    docker(['info', '--format', '{{.ServerVersion}}']);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(fn, what, timeoutMs = 90_000) {
  const started = Date.now();
  for (;;) {
    try {
      await fn();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) {
        const last = error instanceof Error ? error.message : String(error);
        throw new Error(`${what} never became ready: ${last}`, { cause: error });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function startInfra(rootDir, migrations, pg) {
  try {
    docker(['rm', '-f', PG_CONTAINER]);
  } catch {
    // Absent from a previous run: nothing to remove.
  }
  try {
    docker(['rm', '-f', MAIL_CONTAINER]);
  } catch {
    // Same: absent is fine.
  }
  docker([
    'run',
    '-d',
    '--name',
    PG_CONTAINER,
    '-e',
    `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    '-p',
    `127.0.0.1:${PG_PORT}:5432`,
    'postgres:16',
  ]);
  docker([
    'run',
    '-d',
    '--name',
    MAIL_CONTAINER,
    '-p',
    `127.0.0.1:${MAIL_API_PORT}:8025`,
    '-p',
    `127.0.0.1:${MAIL_SMTP_PORT}:1025`,
    'axllent/mailpit:v1.21.8',
  ]);
  await waitFor(async () => {
    docker(['exec', PG_CONTAINER, 'pg_isready', '-U', 'postgres']);
  }, 'e2e postgres');
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${MAIL_API_PORT}/api/v1/info`);
    if (!response.ok) throw new Error(`mailpit api ${response.status}`);
  }, 'e2e mailpit');

  const databaseUrl = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/e2e`;
  const maintenance = new pg.Pool({ connectionString: `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres` });
  try {
    await maintenance.query('DROP DATABASE IF EXISTS "e2e" WITH (FORCE)');
    await maintenance.query('CREATE DATABASE "e2e"');
  } finally {
    await maintenance.end();
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    for (const name of migrations) {
      const sql = readFileSync(`${rootDir}/infra/postgres/${name}`, 'utf8');
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
  const evidenceDir = mkdtempSync(join(tmpdir(), 'cp-e2e-evidence-'));
  return {
    databaseUrl,
    mailApi: `http://127.0.0.1:${MAIL_API_PORT}`,
    mailSmtpPort: MAIL_SMTP_PORT,
    evidenceDir,
  };
}

export function stopInfra(evidenceDir) {
  for (const name of [PG_CONTAINER, MAIL_CONTAINER]) {
    try {
      docker(['rm', '-f', name]);
    } catch {
      // Tear-down best effort; the next start removes strays first.
    }
  }
  if (evidenceDir !== undefined) {
    try {
      rmSync(evidenceDir, { recursive: true, force: true });
    } catch {
      // Same: a stray temp dir never fails the run.
    }
  }
}
