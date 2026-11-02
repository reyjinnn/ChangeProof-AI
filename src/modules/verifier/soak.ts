import { createHash } from 'node:crypto';

import {
  ChangeProofError,
  InstantSchema,
  NonEmptyStringSchema,
  SoakCycleAccountingSchema,
  SoakPlanSchema,
  SoakProvenanceSchema,
  SoakReceiptSchema,
  SoakReportSchema,
  SoakRestartSchema,
  SoakSampleSchema,
  type SoakPlan,
  type SoakReceipt,
  type SoakReport,
  type SoakSample,
  type SoakSeries,
} from '../../core/index.js';

import { stableStringify, type JsonValue } from './reducers.js';

/**
 * Long-horizon soak profiler (WP3-19, SC3-11, FR3-27).
 *
 * The profiler executes frozen soak plans through three injected seams — a
 * workload (per-cycle accounting), a sampler (resource observations), and an
 * optional restarter (policy-driven restarts) — and reduces the receipt to
 * per-check verdicts plus an enforced qualification label. Series are fitted
 * per segment between restarts with slope ± 2·SE; workload accounting must
 * close inside its frozen tolerance (NEG3-18); an uncalibrated profiler is
 * inconclusive; a restart the policy cannot explain invalidates the run; and
 * a short smoke run reports `smoke-only` even when green (NEG3-40).
 *
 * There is no simulated workload or sampler in product code: tests inject
 * fakes, the native smoke drives a real worker process, and full SC3-11
 * qualification waits for provisioned soak environments in phase-7.
 */

export interface SoakWorkload {
  runCycle(cycleIndex: number): Promise<{
    attempted: number;
    completed: number;
    dropped: number;
    timeouts: number;
  }>;
}

export interface SoakSampler {
  sample(cycleIndex: number): Promise<{
    heapUsedBytes: number;
    rssBytes: number;
    nativeBytes?: number;
    fds?: number;
    threads?: number;
    poolActive?: number;
    poolWaiting?: number;
    queueDepth?: number;
  }>;
}

export interface SoakRestarter {
  restart(input: {
    cycleIndex: number;
    metric: SoakSeries;
    observed: number;
    threshold: number;
  }): Promise<{ restartedAt: string; restarted: boolean }>;
}

function planDigestOf(body: object): string {
  const json = JSON.parse(JSON.stringify(body)) as JsonValue;
  return createHash('sha256').update(stableStringify(json), 'utf8').digest('hex');
}

export function freezeSoakPlan(input: {
  planId: string;
  profileId: string;
  provenance: unknown;
  knownOnset: unknown;
  horizon: unknown;
  workload: unknown;
  runtime: unknown;
  requiredSeries: readonly string[];
  slopeBounds: Record<string, number>;
  minSamplesPerSegment: number;
  workloadTolerance: unknown;
  restartPolicy: unknown;
  frozenAt: string;
}): SoakPlan {
  const body = {
    schemaVersion: '1',
    planId: NonEmptyStringSchema.parse(input.planId),
    profileId: NonEmptyStringSchema.parse(input.profileId),
    provenance: SoakProvenanceSchema.parse(input.provenance),
    knownOnset: input.knownOnset,
    horizon: input.horizon,
    workload: input.workload,
    runtime: input.runtime,
    requiredSeries: [...input.requiredSeries],
    slopeBounds: { ...input.slopeBounds },
    minSamplesPerSegment: input.minSamplesPerSegment,
    workloadTolerance: input.workloadTolerance,
    restartPolicy: input.restartPolicy,
    frozenAt: InstantSchema.parse(input.frozenAt),
  };
  // Shape, onset, mandatory series, and bound coverage are all enforced here.
  const staged = SoakPlanSchema.parse({ ...body, digest: '0'.repeat(64) });
  const content: Record<string, unknown> = { ...staged };
  delete content['digest'];
  const digest = planDigestOf(content);
  return SoakPlanSchema.parse({ ...content, digest });
}

