import { spawn } from 'node:child_process';

/**
 * Native toolchain invocation for adapter extraction.
 *
 * These helpers run read-only analysis tools over bounded source snapshots.
 * They are not the guest runner: no customer code is executed here. Every
 * invocation has a timeout, output cap, and explicit stdin; no shell is used.
 */

export interface NativeRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface NativeRunOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly input?: string;
}

/**
 * The environment a native toolchain is allowed to see.
 *
 * Only toolchain build/cache variables are forwarded. Nothing secret is passed:
 * model, GitHub and payment credentials stay in their brokers and never reach a
 * parser helper (AGENTS.md §3 rule 12). The list is explicit so a new
 * environment variable cannot leak in by accident.
 */
const FORWARDED_ENVIRONMENT = [
  'PATH',
  'Path',
  'SystemRoot',
  'SystemDrive',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'GOCACHE',
  'GOPATH',
  'GOMODCACHE',
  'GOTOOLCHAIN',
  'GOFLAGS',
  'GOPROXY',
  'DOTNET_ROOT',
  'DOTNET_CLI_HOME',
  'DOTNET_CLI_TELEMETRY_OPTOUT',
  'DOTNET_NOLOGO',
  'JAVA_HOME',
  'LANG',
  'LC_ALL',
  // MSBuild/NuGet need standard Windows installation roots to locate their
  // SDK packs and package cache. These are paths, not credentials.
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'NUGET_PACKAGES',
  'DOTNET_HOST_PATH',
  'DOTNET_ROOT(x86)',
  'MSBuildSDKsPath',
  'MSBuildExtensionsPath',
  'MSBuildToolsPath',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
] as const;

function nativeEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of FORWARDED_ENVIRONMENT) {
    const value = process.env[name];
    if (value !== undefined && value !== '') {
      env[name] = value;
    }
  }
  return env;
}

export async function runNative(
  command: string,
  args: readonly string[],
  options: NativeRunOptions,
): Promise<NativeRunResult> {
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: nativeEnvironment(),
    });

    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    };

    const timer = setTimeout(() => {
      stderr += `\nProcess timed out after ${options.timeoutMs}ms`;
      child.kill('SIGKILL');
      finish(124);
    }, options.timeoutMs);

    const append = (current: string, chunk: Buffer): string => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        stderr += `\nProcess output exceeded ${options.maxOutputBytes} bytes`;
        child.kill('SIGKILL');
        finish(125);
        return current;
      }
      return current + chunk.toString('utf8');
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(127);
    });
    child.on('close', (code, signal) => {
      finish(code ?? (signal === null ? 1 : 128));
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input, 'utf8');
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Parse JSON emitted by a helper, returning null when the output is unusable.
 *
 * The result is returned untyped on purpose: the caller declares the expected
 * shape, so a helper that emits a different shape fails at that call site
 * instead of being silently accepted here.
 */
export function parseNativeJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}
