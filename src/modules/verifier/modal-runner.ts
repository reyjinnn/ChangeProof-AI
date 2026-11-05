import { spawn } from 'node:child_process';

import { z } from 'zod';

import { ChangeProofError, MissingConfigurationError, type SecretBrokerPort } from '../../core/index.js';

/**
 * Modal Sandbox guest runner (P4, WP3-04, NFR3-04..08).
 *
 * The leaf owns one job: spawn the trusted probe helper
 * (`scripts/modal_sandbox_probe.py`, reviewed and versioned in this repo),
 * validate its exactly-one-JSON-document receipt, and refuse anything that is
 * not a pinned `modal-sandbox` run. Modal credentials are read from the
 * broker at call time and handed to the helper process only — they are never
 * forwarded into the guest (the helper itself verifies this with the
 * `no-guest-secrets` probe), never logged, and never embedded in errors.
 *
 * Probe failures resolve as evidence (the receipt carries the verdict);
 * missing credentials, a crashed helper, or an unpinned receipt throw.
 * Quarantine on unconfirmed cleanup is the orchestrator's decision, made
 * from the returned summary through `GuestRunner.recordCleanup`.
 */

/** Receipt contract owned by the trusted helper; keep in sync with it. */
export const MODAL_PROBE_RECEIPT_VERSION = 't08-probe/1';
export const MODAL_PROBE_IMAGE_DIGEST =
  'sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3';
export const MODAL_PROBE_IMAGE_REF = `docker.io/library/debian:12-slim@${MODAL_PROBE_IMAGE_DIGEST}`;
export const MODAL_PROBE_APP = 'changeproof-t08-probes';

export const ModalProbeOutcomeSchema = z.enum(['pass', 'fail', 'inconclusive']);
export type ModalProbeOutcome = z.infer<typeof ModalProbeOutcomeSchema>;

const ModalProbeEntrySchema = z
  .object({ id: z.string().min(1), outcome: ModalProbeOutcomeSchema })
  .loose()
  .describe('One probe outcome; detail fields vary per probe and are not authority');

export const ModalProbeReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(MODAL_PROBE_RECEIPT_VERSION),
    mode: z.string().min(1),
    runId: z.string().min(1),
    boundaryClass: z.literal('microvm'),
    provider: z.literal('modal-sandbox'),
    app: z.string().min(1),
    imageRef: z.string().min(1),
    imageDigestPinned: z.literal(true),
    sandboxId: z.string().min(1),
    limits: z.strictObject({
      cpu: z.number().positive(),
      memoryMb: z.number().int().positive(),
      timeoutS: z.number().int().positive(),
    }),
    network: z.string().min(1),
    probes: z.array(ModalProbeEntrySchema).min(1),
    cleanup: z.strictObject({
      sandboxId: z.string().min(1),
      terminated: z.boolean(),
      confirmed: z.boolean(),
    }),
    verdict: z.enum(['pass', 'fail', 'inconclusive']),
    notes: z.array(z.string()),
  })
  .describe('Validated Modal Sandbox isolation probe receipt');
export type ModalProbeReceipt = z.infer<typeof ModalProbeReceiptSchema>;

export interface ModalRunnerConfig {
  /** Trusted interpreter binary, chosen by the composition root. */
  readonly pythonBin: string;
  /** Trusted helper script path, chosen by the composition root. */
  readonly scriptPath: string;
  /** Expected Modal app label; a different app is refused. */
  readonly expectedApp: string;
  /** Supervisor-side spawn timeout; the helper enforces the guest timeout. */
  readonly timeoutMs: number;
}

export interface ModalSpawnInput {
  readonly pythonBin: string;
  readonly scriptPath: string;
  readonly timeoutMs: number;
  readonly tokenId: string;
  readonly tokenSecret: string;
}

export interface ModalSpawnResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderrTail: string;
  readonly timedOut: boolean;
}

export type ModalSpawner = (input: ModalSpawnInput) => Promise<ModalSpawnResult>;

const STDOUT_CAP_BYTES = 256 * 1024;
const STDERR_TAIL_BYTES = 2048;

/** Production spawner: argv only, no shell, bounded capture, finite timeout. */
export function nodeModalSpawner(input: ModalSpawnInput): Promise<ModalSpawnResult> {
  return new Promise<ModalSpawnResult>((resolve, reject) => {
    let proc;
    try {
      proc = spawn(input.pythonBin, [input.scriptPath], {
        env: { ...process.env, MODAL_TOKEN_ID: input.tokenId, MODAL_TOKEN_SECRET: input.tokenSecret },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new ChangeProofError(
          `Modal probe helper could not start: ${error instanceof Error ? error.message : 'unknown spawn error'}.`,
        ),
      );
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill('SIGKILL');
      }
    }, input.timeoutMs);
    proc.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < STDOUT_CAP_BYTES) {
        stdout += chunk.toString('utf8').slice(0, STDOUT_CAP_BYTES - stdout.length);
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-STDERR_TAIL_BYTES);
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(new ChangeProofError(`Modal probe helper could not start: ${error.message}.`));
    });
    proc.on('exit', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderrTail: stderr, timedOut });
    });
  });
}

