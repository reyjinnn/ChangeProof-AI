import { spawn, type ChildProcess } from 'node:child_process';

import {
  ChangeProofError,
  ExperimentPlanSchema,
  TrialReceiptSchema,
  type ExperimentPlan,
  type TrialReceipt,
} from '../../core/index.js';

import { validateFaultTarget } from './campaign.js';

/**
 * Bounded trial executor (WP3-16, FR3-26).
 *
 * Runs one pre-registered trial at a time: declared reset first, then the
 * trial argv, with an optional supervisor fault from the frozen plan allowlist.
 * Every trial yields exactly one validated `TrialReceipt`; warmups run but are
 * never counted as measured trials.
 *
 * Trust boundary (threat model in one paragraph): the executor IS the trusted
 * supervisor. It spawns argv only — never a shell — with finite timeouts, kills
 * strays, and applies faults solely to allowlisted targets validated by
 * `validateFaultTarget`. Trial/reset programs are trusted fixture code in this
 * slice. Untrusted customer code must run in a qualified guest (AGENTS.md §3
 * rule 11); this executor does not claim that boundary. The model proposes a
 * typed fault intent; only a target present in the frozen plan is injectable.
 *
 * Out of this slice: barrier/interleaving concurrency control (FR3-26.3),
 * network-edge faults (need disposable topology control), and budget
 * enforcement (FR3-14 profiles arrive with the full WP).
 */

export interface TrialArgv {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly extraEnv?: Record<string, string>;
}

export interface FaultSpec {
  /** Must equal one of the plan's intended schedule fault targets. */
  readonly target: string;
  readonly action: 'kill' | 'kill-and-restart';
  readonly atMs: number;
}

export interface ResetReceipt {
  readonly trialIndex: number;
  readonly exitCode: number | null;
  readonly durationMs: number;
}

export interface AttemptRecord {
  readonly attempt: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly killedByFault: boolean;
}

export interface TrialExecution {
  readonly receipt: TrialReceipt;
  readonly resetReceipts: readonly ResetReceipt[];
  readonly attempts: readonly AttemptRecord[];
}

export interface CampaignSpec {
  readonly trial: TrialArgv;
  readonly reset?: TrialArgv;
  readonly fault?: FaultSpec;
  /** One seed per warmup + measured trial, frozen in the plan. */
  readonly seeds: readonly number[];
  readonly candidateBundleDigest: string;
  readonly environmentIdentity: string;
  readonly telemetryRefs: readonly string[];
}

export interface CampaignExecution {
  readonly receipts: readonly TrialReceipt[];
  readonly warmupTrials: number;
  readonly resetReceipts: readonly ResetReceipt[];
  readonly executions: readonly TrialExecution[];
}

function assertArgv(argv: TrialArgv, label: string): void {
  if (argv.command.length === 0) {
    throw new ChangeProofError(`${label} needs a command; refusing to run nothing.`);
  }
  if (argv.cwd.length === 0) {
    throw new ChangeProofError(`${label} needs a working directory; refusing an ambient cwd.`);
  }
  if (!Number.isInteger(argv.timeoutMs) || argv.timeoutMs <= 0) {
    throw new ChangeProofError(`${label} needs a positive timeout; unbounded runs are refused.`);
  }
}

interface ProcessOutcome {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

interface RunningProcess {
  readonly proc: ChildProcess;
  readonly done: Promise<ProcessOutcome>;
}

/** Spawn immediately; the handle is live so supervisor timers can act on it. */
function startProcess(argv: TrialArgv): RunningProcess {
  assertArgv(argv, 'Trial process');
  const started = Date.now();
  const proc = spawn(argv.command, [...argv.args], {
    cwd: argv.cwd,
    env: { ...process.env, ...argv.extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Never shell out: argv reaches the OS exactly as given.
    shell: false,
  });
  let timedOut = false;
  const done = new Promise<ProcessOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      killStray(proc);
    }, argv.timeoutMs);
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, durationMs: Date.now() - started, timedOut });
    });
  });
  return { proc, done };
}

