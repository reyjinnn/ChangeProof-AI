import { createHash } from 'node:crypto';

import {
  ChangeProofError,
  ConsistencyReportSchema,
  InstantSchema,
  NonEmptyStringSchema,
  RegionCampaignSchema,
  RegionFaultSchema,
  RegionTopologySchema,
  RegionTrialReceiptSchema,
  type ConsistencyReport,
  type RegionCampaign,
  type RegionFault,
  type RegionTrialReceipt,
} from '../../core/index.js';

import { stableStringify, type JsonValue } from './reducers.js';

/**
 * Multi-region supervisor (WP3-19, FR3-26/27).
 *
 * The supervisor executes frozen region campaigns through two injected
 * seams — a fault driver (partition/heal/roles) and a workload (journal
 * writes/reads) — and reduces per-trial receipts to per-check verdicts plus
 * an enforced qualification label. A fault that never applies or never
 * heals invalidates the experiment instead of blaming the application
 * (NEG3-17); failed writes are data, not crashes; and a single-host probe
 * reports `probe-only` even when green (NEG3-40). Only complete, all-green
 * evidence from provisioned regions reports `qualified`.
 *
 * There is no simulated topology driver in product code: tests inject
 * fakes, the native probe drives real containers, and full SC3-10
 * qualification waits for provisioned regions in phase-7.
 */

export interface RegionFaultDriver {
  applyFault(input: {
    fault: RegionFault;
    trialIndex: number;
    nowIso: string;
  }): Promise<{ appliedAt: string; applied: boolean }>;
  healFault(input: {
    fault: RegionFault;
    trialIndex: number;
    nowIso: string;
  }): Promise<{ healedAt: string; healed: boolean; verified: boolean }>;
  roles(): Promise<Record<string, 'primary' | 'replica' | 'witness'>>;
}

export interface RegionWorkload {
  write(region: string): Promise<{ seq: number; acked: boolean }>;
  read(region: string, seq: number): Promise<{ present: boolean }>;
  journal(region: string): Promise<readonly { seq: number; acked: boolean }[]>;
}

function planDigestOf(body: object): string {
  const json = JSON.parse(JSON.stringify(body)) as JsonValue;
  return createHash('sha256').update(stableStringify(json), 'utf8').digest('hex');
}

function resolveTarget(target: string, regions: ReadonlySet<string>): void {
  if (regions.has(target)) {
    return;
  }
  const ends = target.split('-');
  if (
    ends.length === 2 &&
    ends[0] !== undefined &&
    ends[1] !== undefined &&
    regions.has(ends[0]) &&
    regions.has(ends[1])
  ) {
    return;
  }
  throw new ChangeProofError(`Region campaign target "${target}" is unknown to the topology; refusing.`);
}

export function freezeRegionPlan(input: {
  planId: string;
  planHash: string;
  topology: unknown;
  faults: readonly unknown[];
  trials: number;
  workload: unknown;
  orderingBound: unknown;
  rpoBound: unknown;
  rtoBound: unknown;
  frozenAt: string;
}): RegionCampaign {
  const topology = RegionTopologySchema.parse(input.topology);
  const faults = input.faults.map((fault) => RegionFaultSchema.parse(fault));
  const regionIds = new Set(topology.regions.map((region) => region.regionId));
  if (regionIds.size !== topology.regions.length) {
    throw new ChangeProofError('Region topology lists a region twice; refusing an ambiguous freeze.');
  }
  for (const fault of faults) {
    for (const target of fault.targets) {
      resolveTarget(target, regionIds);
    }
  }
  const body = {
    schemaVersion: '1',
    planId: NonEmptyStringSchema.parse(input.planId),
    planHash: input.planHash,
    topology,
    faults,
    trials: input.trials,
    workload: input.workload,
    orderingBound: input.orderingBound,
    rpoBound: input.rpoBound,
    rtoBound: input.rtoBound,
    frozenAt: InstantSchema.parse(input.frozenAt),
  };
  const digest = planDigestOf(body);
  return RegionCampaignSchema.parse({ ...body, digest });
}

export function verifyRegionPlan(plan: unknown): RegionCampaign {
  const parsed = RegionCampaignSchema.parse(plan);
  const { digest, ...body } = parsed;
  if (planDigestOf(body) !== digest) {
    throw new ChangeProofError('Region plan digest does not match its content; drift is refused.');
  }
  return parsed;
}

function msOf(iso: string): number {
  const ms = Date.parse(InstantSchema.parse(iso));
  if (!Number.isFinite(ms)) {
    throw new ChangeProofError('Unreadable timestamp in region trial; refusing.');
  }
  return ms;
}

