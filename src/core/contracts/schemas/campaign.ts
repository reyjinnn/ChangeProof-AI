import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema, Sha256Schema, SubjectRefSchema, assertCountsReconcile } from '../primitives.js';

/**
 * ExperimentPlan and TrialReceipt — the pre-registered campaign protocol
 * (FR3-26, MVP §17).
 *
 * A campaign is designed *before* the run: subjects, workload, fault/schedule,
 * n, reset semantics, measurements, thresholds, budgets and claim envelope are
 * all fixed up front. Reruns cannot be chosen after seeing results (DEC3-12).
 *
 * The receipts then have to account for every planned trial. A campaign that
 * completed one green run out of ten is `campaign_incomplete`, not a pass
 * (NEG3-15). A fault that was injected but never healed makes the experiment
 * invalid, not the application a failure (NEG3-17).
 */

export const ArrivalDistributionSchema = z.enum([
  'steady',
  'burst',
  'ramp',
  'poisson',
  'replay',
]);
export type ArrivalDistribution = z.infer<typeof ArrivalDistributionSchema>;

export const DataSkewSchema = z.enum(['none', 'low', 'medium', 'high']);
export type DataSkew = z.infer<typeof DataSkewSchema>;

export const ResetSemanticsSchema = z.enum([
  'fresh-database-per-trial',
  'fresh-snapshot-per-trial',
  'transaction-rollback',
  'declared-restore',
]);
export type ResetSemantics = z.infer<typeof ResetSemanticsSchema>;

export const TrialUnitSchema = z.enum(['trial', 'request', 'transaction', 'batch']);
export type TrialUnit = z.infer<typeof TrialUnitSchema>;

export const ComparisonSchema = z.enum(['lt', 'lte', 'gt', 'gte', 'eq']);
export type Comparison = z.infer<typeof ComparisonSchema>;

export const ThresholdSchema = z
  .strictObject({
    metricId: IdSchema,
    statistic: z.enum(['p50', 'p95', 'p99', 'mean', 'max', 'min', 'error_rate', 'count']),
    comparison: ComparisonSchema,
    value: z.number(),
    unit: z.string().min(1),
  })
  .describe('A threshold the reducer compares an observation against');
export type Threshold = z.infer<typeof ThresholdSchema>;

export const StopRuleSchema = z
  .strictObject({
    kind: z.enum(['stop', 'censor']),
    afterTrials: z.number().int().gt(0),
    reason: NonEmptyStringSchema.optional(),
  })
  .describe('When to stop or censor a campaign');
export type StopRule = z.infer<typeof StopRuleSchema>;

export const ScheduleSchema = z
  .strictObject({
    id: IdSchema,
    faultStartMs: z.number().int().nonnegative(),
    faultDurationMs: z.number().int().nonnegative(),
    faultTarget: NonEmptyStringSchema,
  })
  .describe('The intended fault schedule');
export type Schedule = z.infer<typeof ScheduleSchema>;

