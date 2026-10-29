import { z } from 'zod';

import { SemanticViolationError } from '../../errors/index.js';
import { IdSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';

/**
 * ExecutionBudget — the finite resource envelope for a run (FR3-14).
 *
 * Two properties matter and are enforced here:
 *
 *  1. Every limit is finite and validated before the run. There is no
 *     "unlimited" default (.claude/AGENTS.md §3 rule 14).
 *  2. Usage is monotonic. A resume may carry usage forward but never back:
 *     retrying or resuming must not reset the counter (NEG3-13).
 *
 * The reserve exists so that a nearly-exhausted budget cannot silently drop
 * the full verification pass: proof, reproduction and cleanup all draw on it.
 */

export const BudgetLimitSchema = z
  .strictObject({
    modelCostUsd: z.number().gt(0),
    modelRequests: z.number().int().gt(0),
    wallTimeMs: z.number().int().gt(0),
    cpuMs: z.number().int().gt(0),
    maxPids: z.number().int().gt(0),
    diskBytes: z.number().int().gt(0),
    outputBytes: z.number().int().gt(0).optional(),
  })
  .describe('Finite limits for one run');
export type BudgetLimit = z.infer<typeof BudgetLimitSchema>;

export const BudgetUsageSchema = z
  .strictObject({
    modelCostUsd: z.number().nonnegative(),
    modelRequests: z.number().int().nonnegative(),
    wallTimeMs: z.number().int().nonnegative(),
    cpuMs: z.number().int().nonnegative(),
    peakPids: z.number().int().nonnegative(),
    diskBytes: z.number().int().nonnegative(),
  })
  .describe('Consumption so far');
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

export const BudgetReserveSchema = z
  .strictObject({
    modelCostUsd: z.number().nonnegative(),
    wallTimeMs: z.number().int().nonnegative(),
  })
  .describe('Held back for full proof, reproduction and cleanup');
export type BudgetReserve = z.infer<typeof BudgetReserveSchema>;

/** Reserved amounts that must remain available for the mandatory proof pass. */
export const RESERVED_FOR_FULL_PROOF = ['modelCostUsd', 'wallTimeMs'] as const;

export const ExecutionBudgetSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    profileId: NonEmptyStringSchema,
    /** Digest of the profile configuration; a changed profile is a new budget identity. */
    profileConfigDigest: Sha256Schema,
    limits: BudgetLimitSchema,
    reserve: BudgetReserveSchema,
    usage: BudgetUsageSchema,
    /** Segmented budgets inside the aggregate. Separation must not enable a reset. */
    segments: z
      .partialRecord(
        z.enum(['proposal_fixer', 'diagnostic_probe', 'verification_campaign']),
        BudgetUsageSchema.partial(),
      )
      .default({}),
  })
  .superRefine((budget, ctx) => {
    const limitFields: (keyof BudgetLimit)[] = [
      'modelCostUsd',
      'modelRequests',
      'wallTimeMs',
      'cpuMs',
      'maxPids',
      'diskBytes',
    ];

    for (const field of limitFields) {
      const limit = budget.limits[field];
      if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['limits', field],
          message: `Limit "${field}" must be a finite positive number. There is no unlimited default (FR3-14).`,
        });
      }
    }

    if (budget.usage.modelCostUsd > budget.limits.modelCostUsd) {
      ctx.addIssue({
        code: 'custom',
        path: ['usage', 'modelCostUsd'],
        message: 'Recorded usage exceeds the configured limit. That is a resource blocker, not a reset.',
      });
    }
    if (budget.usage.wallTimeMs > budget.limits.wallTimeMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['usage', 'wallTimeMs'],
        message: 'Recorded usage exceeds the configured limit. That is a resource blocker, not a reset.',
      });
    }
    if (budget.usage.modelRequests > budget.limits.modelRequests) {
      ctx.addIssue({
        code: 'custom',
        path: ['usage', 'modelRequests'],
        message: 'Recorded usage exceeds the configured limit.',
      });
    }
  })
  .describe('Finite, validated, frozen resource envelope');
export type ExecutionBudget = z.infer<typeof ExecutionBudgetSchema>;

export interface BudgetParseContext {
  /** Usage already recorded by a previous, interrupted attempt. */
  priorUsage?: BudgetUsage;
}

/**
 * Parse a budget, additionally enforcing that usage never moves backwards.
 *
 * Kept separate from the schema because monotonicity is a *relation* between
 * two documents, not a property of one. A resume presents the previous usage
 * alongside the new one.
 */
export function parseExecutionBudget(
  input: unknown,
  context: BudgetParseContext = {},
): ExecutionBudget {
  const budget = ExecutionBudgetSchema.parse(input);

  if (context.priorUsage === undefined) {
    return budget;
  }

  const prior = context.priorUsage;
  const current = budget.usage;
  const regressions: string[] = [];

  const compare: (keyof BudgetUsage)[] = [
    'modelCostUsd',
    'modelRequests',
    'wallTimeMs',
    'cpuMs',
    'peakPids',
    'diskBytes',
  ];

  for (const field of compare) {
    if (current[field] < prior[field]) {
      regressions.push(`${field}: ${prior[field]} -> ${current[field]}`);
    }
  }

  if (regressions.length > 0) {
    throw new SemanticViolationError(
      'budget.usage.regressed',
      'Usage cannot decrease across a resume or retry. A reset would let an exhausted budget ' +
        `restart silently (NEG3-13). Regressions: ${regressions.join('; ')}.`,
      { regressions },
    );
  }

  return budget;
}

/** Remaining capacity against a limit. */
export function remainingBudget(budget: ExecutionBudget): {
  modelCostUsd: number;
  wallTimeMs: number;
  modelRequests: number;
} {
  return {
    modelCostUsd: budget.limits.modelCostUsd - budget.usage.modelCostUsd,
    wallTimeMs: budget.limits.wallTimeMs - budget.usage.wallTimeMs,
    modelRequests: budget.limits.modelRequests - budget.usage.modelRequests,
  };
}

/**
 * True when the remaining budget cannot cover the mandatory proof, reproduction
 * and cleanup pass. When true, the run must stop `unverified` with a resource
 * blocker rather than reduce n or skip the suite (.claude/AGENTS.md §3 rule 14).
 */
export function cannotFundFullProof(budget: ExecutionBudget): boolean {
  const remaining = remainingBudget(budget);
  return (
    remaining.modelCostUsd < budget.reserve.modelCostUsd ||
    remaining.wallTimeMs < budget.reserve.wallTimeMs
  );
}

export const BudgetProfileIdSchema = IdSchema;
