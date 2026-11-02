import type {
  AdapterCheckPlan,
  AdapterFixRequest,
  AdapterFixStatus,
  AdapterPatch,
  CapabilityKey,
  CapabilityRecord,
  SystemGraph,
} from '../../core/index.js';

/**
 * Shared adapter surface (FR3-02).
 *
 * An adapter provides extract/planFix/applyPatch/planChecks through a
 * versioned contract. It never decides a verdict: `planChecks` produces a
 * check plan for the independent verifier, and the policy module owns the
 * outcome. Detection and analysis live in the `detector`/`analyzer` modules.
 *
 * Unsupported inputs return a typed `unsupported` status. They must never
 * return an empty success, because an empty graph reads as "no impact" and
 * would silently shrink the coverage denominator (NEG3-09).
 */

export const ADAPTER_CONTRACT_VERSION = '3';

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

export interface AdapterPlanFixInput {
  readonly root: string;
  readonly files: readonly string[];
  readonly version: string;
  readonly capability: CapabilityRecord;
  readonly request: AdapterFixRequest;
}

export interface AdapterPlanFixResult {
  readonly status: AdapterFixStatus;
  readonly patch: AdapterPatch | null;
  readonly unknowns: readonly string[];
  readonly unsupportedSurfaces: readonly string[];
  readonly diagnostics: readonly string[];
}

/**
 * One gateway authorization, as validated data.
 *
 * The orchestrator authorizes every patch operation through the typed gateway
 * and hands the decisions here; the adapter refuses any operation without a
 * matching authorization. No gateway import, no callback handle — the decision
 * is data, and the adapter checks coverage, not policy.
 */
export interface AdapterApplyAuthorization {
  readonly operation: 'write';
  readonly path: string;
  readonly authorizedRoot: string;
}

export interface AdapterApplyInput {
  readonly root: string;
  readonly patch: AdapterPatch;
  readonly authorizations: readonly AdapterApplyAuthorization[];
}

export interface AdapterApplyResult {
  readonly applied: readonly string[];
  readonly patchDigest: string;
}

export interface AdapterPlanChecksInput {
  readonly root: string;
  readonly patch: AdapterPatch;
  readonly capability: CapabilityRecord;
  readonly request: AdapterFixRequest;
  readonly runnerIdentity: string;
  readonly version: string;
}

export interface AdapterDefinition {
  readonly name: string;
  readonly contractVersion: string;
  readonly key: CapabilityKey;
  readonly records: readonly CapabilityRecord[];
  extract(input: AdapterExtractInput): Promise<AdapterExtractResult>;
  planFix(input: AdapterPlanFixInput): Promise<AdapterPlanFixResult>;
  applyPatch(input: AdapterApplyInput): Promise<AdapterApplyResult>;
  planChecks(input: AdapterPlanChecksInput): Promise<AdapterCheckPlan>;
}

/** Snapshot identity used by graph nodes and edges produced in one run. */
export function snapshotId(root: string, version: string): string {
  return `snap-${version}-${root.replace(/[^a-zA-Z0-9]/g, '').slice(-16)}`;
}
