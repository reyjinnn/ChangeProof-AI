import { describe, expect, it } from 'vitest';

import {
  REASON_CODES,
  ReasonCodeSchema,
  SUPPORT_LEVELS,
  CapabilityRecordSchema,
  TargetOutcomeSchema,
  classifySupportLevel,
} from '../../src/core/index.js';

/**
 * WP3-01 / T1-1 — status vocabulary and capability honesty.
 *
 * AGENTS.md §4 fixes this vocabulary exactly and forbids inventing synonyms.
 * NEG3-09: an unsupported adapter/version must not fall back to a generic
 * "verified"; a capability must not claim a level without evidence.
 */
describe('status vocabulary is exact', () => {
  it('accepts exactly the declared TargetOutcome values', () => {
    for (const value of ['fixed', 'no_impact_verified', 'unverified', 'partial', 'failed']) {
      expect(TargetOutcomeSchema.parse(value)).toBe(value);
    }
    for (const rejected of ['verified', 'no_impact', 'success', 'FIXED', '']) {
      expect(() => TargetOutcomeSchema.parse(rejected)).toThrow();
    }
  });

  it('declares exactly four support levels', () => {
    expect(SUPPORT_LEVELS).toEqual(['L1', 'L2', 'L3']);
  });

  it('accepts exactly the declared reason codes', () => {
    for (const code of REASON_CODES) {
      expect(ReasonCodeSchema.parse(code)).toBe(code);
    }
    expect(() => ReasonCodeSchema.parse('because_it_is_fixed')).toThrow();
  });

  it('includes the four reason codes the specification names as important', () => {
    for (const code of [
      'campaign_incomplete',
      'causality_unproven',
      'experiment_invalid',
      'behavior_contract_unknown',
    ]) {
      expect(REASON_CODES).toContain(code);
    }
  });
});

describe('capability records keep target and proven level separate (NEG3-09)', () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const,
    key: {
      ecosystem: 'typescript',
      language: 'typescript',
      framework: 'next',
      versionRange: '>=15.0.0 <16.0.0',
      componentKind: 'frontend',
      changeCategory: 'api-contract',
      featureRestrictions: [],
      runnerProfile: 'node-linux',
      adapterVersion: '1.0.0',
    },
    targetLevel: 'L3' as const,
    provenLevel: 'none' as const,
    certificationStatus: 'uncertified' as const,
    evidenceRefs: [],
    limitations: ['no browser evidence recorded yet'],
    ...overrides,
  });

  it('starts a new record at provenLevel none, not L1', () => {
    expect(CapabilityRecordSchema.parse(record()).provenLevel).toBe('none');
  });

  it('rejects a proven level higher than the target level', () => {
    expect(() =>
      CapabilityRecordSchema.parse(record({ targetLevel: 'L1', provenLevel: 'L3' })),
    ).toThrow();
  });

  it('rejects a proven level above none with no evidence reference', () => {
    expect(() =>
      CapabilityRecordSchema.parse(
        record({ provenLevel: 'L1', certificationStatus: 'certified', evidenceRefs: [] }),
      ),
    ).toThrow();
  });

  it('accepts a proven level once evidence references exist', () => {
    const parsed = CapabilityRecordSchema.parse(
      record({
        provenLevel: 'L1',
        certificationStatus: 'certified',
        evidenceRefs: ['runs/conformance/typescript-next-l1.json'],
      }),
    );
    expect(parsed.provenLevel).toBe('L1');
  });

  it('requires a reason when certification is invalidated', () => {
    expect(() =>
      CapabilityRecordSchema.parse(record({ certificationStatus: 'invalidated' })),
    ).toThrow();
    expect(
      CapabilityRecordSchema.parse(
        record({
          certificationStatus: 'invalidated',
          invalidationReason: 'adapter version changed from 1.0.0 to 1.1.0',
        }),
      ).certificationStatus,
    ).toBe('invalidated');
  });

  it('rejects a versionRange that claims every version', () => {
    for (const claim of ['*', 'any', 'all']) {
      expect(() =>
        CapabilityRecordSchema.parse({
          ...record(),
          key: { ...record().key, versionRange: claim },
        }),
      ).toThrow();
    }
  });

  it('rejects an empty versionRange', () => {
    expect(() =>
      CapabilityRecordSchema.parse({ ...record(), key: { ...record().key, versionRange: '' } }),
    ).toThrow();
  });
});

describe('support level derivation is evidence-driven, never optimistic', () => {
  it('returns none when there is no evidence at all', () => {
    expect(classifySupportLevel({ positiveCases: 0, negativeCases: 0, hasPatchCase: false, hasNativeProof: false })).toBe('none');
  });

  it('returns L1 only with both a positive and a negative case', () => {
    expect(classifySupportLevel({ positiveCases: 1, negativeCases: 0, hasPatchCase: false, hasNativeProof: false })).toBe('none');
    expect(classifySupportLevel({ positiveCases: 1, negativeCases: 1, hasPatchCase: false, hasNativeProof: false })).toBe('L1');
  });

  it('returns L2 with a patch case but refuses L3 without native proof', () => {
    const l2 = { positiveCases: 1, negativeCases: 1, hasPatchCase: true, hasNativeProof: false };
    expect(classifySupportLevel(l2)).toBe('L2');

    const l3 = { positiveCases: 2, negativeCases: 1, hasPatchCase: true, hasNativeProof: false };
    expect(classifySupportLevel(l3)).toBe('L2');
  });

  it('returns L3 only with two distinct positive patterns and native proof', () => {
    expect(
      classifySupportLevel({ positiveCases: 2, negativeCases: 1, hasPatchCase: true, hasNativeProof: true }),
    ).toBe('L3');
  });

  it('does not promote on compilation alone', () => {
    expect(
      classifySupportLevel({ positiveCases: 1, negativeCases: 1, hasPatchCase: true, hasNativeProof: false }),
    ).not.toBe('L3');
  });
});