interface TrialContext {
  plan: RegionCampaign;
  trialIndex: number;
  fault: RegionFault;
  driver: RegionFaultDriver;
  workload: RegionWorkload;
  resync?: { by: string; run: () => Promise<void> };
  nowIso: () => string;
  sleep: (ms: number) => Promise<void>;
}

async function runTrial(context: TrialContext): Promise<RegionTrialReceipt> {
  const { plan, trialIndex, fault, driver, workload } = context;
  const startedAt = InstantSchema.parse(context.nowIso());
  const rolesBefore = await driver.roles();
  await context.sleep(fault.startAfterMs);
  const faultStartMs = msOf(context.nowIso());
  const applied = await driver.applyFault({ fault, trialIndex, nowIso: context.nowIso() });

  const attempts: { seq: number | null; acked: boolean }[] = [];
  for (let i = 0; i < plan.workload.writesPerTrial; i += 1) {
    try {
      const written = await workload.write(plan.workload.writeRegion);
      attempts.push({ seq: written.seq, acked: written.acked });
    } catch {
      attempts.push({ seq: null, acked: false });
    }
  }
  const ackedSeqs = attempts.flatMap((attempt) => (attempt.acked && attempt.seq !== null ? [attempt.seq] : []));

  await context.sleep(fault.durationMs);
  const healed = await driver.healFault({ fault, trialIndex, nowIso: context.nowIso() });
  const rolesAfter = await driver.roles();
  if (context.resync !== undefined) {
    await context.resync.run();
  }

  // RTO: time from fault start until a probe write acks again, bounded by the plan.
  let restoredMs: number | null = null;
  const healStartMs = msOf(context.nowIso());
  while (msOf(context.nowIso()) - healStartMs < fault.heal.verifyWithinMs) {
    try {
      const probe = await workload.write(plan.workload.writeRegion);
      if (probe.acked) {
        restoredMs = msOf(context.nowIso());
        break;
      }
    } catch {
      // A failed probe is data: keep waiting inside the bound.
    }
    await context.sleep(50);
  }
  const measuredRtoMs = restoredMs === null ? null : Math.max(0, restoredMs - faultStartMs);

  let presentAfter = 0;
  for (const seq of ackedSeqs) {
    let everywhere = true;
    for (const region of plan.workload.readRegions) {
      const seen = await workload.read(region, seq);
      if (!seen.present) {
        everywhere = false;
      }
    }
    if (everywhere) {
      presentAfter += 1;
    }
  }

  let maxSeqGap = 0;
  let duplicates = 0;
  for (const region of plan.workload.readRegions) {
    const entries = [...(await workload.journal(region))].sort((left, right) => left.seq - right.seq);
    const seen = new Set<number>();
    let previous: number | null = null;
    for (const entry of entries) {
      if (seen.has(entry.seq)) {
        duplicates += 1;
      }
      seen.add(entry.seq);
      if (previous !== null && entry.seq > previous + 1) {
        maxSeqGap = Math.max(maxSeqGap, entry.seq - previous - 1);
      }
      previous = entry.seq;
    }
  }

  const finishedAt = InstantSchema.parse(context.nowIso());
  return RegionTrialReceiptSchema.parse({
    schemaVersion: '1',
    planDigest: plan.digest,
    trialIndex,
    faultId: fault.faultId,
    faultApplied: applied.applied,
    faultHealed: healed.healed,
    healVerified: healed.verified,
    rolesBefore,
    rolesAfter,
    journal: {
      writesAttempted: attempts.length,
      writesAcked: ackedSeqs.length,
      writesPresentAfter: presentAfter,
      maxSeqGap,
      duplicates,
    },
    measuredRpoLostWrites: ackedSeqs.length - presentAfter,
    measuredRtoMs,
    ...(context.resync === undefined ? {} : { resyncBy: context.resync.by }),
    startedAt,
    finishedAt,
  });
}

