import {
  ProposerCaseSchema,
  type EvalCase,
  type EvalManifest,
  type ProposerCase,
} from '../../core/index.js';

/**
 * Role projections (WP3-13, NEG3-03).
 *
 * Proposers receive dev cases only, stripped of oracle and reference
 * bindings; holdout cases never project. Evaluators receive every case with
 * bindings intact. Comparisons aggregate elsewhere and carry no case
 * content for any role.
 */

export function proposerCases(manifest: EvalManifest): ProposerCase[] {
  return manifest.cases
    .filter((c) => c.dataset === 'dev')
    .map((c) =>
      ProposerCaseSchema.parse({
        schemaVersion: '1',
        caseId: c.caseId,
        pack: c.pack,
        suite: c.suite,
        intermittent: c.intermittent,
        inputDigest: c.inputDigest,
      }),
    );
}

export function evaluatorCases(manifest: EvalManifest): EvalCase[] {
  return [...manifest.cases];
}
