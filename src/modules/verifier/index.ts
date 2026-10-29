import { z } from 'zod';

import { ChangeProofError, MissingConfigurationError } from '../../core/index.js';

/**
 * Trusted guest runner (WP3-04, FR3-15, FR3-23).
 *
 * This module plans per-run execution, validates the security profile and
 * records cleanup/quarantine receipts. The actual Docker process is owned by
 * the trusted supervisor and is not exposed to candidate code. The default
 * profile is explicitly `container_only`: the spec says container smoke alone
 * does **not** prove a VM/microVM equivalent boundary or public readiness.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const RunnerProfileSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    runnerProfile: z.string().min(1),
    imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/, 'runner image must be pinned by sha256 digest'),
    user: z.string().min(1),
    dockerSocketMounted: z.boolean(),
    secretsProvided: z.boolean(),
    networkMode: z.enum(['private', 'none', 'host', 'bridge']),
    limits: z
      .strictObject({
        cpu: z.number().positive(),
        memoryMb: z.number().int().positive(),
        pids: z.number().int().positive(),
        diskMb: z.number().int().positive(),
      })
      .describe('Finite execution caps'),
    boundaryClass: z
      .enum(['container_only', 'vm', 'microvm', 'equivalent_unqualified'])
      .default('container_only'),
  })
  .superRefine((profile, ctx) => {
    if (profile.user === 'root' || profile.user === '0') {
      ctx.addIssue({ code: 'custom', path: ['user'], message: 'Guest must not run as root.' });
    }
    if (profile.dockerSocketMounted) {
      ctx.addIssue({
        code: 'custom',
        path: ['dockerSocketMounted'],
        message: 'Guest must not receive the host Docker socket (NEG3-24).',
      });
    }
    if (profile.secretsProvided) {
      ctx.addIssue({
        code: 'custom',
        path: ['secretsProvided'],
        message: 'Secrets must not be forwarded to the guest (AGENTS.md §3 rule 12).',
      });
    }
    if (profile.networkMode === 'host' || profile.networkMode === 'bridge') {
      ctx.addIssue({
        code: 'custom',
        path: ['networkMode'],
        message: 'Host/default bridge networking is forbidden. Use a private per-run network or none.',
      });
    }
  })
  .describe('A pinned guest runner profile');
export type RunnerProfile = z.infer<typeof RunnerProfileSchema>;

export interface BuildRunnerProfileInput {
  readonly runnerProfile: string;
  readonly imageDigest: string;
  readonly cpuLimit: number;
  readonly memoryLimitMb: number;
  readonly pidsLimit: number;
  readonly diskLimitMb: number;
  readonly networkMode: 'private' | 'none' | 'host' | 'bridge';
  readonly boundaryClass?: RunnerProfile['boundaryClass'];
}

/** Build a constrained runner profile, validating every security invariant. */
export function buildRunnerProfile(input: BuildRunnerProfileInput): RunnerProfile {
  return RunnerProfileSchema.parse({
    schemaVersion: '1',
    runnerProfile: input.runnerProfile,
    imageDigest: input.imageDigest,
    user: 'changeproof-guest',
    dockerSocketMounted: false,
    secretsProvided: false,
    networkMode: input.networkMode,
    limits: {
      cpu: input.cpuLimit,
      memoryMb: input.memoryLimitMb,
      pids: input.pidsLimit,
      diskMb: input.diskLimitMb,
    },
    boundaryClass: input.boundaryClass ?? 'container_only',
  });
}

export const GuestRunPlanSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    runId: z.string().min(1),
    runnerProfile: RunnerProfileSchema,
    mounts: z.array(
      z.strictObject({
        source: z.string().min(1),
        target: z.string().min(1),
        readOnly: z.boolean(),
        purpose: z.enum(['candidate', 'oracle', 'toolchain', 'data']),
      }),
    ),
    checks: z.array(z.string().min(1)).min(1),
    timeoutMs: z.number().int().positive(),
    cleanupRequired: z.literal(true),
    cleanup: z.strictObject({
      targets: z.array(z.enum(['container', 'volume', 'network', 'credential'])).min(1),
      persistReceiptsBeforeCleanup: z.literal(true),
    }),
  })
  .describe('A trusted supervisor plan for one disposable guest execution');
export type GuestRunPlan = z.infer<typeof GuestRunPlanSchema>;

export interface PlanGuestRunInput {
  readonly runId?: string;
  readonly profile: RunnerProfile;
  readonly candidateRoot: string;
  readonly oracleRoot: string;
  readonly checks: readonly string[];
  readonly timeoutMs: number;
}

