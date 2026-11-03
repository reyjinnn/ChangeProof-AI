import { createHash } from 'node:crypto';

import {
  ChangeProofError,
  InstantSchema,
  NonEmptyStringSchema,
  TransferChunkSchema,
  TypeMappingSchema,
  VolumeProfileSchema,
  type TransferChunk,
  type TransferLabel,
  type TypeMapping,
  type VolumeProfile,
} from '../../core/index.js';

import { z } from 'zod';

/**
 * TB-scale / cross-engine transfer mechanics (WP3-33, MVP §20).
 *
 * The byte ledger counts logical bytes from actual chunk payloads only, so
 * a small dataset can never pass as TB proof (NEG3-40). Type mappings are
 * checked before any row moves: a narrowing conversion is refused, and
 * decimal samples must fit the target precision exactly (NEG3-05).
 * Reconciliation reuses the migration integrity report — row counts,
 * per-tenant splits, and checksums must all agree or a data-integrity
 * failure is recorded instead of a fix. `qualified` additionally requires
 * independent reproduction, which phase-7 owns.
 */

export const IntegrityCheckSchema = z.strictObject({
  name: z.string().min(1),
  expected: z.string(),
  actual: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
});
export type IntegrityCheck = z.infer<typeof IntegrityCheckSchema>;

export const IntegrityReportSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  migrationId: z.string().min(1),
  passed: z.boolean(),
  checks: z.array(IntegrityCheckSchema).min(1),
});
export type IntegrityReport = z.infer<typeof IntegrityReportSchema>;

export class MigrationIntegrityError extends ChangeProofError {
  readonly report: IntegrityReport;

  constructor(report: IntegrityReport) {
    const failing = report.checks.filter((check) => !check.passed).map((check) => check.name);
    super(
      `Migration "${report.migrationId}" failed data-integrity verification: ${failing.join(', ')}. ` +
        'No fix is claimed; the full report is attached.',
    );
    this.name = 'MigrationIntegrityError';
    this.report = report;
  }
}

function digestOf(body: object): string {
  return createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
}

export function freezeVolumeProfile(input: {
  profileId: string;
  declaredLogicalBytes: number;
  sourceEngine: string;
  sourceVersion: string;
  targetEngine: string;
  targetVersion: string;
  crossEngine: boolean;
  activeWriters: { writers: number; opsPerWriter: number };
  frozenAt: string;
}): VolumeProfile {
  const staged = VolumeProfileSchema.parse({
    schemaVersion: '1',
    profileId: NonEmptyStringSchema.parse(input.profileId),
    declaredLogicalBytes: input.declaredLogicalBytes,
    sourceEngine: NonEmptyStringSchema.parse(input.sourceEngine),
    sourceVersion: NonEmptyStringSchema.parse(input.sourceVersion),
    targetEngine: NonEmptyStringSchema.parse(input.targetEngine),
    targetVersion: NonEmptyStringSchema.parse(input.targetVersion),
    crossEngine: input.crossEngine,
    activeWriters: { ...input.activeWriters },
    frozenAt: InstantSchema.parse(input.frozenAt),
    digest: '0'.repeat(64),
  });
  const body: Record<string, unknown> = { ...staged };
  delete body['digest'];
  return VolumeProfileSchema.parse({ ...body, digest: digestOf(body) });
}

export function verifyVolumeProfile(profile: unknown): VolumeProfile {
  const parsed = VolumeProfileSchema.parse(profile);
  const { digest, ...body } = parsed;
  if (digestOf(body) !== digest) {
    throw new ChangeProofError('Volume profile drifted from its frozen digest; the proof is invalid.');
  }
  return parsed;
}

/** Counts payload bytes only; apparent file size never enters the ledger. */
export class ByteLedger {
  private readonly profile: VolumeProfile;
  private readonly chunks: TransferChunk[] = [];

  constructor(profile: VolumeProfile) {
    this.profile = verifyVolumeProfile(profile);
  }

  recordChunk(chunk: unknown): void {
    const parsed = TransferChunkSchema.parse(chunk);
    if (this.chunks.some((seen) => seen.chunkId === parsed.chunkId)) {
      throw new ChangeProofError(`Chunk "${parsed.chunkId}" is already recorded; double counting is refused.`);
    }
    this.chunks.push(parsed);
  }

  /** Recorded chunk checksums in record order, for independent recomputation. */
  checksums(): string[] {
    return this.chunks.map((chunk) => chunk.checksum);
  }

  total(): { totalLogicalBytes: number; totalRows: number; chunks: number } {
    return {
      totalLogicalBytes: this.chunks.reduce((sum, chunk) => sum + chunk.logicalBytes, 0),
      totalRows: this.chunks.reduce((sum, chunk) => sum + chunk.rows, 0),
      chunks: this.chunks.length,
    };
  }

