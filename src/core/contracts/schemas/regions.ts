import { z } from 'zod';

import { NonEmptyStringSchema, Sha256Schema } from '../primitives.js';

/**
 * Multi-region campaign contracts (WP3-19, FR3-26/27).
 *
 * A region campaign binds an `ExperimentPlan` hash to a frozen topology,
 * fault schedule, consistency expectations, and RPO/RTO bounds. Receipts
 * record what actually happened per trial — roles, journal evidence, heal
 * proof, measured loss and restore time — and the reducer turns them into
 * per-check verdicts plus a qualification label.
 *
 * The qualification label enforces NEG3-40 in code: a single-host probe
 * reports `probe-only` even when every check is green. Only complete,
 * all-green evidence from provisioned regions reports `qualified`.
 */

export const RegionRoleSchema = z.enum(['primary', 'replica', 'witness']);
export type RegionRole = z.infer<typeof RegionRoleSchema>;

export const RegionProvenanceSchema = z
  .strictObject({
    kind: z.enum(['provisioned-regions', 'single-host-probe']),
    detail: NonEmptyStringSchema,
  })
  .describe('Where the topology actually runs; probes never qualify');
export type RegionProvenance = z.infer<typeof RegionProvenanceSchema>;

export const RegionTopologySchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    topologyId: NonEmptyStringSchema,
    regions: z
      .array(
        z.strictObject({
          regionId: NonEmptyStringSchema,
          role: RegionRoleSchema,
          endpointRef: NonEmptyStringSchema,
        }),
      )
      .min(2),
    provenance: RegionProvenanceSchema,
    consistencyClaimed: z.enum(['linearizable', 'sequential', 'causal', 'eventual', 'unknown']),
    clockSource: NonEmptyStringSchema,
  })
  .describe('Frozen multi-region topology; at least two regions or it is not multi-region');
export type RegionTopology = z.infer<typeof RegionTopologySchema>;

export const RegionFaultSchema = z
  .strictObject({
    faultId: NonEmptyStringSchema,
    kind: z.enum(['partition', 'failover', 'clock-skew']),
    /** Region ids or `a-b` links; resolved against the frozen topology. */
    targets: z.array(NonEmptyStringSchema).min(1),
    startAfterMs: z.number().int().nonnegative(),
    durationMs: z.number().int().gt(0),
    heal: z.strictObject({
      kind: z.enum(['reconnect', 'promote', 'resync']),
      verifyWithinMs: z.number().int().gt(0),
    }),
  })
  .describe('One frozen fault with its heal step and verification bound');
export type RegionFault = z.infer<typeof RegionFaultSchema>;

export const RegionCampaignSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planId: NonEmptyStringSchema,
    /** Binds the ExperimentPlan this region layer rides with. */
    planHash: Sha256Schema,
    topology: RegionTopologySchema,
    faults: z.array(RegionFaultSchema).min(1),
    trials: z.number().int().gt(0),
    workload: z.strictObject({
      writesPerTrial: z.number().int().gt(0),
      writeRegion: NonEmptyStringSchema,
      readRegions: z.array(NonEmptyStringSchema).min(1),
    }),
    orderingBound: z.strictObject({
      maxSeqGap: z.number().int().nonnegative(),
      maxDuplicates: z.number().int().nonnegative(),
    }),
    rpoBound: z.strictObject({ maxLostAckedWrites: z.number().int().nonnegative() }),
    rtoBound: z.strictObject({ maxRestoreMs: z.number().int().gt(0) }),
    frozenAt: z.iso.datetime({ offset: true }),
    digest: Sha256Schema,
  })
  .describe('Frozen region campaign; digest binds every byte except itself');
export type RegionCampaign = z.infer<typeof RegionCampaignSchema>;

export const RegionJournalSchema = z
  .strictObject({
    writesAttempted: z.number().int().nonnegative(),
    writesAcked: z.number().int().nonnegative(),
    writesPresentAfter: z.number().int().nonnegative(),
    maxSeqGap: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
  })
  .describe('Journal evidence observed across the read regions');
export type RegionJournal = z.infer<typeof RegionJournalSchema>;

export const RegionTrialReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planDigest: Sha256Schema,
    trialIndex: z.number().int().nonnegative(),
    faultId: NonEmptyStringSchema,
    faultApplied: z.boolean(),
    faultHealed: z.boolean(),
    healVerified: z.boolean(),
    rolesBefore: z.record(z.string(), RegionRoleSchema),
    rolesAfter: z.record(z.string(), RegionRoleSchema),
    journal: RegionJournalSchema,
    measuredRpoLostWrites: z.number().int().nonnegative(),
    /** Null when writes never restored inside the verification bound. */
    measuredRtoMs: z.number().int().nonnegative().nullable(),
    resyncBy: z.string().min(1).optional(),
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }),
  })
  .describe('What one region trial actually did; resync authorship is explicit');
export type RegionTrialReceipt = z.infer<typeof RegionTrialReceiptSchema>;

export const RegionCheckSchema = z
  .strictObject({
    id: NonEmptyStringSchema,
    trialIndex: z.number().int().nonnegative(),
    faultId: NonEmptyStringSchema,
    pass: z.boolean(),
    detail: NonEmptyStringSchema,
  })
  .describe('One consistency verdict; no averaging across checks');
export type RegionCheck = z.infer<typeof RegionCheckSchema>;

export const ConsistencyReportSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    planDigest: Sha256Schema,
    checks: z.array(RegionCheckSchema),
    qualification: z.enum(['qualified', 'probe-only', 'invalid']),
    reasons: z.array(NonEmptyStringSchema),
  })
  .describe('Per-check verdicts plus the enforced qualification label');
export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;
