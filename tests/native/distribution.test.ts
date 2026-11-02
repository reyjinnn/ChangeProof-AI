import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TenantContext } from '../../src/core/index.js';
import { parseSelfHostArgs, runSelfHost } from '../../src/cli/selfhost.js';
import { createIdentityStore } from '../../src/modules/identity/index.js';
import { createUsageStore } from '../../src/modules/usage/index.js';
import {
  composeDistribution,
  composeIdentityStore,
  composeMapSecrets,
} from '../../src/orchestrator/index.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-31 / T-31 — BYOK plus self-host deployment on real PostgreSQL (native).
 *
 * Written before the implementation. Provision/rotate/revoke run against
 * real tables with RLS; usage attribution flows through the real ledger; and
 * one workdir goes through a real install (V1..V8) → upgrade (V9) → backup →
 * dropped-database disaster → restore → teardown cycle driven by the actual
 * operator CLI. Unqualified profiles and wrong runtimes stay `blocked`, and
 * no CLI output ever carries a key value (NEG3-21, NEG3-25, NEG3-28, NEG3-37).
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required; start the disposable PostgreSQL container first.');
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const migrationsDir = join(root, 'infra', 'postgres');

const DB_NAME = 't_distribution';
const NOW_ISO = '2026-11-02T00:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const HOUR_MS = 3_600_000;
const TEST_KEY = 'sk-test-live-value-7f3a9c';

const maintenance = new Pool({ connectionString: databaseUrl });
const fileDbUrl = databaseUrlFor(databaseUrl, DB_NAME);
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';

const workdir = mkdtempSync(join(tmpdir(), 'changeproof-dist-'));
const pools: Pool[] = [];
const poolErrors: unknown[] = [];

function track(pool: Pool): Pool {
  // Dropped databases kill idle clients; record every pool error and prove
  // at the end that only those expected terminations happened.
  pool.on('error', (error: unknown) => {
    poolErrors.push(error);
  });
  pools.push(pool);
  return pool;
}

track(maintenance);

function openTarget(): Pool {
  return track(new Pool({ connectionString: fileDbUrl }));
}

function openApp(): Pool {
  return track(new Pool({ connectionString: appUrl.toString() }));
}

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function digest(seed: string): string {
  return createHash('sha256').update(`distribution:${seed}`).digest('hex');
}

let probePostgresMajor = '16';

function actualRuntime(): { nodeVersion: string; pnpmVersion: string; postgresMajor: string } {
  const binary = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return {
    nodeVersion: process.version.startsWith('v') ? process.version.slice(1) : process.version,
    pnpmVersion: execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim(),
    postgresMajor: probePostgresMajor,
  };
}

interface CycleProfile {
  installProfile: string;
  fullProfile: string;
  qualification: string;
}

async function writeCycleFiles(): Promise<CycleProfile> {
  const reported = await maintenance.query('SELECT version() AS version');
  const row = reported.rows[0] as { version: string };
  const major = /PostgreSQL (\d+)/.exec(row.version)?.[1];
  if (major === undefined) {
    throw new Error('Could not read the probe PostgreSQL version; refusing.');
  }
  probePostgresMajor = major;
  const runtime = { ...actualRuntime(), postgresMajor: major };
  const base = JSON.parse(
    readFileSync(join(root, 'infra', 'selfhost', 'profiles', 'local-linux.json'), 'utf8'),
  ) as Record<string, unknown>;
  const common = {
    ...base,
    profileId: 't31-native-1',
    nodePin: runtime.nodeVersion,
    pnpmPin: runtime.pnpmVersion,
    postgresPin: runtime.postgresMajor,
    qualificationMethod: 't31-native-cycle-1',
  };
  const v8 = [
    'V1__identity_tenancy.sql',
    'V2__identity_services.sql',
    'V3__jobs.sql',
    'V4__usage.sql',
    'V5__email_identity.sql',
    'V6__lifecycle.sql',
    'V7__engagement.sql',
    'V8__teamwork.sql',
  ];
  const installProfile = join(workdir, 'profile-install.json');
  const fullProfile = join(workdir, 'profile-full.json');
  const qualification = join(workdir, 'qualification.json');
  writeFileSync(installProfile, JSON.stringify({ ...common, migrationFiles: v8 }), 'utf8');
  writeFileSync(
    fullProfile,
    JSON.stringify({
      ...common,
      migrationFiles: [...v8, 'V9__distribution.sql', 'V10__enterprise.sql'],
    }),
    'utf8',
  );
  writeFileSync(
    qualification,
    JSON.stringify({
      schemaVersion: '1',
      profileId: 't31-native-1',
      method: 't31-native-cycle-1',
      receiptRefs: ['receipt-install-t31'],
      qualifiedAt: NOW_ISO,
    }),
    'utf8',
  );
  return { installProfile, fullProfile, qualification };
}

