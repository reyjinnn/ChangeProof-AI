import {
  EvalAbortPolicySchema,
  type EvalAbortPolicy,
  type EvalArmResult,
  type EvalComparison,
  type EvalManifest,
  type ReleaseCriterion,
} from '../../core/index.js';

/**
 * Abort and release evaluation (WP3-13).
 *
 * Both checks are pure over frozen inputs: abort stops runaway arms inside
 * a run, release gates report per arm without averaging anything away. The
 * harness reports; it never ships — release stays an explicit owner
 * decision over the full per-arm detail.
 */

export function checkAbort(
  progress: { consecutiveInfraFailures: number; spentUnits: number; budgetUnits: number },
  policy: EvalAbortPolicy,
): { abort: boolean; reason?: string } {
  const valid = EvalAbortPolicySchema.parse(policy);
  if (progress.consecutiveInfraFailures >= valid.maxConsecutiveInfraFailures) {
    return {
      abort: true,
      reason: `consecutive infra failures reached ${String(progress.consecutiveInfraFailures)}`,
    };
  }
  if (progress.budgetUnits > 0 && progress.spentUnits / progress.budgetUnits > valid.maxCostOverrunRatio) {
    return {
      abort: true,
      reason: `spent ${String(progress.spentUnits)} of ${String(progress.budgetUnits)} budget units`,
    };
  }
  return { abort: false };
}

export interface ReleaseCheck {
  readonly criterionId: string;
  readonly armId: string;
  readonly suite: string | null;
  readonly pass: boolean;
  readonly actual: number | null;
  readonly detail: string;
}

export interface ReleaseReport {
  readonly overall: boolean;
  readonly checks: readonly ReleaseCheck[];
}

export function checkRelease(input: {
  comparison: EvalComparison;
  results: readonly EvalArmResult[];
  manifest: EvalManifest;
  criteria: readonly ReleaseCriterion[];
}): ReleaseReport {
  const checks: ReleaseCheck[] = [];
  for (const criterion of input.criteria) {
    if (criterion.kind === 'suite_present') {
      const suite = criterion.suite ?? '';
      const present = input.manifest.cases.filter((c) => c.suite === suite).length;
      checks.push({
        criterionId: criterion.id,
        armId: '*',
        suite,
        pass: present > 0,
        actual: present,
        detail: present > 0 ? `suite "${suite}" has ${String(present)} cases` : `suite "${suite}" is absent`,
      });
      continue;
    }
    for (const summary of input.comparison.arms) {
      const record = input.results.find((row) => row.armId === summary.armId);
      const scoped =
        criterion.suite === undefined
          ? (record?.caseResults ?? [])
          : (record?.caseResults ?? []).filter((row) => {
              const c = input.manifest.cases.find((entry) => entry.caseId === row.caseId);
              return c !== undefined && c.suite === criterion.suite;
            });
      if (criterion.kind === 'min_resolved_rate') {
        if (scoped.length === 0) {
          checks.push({
            criterionId: criterion.id,
            armId: summary.armId,
            suite: criterion.suite ?? null,
            pass: false,
            actual: null,
            detail: 'no cases in scope; a vacuous pass is refused',
          });
          continue;
        }
        const resolved = scoped.filter((row) => row.outcome === 'resolved').length;
        const rate = resolved / scoped.length;
        checks.push({
          criterionId: criterion.id,
          armId: summary.armId,
          suite: criterion.suite ?? null,
          pass: rate >= criterion.value,
          actual: rate,
          detail: `${String(resolved)} of ${String(scoped.length)} resolved`,
        });
      } else {
        const regressions = scoped.filter((row) => row.regressed).length;
        checks.push({
          criterionId: criterion.id,
          armId: summary.armId,
          suite: criterion.suite ?? null,
          pass: regressions <= criterion.value,
          actual: regressions,
          detail: `${String(regressions)} regressions against a ceiling of ${String(criterion.value)}`,
        });
      }
    }
  }
  return { overall: checks.every((check) => check.pass), checks };
}

export function reducePredictors(
  history: readonly { predictors: readonly string[]; resolved: boolean }[],
): { predictor: string; resolved: number; total: number }[] {
  const buckets = new Map<string, { resolved: number; total: number }>();
  for (const entry of history) {
    for (const predictor of entry.predictors) {
      const bucket = buckets.get(predictor) ?? { resolved: 0, total: 0 };
      bucket.total += 1;
      if (entry.resolved) {
        bucket.resolved += 1;
      }
      buckets.set(predictor, bucket);
    }
  }
  return [...buckets.entries()]
    .map(([predictor, bucket]) => ({ predictor, resolved: bucket.resolved, total: bucket.total }))
    .sort((left, right) => (left.predictor < right.predictor ? -1 : left.predictor > right.predictor ? 1 : 0));
}
