import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runNative, type NativeRunResult } from '../../src/modules/adapters/native/process.js';

/**
 * Test-only native execution for adapter L3 proof (T-21).
 *
 * Each test executes the exact check command the adapter planned. Two
 * dev-machine shims apply (documented, not silent): `pnpm` resolves to the
 * global pnpm.exe and `prisma` to the repo-pinned CLI, because Windows has
 * no PATH-resolvable exe for either and the harness never uses a shell.
 * On the linux guest both are plain PATH commands, as the plan states.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');

let cachedGlobalRoot: string | null = null;

async function npmGlobalRoot(): Promise<string> {
  if (cachedGlobalRoot === null) {
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const probe = await runNative(process.execPath, [npmCli, 'root', '-g'], {
      cwd: REPO_ROOT,
      timeoutMs: 30_000,
      maxOutputBytes: 4096,
    });
    if (probe.exitCode !== 0) throw new Error(`npm root -g failed: ${probe.stderr}`);
    cachedGlobalRoot = probe.stdout.trim();
  }
  return cachedGlobalRoot;
}

export async function pnpmExe(): Promise<string> {
  return join(await npmGlobalRoot(), 'pnpm', 'pnpm.exe');
}

/** Fixture-local install of pinned packages (network on first run, store-cached after). */
export async function pnpmAdd(
  cwd: string,
  packages: readonly string[],
  options: { readonly dev?: boolean; readonly allowBuild?: string } = {},
): Promise<NativeRunResult> {
  const args = ['add', ...(options.dev === true ? ['-D'] : []), ...packages];
  if (options.allowBuild !== undefined) args.push(`--allow-build=${options.allowBuild}`);
  return runNative(await pnpmExe(), args, { cwd, timeoutMs: 300_000, maxOutputBytes: 64_000 });
}

export async function runPython(
  cwd: string,
  args: readonly string[],
  timeoutMs = 60_000,
): Promise<NativeRunResult> {
  return runNative('python', args, { cwd, timeoutMs, maxOutputBytes: 64_000 });
}

/** Runs a planned check verbatim, applying only the pnpm/prisma dev-machine shims. */
export async function runPlannedCheck(
  check: { readonly command: string; readonly args: readonly string[]; readonly cwd: string },
  timeoutMs = 300_000,
): Promise<NativeRunResult> {
  if (check.command === 'pnpm') {
    return runNative(await pnpmExe(), [...check.args], {
      cwd: check.cwd,
      timeoutMs,
      maxOutputBytes: 128_000,
    });
  }
  if (check.command === 'prisma') {
    const cli = join(REPO_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
    return runNative(process.execPath, [cli, ...check.args], {
      cwd: check.cwd,
      timeoutMs,
      maxOutputBytes: 64_000,
    });
  }
  return runNative(check.command, [...check.args], {
    cwd: check.cwd,
    timeoutMs,
    maxOutputBytes: 128_000,
  });
}
