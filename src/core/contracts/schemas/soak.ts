import { z } from 'zod';

import { NonEmptyStringSchema, Sha256Schema } from '../primitives.js';

/**
 * Long-horizon soak contracts (WP3-19, SC3-11, FR3-27).
 *
 * A soak plan freezes the horizon beyond the known leak onset together with
 * the workload, runtime/allocator/GC/profiler pins, required resource
 * series, slope bounds, workload tolerance, and restart policy. Receipts
 * record per-cycle samples plus workload accounting, and the reducer turns
 * them into per-check verdicts plus a qualification label.
 *
 * The qualification label enforces NEG3-40 in code: a short smoke run
 * reports `smoke-only` even when every check is green, and a full-horizon
 * run that never reaches its horizon reports `invalid`. Only complete,
 * all-green evidence over the frozen full horizon reports `qualified`.
 */

export const SoakSeriesSchema = z.enum([
  'heapUsedBytes',
  'nativeBytes',
  'rssBytes',
  'fds',
  'threads',
  'poolActive',
  'poolWaiting',
  'queueDepth',
]);
export type SoakSeries = z.infer<typeof SoakSeriesSchema>;

export const SoakProvenanceSchema = z
  .strictObject({
    kind: z.enum(['full-horizon', 'smoke']),
    detail: NonEmptyStringSchema,
  })
  .describe('Declared run class; smoke runs never qualify');
export type SoakProvenance = z.infer<typeof SoakProvenanceSchema>;

export const SoakPlanSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planId: NonEmptyStringSchema,
    profileId: NonEmptyStringSchema,
    provenance: SoakProvenanceSchema,
    knownOnset: z.strictObject({
      cycles: z.number().int().positive(),
      minDurationMs: z.number().int().positive(),
    }),
    horizon: z.strictObject({
      cycles: z.number().int().positive(),
      minDurationMs: z.number().int().positive(),
    }),
    workload: z.strictObject({
      opsPerCycle: z.number().int().positive(),
      description: NonEmptyStringSchema,
    }),
    runtime: z.strictObject({
      runtime: NonEmptyStringSchema,
      runtimeVersion: NonEmptyStringSchema,
      allocator: NonEmptyStringSchema,
      gcSettings: NonEmptyStringSchema,
      profiler: NonEmptyStringSchema,
      profilerVersion: NonEmptyStringSchema,
    }),
    requiredSeries: z.array(SoakSeriesSchema).min(2),
    slopeBounds: z.record(z.string(), z.number()),
    minSamplesPerSegment: z.number().int().min(3),
    workloadTolerance: z.strictObject({
      maxDroppedOps: z.number().int().nonnegative(),
      maxTimeoutOps: z.number().int().nonnegative(),
    }),
    restartPolicy: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('forbidden') }),
      z.strictObject({ kind: z.literal('on-threshold'), metric: SoakSeriesSchema, threshold: z.number() }),
    ]),
    frozenAt: z.iso.datetime({ offset: true }),
    digest: Sha256Schema,
  })
  .superRefine((plan, ctx) => {
    if (plan.horizon.cycles <= plan.knownOnset.cycles) {
      ctx.addIssue({
        code: 'custom',
        path: ['horizon', 'cycles'],
        message: 'Soak horizon cycles must exceed the known onset cycles (SC3-11).',
      });
    }
    if (plan.horizon.minDurationMs <= plan.knownOnset.minDurationMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['horizon', 'minDurationMs'],
        message: 'Soak horizon duration must exceed the known onset duration (SC3-11).',
      });
    }
    for (const mandatory of ['heapUsedBytes', 'rssBytes'] as const) {
      if (!plan.requiredSeries.includes(mandatory)) {
        ctx.addIssue({
          code: 'custom',
          path: ['requiredSeries'],
          message: `Soak plans always require the ${mandatory} series.`,
        });
      }
    }
    if (new Set(plan.requiredSeries).size !== plan.requiredSeries.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredSeries'],
        message: 'Soak requiredSeries lists a series twice; refusing an ambiguous freeze.',
      });
    }
    for (const series of plan.requiredSeries) {
      if (plan.slopeBounds[series] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['slopeBounds', series],
          message: `Soak series "${series}" has no frozen slope bound; refusing.`,
        });
      }
    }
  })
  .describe('Frozen soak plan; digest binds every byte except itself');
export type SoakPlan = z.infer<typeof SoakPlanSchema>;

export const SoakSampleSchema = z
  .strictObject({
    cycleIndex: z.number().int().nonnegative(),
    heapUsedBytes: z.number().int().nonnegative(),
    rssBytes: z.number().int().nonnegative(),
    nativeBytes: z.number().int().nonnegative().optional(),
    fds: z.number().int().nonnegative().optional(),
    threads: z.number().int().nonnegative().optional(),
    poolActive: z.number().int().nonnegative().optional(),
    poolWaiting: z.number().int().nonnegative().optional(),
    queueDepth: z.number().int().nonnegative().optional(),
  })
  .describe('One observed resource sample; heap and RSS are always present');
export type SoakSample = z.infer<typeof SoakSampleSchema>;

export const SoakCycleAccountingSchema = z
  .strictObject({
    cycleIndex: z.number().int().nonnegative(),
    attempted: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    timeouts: z.number().int().nonnegative(),
  })
  .describe('Per-cycle workload accounting; the reducer requires it to close');
export type SoakCycleAccounting = z.infer<typeof SoakCycleAccountingSchema>;

export const SoakRestartSchema = z
  .strictObject({
    cycleIndex: z.number().int().nonnegative(),
    metric: SoakSeriesSchema,
    observed: z.number(),
    threshold: z.number().nullable(),
    restarted: z.boolean(),
  })
  .describe('One restart decision with the evidence that justified it');
export type SoakRestart = z.infer<typeof SoakRestartSchema>;

export const SoakReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planDigest: Sha256Schema,
    cyclesCompleted: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    samples: z.array(SoakSampleSchema),
    accounting: z.array(SoakCycleAccountingSchema),
    restarts: z.array(SoakRestartSchema),
    profilerOverheadCalibrated: z.boolean(),
    calibrationRef: NonEmptyStringSchema,
    peakRssBytes: z.number().int().nonnegative(),
    totalCompletedOps: z.number().int().nonnegative(),
    abortReason: z.string().min(1).nullable(),
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }),
  })
  .describe('What one soak run actually did; aborts stay visible');
export type SoakReceipt = z.infer<typeof SoakReceiptSchema>;

export const SoakCheckSchema = z
  .strictObject({
    id: NonEmptyStringSchema,
    pass: z.boolean(),
    detail: NonEmptyStringSchema,
  })
  .describe('One soak verdict; no averaging across checks');
export type SoakCheck = z.infer<typeof SoakCheckSchema>;

export const SoakReportSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planDigest: Sha256Schema,
    checks: z.array(SoakCheckSchema),
    qualification: z.enum(['qualified', 'smoke-only', 'invalid']),
    reasons: z.array(NonEmptyStringSchema),
  })
  .describe('Per-check verdicts plus the enforced qualification label');
export type SoakReport = z.infer<typeof SoakReportSchema>;
