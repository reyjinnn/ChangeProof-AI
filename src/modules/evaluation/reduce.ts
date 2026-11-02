import {
  EvalArmResultSchema,
  EvalComparisonSchema,
  type EvalArmResult,
  type EvalArmSummary,
  type EvalComparison,
  type EvalManifest,
} from '../../core/index.js';

/**
 * Arm comparison (WP3-13, FR3-24).
 *
 * Arms compare only over the same frozen dataset, evaluator, budget
 * ceilings, and oracle — anything else yields explicit incomparability
 * reasons, never a quiet partial table (NEG3-13). Every case lands in
 * exactly one outcome bucket with its cost attributed; excluded spend stays
 * visible with reasons, so omitted failures cannot hide (NEG3-15).
 * Summaries aggregate counts only — case content never enters a comparison.
 */

function summarize(armId: string, results: readonly EvalArmResult['caseResults'][number][]): EvalArmSummary {
  const count = (outcome: string): number => results.filter((row) => row.outcome === outcome).length;
  const regressions = results.filter((row) => row.regressed).length;
  const denominator = results.length;
  const netCost = results.reduce((total, row) => total + row.costUnits, 0);
  const excluded = results.flatMap((row) =>
    row.excludedCost === undefined
      ? []
      : [{ caseId: row.caseId, units: row.excludedCost.units, reason: row.excludedCost.reason }],
  );
  const grossCost = netCost + excluded.reduce((total, row) => total + row.units, 0);
  return {
    armId,
    resolved: count('resolved'),
    unresolved: count('unresolved'),
    failed: count('failed'),
    incomplete: count('incomplete'),
    refused: count('refused'),
    regressions,
    denominator,
    resolvedRate: denominator === 0 ? null : count('resolved') / denominator,
    grossCost,
    netCost,
    excluded,
  };
}

export function reduceComparison(input: {
  manifest: EvalManifest;
  results: readonly EvalArmResult[];
}): EvalComparison {
  const reasons: string[] = [];
  const records = input.results.map((row) => EvalArmResultSchema.parse(row));
  if (records.length === 0) {
    reasons.push('no arm records were provided');
  }
  const manifestIds = new Set(input.manifest.cases.map((c) => c.caseId));
  const armById = new Map(input.manifest.arms.map((arm) => [arm.armId, arm]));
  const baselines = records.length > 0 ? records[0] : undefined;
  const baselineArm = baselines !== undefined ? armById.get(baselines.armId) : undefined;

  for (const record of records) {
    if (record.manifestDigest !== input.manifest.digest) {
      reasons.push(`arm "${record.armId}" names a different manifest digest`);
      continue;
    }
    const arm = armById.get(record.armId);
    if (arm === undefined) {
      reasons.push(`arm "${record.armId}" is not in this manifest`);
      continue;
    }
    if (record.aborted) {
      reasons.push(`arm "${record.armId}" aborted (${record.abortReason ?? 'no reason given'})`);
    }
    const seen = new Set<string>();
    for (const row of record.caseResults) {
      if (!manifestIds.has(row.caseId)) {
        reasons.push(`arm "${record.armId}" reports foreign case "${row.caseId}"`);
      }
      if (seen.has(row.caseId)) {
        reasons.push(`arm "${record.armId}" reports case "${row.caseId}" twice`);
      }
      seen.add(row.caseId);
    }
    for (const caseId of manifestIds) {
      if (!seen.has(caseId)) {
        reasons.push(`arm "${record.armId}" is missing case "${caseId}"`);
      }
    }
    if (baselineArm !== undefined) {
      if (arm.evaluatorIdentity !== baselineArm.evaluatorIdentity) {
        reasons.push(`arm "${record.armId}" uses a different evaluator`);
      }
      if (arm.oracleIdentity !== baselineArm.oracleIdentity) {
        reasons.push(`arm "${record.armId}" uses a different oracle`);
      }
      if (arm.datasetVersion !== baselineArm.datasetVersion) {
        reasons.push(`arm "${record.armId}" uses a different dataset version`);
      }
      if (
        arm.commonBudget.modelCostUsd !== baselineArm.commonBudget.modelCostUsd ||
        arm.commonBudget.wallTimeMs !== baselineArm.commonBudget.wallTimeMs
      ) {
        reasons.push(`arm "${record.armId}" uses different budget ceilings`);
      }
    }
  }

  const arms = records.map((record) => summarize(record.armId, record.caseResults));
  return EvalComparisonSchema.parse({
    schemaVersion: '1',
    manifestDigest: input.manifest.digest,
    comparable: reasons.length === 0,
    incomparabilityReasons: reasons,
    arms,
  });
}