export function verifySoakPlan(plan: unknown): SoakPlan {
  const parsed = SoakPlanSchema.parse(plan);
  const { digest, ...body } = parsed;
  if (planDigestOf(body) !== digest) {
    throw new ChangeProofError('Soak plan digest does not match its content; drift is refused.');
  }
  return parsed;
}

function msOf(iso: string): number {
  const ms = Date.parse(InstantSchema.parse(iso));
  if (!Number.isFinite(ms)) {
    throw new ChangeProofError('Unreadable timestamp in soak run; refusing.');
  }
  return ms;
}

/** Least-squares slope per cycle with its standard error; fail closed on degenerate x. */
function fitSlope(xs: readonly number[], ys: readonly number[]): { slope: number; se: number } {
  const n = xs.length;
  const xBar = xs.reduce((sum, x) => sum + x, 0) / n;
  const yBar = ys.reduce((sum, y) => sum + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] ?? 0) - xBar;
    sxx += dx * dx;
    sxy += dx * ((ys[i] ?? 0) - yBar);
  }
  if (sxx === 0) {
    return { slope: 0, se: Number.POSITIVE_INFINITY };
  }
  const slope = sxy / sxx;
  let residualSum = 0;
  for (let i = 0; i < n; i += 1) {
    const residual = (ys[i] ?? 0) - yBar - slope * ((xs[i] ?? 0) - xBar);
    residualSum += residual * residual;
  }
  const se = Math.sqrt(residualSum / (n - 2) / sxx);
  return { slope, se };
}

function seriesValue(sample: SoakSample, series: SoakSeries): number | undefined {
  return sample[series];
}

