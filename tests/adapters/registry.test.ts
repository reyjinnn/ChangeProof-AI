import { describe, expect, it } from 'vitest';

import {
  CapabilityRecordSchema,
  ECOSYSTEMS,
  UnsupportedCapabilityError,
  type CapabilityKey,
} from '../../src/core/index.js';
import { AdapterRegistry } from '../../src/modules/adapters/index.js';

/**
 * WP3-03 / T1-4 — capability registry negatives (NEG3-09, NEG3-02).
 *
 * Written before the implementation. The load-bearing rule is that a capability
 * record must never claim a level it has not been evidenced for, and that an
 * unsupported tuple resolves to an explicit refusal rather than a generic
 * "verified" fallback.
 */

const adapterVersion = '1.0.0';

function key(overrides: Partial<CapabilityKey> = {}): CapabilityKey {
  return {
    ecosystem: 'typescript',
    language: 'typescript',
    framework: 'next',
    versionRange: '>=15.0.0 <16.0.0',
    componentKind: 'frontend',
    changeCategory: 'api-contract',
    featureRestrictions: [],
    runnerProfile: 'node-linux',
    adapterVersion,
    ...overrides,
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '2',
    key: key(),
    targetLevel: 'L3',
    provenLevel: 'none',
    certificationStatus: 'uncertified',
    evidenceRefs: [],
    limitations: [],
    toolchainIdentities: {},
    ...overrides,
  };
}

describe('registry registers all five ecosystems', () => {
  it('declares the five required ecosystems', () => {
    expect(ECOSYSTEMS).toEqual(['typescript', 'python', 'go', 'php', 'dotnet']);
  });

  it('accepts a record for each ecosystem', () => {
    for (const ecosystem of ECOSYSTEMS) {
      const parsed = CapabilityRecordSchema.parse(
        record({
          key: key({ ecosystem, language: ecosystem, framework: 'generic', componentKind: 'backend' }),
        }),
      );
      expect(parsed.key.ecosystem).toBe(ecosystem);
      expect(parsed.provenLevel).toBe('none');
    }
  });
});

describe('targetLevel and provenLevel are separate (NEG3-09)', () => {
  it('starts a fresh record at provenLevel none', () => {
    const parsed = CapabilityRecordSchema.parse(record());
    expect(parsed.targetLevel).toBe('L3');
    expect(parsed.provenLevel).toBe('none');
    expect(parsed.certificationStatus).toBe('uncertified');
  });

  it('rejects provenLevel above targetLevel', () => {
    expect(() => CapabilityRecordSchema.parse(record({ targetLevel: 'L1', provenLevel: 'L3' }))).toThrow();
  });

  it('rejects a proven level without evidence references', () => {
    expect(() =>
      CapabilityRecordSchema.parse(record({ provenLevel: 'L3', certificationStatus: 'certified', evidenceRefs: [] })),
    ).toThrow();
  });

  it('rejects a "verified" style claim that is not a declared level', () => {
    expect(() => CapabilityRecordSchema.parse(record({ provenLevel: 'verified' }))).toThrow();
    expect(() => CapabilityRecordSchema.parse(record({ provenLevel: 'true' }))).toThrow();
  });

  it('rejects a versionRange that claims every version', () => {
    for (const range of ['*', 'any', 'all', 'latest']) {
      expect(() => CapabilityRecordSchema.parse(record({ key: key({ versionRange: range }) }))).toThrow();
    }
  });
});

describe('lookup refuses unsupported tuples explicitly', () => {
  it('returns a registered record for an exact tuple', () => {
    const registry = new AdapterRegistry([CapabilityRecordSchema.parse(record())]);
    expect(registry.get(key())?.provenLevel).toBe('none');
  });

  it('raises UnsupportedCapabilityError instead of a generic verified fallback', () => {
    const registry = new AdapterRegistry([CapabilityRecordSchema.parse(record())]);

    let caught: unknown;
    try {
      registry.require(key({ framework: 'gatsby' }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnsupportedCapabilityError);
    expect((caught as UnsupportedCapabilityError).reasonCode).toBe('adapter_unsupported');
    expect((caught as UnsupportedCapabilityError).capabilityKey.framework).toBe('gatsby');
  });

  it('refuses to resolve an adapter version that was never registered', () => {
    const registry = new AdapterRegistry([CapabilityRecordSchema.parse(record())]);
    expect(() => registry.require(key({ adapterVersion: '9.9.9' }))).toThrow(UnsupportedCapabilityError);
  });

  it('never reports a provenLevel above none for an unregistered ecosystem', () => {
    const registry = new AdapterRegistry([]);
    // Absent record and a record proven at none must not be conflated with
    // an actual capability claim.
    expect(registry.get(key({ ecosystem: 'dotnet', language: 'csharp' }))).toBeNull();
    expect(registry.listRecords().every((r) => r.provenLevel === 'none')).toBe(true);
  });
});

describe('registry cannot promote a level without evidence', () => {
  it('rejects a promotion that has no evidence reference attached', () => {
    const registry = new AdapterRegistry([CapabilityRecordSchema.parse(record())]);
    expect(() => registry.promote(key(), 'L1', [])).toThrow(/evidence/i);
  });

  it('accepts a promotion backed by evidence and records it', () => {
    const registry = new AdapterRegistry([CapabilityRecordSchema.parse(record())]);
    const updated = registry.promote(key(), 'L1', ['runs/conformance/ts-next-l1.json']);

    expect(updated.provenLevel).toBe('L1');
    expect(updated.evidenceRefs).toContain('runs/conformance/ts-next-l1.json');
  });

  it('refuses to promote above the declared target level', () => {
    const registry = new AdapterRegistry([
      CapabilityRecordSchema.parse(record({ targetLevel: 'L1' })),
    ]);
    expect(() => registry.promote(key({}), 'L3', ['evidence.json'])).toThrow(/target/i);
  });

  it('invalidates certification when the adapter version changes', () => {
    const certified = CapabilityRecordSchema.parse(
      record({ provenLevel: 'L1', certificationStatus: 'certified', evidenceRefs: ['evidence.json'] }),
    );
    const registry = new AdapterRegistry([certified]);

    registry.invalidate(certified.key, 'adapter version changed from 1.0.0 to 1.1.0');

    const after = registry.get(certified.key);
    expect(after?.certificationStatus).toBe('invalidated');
    expect(after?.provenLevel).toBe('none');
    expect(after?.invalidationReason).toContain('adapter version changed');
  });
});

describe('registry output is deterministic', () => {
  it('returns the same record for the same key on repeated reads', () => {
    const registry = new AdapterRegistry([CapabilityRecordSchema.parse(record())]);
    expect(registry.get(key())).toEqual(registry.get(key()));
  });
});
