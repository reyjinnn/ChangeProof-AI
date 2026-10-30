export * from './configuration.js';
export * from './errors.js';

import {
  type BundleAssessment,
  type TargetAssessment,
} from '../core/index.js';
import {
  assertOracleUnchanged,
  freezeOracle,
} from '../modules/fixtures/index.js';
import {
  assessTelemetryQuality,
  characterizeLegacyBehaviour,
} from '../modules/observability/index.js';
import {
  assessBundle,
  assessTarget,
  type BundleFacts,
  type TargetFacts,
} from '../modules/policy/index.js';
import {
  reduceMatchedWindows,
  summarizeCampaign,
  validateFaultTarget,
} from '../modules/verifier/index.js';

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

/**
 * Composition root for the phase-2 preparation surface (revision 2, §22).
 *
 * The orchestrator wires the already-proven pure functions; it adds no
 * verdict, grant, scheduling, or persistence behavior of its own. Hosted
 * wiring (sessions, dispatcher, ledger store) arrives with the full WPs.
 */
export interface Phase2Preparation {
  assessTelemetryQuality: typeof assessTelemetryQuality;
  characterizeLegacyBehaviour: typeof characterizeLegacyBehaviour;
  summarizeCampaign: typeof summarizeCampaign;
  validateFaultTarget: typeof validateFaultTarget;
  reduceMatchedWindows: typeof reduceMatchedWindows;
  freezeOracle: typeof freezeOracle;
  assertOracleUnchanged: typeof assertOracleUnchanged;
}

export function composePhase2(): Phase2Preparation {
  return {
    assessTelemetryQuality,
    characterizeLegacyBehaviour,
    summarizeCampaign,
    validateFaultTarget,
    reduceMatchedWindows,
    freezeOracle,
    assertOracleUnchanged,
  };
}
