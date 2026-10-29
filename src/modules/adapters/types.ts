import type { CapabilityKey, CapabilityRecord, SystemGraph } from '../../core/index.js';

/**
 * Shared adapter surface (FR3-02).
 *
 * An adapter provides detect/extract/analyze/planFix/applyPatch/verify through
 * a versioned contract. It never decides a verdict: `verify` produces a check
 * plan for the independent verifier, and the policy module owns the outcome.
 *
 * Unsupported inputs return a typed `unsupported` status. They must never
 * return an empty success, because an empty graph reads as "no impact" and
 * would silently shrink the coverage denominator (NEG3-09).
 */

export const ADAPTER_CONTRACT_VERSION = '1';

export type ExtractStatus = 'ok' | 'unsupported' | 'failed';

export interface AdapterExtractInput {
  /** Root of the bounded snapshot to read. */
  readonly root: string;
  /** Files within the snapshot to read. */
  readonly files: readonly string[];
  /** Pinned toolchain identity that produced this extraction. */
  readonly version: string;
  /** The capability tuple this extraction was performed under. */
  readonly capability: CapabilityRecord;
  /** JVM adapters need to know which language the sources are in. */
  readonly language?: string;
}

export interface AdapterExtractResult {
  readonly status: ExtractStatus;
  readonly graph: SystemGraph;
  /** Unknowns the extractor could not resolve. Never dropped from the output. */
  readonly unknowns: readonly string[];
  /** Surfaces this adapter does not support at all. */
  readonly unsupportedSurfaces: readonly string[];
  /** Non-fatal diagnostics. */
  readonly diagnostics: readonly string[];
  /** The native toolchain identity that produced this result. */
  readonly toolchainIdentity: string;
}

export interface AdapterDefinition {
  readonly name: string;
  readonly contractVersion: string;
  readonly key: CapabilityKey;
  readonly records: readonly CapabilityRecord[];
  extract(input: AdapterExtractInput): Promise<AdapterExtractResult>;
}

/** Snapshot identity used by graph nodes and edges produced in one run. */
export function snapshotId(root: string, version: string): string {
  return `snap-${version}-${root.replace(/[^a-zA-Z0-9]/g, '').slice(-16)}`;
}