function killStray(proc: ChildProcess): void {
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGKILL');
  }
}

/**
 * Arm a fault as an explicit race: either the timer fires on a live process
 * (applied timestamp) or the process settles first (null — a fault that lands
 * after exit never happened and must not mark a clean pass as faulted).
 */
function armFault(
  proc: ChildProcess,
  atMs: number,
  campaignStart: number,
  done: Promise<ProcessOutcome>,
): { fired: Promise<number | null>; cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;
  let settled = false;
  const fired = new Promise<number | null>((resolve) => {
    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      if (proc.exitCode === null && proc.signalCode === null) {
        killStray(proc);
        resolve(Date.now() - campaignStart);
      } else {
        resolve(null);
      }
    }, atMs);
    const standDown = (): void => {
      if (!settled) {
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        resolve(null);
      }
    };
    void done.then(standDown, standDown);
  });
  return {
    fired,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}

function reconcileCounts(result: 'pass' | 'fail' | 'excluded'): TrialReceipt['counts'] {
  return {
    planned: 1,
    completed: result === 'pass' ? 1 : 0,
    failed: result === 'fail' ? 1 : 0,
    invalid: 0,
    censored: result === 'excluded' ? 1 : 0,
    notRun: 0,
  };
}

export async function executeTrial(
  plan: ExperimentPlan,
  trialIndex: number,
  seed: number,
  spec: CampaignSpec,
): Promise<TrialExecution> {
  const frozen = ExperimentPlanSchema.parse(plan);
  if (!Number.isInteger(trialIndex) || trialIndex < 0) {
    throw new ChangeProofError('Trial index must be a non-negative integer.');
  }
  if (!Number.isInteger(seed)) {
    throw new ChangeProofError('Trial seed must be an integer.');
  }
  const allowlist = frozen.intendedSchedules.map((schedule) => schedule.faultTarget);
  if (spec.fault !== undefined) {
    validateFaultTarget(spec.fault.target, allowlist);
    if (!Number.isInteger(spec.fault.atMs) || spec.fault.atMs < 0) {
      throw new ChangeProofError('Fault time must be a non-negative integer.');
    }
  }
  const schedule = frozen.intendedSchedules[trialIndex % frozen.intendedSchedules.length];
  if (schedule === undefined) {
    throw new ChangeProofError('Plan carries no intended schedule; refusing to run.');
  }

  const resetReceipts: ResetReceipt[] = [];
  if (spec.reset !== undefined) {
    const resetStarted = Date.now();
    const resetting = startProcess(spec.reset);
    const reset = await resetting.done;
    killStray(resetting.proc);
    resetReceipts.push({ trialIndex, exitCode: reset.exitCode, durationMs: Date.now() - resetStarted });
    if (reset.exitCode !== 0) {
      // A failed reset invalidates the trial — the trial never runs.
      const receipt = TrialReceiptSchema.parse({
        schemaVersion: '1',
        planHash: frozen.planHash,
        candidateBundleDigest: spec.candidateBundleDigest,
        environmentIdentity: spec.environmentIdentity,
        actualSeed: seed,
        actualSchedule: { id: schedule.id, appliedAtMs: 0 },
        faultApplied: false,
        faultRemoved: false,
        counts: reconcileCounts('excluded'),
        result: 'excluded',
        exclusionReason: `reset failed with exit ${String(reset.exitCode)}; the trial is invalid, not failed.`,
        telemetryRefs: [...spec.telemetryRefs],
      });
      return { receipt, resetReceipts, attempts: [] };
    }
  }

  const attempts: AttemptRecord[] = [];
  const campaignStart = Date.now();
  let appliedBefore: number | null = null;
  let faultRemovedAtMs: number | null = null;
  // At most two attempts: the initial run plus one restart after a healed fault.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const running = startProcess(spec.trial);
    let cancelFault = (): void => undefined;
    let fired: Promise<number | null> = Promise.resolve(null);
    if (spec.fault !== undefined && appliedBefore === null) {
      const armed = armFault(running.proc, spec.fault.atMs, campaignStart, running.done);
      fired = armed.fired;
      cancelFault = armed.cancel;
    }
    const finished = await running.done;
    const appliedAt = await fired;
    cancelFault();
    killStray(running.proc);
    const killedByFault = appliedAt !== null && finished.signal === 'SIGKILL';
    attempts.push({
      attempt,
      exitCode: finished.exitCode,
      signal: finished.signal,
      durationMs: finished.durationMs,
      timedOut: finished.timedOut,
      killedByFault,
    });
    if (killedByFault && spec.fault?.action === 'kill-and-restart' && faultRemovedAtMs === null) {
      faultRemovedAtMs = Date.now() - campaignStart;
      appliedBefore = appliedAt;
      continue;
    }
    const faultApplied = appliedAt !== null || appliedBefore !== null;
    const faultRemoved = faultRemovedAtMs !== null;
    const appliedAtMs = appliedAt ?? appliedBefore ?? 0;
    if (killedByFault) {
      const receipt = TrialReceiptSchema.parse({
        schemaVersion: '1',
        planHash: frozen.planHash,
        candidateBundleDigest: spec.candidateBundleDigest,
        environmentIdentity: spec.environmentIdentity,
        actualSeed: seed,
        actualSchedule: { id: schedule.id, appliedAtMs },
        faultApplied,
        faultRemoved: false,
        counts: reconcileCounts('excluded'),
        result: 'excluded',
        exclusionReason:
          `injector killed the trial at ${String(appliedAtMs)}ms and did not restart it (NEG3-17).`,
        telemetryRefs: [...spec.telemetryRefs],
      });
      return { receipt, resetReceipts, attempts };
    }
    const passed = finished.exitCode === 0 && !finished.timedOut;
    const receipt = TrialReceiptSchema.parse({
      schemaVersion: '1',
      planHash: frozen.planHash,
      candidateBundleDigest: spec.candidateBundleDigest,
      environmentIdentity: spec.environmentIdentity,
      actualSeed: seed,
      actualSchedule: {
        id: schedule.id,
        appliedAtMs: appliedAtMs,
        ...(faultRemovedAtMs === null ? {} : { removedAtMs: faultRemovedAtMs }),
      },
      faultApplied,
      faultRemoved,
      counts: reconcileCounts(passed ? 'pass' : 'fail'),
      result: passed ? 'pass' : 'fail',
      telemetryRefs: [...spec.telemetryRefs],
    });
    return { receipt, resetReceipts, attempts };
  }
  throw new ChangeProofError('Trial attempts exhausted without a receipt; refusing to account around the gap.');
}

