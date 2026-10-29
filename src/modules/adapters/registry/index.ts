import {
  CapabilityRecordSchema,
  UnsupportedCapabilityError,
  type CapabilityKey,
  type CapabilityRecord,
  type ProvenLevel,
} from '../../../core/index.js';

/** Registry for trusted, explicitly-versioned adapter capabilities. */
function keyOf(key: CapabilityKey): string {
  return JSON.stringify([
    key.ecosystem,
    key.language,
    key.framework,
    key.versionRange,
    key.componentKind,
    key.changeCategory,
    [...key.featureRestrictions].sort(),
    key.runnerProfile,
    key.adapterVersion,
  ]);
}

const LEVEL_RANK: Record<ProvenLevel, number> = { none: 0, L1: 1, L2: 2, L3: 3 };

export class AdapterRegistry {
  private readonly records = new Map<string, CapabilityRecord>();

  constructor(initial: readonly CapabilityRecord[] = []) {
    for (const candidate of initial) {
      const record = CapabilityRecordSchema.parse(candidate);
      const id = keyOf(record.key);
      if (this.records.has(id)) {
        throw new Error(`Duplicate adapter capability tuple: ${describeKey(record.key)}`);
      }
      this.records.set(id, record);
    }
  }

  get(key: CapabilityKey): CapabilityRecord | null {
    return this.records.get(keyOf(key)) ?? null;
  }

  require(key: CapabilityKey): CapabilityRecord {
    const record = this.get(key);
    if (record === null) {
      throw new UnsupportedCapabilityError(
        `No registered adapter for ${describeKey(key)}. Register the exact tuple in trusted configuration.`,
        {
          ecosystem: key.ecosystem,
          language: key.language,
          framework: key.framework,
          versionRange: key.versionRange,
          componentKind: key.componentKind,
          changeCategory: key.changeCategory,
          runnerProfile: key.runnerProfile,
          adapterVersion: key.adapterVersion,
        },
      );
    }
    return record;
  }

  listRecords(): readonly CapabilityRecord[] {
    return [...this.records.values()].sort((left, right) => keyOf(left.key).localeCompare(keyOf(right.key)));
  }

  promote(key: CapabilityKey, level: ProvenLevel, evidenceRefs: readonly string[]): CapabilityRecord {
    const current = this.require(key);
    if (evidenceRefs.length === 0) {
      throw new Error(`Cannot promote ${describeKey(key)} without evidence references.`);
    }
    if (LEVEL_RANK[level] > LEVEL_RANK[current.targetLevel]) {
      throw new Error(`Cannot promote ${describeKey(key)} to ${level}: targetLevel is ${current.targetLevel}.`);
    }

    const updated = CapabilityRecordSchema.parse({
      ...current,
      provenLevel: level,
      certificationStatus: level === 'none' ? 'uncertified' : 'certified',
      evidenceRefs: [...new Set([...current.evidenceRefs, ...evidenceRefs])],
      ...(level === 'none' ? { certifiedAt: undefined } : { certifiedAt: new Date().toISOString() }),
    });
    this.records.set(keyOf(updated.key), updated);
    return updated;
  }

  invalidate(key: CapabilityKey, reason: string): CapabilityRecord {
    if (reason.trim().length === 0) throw new Error('Invalidation requires a specific reason.');
    const current = this.require(key);
    const updated = CapabilityRecordSchema.parse({
      ...current,
      provenLevel: 'none',
      certificationStatus: 'invalidated',
      invalidationReason: reason,
      evidenceRefs: [],
      certifiedAt: undefined,
    });
    this.records.set(keyOf(updated.key), updated);
    return updated;
  }
}

function describeKey(key: CapabilityKey): string {
  return `${key.ecosystem}/${key.framework} (${key.versionRange}, ${key.componentKind}/${key.changeCategory}, profile=${key.runnerProfile}, adapter=${key.adapterVersion})`;
}
