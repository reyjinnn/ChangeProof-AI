import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ChangeProofError,
  DeploymentProfileSchema,
  DeploymentQualificationSchema,
  Sha256Schema,
} from '../core/index.js';
import type {
  DistributionComposition,
  IdentityComposition,
} from '../orchestrator/index.js';

/**
 * Self-host operator CLI (WP3-31, FR3-43).
 *
 * Process entrypoint: this file owns argv parsing and output formatting, and
 * reaches product behavior only through the orchestrator composition. It
 * reads no clock, environment, or network itself — `index.ts` injects
 * `runtime` and `nowIso`, so every command below stays deterministic and
 * unit-testable. Output carries refs, fingerprints, and digests only; secret
 * values never appear here (NEG3-37).
 */

const SELF_HOST_COMMANDS = [
  'install',
  'upgrade',
  'backup',
  'restore',
  'teardown',
  'status',
  'byok-provision',
  'byok-rotate',
  'byok-revoke',
  'help',
] as const;

export type SelfHostCommand = (typeof SELF_HOST_COMMANDS)[number];

export interface ParsedSelfHostArgs {
  readonly command: SelfHostCommand;
  readonly profile?: string;
  readonly qualification?: string;
  readonly workdir?: string;
  readonly migrations?: string;
  readonly backup?: string;
  readonly confirm?: string;
  readonly db?: string;
  readonly session?: string;
  readonly ref?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly fingerprint?: string;
  readonly secretsFile?: string;
}

export interface SelfHostDeps {
  readonly distribution: DistributionComposition;
  readonly identity: IdentityComposition;
  readonly runtime: {
    readonly nodeVersion: string;
    readonly pnpmVersion: string;
    readonly postgresMajor: string;
  };
  readonly nowIso: string;
}

export interface SelfHostResult {
  readonly exitCode: number;
  readonly output: string;
}

export const SELF_HOST_USAGE =
  'changeproof <install|upgrade|backup|restore|teardown|status|byok-provision|byok-rotate|byok-revoke|help> --key=value\n' +
  '  install --profile=<file> --qualification=<file> --workdir=<dir> --migrations=<dir> --db=<name>\n' +
  '  upgrade --profile=<file> --qualification=<file> --workdir=<dir> --migrations=<dir> --db=<name>\n' +
  '  backup --workdir=<dir> --db=<name>\n' +
  '  restore --profile=<file> --qualification=<file> --workdir=<dir> --migrations=<dir> --backup=<file> --confirm=<dbName>\n' +
  '  teardown --workdir=<dir> --confirm=<dbName>\n' +
  '  status --workdir=<dir>\n' +
  '  byok-provision --db=<name> --session=<id> --ref=<id> --provider=<p> --model=<m> --fingerprint=<sha256> --secrets-file=<file>\n' +
  '  byok-rotate --db=<name> --session=<id> --ref=<id> --fingerprint=<sha256> --secrets-file=<file>\n' +
  '  byok-revoke --db=<name> --session=<id> --ref=<id>';

function isCommand(value: string): value is SelfHostCommand {
  return (SELF_HOST_COMMANDS as readonly string[]).includes(value);
}

