export * from './configuration.js';
export * from './errors.js';

import {
  type BundleAssessment,
  type TargetAssessment,
} from '../core/index.js';
import {
  assessBundle,
  assessTarget,
  type BundleFacts,
  type TargetFacts,
} from '../modules/policy/index.js';

/**
 * Composition root (.prepare/architecture.md §3).
 *
 * The orchestrator wires ports and passes already-computed facts to the pure
 * policy reducer. It does not interpret framework details, inspect source,
 * decide a verdict, or call external services directly.
 */
export interface Phase1Composition {
  assessTarget(facts: TargetFacts): TargetAssessment;
  assessBundle(facts: BundleFacts): BundleAssessment;
}

export function composePhase1(): Phase1Composition {
  return {
    assessTarget,
    assessBundle,
  };
}
