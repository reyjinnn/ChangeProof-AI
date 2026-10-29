import { z } from 'zod';

/**
 * Reason codes.
 *
 * A reason code explains *why* a verdict landed where it did. It never decides
 * the verdict: policy precedence and evidence validity remain decisive
 * (AGENTS.md §3 rule 1, PRD FR3-16).
 */
export const REASON_CODES = [
  // Refusal / honesty codes — the product must be able to say "I could not".
  'no_replacement_proven',
  'conflicting_requirements',
  'coverage_insufficient',
  'coverage_gap_unresolved',
  'oracle_invalid',
  'identity_drift',
  'budget_exhausted',
  'resource_profile_insufficient',
  'campaign_incomplete',
  'causality_unproven',
  'experiment_invalid',
  'behavior_contract_unknown',
  'harness_flake_unexplained',
  'infrastructure_failure',

  // Capability honesty codes.
  'adapter_unsupported',
  'capability_not_certified',
  'dependency_resolution_failed',

  // Proof-scope codes.
  'intent_not_preserved',
  'intervention_invalid',
  'bundle_incomplete',
  'cross_stack_verification_failed',
  'migration_integrity_failed',
  'rollout_incompatible',

  // Guard codes.
  'guard_violation_protected_file',
  'guard_violation_scope_escalation',
  'guard_violation_test_weakening',
  'guard_violation_script_weakening',

  // Hosted authority codes.
  'grant_revoked',
  'deletion_fence_active',
  'lease_lost',
  'effect_duplicate',
] as const;

export const ReasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

/** Reason codes that always withhold a positive claim, whatever else passed. */
export const WITHHOLDING_REASON_CODES: readonly ReasonCode[] = [
  'oracle_invalid',
  'identity_drift',
  'campaign_incomplete',
  'experiment_invalid',
  'causality_unproven',
  'behavior_contract_unknown',
  'harness_flake_unexplained',
  'infrastructure_failure',
  'coverage_insufficient',
  'coverage_gap_unresolved',
  'guard_violation_protected_file',
  'guard_violation_scope_escalation',
  'guard_violation_test_weakening',
  'guard_violation_script_weakening',
  'adapter_unsupported',
  'capability_not_certified',
];

export function isWithholdingReason(code: ReasonCode): boolean {
  return WITHHOLDING_REASON_CODES.includes(code);
}