export async function runCampaign(plan: ExperimentPlan, spec: CampaignSpec): Promise<CampaignExecution> {
  const frozen = ExperimentPlanSchema.parse(plan);
  const expectedSeeds = frozen.warmupTrials + frozen.n;
  if (spec.seeds.length !== expectedSeeds) {
    throw new ChangeProofError(
      `Campaign needs exactly ${expectedSeeds} frozen seeds (warmup ${frozen.warmupTrials} + n ${frozen.n}); ` +
        `received ${spec.seeds.length}. Seeds are frozen before the run, never topped up after.`,
    );
  }
  const executions: TrialExecution[] = [];
  const receipts: TrialReceipt[] = [];
  const resetReceipts: ResetReceipt[] = [];
  for (const [index, seed] of spec.seeds.entries()) {
    const execution = await executeTrial(frozen, index, seed, spec);
    resetReceipts.push(...execution.resetReceipts);
    if (index < frozen.warmupTrials) {
      continue;
    }
    executions.push(execution);
    receipts.push(execution.receipt);
  }
  if (receipts.length !== frozen.n) {
    throw new ChangeProofError(
      `Campaign executed ${receipts.length} trials for n=${frozen.n}; refusing to account around the gap.`,
    );
  }
  return { receipts, warmupTrials: frozen.warmupTrials, resetReceipts, executions };
}
