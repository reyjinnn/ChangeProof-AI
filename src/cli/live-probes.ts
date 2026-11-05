import {
  ChangeProofError,
  GitShaSchema,
  IdSchema,
  RepositoryConnectionSchema,
  type ModelClientPort,
  type RepositoryConnection,
} from '../core/index.js';
import type { GitHubClient, ModalRunnerComposition } from '../orchestrator/index.js';

/**
 * Live-proof probe commands (P2/P3/P4, operator tooling).
 *
 * Three narrow entries that exercise one real broker seam each and print a
 * receipt: `model-live` (one bounded model call), `modal-probe` (guest
 * isolation through the product runner), `github-probe` (installation
 * read through the product client). This file owns argv parsing and output
 * formatting only — credentials, transports, and budgets are injected by
 * `index.ts`, the only environment edge. Nothing printed here ever carries
 * a secret value; a missing dependency is exit 2 (blocked), a failed
 * probe is exit 1, and a produced receipt is exit 0 even when the
 * verdict inside it is a failure (failures are evidence).
 */

export const LIVE_PROBE_COMMANDS = ['model-live', 'modal-probe', 'github-probe'] as const;
export type LiveProbeCommand = (typeof LIVE_PROBE_COMMANDS)[number];

export function isLiveProbeCommand(value: string): value is LiveProbeCommand {
  return (LIVE_PROBE_COMMANDS as readonly string[]).includes(value);
}

export const LIVE_PROBE_USAGE =
  'changeproof <model-live|modal-probe|github-probe> --key=value\n' +
  '  model-live --prompt=<text> [--system=<text>] [--max-tokens=<1..2000>] [--prompt-id=<id>] [--config-id=<id>]\n' +
  '    env: CHANGEPROOF_MODEL_PROVIDER, CHANGEPROOF_MODEL_URL, CHANGEPROOF_MODEL_NAME, CHANGEPROOF_MODEL_API_KEY\n' +
  '  modal-probe [--python=<bin>] [--script=<path>] [--timeout-ms=<60000..900000>]\n' +
  '    env: MODAL_TOKEN_ID, MODAL_TOKEN_SECRET (broker-held; never forwarded to the guest)\n' +
  '  github-probe --installation=<id> --repository-id=<id> (--sha=<sha> | --branch=<name>) [--owner=<o> --repo=<r>] | --list-repos=1\n' +
  '    env: CP_GITHUB_INSTALLATION_TOKEN (operator-provisioned installation credential)';

const MAX_PROMPT_CHARS = 2000;
const DEFAULT_MAX_TOKENS = 256;
const MAX_MODEL_TOKENS = 2000;
const DEFAULT_MODEL_SYSTEM = 'Reply with exactly one short sentence.';
const DEFAULT_CONFIG_ID = 'config-live-cli-1';
const MIN_MODAL_TIMEOUT_MS = 60_000;
const MAX_MODAL_TIMEOUT_MS = 900_000;
const PROBE_CONNECTION_ID = 'conn-github-probe-1';
const PROBE_TENANT_ID = 'tenant-probe-1';
const PROBE_CREDENTIAL_REF = 'github-installation-token';

export interface ParsedLiveProbeArgs {
  readonly command: LiveProbeCommand;
  readonly prompt?: string;
  readonly system?: string;
  readonly maxTokens: number;
  readonly promptId?: string;
  readonly configId: string;
  readonly python?: string;
  readonly script?: string;
  readonly timeoutMs: number;
  readonly installation?: string;
  readonly repositoryId?: string;
  readonly owner?: string;
  readonly repo?: string;
  readonly sha?: string;
  readonly branch?: string;
  readonly listRepos: boolean;
}

export interface LiveProbeDeps {
  readonly nowIso: string;
  readonly model?: { client: ModelClientPort };
  readonly modal?: ModalRunnerComposition;
  readonly github?: { client: GitHubClient };
}

export interface LiveProbeResult {
  readonly exitCode: number;
  readonly output: string;
}

function fail(message: string): never {
  throw new ChangeProofError(`${message}\n${LIVE_PROBE_USAGE}`);
}

function parseIntFlag(raw: string, flag: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`--${flag} must be an integer ${String(min)}..${String(max)}; refusing.`);
  }
  return value;
}