export interface RunModalProbeInput {
  readonly config: ModalRunnerConfig;
  readonly secrets: SecretBrokerPort;
  readonly tokenIdRef: string;
  readonly tokenSecretRef: string;
  readonly spawner?: ModalSpawner;
}

export interface ModalProbeSummary {
  readonly runId: string;
  readonly sandboxId: string;
  readonly boundaryClass: 'microvm';
  readonly network: string;
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
  readonly imageRef: string;
  readonly imageDigestPinned: true;
  readonly probes: readonly { id: string; outcome: ModalProbeOutcome }[];
  readonly cleanup: { terminated: boolean; confirmed: boolean };
}

export interface ModalProbeRun {
  readonly receipt: ModalProbeReceipt;
  readonly summary: ModalProbeSummary;
}

async function readModalCredential(
  secrets: SecretBrokerPort,
  ref: string,
  envName: 'MODAL_TOKEN_ID' | 'MODAL_TOKEN_SECRET',
): Promise<string> {
  let value: string;
  try {
    value = await secrets.readCredential(ref);
  } catch {
    throw new MissingConfigurationError(
      envName,
      `secret broker ref "${ref}"`,
      'Provision the Modal workspace token out-of-band; the runner never invents one.',
    );
  }
  if (value.length === 0) {
    throw new MissingConfigurationError(
      envName,
      `secret broker ref "${ref}"`,
      'Provision the Modal workspace token out-of-band; the runner never invents one.',
    );
  }
  return value;
}

export async function runModalProbe(input: RunModalProbeInput): Promise<ModalProbeRun> {
  if (input.config.pythonBin.length === 0 || input.config.scriptPath.length === 0) {
    throw new ChangeProofError('Modal runner needs an explicit interpreter and helper path; refusing.');
  }
  if (!Number.isInteger(input.config.timeoutMs) || input.config.timeoutMs <= 0) {
    throw new ChangeProofError('Modal runner needs a positive spawn timeout; unbounded runs are refused.');
  }
  // Credentials first: no spawn happens without both broker values.
  const tokenId = await readModalCredential(input.secrets, input.tokenIdRef, 'MODAL_TOKEN_ID');
  const tokenSecret = await readModalCredential(input.secrets, input.tokenSecretRef, 'MODAL_TOKEN_SECRET');
  const spawner = input.spawner ?? nodeModalSpawner;
  const spawned = await spawner({
    pythonBin: input.config.pythonBin,
    scriptPath: input.config.scriptPath,
    timeoutMs: input.config.timeoutMs,
    tokenId,
    tokenSecret,
  });
  if (spawned.timedOut) {
    throw new ChangeProofError(
      `Modal probe helper timed out after ${String(input.config.timeoutMs)}ms; the sandbox state is unknown, not clean.`,
    );
  }
  if (spawned.exitCode !== 0) {
    throw new ChangeProofError(
      `Modal probe helper exited ${String(spawned.exitCode)}: ${spawned.stderrTail !== '' ? spawned.stderrTail : 'no diagnostics; the receipt is missing'}.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(spawned.stdout.trim()) as unknown;
  } catch {
    throw new ChangeProofError('Modal probe helper printed no parseable receipt; refusing to guess.');
  }
  const receipt = ModalProbeReceiptSchema.safeParse(parsed);
  if (!receipt.success) {
    const paths = receipt.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
    throw new ChangeProofError(`Modal probe receipt violates its schema at: ${paths}; refusing to accept it.`);
  }
  const data = receipt.data;
  if (data.mode !== 'modal-sandbox') {
    throw new ChangeProofError(
      `Modal probe mode "${data.mode}" is wiring output, not isolation evidence; refusing to accept it.`,
    );
  }
  if (data.app !== input.config.expectedApp) {
    throw new ChangeProofError(
      `Modal probe ran under app "${data.app}", expected "${input.config.expectedApp}"; refusing.`,
    );
  }
  if (data.imageRef !== MODAL_PROBE_IMAGE_REF) {
    throw new ChangeProofError(
      'Modal probe image is not the pinned digest; an unpinned guest is refused as evidence.',
    );
  }
  return {
    receipt: data,
    summary: {
      runId: data.runId,
      sandboxId: data.sandboxId,
      boundaryClass: data.boundaryClass,
      network: data.network,
      verdict: data.verdict,
      imageRef: data.imageRef,
      imageDigestPinned: data.imageDigestPinned,
      probes: data.probes.map((probe) => ({ id: probe.id, outcome: probe.outcome })),
      cleanup: { terminated: data.cleanup.terminated, confirmed: data.cleanup.confirmed },
    },
  };
}