let cycle: CycleProfile;

interface SeededTenant {
  tenantId: string;
  owner: TenantContext;
  member: TenantContext;
  viewer: TenantContext;
  operator: TenantContext;
}

async function seedTenant(prefix: string): Promise<SeededTenant> {
  const identity = createIdentityStore(openApp());
  const admin = openTarget();
  const tenantId = uniqueId(`${prefix}-tenant`);
  const ownerId = uniqueId(`${prefix}-owner`);
  const memberId = uniqueId(`${prefix}-member`);
  const viewerId = uniqueId(`${prefix}-viewer`);
  const operatorId = uniqueId(`${prefix}-operator`);
  await identity.createTenant(tenantId);
  for (const [userId, role] of [
    [ownerId, 'owner'],
    [memberId, 'member'],
    [viewerId, 'viewer'],
    [operatorId, 'operator'],
  ] as const) {
    await admin.query(
      'INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, $3, 0)',
      [tenantId, userId, role],
    );
  }
  const sessionFor = async (userId: string): Promise<TenantContext> => {
    const session = await identity.createSession({ tenantId, userId, ttlMs: HOUR_MS, nowMs: NOW_MS });
    return identity.deriveContext({ sessionId: session.sessionId, nowIso: NOW_ISO });
  };
  return {
    tenantId,
    owner: await sessionFor(ownerId),
    member: await sessionFor(memberId),
    viewer: await sessionFor(viewerId),
    operator: await sessionFor(operatorId),
  };
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, DB_NAME);
  cycle = await writeCycleFiles();
}, 60_000);

afterAll(async () => {
  for (const pool of pools) {
    await pool.end();
  }
  rmSync(workdir, { recursive: true, force: true });
  for (const error of poolErrors) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as Record<string, unknown>)['code']
        : null;
    if (code !== '57P01') {
      throw new Error(`Unexpected pool error during the cycle: ${String(code)}`);
    }
  }
});

describe('deployment gate blocks unqualified installs (native)', () => {
  it('refuses the wrong runtime and a mismatched qualification', async () => {
    const target = openTarget();
    const distribution = composeDistribution({
      db: target,
      maintenanceDb: maintenance,
      secrets: composeMapSecrets(new Map()),
    });
    const identity = composeIdentityStore(openApp());
    const deps = {
      distribution,
      identity,
      runtime: { ...actualRuntime(), nodeVersion: '0.0.0' },
      nowIso: NOW_ISO,
    };
    await expect(
      runSelfHost(
        parseSelfHostArgs([
          'install',
          `--profile=${cycle.installProfile}`,
          `--qualification=${cycle.qualification}`,
          `--workdir=${workdir}`,
          `--migrations=${migrationsDir}`,
          `--db=${DB_NAME}`,
        ]),
        deps,
      ),
    ).rejects.toThrow(/blocked/);
    const badQualification = join(workdir, 'qualification-bad.json');
    writeFileSync(
      badQualification,
      JSON.stringify({
        schemaVersion: '1',
        profileId: 't31-native-1',
        method: 'some-other-method',
        receiptRefs: ['receipt-x'],
        qualifiedAt: NOW_ISO,
      }),
      'utf8',
    );
    await expect(
      runSelfHost(
        parseSelfHostArgs([
          'install',
          `--profile=${cycle.installProfile}`,
          `--qualification=${badQualification}`,
          `--workdir=${workdir}`,
          `--migrations=${migrationsDir}`,
          `--db=${DB_NAME}`,
        ]),
        { ...deps, runtime: actualRuntime() },
      ),
    ).rejects.toThrow(/blocked/);
    expect(existsSync(join(workdir, 'applied.json'))).toBe(false);
  }, 60_000);
});