  assertDeclaredVolume(): void {
    const { totalLogicalBytes } = this.total();
    if (totalLogicalBytes < this.profile.declaredLogicalBytes) {
      throw new ChangeProofError(
        `Ledger holds ${String(totalLogicalBytes)} logical bytes, below the declared ${String(this.profile.declaredLogicalBytes)}; a small dataset is never TB proof (NEG3-40).`,
      );
    }
  }
}

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** A decimal survives only when it fits the target precision exactly. */
export function assertDecimalPreserved(text: string, precision: number, scale: number): string {
  const match = DECIMAL.exec(text);
  const whole = match?.[2];
  if (whole === undefined) {
    throw new ChangeProofError(`"${text}" is not a plain decimal; refusing.`);
  }
  const fraction = match?.[3] ?? '';
  const digits = `${whole.replace(/^0+(?=\d)/, '')}${fraction}`.replace(/^0+(?=\d)/, '');
  const significant = digits === '' ? 1 : digits.length;
  if (fraction.length > scale) {
    throw new ChangeProofError(`"${text}" exceeds scale ${String(scale)}; precision would be lost (NEG3-05).`);
  }
  if (significant > precision) {
    throw new ChangeProofError(`"${text}" exceeds precision ${String(precision)}; refusing (NEG3-05).`);
  }
  return text;
}

export function assertMappingPreserves(mapping: unknown, samples: readonly string[]): void {
  const parsed: TypeMapping = TypeMappingSchema.parse(mapping);
  if (parsed.rule.kind === 'exact-decimal') {
    if (parsed.rule.targetPrecision < parsed.rule.sourcePrecision || parsed.rule.targetScale < parsed.rule.sourceScale) {
      throw new ChangeProofError(
        `Mapping ${parsed.sourceType} to ${parsed.targetType} narrows precision; refusing (NEG3-05).`,
      );
    }
    for (const sample of samples) {
      assertDecimalPreserved(sample, parsed.rule.targetPrecision, parsed.rule.targetScale);
    }
    return;
  }
  if (parsed.rule.kind === 'widening-integer') {
    if (parsed.rule.targetBits < parsed.rule.sourceBits) {
      throw new ChangeProofError(
        `Mapping ${parsed.sourceType} to ${parsed.targetType} narrows integer width; refusing (NEG3-05).`,
      );
    }
    const limit = 2n ** BigInt(parsed.rule.targetBits - 1);
    for (const sample of samples) {
      let value: bigint;
      try {
        value = BigInt(sample);
      } catch {
        throw new ChangeProofError(`"${sample}" is not an integer; refusing.`);
      }
      if (value < -limit || value >= limit) {
        throw new ChangeProofError(`"${sample}" overflows the target integer width; refusing (NEG3-05).`);
      }
    }
    return;
  }
  for (const sample of samples) {
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(sample)) {
      throw new ChangeProofError('Text holds a lone surrogate; it is not valid UTF-8 (NEG3-05).');
    }
  }
}

export interface TransferCounts {
  readonly total: number;
  readonly byTenant: Readonly<Record<string, number>>;
  readonly checksum: string;
}

export function reconcileTransfer(
  migrationId: string,
  source: TransferCounts,
  target: TransferCounts,
): IntegrityReport {
  const checks = [
    {
      name: 'row-count',
      expected: String(source.total),
      actual: String(target.total),
      passed: source.total === target.total,
    },
    {
      name: 'checksum',
      expected: source.checksum,
      actual: target.checksum,
      passed: source.checksum === target.checksum,
    },
  ];
  const tenants = new Set([...Object.keys(source.byTenant), ...Object.keys(target.byTenant)]);
  for (const tenant of [...tenants].sort()) {
    const expected = source.byTenant[tenant] ?? 0;
    const actual = target.byTenant[tenant] ?? 0;
    checks.push({
      name: `tenant:${tenant}`,
      expected: String(expected),
      actual: String(actual),
      passed: expected === actual,
    });
  }
  const report = IntegrityReportSchema.parse({
    schemaVersion: '1',
    migrationId,
    passed: checks.every((check) => check.passed),
    checks,
  });
  if (!report.passed) {
    throw new MigrationIntegrityError(report);
  }
  return report;
}

export function labelTransfer(
  profile: VolumeProfile,
  totalLogicalBytes: number,
  reconciled: boolean,
  independentlyReproduced: boolean,
): TransferLabel {
  const verified = verifyVolumeProfile(profile);
  if (
    totalLogicalBytes >= verified.declaredLogicalBytes &&
    reconciled &&
    independentlyReproduced
  ) {
    return 'qualified';
  }
  return 'probe-only';
}
