import {
  ChangeProofError,
  ExperimentPlanSchema,
  TrialReceiptSchema,
  type ExperimentPlan,
  type TrialReceipt,
} from '../../core/index.js';

/**
 * Campaign accounting (WP3-16, FR3-26).
 *
 * Preparation scope: this module classifies trial-level receipts against the
 * frozen `ExperimentPlan`. It reports all-trial accounting
 * (`planned/completed/failed/invalid/censored/notRun`) and one of three
 * accounting verdicts:
 *
 *   - `campaign_complete`: every planned trial has a receipt (accounting
 *     complete — pass/fail evaluation of the claim belongs to policy, not to
 *     this counter);
 *   - `campaign_incomplete`: fewer receipts than planned (NEG3-15 — one green
 *     run is not a pass);
 *   - `experiment_invalid`: the fault was applied but never removed, an
 *     injector/cleanup failure was recorded, or receipts drifted to another
 *     plan hash (NEG3-17).
 *
 * Malformed receipts and more receipts than planned throw instead of being
 * counted around (fail closed). Per-receipt campaign-level `counts` are
 * validated for shape by the schema; the set-level accounting here is derived
 * transparently from trial records so a drift between the two cannot hide.
 *
 * Fault authority stays in the supervisor: `validateFaultTarget` accepts only
 * allowlisted edge/process targets from the frozen plan. The model proposes a
 * typed probe intent; the supervisor selects the trusted plan. Raw network,
 * shell, or unlisted input is rejected outright.
 */

export type CampaignAccountingVerdict =
  | 'campaign_complete'
  | 'campaign_incomplete'
  | 'experiment_invalid';

export type CampaignReasonCode = 'campaign_incomplete' | 'experiment_invalid';

export interface CampaignCounts {
  readonly planned: number;
  readonly completed: number;
  readonly failed: number;
  readonly invalid: number;
  readonly censored: number;
  readonly notRun: number;
}

export interface CampaignAccounting {
  readonly verdict: CampaignAccountingVerdict;
  readonly reasonCode?: CampaignReasonCode;
  readonly reasons: readonly string[];
  readonly counts: CampaignCounts;
}

const INJECTOR_FAILURE_PATTERN = /injector|fault|heal|cleanup|reset/i;

const FAULT_TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;

export function summarizeCampaign(
  receipts: readonly TrialReceipt[],
  plan: ExperimentPlan,
): CampaignAccounting {
  const frozen = ExperimentPlanSchema.parse(plan);
  const validated = receipts.map((receipt) => TrialReceiptSchema.parse(receipt));

  const drifted = validated.filter((receipt) => receipt.planHash !== frozen.planHash);
  if (drifted.length > 0) {
    return {
      verdict: 'experiment_invalid',
      reasonCode: 'experiment_invalid',
      reasons: [
        `plan-hash-drift: ${drifted.length} receipt(s) belong to another plan; ` +
          'receipts cannot be transferred across plans or candidates.',
      ],
      counts: emptyCounts(frozen.n, frozen.n),
    };
  }

  let completed = 0;
  let failed = 0;
  let invalid = 0;
  let censored = 0;
  const invalidReasons: string[] = [];

  for (const receipt of validated) {
    if (receipt.faultApplied && !receipt.faultRemoved) {
      invalid += 1;
      invalidReasons.push(
        'fault-applied-but-never-removed: a failed injector makes the experiment ' +
          'invalid, not the application recovered (NEG3-17).',
      );
    } else if (
      receipt.result === 'excluded' &&
      receipt.exclusionReason !== undefined &&
      INJECTOR_FAILURE_PATTERN.test(receipt.exclusionReason)
    ) {
      invalid += 1;
      invalidReasons.push(
        `injector-failure-recorded: ${receipt.exclusionReason} (NEG3-17).`,
      );
    } else if (receipt.result === 'pass') {
      completed += 1;
    } else if (receipt.result === 'fail') {
      failed += 1;
    } else {
      censored += 1;
    }
  }

  if (invalid > 0) {
    return {
      verdict: 'experiment_invalid',
      reasonCode: 'experiment_invalid',
      reasons: [...new Set(invalidReasons)],
      counts: {
        planned: frozen.n,
        completed,
        failed,
        invalid,
        censored,
        notRun: frozen.n - validated.length,
      },
    };
  }

  if (validated.length > frozen.n) {
    throw new ChangeProofError(
      `Campaign has more receipts than planned: ${validated.length} receipts for n=${frozen.n}. ` +
        'A rerun is a new trial with cumulative usage, never progress counted twice.',
    );
  }

  if (validated.length < frozen.n) {
    return {
      verdict: 'campaign_incomplete',
      reasonCode: 'campaign_incomplete',
      reasons: [
        `only ${validated.length} of ${frozen.n} planned trials have receipts; ` +
          'one green run is not campaign completion (NEG3-15).',
      ],
      counts: {
        planned: frozen.n,
        completed,
        failed,
        invalid,
        censored,
        notRun: frozen.n - validated.length,
      },
    };
  }

  return {
    verdict: 'campaign_complete',
    reasons:
      failed > 0 || censored > 0
        ? [
            `all ${frozen.n} planned trials accounted (${failed} failed, ${censored} censored); ` +
              'accounting is complete, claim evaluation belongs to policy.',
          ]
        : ['all planned trials accounted with passing receipts.'],
    counts: { planned: frozen.n, completed, failed, invalid, censored, notRun: 0 },
  };
}

function emptyCounts(planned: number, notRun: number): CampaignCounts {
  return { planned, completed: 0, failed: 0, invalid: 0, censored: 0, notRun };
}

/**
 * Accept only an allowlisted fault target from the frozen plan.
 *
 * The shape check runs before the membership check so that raw network ranges,
 * shell fragments, or traversal input is rejected for what it is — never
 * widened into a fault, never defaulted.
 */
export function validateFaultTarget(target: string, allowlist: readonly string[]): string {
  if (target.length === 0) {
    throw new ChangeProofError(
      'Fault target must not be empty: the supervisor injects no default fault (fail closed).',
    );
  }
  if (!FAULT_TARGET_PATTERN.test(target)) {
    throw new ChangeProofError(
      `Fault target "${target}" carries characters outside the allowlisted edge/process shape; ` +
        'raw network or shell input is never a fault target.',
    );
  }
  if (!allowlist.includes(target)) {
    throw new ChangeProofError(
      `Fault target "${target}" is not in the frozen plan allowlist; the model proposes intent, ` +
        'the supervisor selects a trusted plan (FR3-26).',
    );
  }
  return target;
}