/**
 * Build a per-run guest plan.
 *
 * Oracle must be mounted read-only and outside the candidate workspace. This
 * is checked from the actual paths rather than trusted from the caller.
 */
export function planGuestRun(input: PlanGuestRunInput): GuestRunPlan {
  const candidate = normaliseAbsolutePath(input.candidateRoot);
  const oracle = normaliseAbsolutePath(input.oracleRoot);
  if (oracle === candidate || oracle.startsWith(`${candidate}/`)) {
    throw new ChangeProofError(
      `Oracle path "${oracle}" is inside candidate workspace "${candidate}". ` +
        'The protected oracle must be outside candidate access and mounted read-only (AGENTS.md §3 rule 2).',
    );
  }

  return GuestRunPlanSchema.parse({
    schemaVersion: '1',
    runId: input.runId ?? `run-${Date.now()}`,
    runnerProfile: input.profile,
    mounts: [
      { source: candidate, target: '/workspace/candidate', readOnly: false, purpose: 'candidate' },
      { source: oracle, target: '/protected/oracle', readOnly: true, purpose: 'oracle' },
    ],
    checks: [...input.checks],
    timeoutMs: input.timeoutMs,
    cleanupRequired: true,
    cleanup: {
      targets: ['container', 'volume', 'network', 'credential'],
      persistReceiptsBeforeCleanup: true,
    },
  });
}

function normaliseAbsolutePath(path: string): string {
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) {
    throw new ChangeProofError(`Runner mount path must be absolute: "${path}".`);
  }
  return path.replace(/\\/g, '/').replace(/\/$/, '');
}

export const CleanupTargetSchema = z.strictObject({
  kind: z.enum(['container', 'volume', 'network', 'credential']),
  id: z.string().min(1),
  removed: z.boolean(),
});

export const CleanupReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    runId: z.string().min(1),
    completedAt: z.string().min(1),
    targets: z.array(CleanupTargetSchema).min(1),
    environmentReusable: z.boolean(),
  })
  .superRefine((receipt, ctx) => {
    const survivors = receipt.targets.filter((target) => !target.removed);
    if (receipt.environmentReusable && survivors.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['environmentReusable'],
        message:
          `Cannot reuse an environment while cleanup targets survived: ${survivors.map((target) => `${target.kind}:${target.id}`).join(', ')}.`,
      });
    }
  })
  .describe('Durable cleanup receipt; required even on timeout/cancel');
export type CleanupReceipt = z.infer<typeof CleanupReceiptSchema>;

export class QuarantineError extends ChangeProofError {
  readonly runId: string;
  readonly reasonCode = 'experiment_invalid' as const;

  constructor(runId: string, detail: string) {
    super(
      `Run "${runId}" cleanup did not complete. The environment is quarantined and cannot be reused. ${detail}`,
    );
    this.runId = runId;
  }
}

/**
 * In-process quarantine ledger for the supervisor.
 *
 * This state is not hosted authority; the hosted supervisor persists the same
 * transition durably in its job store. It is the local state machine boundary
 * and is tested without pretending that persistence exists.
 */
export class GuestRunner {
  private readonly quarantined = new Map<string, string>();

  recordCleanup(input: CleanupReceipt): CleanupReceipt {
    const receipt = CleanupReceiptSchema.parse(input);
    const survivors = receipt.targets.filter((target) => !target.removed);

    if (survivors.length > 0 || !receipt.environmentReusable) {
      const detail = survivors.length > 0
        ? `Targets not removed: ${survivors.map((target) => `${target.kind}:${target.id}`).join(', ')}.`
        : 'The supervisor marked the environment non-reusable.';
      this.quarantined.set(receipt.runId, detail);
      throw new QuarantineError(receipt.runId, detail);
    }

    return receipt;
  }

  isQuarantined(runId: string): boolean {
    return this.quarantined.has(runId);
  }

  assertReusable(runId: string): void {
    const reason = this.quarantined.get(runId);
    if (reason !== undefined) {
      throw new QuarantineError(runId, reason);
    }
  }
}

/** Explicitly throw when a required runner setting is missing. */
export function requireRunnerImage(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new MissingConfigurationError('RUNNER_IMAGE_DIGEST', 'runner profile config');
  }
  if (!SHA256_HEX.test(value.replace(/^sha256:/, ''))) {
    throw new ChangeProofError('RUNNER_IMAGE_DIGEST must be a sha256-pinned image digest.');
  }
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}