export function reduceSoak(input: { plan: SoakPlan; receipt: SoakReceipt }): SoakReport {
  const plan = SoakPlanSchema.parse(input.plan);
  const receipt = SoakReceiptSchema.parse(input.receipt);
  const reasons: string[] = [];
  const checks: SoakReport['checks'] = [];
  const check = (id: string, pass: boolean, detail: string): void => {
    checks.push({ id, pass, detail });
  };

  if (receipt.planDigest !== plan.digest) {
    reasons.push('receipt names a different plan digest');
    return SoakReportSchema.parse({
      schemaVersion: '1',
      planDigest: plan.digest,
      checks,
      qualification: 'invalid',
      reasons,
    });
  }

  const horizonPass =
    receipt.cyclesCompleted === plan.horizon.cycles && receipt.durationMs >= plan.horizon.minDurationMs;
  check(
    'horizon-reached',
    horizonPass,
    `${String(receipt.cyclesCompleted)}/${String(plan.horizon.cycles)} cycles, ` +
      `${String(receipt.durationMs)}ms against a ${String(plan.horizon.minDurationMs)}ms floor` +
      (receipt.abortReason === null ? '' : `, aborted: ${receipt.abortReason}`),
  );
  if (!horizonPass) {
    reasons.push('horizon-reached failed: the run never covered its frozen horizon');
  }

  let accountingClosed = receipt.accounting.length === receipt.cyclesCompleted;
  let droppedTotal = 0;
  let timeoutTotal = 0;
  for (const row of receipt.accounting) {
    droppedTotal += row.dropped;
    timeoutTotal += row.timeouts;
    if (row.completed + row.dropped + row.timeouts !== row.attempted) {
      accountingClosed = false;
    }
  }
  const workloadPass =
    accountingClosed &&
    droppedTotal <= plan.workloadTolerance.maxDroppedOps &&
    timeoutTotal <= plan.workloadTolerance.maxTimeoutOps;
  check(
    'workload-accounted',
    workloadPass,
    accountingClosed
      ? `${String(droppedTotal)} dropped, ${String(timeoutTotal)} timeouts against tolerance ` +
        `${String(plan.workloadTolerance.maxDroppedOps)}/${String(plan.workloadTolerance.maxTimeoutOps)}`
      : 'workload accounting does not close: completed + dropped + timeouts != attempted',
  );
  if (!workloadPass) {
    reasons.push('workload-accounted failed: the load the leak claim rests on is unproven');
  }

  check(
    'profiler-calibrated',
    receipt.profilerOverheadCalibrated,
    receipt.profilerOverheadCalibrated
      ? `profiler overhead calibrated (${receipt.calibrationRef})`
      : 'profiler overhead uncalibrated: measurement inconclusive',
  );
  if (!receipt.profilerOverheadCalibrated) {
    reasons.push('profiler-calibrated failed: uncalibrated overhead never passes');
  }

  let restartPass = true;
  const policy = plan.restartPolicy;
  if (policy.kind === 'forbidden') {
    if (receipt.restarts.length > 0) {
      restartPass = false;
      reasons.push('restart-policy failed: restarts recorded under a forbidden policy');
    }
  } else {
    for (const restart of receipt.restarts) {
      const explained =
        restart.metric === policy.metric &&
        restart.threshold === policy.threshold &&
        restart.observed >= policy.threshold &&
        restart.restarted;
      if (!explained) {
        restartPass = false;
        reasons.push(
          `restart-policy failed: restart at cycle ${String(restart.cycleIndex)} is unexplained by the policy`,
        );
      }
    }
    // A breach the receipt never answers is a policy violation too.
    const firstBreach = receipt.samples.find(
      (sample) => (seriesValue(sample, policy.metric) ?? Number.NEGATIVE_INFINITY) >= policy.threshold,
    );
    if (firstBreach !== undefined) {
      const answered = receipt.restarts.some(
        (restart) => restart.restarted && restart.cycleIndex >= firstBreach.cycleIndex,
      );
      if (!answered) {
        restartPass = false;
        reasons.push(
          `restart-policy failed: ${policy.metric} breached its threshold at cycle ` +
            `${String(firstBreach.cycleIndex)} with no later restart`,
        );
      }
    }
  }
  check(
    'restart-policy',
    restartPass,
    restartPass
      ? `${String(receipt.restarts.length)} restart(s) under a ${policy.kind} policy`
      : 'restart evidence contradicts the frozen policy',
  );

  const boundaries = [...receipt.restarts]
    .filter((restart) => restart.restarted)
    .map((restart) => restart.cycleIndex)
    .sort((left, right) => left - right);
  for (const series of plan.requiredSeries) {
    const bound = plan.slopeBounds[series] ?? Number.NEGATIVE_INFINITY;
    const missing = receipt.samples.filter((sample) => seriesValue(sample, series) === undefined);
    if (missing.length > 0) {
      check(`series-${series}`, false, `series ${series} is missing from ${String(missing.length)} sample(s)`);
      reasons.push(`series-${series} failed: a required series must be present in every sample`);
      continue;
    }
    // Segments split after each effective restart; every segment stands alone.
    const segments: SoakSample[][] = [];
    let current: SoakSample[] = [];
    const cuts = new Set(boundaries);
    for (const sample of receipt.samples) {
      current.push(sample);
      if (cuts.has(sample.cycleIndex)) {
        segments.push(current);
        current = [];
      }
    }
    if (current.length > 0) {
      segments.push(current);
    }
    let seriesPass = segments.length > 0;
    const details: string[] = [];
    segments.forEach((segment, index) => {
      if (segment.length < plan.minSamplesPerSegment) {
        seriesPass = false;
        details.push(
          `segment ${String(index)}: ${String(segment.length)} samples < ${String(plan.minSamplesPerSegment)} minimum (inconclusive)`,
        );
        return;
      }
      const xs = segment.map((sample) => sample.cycleIndex);
      const ys = segment.map((sample) => seriesValue(sample, series) ?? 0);
      const { slope, se } = fitSlope(xs, ys);
      const upper = slope + 2 * se;
      const pass = upper <= bound;
      if (!pass) {
        seriesPass = false;
      }
      details.push(
        `segment ${String(index)}: slope ${slope.toFixed(3)} + 2SE ${se.toFixed(3)} against bound ${String(bound)}`,
      );
    });
    check(`series-${series}`, seriesPass, details.join('; ') || 'no segments');
    if (!seriesPass) {
      reasons.push(`series-${series} failed: growth or inconclusive evidence within a segment`);
    }
  }

  const anyCheckFailed = checks.some((item) => !item.pass);
  const qualification =
    anyCheckFailed
      ? 'invalid'
      : plan.provenance.kind === 'smoke'
        ? 'smoke-only'
        : 'qualified';
  if (qualification === 'smoke-only') {
    reasons.push('smoke provenance: mechanics evidence only, not a qualification result');
  }
  return SoakReportSchema.parse({
    schemaVersion: '1',
    planDigest: plan.digest,
    checks,
    qualification,
    reasons,
  });
}

