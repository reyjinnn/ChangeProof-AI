#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { Pool } from 'pg';
import { z } from 'zod';

import {
  ChangeProofError,
  DeploymentBlockedError,
  MissingConfigurationError,
  type ModelClientPort,
} from '../core/index.js';
import {
  composeDistribution,
  composeIdentityStore,
  composeMapSecrets,
  composeGitHub,
  composeLiveModelClient,
  composeModalRunner,
  type GitHubClient,
  type ModalRunnerComposition,
} from '../orchestrator/index.js';

import { isLiveProbeCommand, parseLiveProbeArgs, runLiveProbe, type ParsedLiveProbeArgs } from './live-probes.js';
import { parseSelfHostArgs, runSelfHost, SELF_HOST_USAGE } from './selfhost.js';

/**
 * ChangeProof operator CLI entrypoint (WP3-31, FR3-43).
 * Live-proof probes (P2/P3/P4) dispatch here too: this file stays the
 * only environment edge, reading probe credentials and helper paths
 * before handing a composed dependency set to `runLiveProbe`.
 *
 * This file is the only environment edge: it reads argv, DATABASE_URL, the
 * pinned runtimes, the secrets file, and the clock, then hands everything to
 * the deterministic `runSelfHost`. Blocked gates exit 2 so automation can
 * tell "not qualified" apart from a failure; every other error exits 1 with
 * an actionable message. Nothing printed here ever carries a secret value.
 */

const SAFE_DB_NAME = /^[a-z_][a-z0-9_]*$/;

