import { z } from 'zod';

import { InstantSchema, NonEmptyStringSchema, Sha256Schema } from '../primitives.js';

/**
 * TB-scale / cross-engine migration contracts (WP3-33, MVP §20, NEG3-05/40).
 *
 * A volume profile pins the declared logical bytes (10^12 for the TB
 * profile), the exact source/target engine versions, and the active-writer
 * envelope. Logical bytes are counted from actual chunk payloads —
 * compression or sparse apparent size never counts. Cross-engine type
 * mappings pin precision rules so a narrowing conversion is refused before
 * any row moves. Transfer labels enforce NEG3-40: `qualified` requires the
 * declared volume, reconciliation, and independent proof together.
 */

export const TB_BYTES = 1_000_000_000_000;

export const VolumeProfileSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    profileId: NonEmptyStringSchema,
    declaredLogicalBytes: z.number().int().positive(),
    sourceEngine: NonEmptyStringSchema,
    sourceVersion: NonEmptyStringSchema,
    targetEngine: NonEmptyStringSchema,
    targetVersion: NonEmptyStringSchema,
    crossEngine: z.boolean(),
    activeWriters: z.strictObject({
      writers: z.number().int().positive(),
      opsPerWriter: z.number().int().positive(),
    }),
    frozenAt: InstantSchema,
    digest: Sha256Schema,
  })
  .superRefine((profile, ctx) => {
    if (
      profile.crossEngine &&
      profile.sourceEngine === profile.targetEngine &&
      profile.sourceVersion === profile.targetVersion
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['crossEngine'],
        message: 'A cross-engine profile must name engines or versions that differ.',
      });
    }
  });
export type VolumeProfile = z.infer<typeof VolumeProfileSchema>;

export const TransferChunkSchema = z.strictObject({
  chunkId: NonEmptyStringSchema,
  rows: z.number().int().nonnegative(),
  logicalBytes: z.number().int().nonnegative(),
  checksum: Sha256Schema,
});
export type TransferChunk = z.infer<typeof TransferChunkSchema>;

export const TypeMappingSchema = z.strictObject({
  sourceType: NonEmptyStringSchema,
  targetType: NonEmptyStringSchema,
  rule: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('exact-decimal'),
      sourcePrecision: z.number().int().positive(),
      sourceScale: z.number().int().nonnegative(),
      targetPrecision: z.number().int().positive(),
      targetScale: z.number().int().nonnegative(),
    }),
    z.strictObject({
      kind: z.literal('widening-integer'),
      sourceBits: z.number().int().positive(),
      targetBits: z.number().int().positive(),
    }),
    z.strictObject({ kind: z.literal('utf8-text') }),
  ]),
});
export type TypeMapping = z.infer<typeof TypeMappingSchema>;

export const TransferLabelSchema = z.enum(['probe-only', 'qualified']);
export type TransferLabel = z.infer<typeof TransferLabelSchema>;

export const TransferReceiptSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  profileDigest: Sha256Schema,
  chunks: z.array(TransferChunkSchema),
  totalLogicalBytes: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative(),
  reconciled: z.boolean(),
  independentlyReproduced: z.boolean(),
  label: TransferLabelSchema,
  reportedAt: InstantSchema,
});
export type TransferReceipt = z.infer<typeof TransferReceiptSchema>;