export const ExperimentPlanSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planVersion: z.number().int().gt(0),
    planHash: Sha256Schema,
    subjects: z.array(SubjectRefSchema).min(1),
    workload: z
      .strictObject({
        arrivalDistribution: ArrivalDistributionSchema,
        concurrency: z.number().int().gt(0),
        dataSkew: DataSkewSchema,
      })
      .describe('The workload the plan measures under'),
    resetSemantics: ResetSemanticsSchema,
    seeds: z.array(z.number().int()).min(1),
    intendedSchedules: z.array(ScheduleSchema).min(1),
    observations: z.array(NonEmptyStringSchema).min(1),
    trialUnit: TrialUnitSchema,
    n: z.number().int().gt(0),
    warmupTrials: z.number().int().nonnegative(),
    measurementWindow: z
      .strictObject({
        kind: z.enum(['fixed', 'matched', 'continuous']),
        durationMs: z.number().int().gt(0).optional(),
        matchedTo: NonEmptyStringSchema.optional(),
      })
      .describe('How observations are windowed for comparison'),
    thresholds: z.array(ThresholdSchema).min(1),
    stopRules: z.array(StopRuleSchema).min(1),
    forecast: z
      .strictObject({
        estimatedCostUsd: z.number().nonnegative(),
        estimatedWallTimeMs: z.number().int().nonnegative(),
      })
      .describe('Forecast for the whole campaign, frozen with the plan'),
    claimEnvelope: NonEmptyStringSchema.optional(),
  })
  .superRefine((plan, ctx) => {
    if (plan.n <= plan.warmupTrials) {
      ctx.addIssue({
        code: 'custom',
        path: ['n', 'warmupTrials'],
        message:
          `n (${plan.n}) must exceed warmupTrials (${plan.warmupTrials}). Warmup trials are not ` +
          'measured trials.',
      });
    }
    if (plan.measurementWindow.kind === 'matched' && plan.measurementWindow.matchedTo === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['measurementWindow', 'matchedTo'],
        message: 'A matched measurement window must name what it is matched to.',
      });
    }
  })
  .describe('A pre-registered campaign design');
export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>;

export const TrialResultSchema = z.enum(['pass', 'fail', 'excluded']);
export type TrialResult = z.infer<typeof TrialResultSchema>;

export const TrialReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planHash: Sha256Schema,
    candidateBundleDigest: Sha256Schema,
    environmentIdentity: NonEmptyStringSchema,
    actualSeed: z.number().int(),
    actualSchedule: z
      .strictObject({
        id: IdSchema,
        appliedAtMs: z.number().int().nonnegative(),
        removedAtMs: z.number().int().nonnegative().optional(),
      })
      .describe('What actually happened, not what was intended'),
    faultApplied: z.boolean(),
    faultRemoved: z.boolean(),
    counts: z
      .strictObject({
        planned: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        invalid: z.number().int().nonnegative(),
        censored: z.number().int().nonnegative(),
        notRun: z.number().int().nonnegative(),
      }),
    result: TrialResultSchema,
    /** Required whenever a trial is excluded, so exclusions stay visible. */
    exclusionReason: NonEmptyStringSchema.optional(),
    telemetryRefs: z.array(NonEmptyStringSchema),
    /** Cumulative usage — a new trial adds to it, it never replaces it. */
    cumulativeUsage: z
      .strictObject({
        modelCostUsd: z.number().nonnegative(),
        modelRequests: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .superRefine((receipt, ctx) => {
    try {
      assertCountsReconcile(receipt.counts, `TrialReceipt(plan=${receipt.planHash})`);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['counts'],
        message: (error as Error).message,
      });
    }

    if (receipt.result === 'pass' && receipt.counts.completed < receipt.counts.planned) {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message:
          `A campaign cannot pass with ${receipt.counts.completed} of ${receipt.counts.planned} ` +
          'planned trials completed. One green run is not campaign completion (NEG3-15).',
      });
    }

    if (receipt.faultApplied && !receipt.faultRemoved && receipt.result === 'pass') {
      ctx.addIssue({
        code: 'custom',
        path: ['faultRemoved'],
        message:
          'The injected fault was never removed. A failed injector makes the experiment invalid, ' +
          'not the application recovered (NEG3-17).',
      });
    }

    if (receipt.result === 'excluded' && receipt.exclusionReason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['exclusionReason'],
        message: 'An excluded trial must state why it was excluded.',
      });
    }
  })
  .describe('Receipt for one trial, with all-trial accounting');
export type TrialReceipt = z.infer<typeof TrialReceiptSchema>;

/** True when a campaign produced complete, valid evidence for a positive claim. */
export function isCampaignComplete(receipt: TrialReceipt): boolean {
  return (
    receipt.result === 'pass' &&
    receipt.counts.completed === receipt.counts.planned &&
    receipt.counts.invalid === 0 &&
    receipt.counts.censored === 0 &&
    receipt.counts.notRun === 0
  );
}
