import { describe, expect, it } from 'vitest';

import {
  CharacterizationRecordSchema,
  IncidentEvidenceSchema,
  type CharacterizationRecord,
  type IncidentEvidence,
} from '../../src/core/index.js';
import { authorizeMutation } from '../../src/modules/agent/index.js';
import {
  assessTelemetryQuality,
  characterizeLegacyBehaviour,
  normalizeToEvidence,
} from '../../src/modules/observability/index.js';

/**
 * WP3-18 / T-26 — SC3-09 legacy/telemetry diagnosis (NEG3-16/19).
 *
 * Written before the native scenario campaigns. Four trusted-export variants:
 * complete evidence still only earns a discriminating probe (never a cause),
 * and every incomplete variant withholds claims with `causality_unproven` or
 * `behavior_contract_unknown` plus an explicit gap. No variant mutates
 * anything: the gateway denies the production-write probe and the denial is
 * the receipt. Success here is diagnostic/safety acceptance, not repair.
 */

function evidence(overrides: Partial<IncidentEvidence> = {}): IncidentEvidence {
  return IncidentEvidenceSchema.parse({
    schemaVersion: '1',
    incidentId: 'sc3-09-legacy',
    sourceIdentity: 'trusted-export:legacy-ledger:v3',
    deployIdentity: 'd'.repeat(64),
    configIdentity: 'c'.repeat(64),
    operationIds: ['op-1', 'op-2'],
    traceIds: ['trace-1'],
    spanIds: ['span-1'],
    eventTimestamps: ['2026-11-01T10:00:00.000Z'],
    observedTimestamps: ['2026-11-01T10:00:01.000Z'],
    clockUncertaintyMs: 50,
    sampling: 'none',
    droppedObservations: 0,
    redactions: [],
    readScopeReceipts: ['scope:ledger-read'],
    rawRefs: ['exports/legacy-ledger-v3/ledger.jsonl'],
    ...overrides,
  });
}

function characterization(overrides: Partial<CharacterizationRecord> = {}): CharacterizationRecord {
  return CharacterizationRecordSchema.parse({
    schemaVersion: '1',
    recordId: 'sc3-09-ledger-rule',
    observedBehavior: 'round-half-up at two decimals on invoice totals',
    ownerInterpretation: 'matches the invoicing policy v2.4 §3',
    unknowns: [],
    corpusProvenance: ['exports/legacy-ledger-v3/ledger.jsonl'],
    positiveExamples: ['inv-1001', 'inv-1002'],
    negativeExamples: ['inv-1099'],
    approvedInvariantRefs: ['inv:rounding-half-up-2dp'],
    ...overrides,
  });
}

describe('SC3-09 complete-evidence variant', () => {
  it('earns a discriminating probe, never a cause claim', () => {
    const quality = assessTelemetryQuality(evidence(), { expectedDeployDigest: 'd'.repeat(64) });

    expect(quality.gaps).toHaveLength(0);
    expect(quality.causality).toBe('needs_discriminating_probe');
    expect(quality.correlationAllowed).toBe(true);
    expect(quality.facts.some((fact) => fact.startsWith('source=trusted-export'))).toBe(true);
  });

  it('characterizes the rule only with owner approval plus frozen invariants', () => {
    const result = characterizeLegacyBehaviour(characterization());

    expect(result.contract).toBe('characterized_pending_freeze');
    expect(result.unknowns).toHaveLength(0);
  });
});

describe('SC3-09 missing-rule/baseline variant (NEG3-19)', () => {
  it('withholds the contract when the owner has not interpreted the behavior', () => {
    const record = characterization();
    const withoutOwner: CharacterizationRecord = { ...record, approvedInvariantRefs: [] };
    delete withoutOwner.ownerInterpretation;
    const result = characterizeLegacyBehaviour(CharacterizationRecordSchema.parse(withoutOwner));

    expect(result.contract).toBe('behavior_contract_unknown');
    expect(result.unknowns.some((gap) => gap.includes('owner interpretation'))).toBe(true);
    expect(result.unknowns.some((gap) => gap.includes('no owner-approved invariants'))).toBe(true);
  });

  it('withholds the contract when invariants are not frozen', () => {
    const result = characterizeLegacyBehaviour(characterization({ approvedInvariantRefs: [] }));

    expect(result.contract).toBe('behavior_contract_unknown');
  });
});

describe('SC3-09 missing-join and clock-skew variants (NEG3-16)', () => {
  it('withholds causality when spans cannot join to a deploy', () => {
    const quality = assessTelemetryQuality(evidence({ spanIds: [], traceIds: [], operationIds: [] }));

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.reasons).toContain('timestamp_only_ambiguous');
    expect(quality.correlationAllowed).toBe(false);
  });

  it('withholds causality when the clock uncertainty breaks near-miss joins', () => {
    const quality = assessTelemetryQuality(evidence({ clockUncertaintyMs: 30_000 }), {
      maxClockUncertaintyMs: 1000,
    });

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.reasons).toContain('clock_skew');
  });

  it('withholds causality on stale deploy labels and dropped observations', () => {
    const quality = assessTelemetryQuality(evidence({ sampling: 'partial', droppedObservations: 7 }), {
      expectedDeployDigest: 'e'.repeat(64),
    });

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.reasons).toContain('stale_deploy');
    expect(quality.reasons).toContain('sampling_gap');
  });

  it('normalizes connector output without inventing correlation', () => {
    const normalized = normalizeToEvidence(
      {
        records: [
          {
            eventAt: '2026-11-01T10:00:00.000Z',
            observedAt: '2026-11-01T10:00:05.000Z',
            fields: { amount: '100.00' },
          },
        ],
        dropped: 2,
        truncated: false,
        queryReceipt: 'scope:ledger-read#q1',
      },
      {
        incidentId: 'sc3-09-legacy',
        sourceIdentity: 'trusted-export:legacy-ledger:v3',
        deployIdentity: 'd'.repeat(64),
        configIdentity: 'c'.repeat(64),
      },
    );
    const quality = assessTelemetryQuality(normalized);

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.gaps.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SC3-09 incomplete variants never mutate (denied-mutation receipts)', () => {
  it('denies a production-write probe outside the snapshot roots', () => {
    expect(() =>
      authorizeMutation({
        operation: 'write',
        path: 'prod/ledger/rules.json',
        writableRoots: ['snapshots/sc3-09'],
        protectedRoots: ['prod'],
        allowedOperations: ['read'],
      }),
    ).toThrow(/not in the mutation allowlist|protected|refusing/i);
  });

  it('denies an uncapped patch even inside a writable root', () => {
    expect(() =>
      authorizeMutation({
        operation: 'write',
        path: 'snapshots/sc3-09/notes.md',
        writableRoots: ['snapshots/sc3-09'],
        protectedRoots: ['prod'],
        allowedOperations: ['write'],
        sizeBytes: 1024,
      }),
    ).toThrow(/no explicit cap/i);
  });
});