export async function runSoakCampaign(input: {
  plan: SoakPlan;
  workload: SoakWorkload;
  sampler: SoakSampler;
  restarter?: SoakRestarter;
  profiler: { overheadCalibrated: boolean; calibrationRef: string };
  nowIso: () => string;
  sleep: (ms: number) => Promise<void>;
  cycleMs: number;
}): Promise<{ receipt: SoakReceipt; report: SoakReport }> {
  const plan = verifySoakPlan(input.plan);
  const startedAt = InstantSchema.parse(input.nowIso());
  const samples: SoakSample[] = [];
  const accounting: SoakReceipt['accounting'] = [];
  const restarts: SoakReceipt['restarts'] = [];
  let abortReason: string | null = null;

  for (let cycle = 0; cycle < plan.horizon.cycles; cycle += 1) {
    let row;
    try {
      row = await input.workload.runCycle(cycle);
    } catch (error) {
      abortReason = `workload aborted at cycle ${String(cycle)}: ${error instanceof Error ? error.message : 'unknown error'}`;
      break;
    }
    accounting.push(SoakCycleAccountingSchema.parse({ cycleIndex: cycle, ...row }));
    let metrics;
    try {
      metrics = await input.sampler.sample(cycle);
    } catch (error) {
      abortReason = `sampler aborted at cycle ${String(cycle)}: ${error instanceof Error ? error.message : 'unknown error'}`;
      break;
    }
    const sample = SoakSampleSchema.parse({ cycleIndex: cycle, ...metrics });
    samples.push(sample);
    const policy = plan.restartPolicy;
    if (policy.kind === 'on-threshold') {
      const observed = seriesValue(sample, policy.metric);
      if (observed === undefined) {
        abortReason = `policy metric ${policy.metric} missing from sample at cycle ${String(cycle)}; refusing`;
        break;
      }
      if (observed >= policy.threshold) {
        if (input.restarter === undefined) {
          abortReason = `restart required at cycle ${String(cycle)} but no restarter is wired; refusing`;
          break;
        }
        const outcome = await input.restarter.restart({
          cycleIndex: cycle,
          metric: policy.metric,
          observed,
          threshold: policy.threshold,
        });
        restarts.push(
          SoakRestartSchema.parse({
            cycleIndex: cycle,
            metric: policy.metric,
            observed,
            threshold: policy.threshold,
            restarted: outcome.restarted,
          }),
        );
        if (!outcome.restarted) {
          abortReason = `restart refused at cycle ${String(cycle)}; refusing to continue`;
          break;
        }
      }
    }
    await input.sleep(input.cycleMs);
  }

  const finishedAt = InstantSchema.parse(input.nowIso());
  const peakRssBytes = samples.reduce((peak, sample) => Math.max(peak, sample.rssBytes), 0);
  const totalCompletedOps = accounting.reduce((sum, row) => sum + row.completed, 0);
  const receipt = SoakReceiptSchema.parse({
    schemaVersion: '1',
    planDigest: plan.digest,
    cyclesCompleted: accounting.length,
    durationMs: Math.max(0, msOf(finishedAt) - msOf(startedAt)),
    samples,
    accounting,
    restarts,
    profilerOverheadCalibrated: input.profiler.overheadCalibrated,
    calibrationRef: input.profiler.calibrationRef,
    peakRssBytes,
    totalCompletedOps,
    abortReason,
    startedAt,
    finishedAt,
  });
  return { receipt, report: reduceSoak({ plan, receipt }) };
}
