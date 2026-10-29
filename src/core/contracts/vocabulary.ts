import { z } from 'zod';

/**
 * Status vocabulary.
 *
 * .claude/AGENTS.md §4 fixes these values exactly and forbids inventing synonyms.
 * They are defined once, here, and every contract imports them — so a typo
 * cannot become a second vocabulary.
 */

/** `origin` — how the case came to exist. */
export const OriginSchema = z.enum(['controlled_change', 'historical_organic', 'current_organic']);
export type Origin = z.infer<typeof OriginSchema>;

/** `executionMode` — where the work actually ran. Mock/replay never pass acceptance gates. */
export const ExecutionModeSchema = z.enum(['mock', 'replay', 'real_runtime']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

/** `proposalMode` — who produced the candidate. `human_reference` proves only the verifier. */
export const ProposalModeSchema = z.enum(['live_model', 'replay_model', 'human_reference']);
export type ProposalMode = z.infer<typeof ProposalModeSchema>;

/** Target-level product verdict. Never decided by the model (.claude/AGENTS.md §3 rule 1). */
export const TARGET_OUTCOMES = [
  'fixed',
  'no_impact_verified',
  'unverified',
  'partial',
  'failed',
] as const;
export const TargetOutcomeSchema = z.enum(TARGET_OUTCOMES);
export type TargetOutcome = z.infer<typeof TargetOutcomeSchema>;

/** Bundle-level verdict. Evaluation order: invalid -> blocked -> incomplete -> verified. */
export const BUNDLE_STATES = ['verified', 'incomplete', 'blocked', 'invalid'] as const;
export const BundleStateSchema = z.enum(BUNDLE_STATES);
export type BundleState = z.infer<typeof BundleStateSchema>;

/** Run states that withhold a verdict rather than producing one (FR3-16 precedence step 1). */
export const RunStateSchema = z.enum(['active', 'stale', 'cancelled', 'completed']);
export type RunState = z.infer<typeof RunStateSchema>;

/** Graph edge provenance. `inferred` must never become indistinguishable from `proven`. */
export const EdgeResolutionSchema = z.enum(['proven', 'inferred', 'unresolved']);
export type EdgeResolution = z.infer<typeof EdgeResolutionSchema>;

/** Per-dimension result. Dimensions are assessed separately, never averaged (rule 5). */
export const DIMENSION_NAMES = ['correctness', 'performance', 'resilience', 'data_integrity'] as const;
export const DimensionSchema = z.enum(DIMENSION_NAMES);
export type Dimension = z.infer<typeof DimensionSchema>;

export const DimensionResultSchema = z.enum(['pass', 'fail', 'inconclusive', 'not_applicable']);
export type DimensionResult = z.infer<typeof DimensionResultSchema>;

/** The three support levels (.claude/AGENTS.md §4). `none` is a separate proven-level value. */
export const SUPPORT_LEVELS = ['L1', 'L2', 'L3'] as const;
export const SupportLevelSchema = z.enum(SUPPORT_LEVELS);
export type SupportLevel = z.infer<typeof SupportLevelSchema>;

export const ProvenLevelSchema = z.enum(['none', 'L1', 'L2', 'L3']);
export type ProvenLevel = z.infer<typeof ProvenLevelSchema>;

/** Engineering task status. Kept separate from the product verdict (.claude/AGENTS.md §4). */
export const TaskStatusSchema = z.enum(['not_started', 'in_progress', 'blocked', 'done']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Reproducibility strength of an experiment. A fixed seed is not full replay. */
export const ReproductionModeSchema = z.enum(['controlled', 'observed-partial', 'uncontrolled']);
export type ReproductionMode = z.infer<typeof ReproductionModeSchema>;
