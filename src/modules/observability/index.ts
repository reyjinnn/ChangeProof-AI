import type { CharacterizationRecord, IncidentEvidence } from '../../core/index.js';

/**
 * Read-only telemetry normalization (WP3-15, FR3-25, FR3-28).
 *
 * Preparation scope: this module turns `IncidentEvidence` and
 * `CharacterizationRecord` into facts + quality gaps. It never produces a
 * cause, an oracle, or a verdict. Correlation across clock skew, sampling
 * gaps, stale deploy labels, redacted keys, or timestamp-only evidence is
 * marked ambiguous with `causality_unproven` (NEG3-16). Legacy behaviour
 * without owner interpretation and approved invariants stays
 * `behavior_contract_unknown` (FR3-28) — observation is not desired behaviour.
 */

export type TelemetryCausality = 'causality_unproven' | 'needs_discriminating_probe';

export interface TelemetryQuality {
  readonly facts: readonly string[];
  readonly gaps: readonly string[];
  readonly causality: TelemetryCausality;
  readonly correlationAllowed: boolean;
  readonly reasons: readonly string[];
}

export interface AssessTelemetryOptions {
  /** Digest of the deploy the analysis must stay within. Mismatch = stale label. */
  readonly expectedDeployDigest?: string;
  /** Clock uncertainty above this bound breaks timestamp joins. */
  readonly maxClockUncertaintyMs?: number;
}

const DEFAULT_MAX_CLOCK_UNCERTAINTY_MS = 1000;

export function assessTelemetryQuality(
  evidence: IncidentEvidence,
  options: AssessTelemetryOptions = {},
): TelemetryQuality {
  const maxUncertainty = options.maxClockUncertaintyMs ?? DEFAULT_MAX_CLOCK_UNCERTAINTY_MS;
  const gaps: string[] = [];
  const reasons: string[] = [];

  if (
    evidence.clockUncertaintyMs !== undefined &&
    evidence.clockUncertaintyMs > maxUncertainty
  ) {
    gaps.push(
      `clock-skew: uncertainty ${evidence.clockUncertaintyMs}ms exceeds ${maxUncertainty}ms; ` +
        'near-miss timestamp joins are ambiguous, not causal.',
    );
    reasons.push('clock_skew');
  }

  if (evidence.sampling !== 'none' || evidence.droppedObservations > 0) {
    gaps.push(
      `sampling-gap: sampling=${evidence.sampling} dropped=${evidence.droppedObservations}; ` +
        'correlation across the gap is unsupported.',
    );
    reasons.push('sampling_gap');
  }

  if (
    options.expectedDeployDigest !== undefined &&
    evidence.deployIdentity !== options.expectedDeployDigest
  ) {
    gaps.push(
      'stale-deploy: evidence deploy label differs from the expected deploy; ' +
        'cross-deploy correlation is unsupported.',
    );
    reasons.push('stale_deploy');
  }

  if (evidence.redactions.length > 0) {
    gaps.push(
      `redacted-keys: ${evidence.redactions.length} redacted field(s); ` +
        'joins across redacted keys are unsupported.',
    );
    reasons.push('redacted_keys');
  }

  const hasCorrelationIds =
    evidence.traceIds.length > 0 ||
    evidence.operationIds.length > 0 ||
    evidence.spanIds.length > 0;
  if (!hasCorrelationIds) {
    gaps.push(
      'timestamp-only: no trace/operation/span correlation IDs; ' +
        'timestamp-only correlation is ambiguous.',
    );
    reasons.push('timestamp_only_ambiguous');
  }

  const facts = [
    `source=${evidence.sourceIdentity}`,
    `deploy=${evidence.deployIdentity}`,
    `config=${evidence.configIdentity}`,
    `traceIds=${evidence.traceIds.length}`,
    `operationIds=${evidence.operationIds.length}`,
    `spanIds=${evidence.spanIds.length}`,
    `sampling=${evidence.sampling}`,
    `dropped=${evidence.droppedObservations}`,
    `redactions=${evidence.redactions.length}`,
    `readScopeReceipts=${evidence.readScopeReceipts.length}`,
    `rawRefs=${evidence.rawRefs.length}`,
  ];

  if (gaps.length > 0) {
    return {
      facts,
      gaps,
      causality: 'causality_unproven',
      correlationAllowed: hasCorrelationIds,
      reasons,
    };
  }

  return {
    facts,
    gaps,
    causality: 'needs_discriminating_probe',
    correlationAllowed: true,
    reasons: ['no_gap_pending_probe'],
  };
}

export type LegacyContract = 'behavior_contract_unknown' | 'characterized_pending_freeze';

export interface LegacyCharacterization {
  readonly facts: readonly string[];
  readonly unknowns: readonly string[];
  readonly contract: LegacyContract;
}

export function characterizeLegacyBehaviour(record: CharacterizationRecord): LegacyCharacterization {
  const facts = [
    `observed=${record.observedBehavior}`,
    `corpusRefs=${record.corpusProvenance.length}`,
    `positiveExamples=${record.positiveExamples.length}`,
    `negativeExamples=${record.negativeExamples.length}`,
    `approvedInvariants=${record.approvedInvariantRefs.length}`,
  ];

  const unknowns = [...record.unknowns];
  if (record.ownerInterpretation === undefined) {
    unknowns.push('missing owner interpretation: observed output is a hypothesis, not an oracle.');
  }
  if (record.approvedInvariantRefs.length === 0) {
    unknowns.push('no owner-approved invariants: nothing is frozen for the fixer.');
  }

  if (
    record.ownerInterpretation !== undefined &&
    record.approvedInvariantRefs.length > 0
  ) {
    return { facts, unknowns, contract: 'characterized_pending_freeze' };
  }
  return { facts, unknowns, contract: 'behavior_contract_unknown' };
}
