import { describe, expect, it } from 'vitest';

import {
  CharacterizationRecordSchema,
  IncidentEvidenceSchema,
  type CharacterizationRecord,
  type IncidentEvidence,
} from '../../src/core/index.js';
import {
  assessTelemetryQuality,
  characterizeLegacyBehaviour,
} from '../../src/modules/observability/index.js';

/**
 * WP3-15 / T2-1 — telemetry failure-path tests (NEG3-16, FR3-25, FR3-28).
 *
 * Written before the implementation. Telemetry is untrusted data: its output
 * is facts + quality gaps, never a cause. Clock skew, sampling gaps and stale
 * deploy labels must produce explicit gaps + `causality_unproven`, not a
 * fabricated join. Timestamp-only correlation is ambiguous. Legacy behaviour
 * without owner interpretation stays `behavior_contract_unknown`.
 */

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

function evidence(overrides: Partial<IncidentEvidence> = {}): IncidentEvidence {
  return IncidentEvidenceSchema.parse({
    schemaVersion: '1',
    incidentId: 'incident-1',
    sourceIdentity: 'collector-prod-1',
    deployIdentity: digest('d'),
    configIdentity: 'config-7',
    operationIds: ['op-1'],
    traceIds: ['trace-1'],
    spanIds: ['span-1'],
    eventTimestamps: ['2026-10-26T10:00:00.000Z'],
    observedTimestamps: ['2026-10-26T10:00:00.120Z'],
    clockUncertaintyMs: 50,
    sampling: 'none',
    droppedObservations: 0,
    redactions: [],
    readScopeReceipts: ['receipt-1'],
    rawRefs: ['telemetry/incident-1.json'],
    ...overrides,
  });
}

function record(overrides: Partial<CharacterizationRecord> = {}): CharacterizationRecord {
  return CharacterizationRecordSchema.parse({
    schemaVersion: '1',
    recordId: 'legacy-1',
    observedBehavior: 'orders endpoint returns 200 with a null total for legacy carts',
    ownerInterpretation: undefined,
    unknowns: ['whether null total is intended for legacy carts'],
    corpusProvenance: ['corpus/legacy-carts.json'],
    positiveExamples: ['cart-123'],
    negativeExamples: ['cart-456'],
    approvedInvariantRefs: [],
    ...overrides,
  });
}

describe('telemetry quality never produces a cause (NEG3-16)', () => {
  it('marks clock skew as a gap with causality unproven, not a join', () => {
    const quality = assessTelemetryQuality(evidence({ clockUncertaintyMs: 5000 }), {
      maxClockUncertaintyMs: 1000,
    });

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.gaps.some((gap) => gap.includes('clock'))).toBe(true);
    expect('cause' in quality).toBe(false);
  });

  it('marks sampling gaps and dropped observations instead of joining across them', () => {
    const quality = assessTelemetryQuality(
      evidence({ sampling: 'partial', droppedObservations: 12 }),
    );

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.gaps.some((gap) => gap.includes('sampling') || gap.includes('dropped'))).toBe(
      true,
    );
    expect('cause' in quality).toBe(false);
  });

  it('marks a stale deploy label instead of correlating across deploys', () => {
    const quality = assessTelemetryQuality(evidence(), { expectedDeployDigest: digest('e') });

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.gaps.some((gap) => gap.includes('deploy'))).toBe(true);
  });

  it('marks timestamp-only correlation as ambiguous', () => {
    const quality = assessTelemetryQuality(
      evidence({ traceIds: [], operationIds: [], spanIds: [] }),
    );

    expect(quality.correlationAllowed).toBe(false);
    expect(quality.gaps.some((gap) => gap.includes('timestamp'))).toBe(true);
    expect(quality.causality).toBe('causality_unproven');
  });

  it('withholds a cause even for clean telemetry — a probe is still required', () => {
    const quality = assessTelemetryQuality(evidence(), { expectedDeployDigest: digest('d') });

    expect(quality.causality).toBe('needs_discriminating_probe');
    expect(quality.correlationAllowed).toBe(true);
    expect('cause' in quality).toBe(false);
  });
});

describe('legacy characterization without owner validation (FR3-28)', () => {
  it('stays behavior_contract_unknown when no owner interpretation exists', () => {
    const result = characterizeLegacyBehaviour(record({ ownerInterpretation: undefined }));

    expect(result.contract).toBe('behavior_contract_unknown');
  });

  it('stays behavior_contract_unknown when invariants are not approved', () => {
    const result = characterizeLegacyBehaviour(
      record({ ownerInterpretation: 'null total is a bug', approvedInvariantRefs: [] }),
    );

    expect(result.contract).toBe('behavior_contract_unknown');
  });

  it('never returns the observed behaviour as an oracle', () => {
    const result = characterizeLegacyBehaviour(
      record({
        ownerInterpretation: 'null total is intended for legacy carts',
        approvedInvariantRefs: ['invariant-legacy-total'],
      }),
    );

    expect(result.contract).toBe('characterized_pending_freeze');
    expect('oracle' in result).toBe(false);
  });
});
