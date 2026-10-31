import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';
import { ProvenLevelSchema, SupportLevelSchema, type ProvenLevel } from '../vocabulary.js';

/**
 * CapabilityRecord — the honest description of what is actually supported
 * (FR3-03).
 *
 * The load-bearing split is `targetLevel` vs `provenLevel`. `targetLevel` is
 * what the product intends to support; `provenLevel` is what evidence has
 * actually demonstrated. A new record starts at `none`, and it may only rise
 * with evidence references attached.
 *
 * The capability key is the tuple the specification names, so a record for
 * "Next.js 15" never implies "Next.js".
 */

export const ECOSYSTEMS = ['typescript', 'python', 'go', 'php', 'dotnet'] as const;
export const EcosystemSchema = z.enum(ECOSYSTEMS);
export type Ecosystem = z.infer<typeof EcosystemSchema>;

export const COMPONENT_KINDS = [
  'frontend',
  'backend',
  'persistence',
  'api',
  'event',
  'cache',
  'build',
  'cli',
] as const;
export const ComponentKindSchema = z.enum(COMPONENT_KINDS);
export type ComponentKind = z.infer<typeof ComponentKindSchema>;

export const CHANGE_CATEGORIES = [
  'api-contract',
  'schema',
  'event',
  'dependency',
  'config',
  'behavior',
  'performance',
  'migration',
] as const;
export const ChangeCategorySchema = z.enum(CHANGE_CATEGORIES);
export type ChangeCategory = z.infer<typeof ChangeCategorySchema>;

export const CertificationStatusSchema = z.enum([
  'uncertified',
  'certified',
  'invalidated',
  'expired',
]);
export type CertificationStatus = z.infer<typeof CertificationStatusSchema>;

export const CapabilityKeySchema = z
  .strictObject({
    ecosystem: EcosystemSchema,
    language: NonEmptyStringSchema,
    framework: NonEmptyStringSchema,
    versionRange: NonEmptyStringSchema,
    componentKind: ComponentKindSchema,
    changeCategory: ChangeCategorySchema,
    featureRestrictions: z.array(NonEmptyStringSchema).default([]),
    runnerProfile: NonEmptyStringSchema,
    adapterVersion: NonEmptyStringSchema,
  })
  .superRefine((key, ctx) => {
    const range = key.versionRange.trim().toLowerCase();
    if (['*', 'any', 'all', 'latest', '>=0'].includes(range)) {
      ctx.addIssue({
        code: 'custom',
        path: ['versionRange'],
        message:
          `versionRange "${key.versionRange}" claims every version. A capability record must name ` +
          'an explicit version or range — AGENTS.md §3 rule 7 forbids "all versions" claims.',
      });
    }
  })
  .describe('The tuple that identifies exactly what is supported');
export type CapabilityKey = z.infer<typeof CapabilityKeySchema>;

export const CapabilityRecordSchema = z
  .strictObject({
    schemaVersion: z.literal('2'),
    key: CapabilityKeySchema,
    targetLevel: SupportLevelSchema,
    provenLevel: ProvenLevelSchema,
    certificationStatus: CertificationStatusSchema,
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
    limitations: z.array(NonEmptyStringSchema).default([]),
    invalidationReason: NonEmptyStringSchema.optional(),
    /** Native toolchain the evidence was produced with, pinned. */
    toolchainIdentities: z.record(z.string(), NonEmptyStringSchema).default({}),
    certifiedAt: z.string().min(1).optional(),
  })
  .superRefine((record, ctx) => {
    const levelRank: Record<string, number> = { none: 0, L1: 1, L2: 2, L3: 3 };
    const provenRank = levelRank[record.provenLevel] ?? -1;
    const targetRank = levelRank[record.targetLevel] ?? -1;
    if (provenRank > targetRank) {
      ctx.addIssue({
        code: 'custom',
        path: ['provenLevel'],
        message:
          `provenLevel "${record.provenLevel}" exceeds targetLevel "${record.targetLevel}". ` +
          'A record cannot prove more than it targets.',
      });
    }

    if (record.provenLevel !== 'none' && record.evidenceRefs.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceRefs'],
        message:
          `provenLevel "${record.provenLevel}" requires evidence references. A level without ` +
          'evidence is a claim, not a capability (AGENTS.md §3 rule 7).',
      });
    }

    if (record.certificationStatus === 'invalidated' && record.invalidationReason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['invalidationReason'],
        message:
          'An invalidated certification must say why. Without a reason the next requalification ' +
          'cannot know what changed.',
      });
    }

    if (record.provenLevel === 'none' && record.certificationStatus === 'certified') {
      ctx.addIssue({
        code: 'custom',
        path: ['certificationStatus'],
        message: 'A record with provenLevel "none" cannot be certified.',
      });
    }
  })
  .describe('What is supported, and what has actually been proven');
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>;

/** Evidence inputs the level derivation consumes. */
export interface CapabilityEvidence {
  positiveCases: number;
  negativeCases: number;
  hasPatchCase: boolean;
  hasNativeProof: boolean;
}

/**
 * Derive the support level that the *evidence* supports.
 *
 * Deliberately conservative. Compilation success is not a patch case, and a
 * patch case is not native proof: "successful compilation = limited evidence,
 * not promotion to L3" (MVP §3). The function never returns a level above what
 * the inputs demonstrate, and returns `none` when the minimum case set for L1
 * is not met.
 */
export function classifySupportLevel(evidence: CapabilityEvidence): ProvenLevel {
  if (evidence.positiveCases < 1 || evidence.negativeCases < 1) {
    return 'none';
  }
  if (!evidence.hasPatchCase) {
    return 'L1';
  }
  if (!evidence.hasNativeProof) {
    return 'L2';
  }
  return evidence.positiveCases >= 2 ? 'L3' : 'L2';
}

/** The five ecosystems that must be registered (MVP §3, as resolved in T-06). */
export const REQUIRED_ECOSYSTEMS = ECOSYSTEMS;

export function capabilityKeyDigestInput(key: CapabilityKey): Record<string, string> {
  return {
    ecosystem: key.ecosystem,
    language: key.language,
    framework: key.framework,
    versionRange: key.versionRange,
    componentKind: key.componentKind,
    changeCategory: key.changeCategory,
    featureRestrictions: key.featureRestrictions.join(','),
    runnerProfile: key.runnerProfile,
    adapterVersion: key.adapterVersion,
  };
}

export const CapabilityIdentitySchema = z.strictObject({
  key: CapabilityKeySchema,
  digest: Sha256Schema,
});

export const CapabilityIdSchema = IdSchema;