function databaseUrlFor(baseUrl: string, dbName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function requireFlag(value: string | undefined, flag: string): string {
  if (value === undefined) {
    throw new ChangeProofError(`missing required --${flag}=<value>; refusing.`);
  }
  return value;
}

async function ensureDatabase(maintenance: Pool, dbName: string): Promise<void> {
  if (!SAFE_DB_NAME.test(dbName)) {
    throw new ChangeProofError('Database name is not a safe identifier; refusing.');
  }
  const found = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (found.rows.length === 0) {
    await maintenance.query(`CREATE DATABASE "${dbName}"`);
  }
}

async function postgresMajorOf(maintenance: Pool): Promise<string> {
  const reported = await maintenance.query('SELECT version() AS version');
  const text = z.object({ version: z.string() }).parse(reported.rows[0]).version;
  const major = /PostgreSQL (\d+)/.exec(text)?.[1];
  if (major === undefined) {
    throw new ChangeProofError('Could not read the PostgreSQL server version; refusing.');
  }
  return major;
}

function pnpmVersionOf(): string {
  // Fixed binary plus a literal flag only — no user input reaches the shell.
  const binary = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  try {
    return execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
  } catch {
    throw new MissingConfigurationError('pnpm', 'PATH', 'Install the pinned pnpm first.');
  }
}

/**
 * Live-probe environment edges. Each returns an empty set when its
 * credentials are absent so the probe reports BLOCKED (exit 2); values
 * are read once here and never printed.
 */

function composeProbeModel(probe: ParsedLiveProbeArgs): { model: { client: ModelClientPort } } | Record<string, never> {
  const provider = process.env['CHANGEPROOF_MODEL_PROVIDER'] ?? '';
  const baseUrl = process.env['CHANGEPROOF_MODEL_URL'] ?? '';
  const model = process.env['CHANGEPROOF_MODEL_NAME'] ?? '';
  const apiKey = process.env['CHANGEPROOF_MODEL_API_KEY'] ?? '';
  if (provider === '' || baseUrl === '' || model === '' || apiKey === '') return {};
  // [DERIVED] Single-call headroom: the ceiling covers this call maxTokens
  // plus input-token room; the broker reports actuals and never resets.
  const tokenCeiling = probe.maxTokens + 2048;
  return {
    model: {
      client: composeLiveModelClient({
        baseUrl,
        secrets: composeMapSecrets(new Map([['model-key', apiKey]])),
        secretRef: 'model-key',
        provider,
        model,
        configId: probe.configId,
        tokenCeiling,
      }),
    },
  };
}

function composeProbeModal(probe: ParsedLiveProbeArgs): { modal: ModalRunnerComposition } | Record<string, never> {
  const tokenId = process.env['MODAL_TOKEN_ID'] ?? '';
  const tokenSecret = process.env['MODAL_TOKEN_SECRET'] ?? '';
  if (tokenId === '' || tokenSecret === '') return {};
  return {
    modal: composeModalRunner({
      secrets: composeMapSecrets(new Map([['modal-token-id', tokenId], ['modal-token-secret', tokenSecret]])),
      tokenIdRef: 'modal-token-id',
      tokenSecretRef: 'modal-token-secret',
      pythonBin: probe.python ?? (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'),
      scriptPath: probe.script ?? 'scripts/modal_sandbox_probe.py',
      timeoutMs: probe.timeoutMs,
    }),
  };
}

function composeProbeGitHub(): { github: { client: GitHubClient } } | Record<string, never> {
  const token = process.env['CP_GITHUB_INSTALLATION_TOKEN'] ?? '';
  if (token === '') return {};
  return {
    github: {
      client: composeGitHub(composeMapSecrets(new Map([['github-installation-token', token]]))).client,
    },
  };
}

let db: Pool | undefined;
let maintenance: Pool | undefined;
try {
  const argv = process.argv.slice(2);
  if (argv[0] !== undefined && isLiveProbeCommand(argv[0])) {
    const probe = parseLiveProbeArgs(argv);
    const probed = await runLiveProbe(probe, {
      nowIso: new Date().toISOString(),
      ...(probe.command === 'model-live' ? composeProbeModel(probe) : {}),
      ...(probe.command === 'modal-probe' ? composeProbeModal(probe) : {}),
      ...(probe.command === 'github-probe' ? composeProbeGitHub() : {}),
    });
    process.stdout.write(`${probed.output}\n`);
    process.exitCode = probed.exitCode;
  } else {
    const parsed = parseSelfHostArgs(argv);
    if (parsed.command === 'help') {
      process.stdout.write(`${SELF_HOST_USAGE}\n`);
      process.exitCode = 0;
    } else if (parsed.command === 'status') {
      // Status reads the workdir only: pools are constructed, never connected.
      const lazyDb = new Pool();
      const lazyMaintenance = new Pool();
      db = lazyDb;
      maintenance = lazyMaintenance;
      const result = await runSelfHost(parsed, {
        distribution: composeDistribution({
          db: lazyDb,
          maintenanceDb: lazyMaintenance,
          secrets: composeMapSecrets(new Map()),
        }),
        identity: composeIdentityStore(lazyDb),
        runtime: { nodeVersion: '', pnpmVersion: '', postgresMajor: '' },
        nowIso: new Date().toISOString(),
      });
      process.stdout.write(`${result.output}\n`);
      process.exitCode = result.exitCode;
    } else {
      const baseUrl = process.env['DATABASE_URL'];
      if (baseUrl === undefined || baseUrl.length === 0) {
        throw new MissingConfigurationError('DATABASE_URL', 'environment');
      }
      const targetName =
        parsed.command === 'restore' || parsed.command === 'teardown'
          ? requireFlag(parsed.confirm, 'confirm')
          : requireFlag(parsed.db, 'db');
      maintenance = new Pool({ connectionString: baseUrl });
      db = new Pool({ connectionString: databaseUrlFor(baseUrl, targetName) });
      if (parsed.command === 'install') {
        await ensureDatabase(maintenance, targetName);
      }
      const secrets =
        parsed.command === 'byok-provision' || parsed.command === 'byok-rotate'
          ? new Map(
              Object.entries(
                z
                  .record(z.string(), z.string().min(1))
                  .parse(
                    JSON.parse(readFileSync(requireFlag(parsed.secretsFile, 'secrets-file'), 'utf8')) as unknown,
                  ),
              ),
            )
          : new Map<string, string>();
      const result = await runSelfHost(parsed, {
        distribution: composeDistribution({ db, maintenanceDb: maintenance, secrets: composeMapSecrets(secrets) }),
        identity: composeIdentityStore(db),
        runtime: {
          nodeVersion: process.version.startsWith('v') ? process.version.slice(1) : process.version,
          pnpmVersion: pnpmVersionOf(),
          postgresMajor: await postgresMajorOf(maintenance),
        },
        nowIso: new Date().toISOString(),
      });
      process.stdout.write(`${result.output}\n`);
      process.exitCode = result.exitCode;
    }
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown CLI failure; refusing.';
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof DeploymentBlockedError ? 2 : 1;
} finally {
  await db?.end();
  await maintenance?.end();
}