describe('install then upgrade (native)', () => {
  it('installs V1..V8, upgrades to V9, and reports already-current', async () => {
    const target = openTarget();
    const distribution = composeDistribution({
      db: target,
      maintenanceDb: maintenance,
      secrets: composeMapSecrets(new Map()),
    });
    const identity = composeIdentityStore(openApp());
    const deps = { distribution, identity, runtime: actualRuntime(), nowIso: NOW_ISO };
    const statusBefore = await runSelfHost(
      parseSelfHostArgs(['status', `--workdir=${workdir}`]),
      deps,
    );
    expect(statusBefore.output).toBe('not installed');
    const installed = await runSelfHost(
      parseSelfHostArgs([
        'install',
        `--profile=${cycle.installProfile}`,
        `--qualification=${cycle.qualification}`,
        `--workdir=${workdir}`,
        `--migrations=${migrationsDir}`,
        `--db=${DB_NAME}`,
      ]),
      deps,
    );
    expect(installed.output).toMatch(/installed profile=t31-native-1/);
    const statusAfter = await runSelfHost(
      parseSelfHostArgs(['status', `--workdir=${workdir}`]),
      deps,
    );
    expect(statusAfter.output).toMatch(/files=8/);
    const upgraded = await runSelfHost(
      parseSelfHostArgs([
        'upgrade',
        `--profile=${cycle.fullProfile}`,
        `--qualification=${cycle.qualification}`,
        `--workdir=${workdir}`,
        `--migrations=${migrationsDir}`,
        `--db=${DB_NAME}`,
      ]),
      deps,
    );
    expect(upgraded.output).toMatch(/applied 2 migrations/);
    const byokTable = await target.query(`SELECT to_regclass('byok_credentials') AS present`);
    expect((byokTable.rows[0] as { present: string }).present).toBe('byok_credentials');
    const again = await runSelfHost(
      parseSelfHostArgs([
        'upgrade',
        `--profile=${cycle.fullProfile}`,
        `--qualification=${cycle.qualification}`,
        `--workdir=${workdir}`,
        `--migrations=${migrationsDir}`,
        `--db=${DB_NAME}`,
      ]),
      deps,
    );
    expect(again.output).toMatch(/already current/);
  }, 120_000);
});

