import {
  CaseOutcomeSchema,
  ChangeProofError,
  EvalArmResultSchema,
  EvalCaseResultSchema,
  InstantSchema,
  NonEmptyStringSchema,
  type CaseOutcome,
  type EvalArmResult,
  type EvalManifest,
  type EvaluationArm,
  type ProposerCase,
} from '../../core/index.js';

import { checkAbort } from './policy.js';
import type { EvalCaseStore, EvalRole } from './store.js';

/**
 * Arm execution (WP3-13, FR3-24).
 *
 * The harness runs cases in manifest order through an injected runner: it
 * reads case bytes under the caller's role, enforces trial counts (a
 * terminal outcome without its required trials is refused, never recorded),
 * lands runner crashes as incomplete with infra accounting, and stops the
 * arm when the frozen abort policy fires. The arm record always says what
 * ran, what did not, and why.
 */

export interface EvalCaseRunnerInput {
  readonly arm: EvaluationArm;
  readonly case: ProposerCase;
  readonly trialsRequired: number;
  readonly inputText: string;
  readonly nowIso: string;
}

export interface EvalCaseRunnerOutput {
  readonly outcome: CaseOutcome;
  readonly costUnits: number;
  readonly regressed: boolean;
  readonly trialsCompleted: number;
  readonly excludedCost?: { readonly units: number; readonly reason: string };
}

export interface EvalCaseRunner {
  runCase(input: EvalCaseRunnerInput): Promise<EvalCaseRunnerOutput>;
}

export function runArm(input: {
  manifest: EvalManifest;
  armId: string;
  role: EvalRole;
  runner: EvalCaseRunner;
  store: EvalCaseStore;
  nowIso: () => string;
}): Promise<EvalArmResult> {
  const arm = input.manifest.arms.find((candidate) => candidate.armId === input.armId);
  if (arm === undefined) {
    return Promise.reject(new ChangeProofError(`Arm "${input.armId}" is not in this manifest; refusing.`));
  }
  return execute(input.manifest, arm, input.role, input.runner, input.store, input.nowIso);
}

async function execute(
  manifest: EvalManifest,
  arm: EvaluationArm,
  role: EvalRole,
  runner: EvalCaseRunner,
  store: EvalCaseStore,
  nowIso: () => string,
): Promise<EvalArmResult> {
  const startedAt = InstantSchema.parse(nowIso());
  const results: EvalArmResult['caseResults'] = [];
  let consecutiveInfraFailures = 0;
  let spentUnits = 0;
  let aborted = false;
  let abortReason: string | undefined;

  for (const c of manifest.cases) {
    const text = store.get(c.inputDigest, role, manifest);
    const trialsRequired = c.intermittent && c.campaign !== undefined ? c.campaign.n : 1;
    const proposed: ProposerCase = {
      schemaVersion: '1',
      caseId: c.caseId,
      pack: c.pack,
      suite: c.suite,
      intermittent: c.intermittent,
      inputDigest: c.inputDigest,
    };
    const stamped = InstantSchema.parse(nowIso());
    let output: EvalCaseRunnerOutput;
    try {
      output = await runner.runCase({
        arm,
        case: proposed,
        trialsRequired,
        inputText: text,
        nowIso: stamped,
      });
    } catch (error) {
      consecutiveInfraFailures += 1;
      results.push(
        EvalCaseResultSchema.parse({
          caseId: c.caseId,
          outcome: 'incomplete',
          costUnits: 0,
          regressed: false,
          trialsCompleted: 0,
          trialsRequired,
        }),
      );
      const check = checkAbort(
        { consecutiveInfraFailures, spentUnits, budgetUnits: arm.commonBudget.modelCostUsd },
        manifest.abortPolicy,
      );
      if (check.abort) {
        aborted = true;
        abortReason = `infra failures: ${error instanceof Error ? error.message : 'runner crash'}`;
        break;
      }
      continue;
    }
    const outcome = CaseOutcomeSchema.parse(output.outcome);
    if (
      (outcome === 'resolved' || outcome === 'unresolved') &&
      output.trialsCompleted < trialsRequired
    ) {
      throw new ChangeProofError(
        `Case "${c.caseId}" reports ${outcome} with ${String(output.trialsCompleted)} of ${String(trialsRequired)} required trials; refusing the record.`,
      );
    }
    consecutiveInfraFailures = 0;
    spentUnits += output.costUnits;
    results.push(
      EvalCaseResultSchema.parse({
        caseId: c.caseId,
        outcome,
        costUnits: output.costUnits,
        ...(output.excludedCost === undefined ? {} : { excludedCost: output.excludedCost }),
        regressed: output.regressed,
        trialsCompleted: output.trialsCompleted,
        trialsRequired,
      }),
    );
    const check = checkAbort(
      { consecutiveInfraFailures, spentUnits, budgetUnits: arm.commonBudget.modelCostUsd },
      manifest.abortPolicy,
    );
    if (check.abort) {
      aborted = true;
      abortReason = check.reason ?? 'abort policy fired';
      break;
    }
  }

  const finishedAt = InstantSchema.parse(nowIso());
  return EvalArmResultSchema.parse({
    schemaVersion: '1',
    manifestDigest: manifest.digest,
    armId: arm.armId,
    caseResults: results,
    aborted,
    ...(abortedAt(aborted, abortReason)),
    startedAt,
    finishedAt,
  });
}

function abortedAt(aborted: boolean, reason: string | undefined): { abortReason?: string } {
  if (!aborted || reason === undefined) {
    return {};
  }
  return { abortReason: NonEmptyStringSchema.parse(reason) };
}
