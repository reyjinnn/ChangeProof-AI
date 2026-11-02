import {
  ChangeProofError,
  EvalAbortPolicySchema,
  EvalCaseSchema,
  EvalManifestSchema,
  EvaluationArmSchema,
  InstantSchema,
  NonEmptyStringSchema,
  OriginSchema,
  ReleaseCriterionSchema,
  type EvalCase,
  type EvalManifest,
  type EvaluationArm,
} from '../../core/index.js';

import { canonicalize, sha256Hex } from './canonical.js';
import type { EvalCaseStore } from './store.js';

/**
 * Manifest freeze and verification (WP3-13, FR3-24).
 *
 * Freezing validates every case and arm, writes case bytes to the store,
 * and binds the canonical bytes with two digests: the dataset digest over
 * the sorted cases, and the manifest digest over everything except itself.
 * Verification recomputes both and requires every input digest present —
 * any drift, however small, fails closed (NEG3-07).
 */

export interface FreezeCaseInput {
  readonly caseId: string;
  readonly dataset: 'dev' | 'holdout';
  readonly pack: 'functionality' | 'statistical' | 'refusal' | 'security' | 'regression' | 'ablation';
  readonly suite: string;
  readonly origin: 'controlled_change' | 'historical_organic' | 'current_organic';
  readonly intermittent: boolean;
  readonly campaign?: { readonly n: number; readonly schedule: string };
  readonly predictors?: readonly string[];
  readonly inputText: string;
  readonly oracleRef: string;
  readonly referenceDigest?: string;
  readonly fixability: 'fixable' | 'unfixable' | 'unknown';
}

export function freezeManifest(input: {
  manifestId: string;
  cases: readonly FreezeCaseInput[];
  arms: readonly EvaluationArm[];
  abortPolicy: unknown;
  releaseCriteria: readonly unknown[];
  createdAt: string;
  store: EvalCaseStore;
}): EvalManifest {
  const manifestId = NonEmptyStringSchema.parse(input.manifestId);
  const createdAt = InstantSchema.parse(input.createdAt);
  if (input.cases.length === 0) {
    throw new ChangeProofError('A manifest needs at least one case; refusing an empty freeze.');
  }
  if (input.arms.length === 0) {
    throw new ChangeProofError('A manifest needs at least one arm; refusing an empty freeze.');
  }
  const arms = input.arms.map((arm) => EvaluationArmSchema.parse(arm));
  const firstVersion = arms[0]?.evaluationVersion;
  if (arms.some((arm) => arm.evaluationVersion !== firstVersion)) {
    throw new ChangeProofError('Arms span different evaluations; freeze one evaluation per manifest.');
  }
  const seen = new Set<string>();
  const cases: EvalCase[] = input.cases.map((c) => {
    const caseId = NonEmptyStringSchema.parse(c.caseId);
    if (seen.has(caseId)) {
      throw new ChangeProofError(`Duplicate case id "${caseId}"; refusing an ambiguous freeze.`);
    }
    seen.add(caseId);
    const inputDigest = input.store.put(c.inputText);
    return EvalCaseSchema.parse({
      schemaVersion: '1',
      caseId,
      dataset: c.dataset,
      pack: c.pack,
      suite: NonEmptyStringSchema.parse(c.suite),
      origin: OriginSchema.parse(c.origin),
      intermittent: c.intermittent,
      ...(c.campaign === undefined ? {} : { campaign: c.campaign }),
      predictors: c.predictors === undefined ? [] : [...c.predictors],
      inputDigest,
      oracleRef: NonEmptyStringSchema.parse(c.oracleRef),
      ...(c.referenceDigest === undefined ? {} : { referenceDigest: c.referenceDigest }),
      fixability: c.fixability,
    });
  });
  const sorted = [...cases].sort((left, right) =>
    left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0,
  );
  const datasetDigest = sha256Hex(canonicalize(sorted));
  const abortPolicy = EvalAbortPolicySchema.parse(input.abortPolicy);
  const releaseCriteria = input.releaseCriteria.map((criterion) => ReleaseCriterionSchema.parse(criterion));
  const body = {
    schemaVersion: '1',
    manifestId,
    createdAt,
    datasetDigest,
    cases,
    arms,
    abortPolicy,
    releaseCriteria,
  };
  const digest = sha256Hex(canonicalize(body));
  return EvalManifestSchema.parse({ ...body, digest });
}

export function verifyManifest(manifest: unknown, store: EvalCaseStore): EvalManifest {
  const parsed = EvalManifestSchema.parse(manifest);
  const { digest, ...body } = parsed;
  if (sha256Hex(canonicalize(body)) !== digest) {
    throw new ChangeProofError('Manifest digest does not match its content; drift is refused.');
  }
  const sorted = [...parsed.cases].sort((left, right) =>
    left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0,
  );
  if (sha256Hex(canonicalize(sorted)) !== parsed.datasetDigest) {
    throw new ChangeProofError('Dataset digest does not match the cases; drift is refused.');
  }
  for (const c of parsed.cases) {
    if (!store.has(c.inputDigest)) {
      throw new ChangeProofError(`Case bytes for "${c.caseId}" are missing from the store; refusing.`);
    }
  }
  return parsed;
}
