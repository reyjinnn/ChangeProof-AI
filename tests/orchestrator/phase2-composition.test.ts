import { describe, expect, it } from 'vitest';

import { composePhase2 } from '../../src/orchestrator/index.js';
import { IncidentEvidenceSchema } from '../../src/core/index.js';

/**
 * Phase-2 preparation wiring (revision 2, §22).
 *
 * The composition root re-exports the proven pure functions without adding
 * behavior. These cases prove the wiring end to end through the composed
 * surface: telemetry degrades to gaps + `causality_unproven`, and a frozen
 * oracle verifies unchanged through the same composition.
 */
describe('composePhase2', () => {
  it('exposes the proven preparation surface without wrapping it', () => {
    const composed = composePhase2();

    for (const key of [
      'assessTelemetryQuality',
      'characterizeLegacyBehaviour',
      'summarizeCampaign',
      'validateFaultTarget',
      'reduceMatchedWindows',
      'freezeOracle',
      'assertOracleUnchanged',
    ] as const) {
      expect(typeof composed[key]).toBe('function');
    }
  });

  it('assesses telemetry quality through the composition', () => {
    const evidence = IncidentEvidenceSchema.parse({
      schemaVersion: '1',
      incidentId: 'incident-1',
      sourceIdentity: 'collector-1',
      deployIdentity: 'd'.repeat(64),
      configIdentity: 'config-7',
      operationIds: [],
      traceIds: [],
      spanIds: [],
      eventTimestamps: ['2026-10-29T02:00:00.000Z'],
      observedTimestamps: ['2026-10-29T02:00:00.120Z'],
      clockUncertaintyMs: 50,
      sampling: 'none',
      droppedObservations: 0,
      redactions: [],
      readScopeReceipts: ['receipt-1'],
      rawRefs: ['telemetry/incident-1.json'],
    });

    const quality = composePhase2().assessTelemetryQuality(evidence);

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.correlationAllowed).toBe(false);
  });

  it('freezes and verifies an oracle through the composition', () => {
    const composed = composePhase2();
    const digest = 'a'.repeat(64);
    const frozen = composed.freezeOracle({
      oracleDigest: digest,
      authorId: 'owner-1',
      frozenAt: '2026-10-29T02:00:00.000Z',
      scopeDigest: 'c'.repeat(64),
    });

    expect(() => { composed.assertOracleUnchanged(frozen, digest); }).not.toThrow();
    expect(() => { composed.assertOracleUnchanged(frozen, 'b'.repeat(64)); }).toThrow();
  });
});