export function parseLiveProbeArgs(argv: readonly string[]): ParsedLiveProbeArgs {
  const [command, ...rest] = argv;
  if (command === undefined || !isLiveProbeCommand(command)) {
    fail(`unknown live-probe command "${command ?? ''}"; refusing.`);
  }
  const flags: Record<string, string> = {};
  for (const arg of rest) {
    const match = /^--([a-zA-Z][a-zA-Z-]*)=([\s\S]*)$/.exec(arg);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined || value.length === 0) {
      fail(`malformed flag "${arg}"; expected --key=value with a value.`);
    }
    flags[key] = value;
  }
  const maxTokens = flags['max-tokens'] === undefined
    ? DEFAULT_MAX_TOKENS
    : parseIntFlag(flags['max-tokens'], 'max-tokens', 1, MAX_MODEL_TOKENS);
  const timeoutMs = flags['timeout-ms'] === undefined
    ? 660_000
    : parseIntFlag(flags['timeout-ms'], 'timeout-ms', MIN_MODAL_TIMEOUT_MS, MAX_MODAL_TIMEOUT_MS);
  const listRaw = flags['list-repos'];
  if (listRaw !== undefined && listRaw !== '1' && listRaw.toLowerCase() !== 'true') {
    fail('--list-repos must be 1 when present; refusing.');
  }
  const parsed: ParsedLiveProbeArgs = {
    command,
    maxTokens,
    configId: flags['config-id'] ?? DEFAULT_CONFIG_ID,
    timeoutMs,
    listRepos: listRaw !== undefined,
    ...(flags['prompt'] === undefined ? {} : { prompt: flags['prompt'] }),
    ...(flags['system'] === undefined ? {} : { system: flags['system'] }),
    ...(flags['prompt-id'] === undefined ? {} : { promptId: flags['prompt-id'] }),
    ...(flags['python'] === undefined ? {} : { python: flags['python'] }),
    ...(flags['script'] === undefined ? {} : { script: flags['script'] }),
    ...(flags['installation'] === undefined ? {} : { installation: flags['installation'] }),
    ...(flags['repository-id'] === undefined ? {} : { repositoryId: flags['repository-id'] }),
    ...(flags['owner'] === undefined ? {} : { owner: flags['owner'] }),
    ...(flags['repo'] === undefined ? {} : { repo: flags['repo'] }),
    ...(flags['sha'] === undefined ? {} : { sha: flags['sha'] }),
    ...(flags['branch'] === undefined ? {} : { branch: flags['branch'] }),
  };
  switch (command) {
    case 'model-live':
      if (parsed.prompt === undefined || parsed.prompt.length === 0) {
        fail('command "model-live" requires --prompt=<text>; refusing.');
      }
      if (parsed.prompt.length > MAX_PROMPT_CHARS || (parsed.system ?? '').length > MAX_PROMPT_CHARS) {
        fail(`prompt and system are bounded to ${String(MAX_PROMPT_CHARS)} chars; refusing.`);
      }
      assertProbeId(parsed.promptId, '--prompt-id');
      assertProbeId(parsed.configId, '--config-id');
      return parsed;
    case 'modal-probe':
      return parsed;
    case 'github-probe': {
      if (parsed.installation === undefined) {
        fail('command "github-probe" requires --installation=<id>; refusing.');
      }
      if (parsed.repositoryId === undefined) {
        fail('command "github-probe" requires --repository-id=<id>; refusing.');
      }
      assertProbeId(parsed.installation, '--installation');
      assertProbeId(parsed.repositoryId, '--repository-id');
      if (parsed.listRepos) {
        return parsed;
      }
      if (parsed.sha === undefined && parsed.branch === undefined) {
        fail('command "github-probe" requires --sha=<sha>, --branch=<name>, or --list-repos=1; refusing.');
      }
      if (parsed.sha !== undefined) {
        try {
          GitShaSchema.parse(parsed.sha);
        } catch {
          fail('--sha is not a 40-hex commit sha; refusing.');
        }
      }
      if (parsed.owner === undefined || parsed.repo === undefined) {
        fail('command "github-probe" sha/branch mode requires --owner and --repo; refusing.');
      }
      return parsed;
    }
  }
}

function assertProbeId(value: string | undefined, flag: string): void {
  if (value === undefined) return;
  try {
    IdSchema.parse(value);
  } catch {
    fail(`${flag} is not an opaque id; refusing.`);
  }
}

function blocked(message: string): LiveProbeResult {
  return { exitCode: 2, output: `BLOCKED: ${message}` };
}

function defaultPromptId(nowIso: string): string {
  return `prompt-live-${nowIso}`;
}

