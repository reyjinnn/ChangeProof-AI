import { z } from 'zod';

import { InstantSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';

/**
 * Finite model/schedule checking contracts (WP3-33, MVP §20).
 *
 * A trusted finite model pins states, the initial state, transitions,
 * checked invariants, and the exploration bound. Receipts record how many
 * schedules were explored and whether the bound was exhausted; reports
 * carry a verdict plus the exact claim scope. NEG3-40 is enforced in code:
 * an unexhausted bound reports `bound_incomplete`, never holds — and no
 * claim generalizes beyond the declared model.
 */

export const ModelTransitionSchema = z.strictObject({
  from: NonEmptyStringSchema,
  op: NonEmptyStringSchema,
  to: NonEmptyStringSchema,
});
export type ModelTransition = z.infer<typeof ModelTransitionSchema>;

export const FiniteModelSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    modelId: NonEmptyStringSchema,
    states: z.array(NonEmptyStringSchema).min(1),
    initial: NonEmptyStringSchema,
    transitions: z.array(ModelTransitionSchema).min(1),
    invariants: z.array(NonEmptyStringSchema).min(1),
    bound: z.strictObject({
      maxDepth: z.number().int().positive(),
      maxSchedules: z.number().int().positive(),
    }),
    frozenAt: InstantSchema,
    digest: Sha256Schema,
  })
  .superRefine((model, ctx) => {
    const states = new Set(model.states);
    if (!states.has(model.initial)) {
      ctx.addIssue({ code: 'custom', path: ['initial'], message: 'Initial state is not declared.' });
    }
    model.transitions.forEach((transition, index) => {
      if (!states.has(transition.from) || !states.has(transition.to)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index],
          message: 'Transition references an undeclared state.',
        });
      }
    });
  });
export type FiniteModel = z.infer<typeof FiniteModelSchema>;

export const CounterexampleSchema = z.strictObject({
  schedule: z.array(NonEmptyStringSchema).min(1),
  invariant: NonEmptyStringSchema,
  endState: NonEmptyStringSchema,
});
export type Counterexample = z.infer<typeof CounterexampleSchema>;

export const ModelCheckReceiptSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  modelDigest: Sha256Schema,
  schedulesExplored: z.number().int().nonnegative(),
  boundExhausted: z.boolean(),
  counterexamples: z.array(CounterexampleSchema),
  exploredAt: InstantSchema,
});
export type ModelCheckReceipt = z.infer<typeof ModelCheckReceiptSchema>;

export const ModelCheckVerdictSchema = z.enum([
  'holds_within_bound',
  'violated',
  'bound_incomplete',
  'model_invalid',
]);
export type ModelCheckVerdict = z.infer<typeof ModelCheckVerdictSchema>;

export const ModelCheckReportSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  modelDigest: Sha256Schema,
  verdict: ModelCheckVerdictSchema,
  confirmed: z.array(CounterexampleSchema),
  refuted: z.array(CounterexampleSchema),
  claimScope: z.strictObject({
    modelId: NonEmptyStringSchema,
    maxDepth: z.number().int().positive(),
    maxSchedules: z.number().int().positive(),
  }),
  reportedAt: InstantSchema,
});
export type ModelCheckReport = z.infer<typeof ModelCheckReportSchema>;