describe('BYOK lifecycle on real postgres (native)', () => {
  it('provisions, rotates, and revokes with tenant-isolated reads', async () => {
    const tenant = await seedTenant('byok');
    const other = await seedTenant('byok-other');
    const secrets = new Map<string, string>([['byok-active-1', TEST_KEY]]);
    const distribution = composeDistribution({
      db: openApp(),
      maintenanceDb: maintenance,
      secrets: composeMapSecrets(secrets),
    });
    const first = 'a'.repeat(64);
    const second = 'b'.repeat(64);
    const provisioned = await distribution.byok.provisionCredential({
      context: tenant.owner,
      refId: 'byok-active-1',
      provider: 'meta',
      model: 'muse-spark-1.3',
      fingerprint: first,
      secrets: distribution.secrets,
      nowIso: NOW_ISO,
    });
    expect(provisioned).toMatchObject({ refId: 'byok-active-1', duplicate: false });
    const read = await distribution.byok.getCredential({
      context: tenant.member,
      refId: 'byok-active-1',
    });
    expect(read).toMatchObject({ fingerprint: first, status: 'active', rotationVersion: 1 });
    expect(Object.keys(read)).not.toContain('keyMaterial');
    const identical = await distribution.byok.provisionCredential({
      context: tenant.owner,
      refId: 'byok-active-1',
      provider: 'meta',
      model: 'muse-spark-1.3',
      fingerprint: first,
      secrets: distribution.secrets,
      nowIso: NOW_ISO,
    });
    expect(identical.duplicate).toBe(true);
    await expect(
      distribution.byok.provisionCredential({
        context: tenant.owner,
        refId: 'byok-active-1',
        provider: 'meta',
        model: 'muse-spark-1.3',
        fingerprint: second,
        secrets: distribution.secrets,
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/different metadata/);
    await expect(
      distribution.byok.provisionCredential({
        context: tenant.owner,
        refId: 'byok-missing-value',
        provider: 'meta',
        model: 'muse-spark-1.3',
        fingerprint: first,
        secrets: distribution.secrets,
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow();
    secrets.set('byok-active-1', 'sk-test-rotated-value-9d2b');
    const rotated = await distribution.byok.rotateCredential({
      context: tenant.owner,
      refId: 'byok-active-1',
      newFingerprint: second,
      secrets: distribution.secrets,
      nowIso: NOW_ISO,
    });
    expect(rotated.rotationVersion).toBe(2);
    const afterRotate = await distribution.byok.getCredential({
      context: tenant.owner,
      refId: 'byok-active-1',
    });
    expect(afterRotate.fingerprint).toBe(second);
    await expect(
      distribution.byok.provisionCredential({
        context: tenant.viewer,
        refId: 'byok-viewer-1',
        provider: 'meta',
        model: 'muse-spark-1.3',
        fingerprint: first,
        secrets: distribution.secrets,
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow(/owner or admin/);
    await expect(
      distribution.byok.provisionCredential({
        context: tenant.operator,
        refId: 'byok-operator-1',
        provider: 'meta',
        model: 'muse-spark-1.3',
        fingerprint: first,
        secrets: distribution.secrets,
        nowIso: NOW_ISO,
      }),
    ).rejects.toThrow();
    await expect(
      distribution.byok.getCredential({ context: other.owner, refId: 'byok-active-1' }),
    ).rejects.toThrow(/unknown/);
    secrets.set('byok-other-1', 'sk-test-other-tenant-1c4e');
    const otherProvisioned = await distribution.byok.provisionCredential({
      context: other.owner,
      refId: 'byok-other-1',
      provider: 'meta',
      model: 'muse-spark-1.3',
      fingerprint: first,
      secrets: distribution.secrets,
      nowIso: NOW_ISO,
    });
    expect(otherProvisioned.duplicate).toBe(false);
    const revoked = await distribution.byok.revokeCredential({
      context: tenant.owner,
      refId: 'byok-active-1',
      nowIso: NOW_ISO,
    });
    expect(revoked.revoked).toBe(true);
    const revokedAgain = await distribution.byok.revokeCredential({
      context: tenant.owner,
      refId: 'byok-active-1',
      nowIso: NOW_ISO,
    });
    expect(revokedAgain.revoked).toBe(false);
    const checked = distribution.secretsFor(tenant.owner);
    await expect(checked.readCredential('byok-active-1')).rejects.toThrow(/revoked/);
    await expect(checked.readCredential('byok-other-1')).rejects.toThrow();
    const otherChecked = distribution.secretsFor(other.owner);
    await expect(otherChecked.readCredential('byok-other-1')).resolves.toBe(
      'sk-test-other-tenant-1c4e',
    );
  }, 60_000);

  it('never prints a key value through the operator CLI', async () => {
    const tenant = await seedTenant('byok-cli');
    const secrets = new Map<string, string>([['byok-cli-1', TEST_KEY]]);
    const distribution = composeDistribution({
      db: openApp(),
      maintenanceDb: maintenance,
      secrets: composeMapSecrets(secrets),
    });
    const identity = composeIdentityStore(openApp());
    const session = await createIdentityStore(openApp()).createSession({
      tenantId: tenant.tenantId,
      userId: tenant.owner.userId,
      ttlMs: HOUR_MS,
      nowMs: NOW_MS,
    });
    const provisioned = await runSelfHost(
      {
        command: 'byok-provision',
        db: DB_NAME,
        session: session.sessionId,
        ref: 'byok-cli-1',
        provider: 'meta',
        model: 'muse-spark-1.3',
        fingerprint: 'c'.repeat(64),
        secretsFile: join(workdir, 'secrets.json'),
      },
      { distribution, identity, runtime: actualRuntime(), nowIso: NOW_ISO },
    );
    expect(provisioned.output).toMatch(/provisioned ref=byok-cli-1/);
    expect(provisioned.output).not.toContain(TEST_KEY);
  }, 60_000);
});

describe('BYOK usage attribution (native)', () => {
  it('attributes model consumption to the tenant reservation and provider', async () => {
    const tenant = await seedTenant('byok-use');
    const usage = createUsageStore(openApp());
    await usage.setEntitlement({
      tenantId: tenant.tenantId,
      capAmount: 1000,
      rateVersion: 'rate-t31',
      periodId: 'period-t31',
      nowIso: NOW_ISO,
    });
    const admitted = await usage.admitReservation({
      tenantId: tenant.tenantId,
      runId: 'run-byok-1',
      reservationId: 'res-byok-1',
      effectId: digest('reserve-1'),
      requested: 200,
      nowIso: NOW_ISO,
    });
    expect(admitted.reserved).toBe(200);
    const consumed = await usage.recordConsume({
      tenantId: tenant.tenantId,
      reservationId: 'res-byok-1',
      effectId: digest('consume-1'),
      provider: 'byok:meta',
      measuredUnits: 50,
      unitName: 'tokens-k',
      nowIso: NOW_ISO,
    });
    expect(consumed.consumed).toBe(50);
    const balances = await usage.readBalances({ tenantId: tenant.tenantId });
    expect(balances.consumed).toBe(50);
    const ledger = await openTarget().query(
      `SELECT provider, measured_units FROM usage_ledger WHERE reservation_id = $1 AND event = 'consume'`,
      ['res-byok-1'],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0] as { provider: string }).toMatchObject({ provider: 'byok:meta' });
  }, 60_000);
});

describe('backup, disaster, restore (native)', () => {
  it('restores credential metadata with revocations replayed', async () => {
    const target = openTarget();
    const distribution = composeDistribution({
      db: target,
      maintenanceDb: maintenance,
      secrets: composeMapSecrets(new Map()),
    });
    const identity = composeIdentityStore(openApp());
    const deps = { distribution, identity, runtime: actualRuntime(), nowIso: NOW_ISO };
    const backup = await runSelfHost(
      parseSelfHostArgs(['backup', `--workdir=${workdir}`, `--db=${DB_NAME}`]),
      deps,
    );
    expect(backup.output).toMatch(/rows=\d+ digest=[0-9a-f]{64}/);
    const backupPath = join(
      workdir,
      `backup-${NOW_ISO.replace(/[^0-9]/g, '')}.json`,
    );
    expect(existsSync(backupPath)).toBe(true);
    const rawBackup = readFileSync(backupPath, 'utf8');
    expect(rawBackup).not.toContain(TEST_KEY);
    const backupJson = JSON.parse(rawBackup) as {
      tables: { name: string; columns: string[]; rows: unknown[][] }[];
    };
    const byokTable = backupJson.tables.find((table) => table.name === 'byok_credentials');
    expect(byokTable?.rows).toHaveLength(3);
    expect(backupJson.tables.some((table) => table.name === 'tenants')).toBe(true);
    const tenantsBefore = await target.query(`SELECT COUNT(*) AS count FROM tenants`);
    const membersBefore = await target.query(`SELECT COUNT(*) AS count FROM memberships`);
    await expect(
      runSelfHost(
        parseSelfHostArgs([
          'restore',
          `--profile=${cycle.fullProfile}`,
          `--qualification=${cycle.qualification}`,
          `--workdir=${workdir}`,
          `--migrations=${migrationsDir}`,
          `--backup=${backupPath}`,
          '--confirm=t_restore_typo',
        ]),
        deps,
      ),
    ).rejects.toThrow(/not "t_restore_typo"/);
    await maintenance.query(`DROP DATABASE "${DB_NAME}" WITH (FORCE)`);
    const gone = await maintenance.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]);
    expect(gone.rows).toHaveLength(0);
    const freshTarget = openTarget();
    const freshDistribution = composeDistribution({
      db: freshTarget,
      maintenanceDb: maintenance,
      secrets: composeMapSecrets(new Map()),
    });
    const restored = await runSelfHost(
      parseSelfHostArgs([
        'restore',
        `--profile=${cycle.fullProfile}`,
        `--qualification=${cycle.qualification}`,
        `--workdir=${workdir}`,
        `--migrations=${migrationsDir}`,
        `--backup=${backupPath}`,
        `--confirm=${DB_NAME}`,
      ]),
      { ...deps, distribution: freshDistribution },
    );
    expect(restored.output).toMatch(/content verified/);
    const tenantsAfter = await freshTarget.query(`SELECT COUNT(*) AS count FROM tenants`);
    const membersAfter = await freshTarget.query(`SELECT COUNT(*) AS count FROM memberships`);
    expect(tenantsAfter.rows).toEqual(tenantsBefore.rows);
    expect(membersAfter.rows).toEqual(membersBefore.rows);
    const rows = await freshTarget.query(
      `SELECT id, status, rotation_version FROM byok_credentials ORDER BY id`,
    );
    expect(rows.rows).toHaveLength(3);
    const statuses = Object.fromEntries(
      (rows.rows as { id: string; status: string }[]).map((row) => [row.id, row.status]),
    );
    expect(statuses).toMatchObject({
      'byok-active-1': 'revoked',
      'byok-cli-1': 'active',
      'byok-other-1': 'active',
    });
    const rotated = (rows.rows as { id: string; rotation_version: number }[]).find(
      (row) => row.id === 'byok-active-1',
    );
    expect(rotated?.rotation_version).toBe(2);
  }, 120_000);
});

describe('teardown (native)', () => {
  it('removes the database and the workdir only with confirmation', async () => {
    const distribution = composeDistribution({
      db: openTarget(),
      maintenanceDb: maintenance,
      secrets: composeMapSecrets(new Map()),
    });
    const identity = composeIdentityStore(openApp());
    const deps = { distribution, identity, runtime: actualRuntime(), nowIso: NOW_ISO };
    await expect(
      runSelfHost(
        {
          command: 'teardown',
          workdir,
          confirm: 't_distribution_typo',
        },
        deps,
      ),
    ).rejects.toThrow(/not "t_distribution_typo"/);
    expect(existsSync(workdir)).toBe(true);
    const torn = await runSelfHost(
      parseSelfHostArgs(['teardown', `--workdir=${workdir}`, `--confirm=${DB_NAME}`]),
      deps,
    );
    expect(torn.output).toMatch(/workdirRemoved=true/);
    const gone = await maintenance.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]);
    expect(gone.rows).toHaveLength(0);
    expect(existsSync(workdir)).toBe(false);
  }, 60_000);
});