async function runModelLive(args: ParsedLiveProbeArgs, deps: LiveProbeDeps): Promise<LiveProbeResult> {
  const model = deps.model;
  if (model === undefined) {
    return blocked('model-live needs a wired model client; the operator did not provision model credentials.');
  }
  const prompt = args.prompt ?? '';
  try {
    const promptId = args.promptId ?? defaultPromptId(deps.nowIso);
    IdSchema.parse(promptId);
    const result = await model.client.complete({
      promptId,
      messages: [
        { role: 'system', content: args.system ?? DEFAULT_MODEL_SYSTEM },
        { role: 'user', content: prompt },
      ],
      tools: [],
      maxTokens: args.maxTokens,
      requireToolCall: false,
    });
    return {
      exitCode: 0,
      output: JSON.stringify({
        command: 'model-live',
        proposalMode: 'live_model',
        origin: 'controlled_change',
        executionMode: 'real_runtime',
        provider: model.client.provider,
        model: result.model,
        promptId: result.promptId,
        configId: result.configId,
        providerRequestId: result.providerRequestId,
        usage: result.usage,
        cumulativeTokens: result.cumulativeTokens,
        contractVersion: model.client.contractVersion,
        outputText: result.outputText,
      }),
    };
  } catch (error) {
    return { exitCode: 1, output: `model-live failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function runModalProbe(deps: LiveProbeDeps): Promise<LiveProbeResult> {
  const modal = deps.modal;
  if (modal === undefined) {
    return blocked('modal-probe needs a wired Modal runner; the operator did not provision Modal credentials.');
  }
  try {
    const run = await modal.runProbes(deps.nowIso);
    return {
      exitCode: 0,
      output: JSON.stringify({
        command: 'modal-probe',
        boundaryClass: run.summary.boundaryClass,
        verdict: run.summary.verdict,
        runId: run.summary.runId,
        sandboxId: run.summary.sandboxId,
        network: run.summary.network,
        imageRef: run.summary.imageRef,
        imageDigestPinned: run.summary.imageDigestPinned,
        probes: run.summary.probes,
        cleanup: run.summary.cleanup,
        quarantined: run.quarantined,
        ...(run.quarantineReason === undefined ? {} : { quarantineReason: run.quarantineReason }),
      }),
    };
  } catch (error) {
    return { exitCode: 1, output: `modal-probe failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function probeConnection(args: ParsedLiveProbeArgs): RepositoryConnection {
  return RepositoryConnectionSchema.parse({
    schemaVersion: '1',
    connectionId: PROBE_CONNECTION_ID,
    tenantId: PROBE_TENANT_ID,
    installationId: args.installation ?? '',
    provider: 'github',
    repositoryAllowlist: [args.repositoryId ?? ''],
    permissionMatrix: {},
    status: 'active',
    revocationVersion: 0,
    credentialRef: PROBE_CREDENTIAL_REF,
  });
}

async function runGitHubProbe(args: ParsedLiveProbeArgs, deps: LiveProbeDeps): Promise<LiveProbeResult> {
  const github = deps.github;
  if (github === undefined) {
    return blocked(
      'github-probe needs a wired installation client; the operator did not authorize a GitHub App.',
    );
  }
  try {
    const connection = probeConnection(args);
    if (args.listRepos) {
      const repositories = await github.client.listInstallationRepositories({ connection });
      return {
        exitCode: 0,
        output: JSON.stringify({
          command: 'github-probe',
          installationId: connection.installationId,
          repositories,
        }),
      };
    }
    if (args.sha === undefined) {
      const head = await github.client.fetchBranchHead({
        connection,
        repository: { id: args.repositoryId ?? '', owner: args.owner ?? '', repo: args.repo ?? '' },
        branch: args.branch ?? '',
      });
      return {
        exitCode: 0,
        output: JSON.stringify({
          command: 'github-probe',
          installationId: connection.installationId,
          repository: { owner: args.owner, repo: args.repo },
          branch: args.branch,
          head,
        }),
      };
    }
    const commit = await github.client.fetchCommit({
      connection,
      repository: { id: args.repositoryId ?? '', owner: args.owner ?? '', repo: args.repo ?? '' },
      sha: args.sha ?? '',
    });
    return {
      exitCode: 0,
      output: JSON.stringify({
        command: 'github-probe',
        installationId: connection.installationId,
        repository: { owner: args.owner, repo: args.repo },
        commit,
      }),
    };
  } catch (error) {
    return { exitCode: 1, output: `github-probe failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function runLiveProbe(
  args: ParsedLiveProbeArgs,
  deps: LiveProbeDeps,
): Promise<LiveProbeResult> {
  switch (args.command) {
    case 'model-live':
      return runModelLive(args, deps);
    case 'modal-probe':
      return runModalProbe(deps);
    case 'github-probe':
      return runGitHubProbe(args, deps);
  }
}