export function parseSelfHostArgs(argv: readonly string[]): ParsedSelfHostArgs {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help') {
    return { command: 'help' };
  }
  if (!isCommand(command)) {
    throw new ChangeProofError(
      `unknown command "${command}"; expected one of: ${SELF_HOST_COMMANDS.join(', ')}.`,
    );
  }
  const flags: Record<string, string> = {};
  for (const arg of rest) {
    const match = /^--([a-zA-Z][a-zA-Z-]*)=([\s\S]*)$/.exec(arg);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined || value.length === 0) {
      throw new ChangeProofError(`malformed flag "${arg}"; expected --key=value with a value.`);
    }
    flags[key] = value;
  }
  const need = (key: string): string => {
    const value = flags[key];
    if (value === undefined) {
      throw new ChangeProofError(`command "${command}" requires --${key}=<value>; refusing.`);
    }
    return value;
  };
  switch (command) {
    case 'install':
    case 'upgrade':
      return {
        command,
        profile: need('profile'),
        qualification: need('qualification'),
        workdir: need('workdir'),
        migrations: need('migrations'),
        db: need('db'),
      };
    case 'backup':
      return { command, workdir: need('workdir'), db: need('db') };
    case 'restore':
      return {
        command,
        profile: need('profile'),
        qualification: need('qualification'),
        workdir: need('workdir'),
        migrations: need('migrations'),
        backup: need('backup'),
        confirm: need('confirm'),
      };
    case 'teardown':
      return { command, workdir: need('workdir'), confirm: need('confirm') };
    case 'status':
      return { command, workdir: need('workdir') };
    case 'byok-provision':
      return {
        command,
        db: need('db'),
        session: need('session'),
        ref: need('ref'),
        provider: need('provider'),
        model: need('model'),
        fingerprint: need('fingerprint'),
        secretsFile: need('secrets-file'),
      };
    case 'byok-rotate':
      return {
        command,
        db: need('db'),
        session: need('session'),
        ref: need('ref'),
        fingerprint: need('fingerprint'),
        secretsFile: need('secrets-file'),
      };
    case 'byok-revoke':
      return { command, db: need('db'), session: need('session'), ref: need('ref') };
    case 'help':
      return { command };
  }
}

