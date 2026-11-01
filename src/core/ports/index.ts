/**
 * Ports in core.
 *
 * AGENTS.md §5: leaf modules may only import `core`. Cross-module collaboration
 * goes through ports defined here, with implementations wired by the
 * orchestrator. A port is a contract, never a concrete I/O handle: no AST
 * objects, no runtime handles, no driver instances.
 *
 * Phase-1 declares the ports the engine depends on. Implementations arrive with
 * the owning modules; the declaration itself is what keeps the import matrix
 * enforceable.
 */

import type { CapabilityKey, CapabilityRecord } from '../contracts/schemas/capability.js';
import type { SystemGraph } from '../contracts/schemas/graph.js';
import type { ExperimentPlan, TrialReceipt } from '../contracts/schemas/campaign.js';
import type { ExecutionBudget } from '../contracts/schemas/budget.js';
import type { ExecutionMode } from '../contracts/vocabulary.js';

/** A snapshot of customer source, pinned to an immutable identity. */
export interface SourceSnapshotPort {
  readonly snapshotId: string;
  readonly repository: string;
  readonly commit: string;
  /** Digest of the exact bytes that were pinned. */
  readonly digest: string;
}

/** Adapter surface (FR3-02). Adapters never decide the verdict. */
export interface AdapterPort {
  readonly contractVersion: string;
  detect(snapshot: SourceSnapshotPort): Promise<DetectionResult>;
  extract(snapshot: SourceSnapshotPort, scope: readonly string[]): Promise<ExtractionResult>;
}

export interface DetectionResult {
  detected: boolean;
  capabilityKey: CapabilityKey | null;
  version: string | null;
  confidence: number;
  evidenceRefs: readonly string[];
}

export interface ExtractionResult {
  graph: SystemGraph;
  unsupportedSurfaces: readonly string[];
  diagnostics: readonly string[];
}

/** Capability registry (FR3-03). Registered adapters only; never a customer repo. */
export interface CapabilityRegistryPort {
  get(key: CapabilityKey): CapabilityRecord | null;
  list(): readonly CapabilityRecord[];
}

/** Verifier executes checks and records observations; it does not judge them. */
export interface VerifierPort {
  runStage(input: StageRequest): Promise<StageReceipt>;
}

export interface StageRequest {
  readonly stage: 'baseline_old' | 'baseline_new' | 'attempt_fast' | 'post_fix_full';
  readonly mode: ExecutionMode;
  readonly runnerIdentity: string;
  readonly checks: readonly string[];
}

export interface StageReceipt {
  readonly checkId: string;
  readonly result: 'pass' | 'fail' | 'skipped' | 'error';
  readonly required: boolean;
  readonly detail?: string;
  readonly durationMs?: number;
}

/** Campaign runner: pre-registered plan in, all-trial receipts out. */
export interface CampaignRunnerPort {
  run(plan: ExperimentPlan, budget: ExecutionBudget): Promise<readonly TrialReceipt[]>;
}

/**
 * Configuration access.
 *
 * AGENTS.md §3 rule 8 and NFR3-08: a missing tool, credential or config must
 * raise a specific actionable error, never silently default. Implementations
 * are required to throw rather than return a substitute.
 */
export interface ConfigurationPort {
  require(key: string): string;
  optional(key: string): string | null;
}

/**
 * Secret broker (AGENTS.md §3 rule 12).
 *
 * Model, provider, and payment credentials are read at call time from the
 * broker and never stored in modules, guests, logs, or contracts. A ref that
 * is unknown or empty throws — there is no default credential. Implementations
 * must never log values or include them in errors.
 */
export interface SecretBrokerPort {
  readCredential(refId: string): Promise<string>;
}

/**
 * Read-only telemetry connector (FR3-25).
 *
 * Connectors read logs/traces/metrics/deploy history within a declared scope
 * and return records plus a query receipt. They never produce causes,
 * verdicts, or oracle content: quality assessment stays in `observability`
 * over validated `IncidentEvidence`. Dropped and truncated reads stay visible
 * as counts — a silent gap is a false-assurance bug.
 */
export interface TelemetryQuery {
  /** Backend-local source name (stream, file, table); never a raw path or URL. */
  readonly source: string;
  readonly sinceIso?: string;
  readonly untilIso?: string;
  readonly limit: number;
}

export interface TelemetryRecord {
  readonly eventAt: string;
  readonly observedAt: string;
  readonly traceId?: string;
  readonly operationId?: string;
  readonly spanId?: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface TelemetryPage {
  readonly records: readonly TelemetryRecord[];
  readonly dropped: number;
  readonly truncated: boolean;
  readonly queryReceipt: string;
}

export interface TelemetryConnectorPort {
  readonly backend: string;
  query(query: TelemetryQuery): Promise<TelemetryPage>;
}