export function reduceConsistency(input: {
  plan: RegionCampaign;
  receipts: readonly RegionTrialReceipt[];
}): ConsistencyReport {
  const reasons: string[] = [];
  const checks: ConsistencyReport['checks'] = [];
  const records = input.receipts.map((receipt) => RegionTrialReceiptSchema.parse(receipt));
  const expected = new Set<string>();
  for (let trial = 0; trial < input.plan.trials; trial += 1) {
    for (const fault of input.plan.faults) {
      expected.add(`${String(trial)}:${fault.faultId}`);
    }
  }
  const seen = new Set<string>();
  let experimentInvalid = false;
  for (const receipt of records) {
    const key = `${String(receipt.trialIndex)}:${receipt.faultId}`;
    if (receipt.planDigest !== input.plan.digest) {
      reasons.push(`receipt for trial ${String(receipt.trialIndex)} names a different plan digest`);
      experimentInvalid = true;
      continue;
    }
    if (!expected.has(key)) {
      reasons.push(`receipt for trial ${String(receipt.trialIndex)} fault "${receipt.faultId}" is foreign to this plan`);
      experimentInvalid = true;
      continue;
    }
    if (seen.has(key)) {
      reasons.push(`duplicate receipt for trial ${String(receipt.trialIndex)} fault "${receipt.faultId}"`);
      experimentInvalid = true;
      continue;
    }
    seen.add(key);
    const check = (id: string, pass: boolean, detail: string): void => {
      checks.push({ id, trialIndex: receipt.trialIndex, faultId: receipt.faultId, pass, detail });
    };
    if (!receipt.faultApplied) {
      reasons.push(`fault "${receipt.faultId}" never applied (trial ${String(receipt.trialIndex)}): experiment invalid`);
      experimentInvalid = true;
    }
    check('fault-applied', receipt.faultApplied, receipt.faultApplied ? 'fault applied' : 'fault never applied: no-op injector');
    if (!receipt.faultHealed || !receipt.healVerified) {
      reasons.push(`fault "${receipt.faultId}" never healed and verified (trial ${String(receipt.trialIndex)}): experiment invalid`);
      experimentInvalid = true;
    }
    check(
      'heal-verified',
      receipt.faultHealed && receipt.healVerified,
      receipt.faultHealed && receipt.healVerified ? 'heal verified' : 'heal missing or unverified',
    );
    const rpoPass = receipt.measuredRpoLostWrites <= input.plan.rpoBound.maxLostAckedWrites;
    check(
      'rpo-within-bound',
      rpoPass,
      `${String(receipt.measuredRpoLostWrites)} acked writes lost against a bound of ${String(input.plan.rpoBound.maxLostAckedWrites)}`,
    );
    if (!rpoPass) {
      reasons.push(`rpo-within-bound failed (trial ${String(receipt.trialIndex)} fault "${receipt.faultId}")`);
    }
    const rtoPass =
      receipt.measuredRtoMs !== null && receipt.measuredRtoMs <= input.plan.rtoBound.maxRestoreMs;
    check(
      'rto-within-bound',
      rtoPass,
      receipt.measuredRtoMs === null
        ? 'writes never restored inside the verification bound'
        : `${String(receipt.measuredRtoMs)}ms restore against a bound of ${String(input.plan.rtoBound.maxRestoreMs)}ms`,
    );
    if (!rtoPass) {
      reasons.push(`rto-within-bound failed (trial ${String(receipt.trialIndex)} fault "${receipt.faultId}")`);
    }
    const orderingPass =
      receipt.journal.maxSeqGap <= input.plan.orderingBound.maxSeqGap &&
      receipt.journal.duplicates <= input.plan.orderingBound.maxDuplicates;
    check(
      'ordering-within-bound',
      orderingPass,
      `gap ${String(receipt.journal.maxSeqGap)}, duplicates ${String(receipt.journal.duplicates)}`,
    );
    if (!orderingPass) {
      reasons.push(`ordering-within-bound failed (trial ${String(receipt.trialIndex)} fault "${receipt.faultId}")`);
    }
  }
  for (const key of expected) {
    if (!seen.has(key)) {
      reasons.push(`missing receipt for ${key}: campaign incomplete`);
      experimentInvalid = true;
    }
  }
  const anyCheckFailed = checks.some((check) => !check.pass);
  const qualification =
    experimentInvalid || anyCheckFailed
      ? 'invalid'
      : input.plan.topology.provenance.kind === 'single-host-probe'
        ? 'probe-only'
        : 'qualified';
  if (qualification === 'probe-only') {
    reasons.push('single-host provenance: mechanics evidence only, not a qualification result');
  }
  return ConsistencyReportSchema.parse({
    schemaVersion: '1',
    planDigest: input.plan.digest,
    checks,
    qualification,
    reasons,
  });
}

export async function runRegionCampaign(input: {
  plan: RegionCampaign;
  driver: RegionFaultDriver;
  workload: RegionWorkload;
  resync?: { by: string; run: () => Promise<void> };
  nowIso: () => string;
  sleep: (ms: number) => Promise<void>;
}): Promise<{ receipts: RegionTrialReceipt[]; consistency: ConsistencyReport }> {
  const plan = verifyRegionPlan(input.plan);
  const receipts: RegionTrialReceipt[] = [];
  for (let trialIndex = 0; trialIndex < plan.trials; trialIndex += 1) {
    for (const fault of plan.faults) {
      receipts.push(
        await runTrial({
          plan,
          trialIndex,
          fault,
          driver: input.driver,
          workload: input.workload,
          ...(input.resync === undefined ? {} : { resync: input.resync }),
          nowIso: input.nowIso,
          sleep: input.sleep,
        }),
      );
    }
  }
  return { receipts, consistency: reduceConsistency({ plan, receipts }) };
}