function loadProfile(path: string): ReturnType<typeof DeploymentProfileSchema.parse> {
  return DeploymentProfileSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

function loadQualification(
  path: string,
): ReturnType<typeof DeploymentQualificationSchema.parse> {
  return DeploymentQualificationSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

function loadMigrations(
  dir: string,
  files: readonly string[],
): readonly { name: string; sql: string }[] {
  return files.map((name) => {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new ChangeProofError(`Migration name "${name}" is not a plain file name; refusing.`);
    }
    return { name, sql: readFileSync(join(dir, name), 'utf8') };
  });
}

function required(value: string | undefined, flag: string, command: SelfHostCommand): string {
  if (value === undefined) {
    throw new ChangeProofError(`command "${command}" requires --${flag}=<value>; refusing.`);
  }
  return value;
}

export async function runSelfHost(
  args: ParsedSelfHostArgs,
  deps: SelfHostDeps,
): Promise<SelfHostResult> {
  switch (args.command) {
    case 'help':
      return { exitCode: 0, output: SELF_HOST_USAGE };
    case 'install': {
      const profilePath = required(args.profile, 'profile', args.command);
      const profile = loadProfile(profilePath);
      deps.distribution.assertQualified(
        profile,
        loadQualification(required(args.qualification, 'qualification', args.command)),
      );
      const receipt = await deps.distribution.install({
        dbName: required(args.db, 'db', args.command),
        profile,
        runtime: deps.runtime,
        workdir: required(args.workdir, 'workdir', args.command),
        migrations: loadMigrations(
          required(args.migrations, 'migrations', args.command),
          profile.migrationFiles,
        ),
        nowIso: deps.nowIso,
      });
      return {
        exitCode: 0,
        output: `installed profile=${receipt.profileId} digest=${receipt.artifactDigest} detail=${receipt.detail}`,
      };
    }
    case 'upgrade': {
      const profilePath = required(args.profile, 'profile', args.command);
      const profile = loadProfile(profilePath);
      deps.distribution.assertQualified(
        profile,
        loadQualification(required(args.qualification, 'qualification', args.command)),
      );
      const receipt = await deps.distribution.upgrade({
        dbName: required(args.db, 'db', args.command),
        profile,
        runtime: deps.runtime,
        workdir: required(args.workdir, 'workdir', args.command),
        migrations: loadMigrations(
          required(args.migrations, 'migrations', args.command),
          profile.migrationFiles,
        ),
        nowIso: deps.nowIso,
      });
      return {
        exitCode: 0,
        output: `upgraded profile=${receipt.profileId} digest=${receipt.artifactDigest} detail=${receipt.detail}`,
      };
    }
    case 'backup': {
      const result = await deps.distribution.backup({
        workdir: required(args.workdir, 'workdir', args.command),
        nowIso: deps.nowIso,
      });
      return {
        exitCode: 0,
        output: `backup path=${result.path} rows=${String(result.rows)} digest=${result.digest}`,
      };
    }
    case 'restore': {
      const profilePath = required(args.profile, 'profile', args.command);
      const profile = loadProfile(profilePath);
      deps.distribution.assertQualified(
        profile,
        loadQualification(required(args.qualification, 'qualification', args.command)),
      );
      const confirm = required(args.confirm, 'confirm', args.command);
      const receipt = await deps.distribution.restore({
        dbName: confirm,
        profile,
        runtime: deps.runtime,
        workdir: required(args.workdir, 'workdir', args.command),
        backupPath: required(args.backup, 'backup', args.command),
        migrations: loadMigrations(
          required(args.migrations, 'migrations', args.command),
          profile.migrationFiles,
        ),
        confirm,
        nowIso: deps.nowIso,
      });
      return {
        exitCode: 0,
        output: `restored digest=${receipt.artifactDigest} detail=${receipt.detail}`,
      };
    }
    case 'teardown': {
      const confirm = required(args.confirm, 'confirm', args.command);
      const result = await deps.distribution.teardown({
        dbName: confirm,
        workdir: required(args.workdir, 'workdir', args.command),
        confirm,
      });
      return {
        exitCode: 0,
        output: `tore down database=${result.dbName} workdirRemoved=${String(result.workdirRemoved)}`,
      };
    }
    case 'status': {
      const state = deps.distribution.status(required(args.workdir, 'workdir', args.command));
      if (state === null) {
        return { exitCode: 0, output: 'not installed' };
      }
      return {
        exitCode: 0,
        output:
          `installed profile=${state.profileId} files=${String(state.files.length)} ` +
          `digest=${state.artifactDigest} installedAt=${state.installedAt}`,
      };
    }
    case 'byok-provision': {
      const context = await deps.identity.store.deriveContext({
        sessionId: required(args.session, 'session', args.command),
        nowIso: deps.nowIso,
      });
      const result = await deps.distribution.byok.provisionCredential({
        context,
        refId: required(args.ref, 'ref', args.command),
        provider: required(args.provider, 'provider', args.command),
        model: required(args.model, 'model', args.command),
        fingerprint: Sha256Schema.parse(required(args.fingerprint, 'fingerprint', args.command)),
        secrets: deps.distribution.secrets,
        nowIso: deps.nowIso,
      });
      return {
        exitCode: 0,
        output: `provisioned ref=${result.refId} duplicate=${String(result.duplicate)}`,
      };
    }
    case 'byok-rotate': {
      const context = await deps.identity.store.deriveContext({
        sessionId: required(args.session, 'session', args.command),
        nowIso: deps.nowIso,
      });
      const result = await deps.distribution.byok.rotateCredential({
        context,
        refId: required(args.ref, 'ref', args.command),
        newFingerprint: Sha256Schema.parse(
          required(args.fingerprint, 'fingerprint', args.command),
        ),
        secrets: deps.distribution.secrets,
        nowIso: deps.nowIso,
      });
      return {
        exitCode: 0,
        output: `rotated ref=${result.refId} rotationVersion=${String(result.rotationVersion)}`,
      };
    }
    case 'byok-revoke': {
      const context = await deps.identity.store.deriveContext({
        sessionId: required(args.session, 'session', args.command),
        nowIso: deps.nowIso,
      });
      const result = await deps.distribution.byok.revokeCredential({
        context,
        refId: required(args.ref, 'ref', args.command),
        nowIso: deps.nowIso,
      });
      return {
        exitCode: 0,
        output: `revoked ref=${result.refId} revoked=${String(result.revoked)}`,
      };
    }
  }
}
