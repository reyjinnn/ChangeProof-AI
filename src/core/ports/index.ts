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
import type {
  RepositoryConnection,
  TenantContext,
} from '../contracts/schemas/hosted.js';
import type { ExecutionMode } from '../contracts/vocabulary.js';

/** A snapshot of customer source, pinned to an immutable identity. */
export interface SourceSnapshotPort {
  readonly snapshotId: string;
  readonly repository: string;
  readonly commit: string;
  /** Digest of the exact bytes that were pinned. */
  readonly digest: string;
}

/**
 * Provider-neutral repository surface (FR3-45).
 *
 * GitLab and Bitbucket adapters implement this port; the GitHub App client
 * stays the mandatory provider-specific adapter. Every call first asserts an
 * `active` connection of the matching provider with the repository
 * allowlisted — revocation and provider mismatch fail before any network
 * happens. Webhook payloads are triggers only: effects derive from exact
 * state re-read over the authenticated API, never from the event body.
 */
export type RepositoryProvider = 'github' | 'gitlab' | 'bitbucket';

export interface ProviderRepositoryRef {
  readonly id: string;
  /** Provider-local path: `group/project` (GitLab) or `workspace/repo` (Bitbucket). */
  readonly path: string;
}

export interface ProviderCommit {
  readonly sha: string;
  readonly message: string;
  readonly committedAt: string;
}

export interface ProviderBranchHead {
  readonly sha: string;
}

export interface ProviderMergeRequest {
  readonly id: string;
  readonly url: string;
  readonly headSha: string;
  readonly state: string;
}

export interface ProviderRepository {
  readonly id: string;
  readonly fullName: string;
  readonly isPrivate: boolean;
}

export interface ProviderPipelineStatus {
  readonly sha: string;
  readonly pipelineId: string;
  readonly status: string;
  readonly fetchedAt: string;
}

export interface ProviderCommitInput {
  readonly connection: RepositoryConnection;
  readonly repository: ProviderRepositoryRef;
  readonly sha: string;
}

export interface ProviderHeadInput {
  readonly connection: RepositoryConnection;
  readonly repository: ProviderRepositoryRef;
  readonly branch: string;
}

export interface ProviderOpenRequestInput {
  readonly connection: RepositoryConnection;
  readonly repository: ProviderRepositoryRef;
  readonly base: string;
  readonly head: string;
  readonly title: string;
  readonly body: string;
}

export interface ProviderFindRequestInput {
  readonly connection: RepositoryConnection;
  readonly repository: ProviderRepositoryRef;
  readonly head: string;
}

export interface ProviderScopeInput {
  readonly connection: RepositoryConnection;
}

export interface ProviderPipelineInput {
  readonly connection: RepositoryConnection;
  readonly repository: ProviderRepositoryRef;
  readonly sha: string;
  readonly nowIso: string;
}

export interface RepositoryProviderPort {
  readonly provider: RepositoryProvider;
  fetchCommit(input: ProviderCommitInput): Promise<ProviderCommit>;
  fetchBranchHead(input: ProviderHeadInput): Promise<ProviderBranchHead>;
  openMergeRequest(input: ProviderOpenRequestInput): Promise<ProviderMergeRequest>;
  findRequestByHead(input: ProviderFindRequestInput): Promise<ProviderMergeRequest | null>;
  listAccessibleRepositories(input: ProviderScopeInput): Promise<readonly ProviderRepository[]>;
  /** CI status bound to the exact head sha; a different sha is a refusal, not an attestation. */
  fetchHeadPipeline(input: ProviderPipelineInput): Promise<ProviderPipelineStatus>;
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

/**
 * Outbound email delivery (FR3-38).
 *
 * The store composes the recipient, subject, and plaintext body (which
 * carries the single-use token); link assembly around the token is
 * presentation work for the HTTP layer. Implementations return the transport
 * acceptance receipt. Bodies are ASCII-only: non-ASCII content fails closed
 * rather than sending mojibake.
 */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly textBody: string;
}

export interface EmailDeliveryReceipt {
  readonly messageId: string;
  readonly acceptedAt: string;
}

export interface EmailDeliveryPort {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt>;
}

/**
 * Versioned model client (FR3-07).
 *
 * The single seam between the reasoning engine and any model provider. The
 * client sends allowlisted context with recorded prompt/config/model IDs,
 * revalidates every response, and raises typed failures for outages,
 * malformed responses, and missing tool calls. Provider fallback happens
 * only through explicit configuration. The model never becomes a verifier
 * or verdict authority: its output is an untrusted proposal.
 */
export interface ModelMessage {
  readonly role: 'system' | 'user' | 'tool';
  /** Origin label for context-allowlist filtering; absent means broker-owned. */
  readonly source?: string;
  readonly content: string;
}

export interface ModelTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema text for the tool arguments. */
  readonly parameters: string;
}

export interface ModelToolCall {
  readonly name: string;
  /** JSON text; validated parseable, never executed blindly. */
  readonly arguments: string;
}

export interface ModelCompleteInput {
  readonly promptId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelTool[];
  readonly maxTokens: number;
  readonly requireToolCall: boolean;
  /** Sources allowed into context; absent admits broker-owned content only. */
  readonly contextAllowlist?: readonly string[];
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelCompleteResult {
  readonly model: string;
  readonly outputText: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly usage: ModelUsage;
  readonly providerRequestId: string;
  readonly promptId: string;
  readonly configId: string;
  readonly usedFallback: boolean;
  readonly droppedContextMessages: number;
  readonly cumulativeTokens: number;
}

export interface ModelClientPort {
  readonly provider: string;
  readonly contractVersion: string;
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult>;
}

/**
 * Run-lifecycle seams (FR3-31, WP3-25).
 *
 * The lifecycle store re-derives the session context on every call and
 * reserves/enqueues through these ports; the orchestrator binds them to the
 * identity, usage, jobs, and evidence stores. No port passes credentials,
 * source bytes, or verdicts — only opaque IDs, digests, and amounts.
 */
export interface LifecycleSessionPort {
  deriveContext(input: { sessionId: string; nowIso: string }): Promise<TenantContext>;
}

export interface LifecycleUsagePort {
  reserveRun(input: {
    tenantId: string;
    runId: string;
    reservationId: string;
    effectId: string;
    requested: number;
    nowIso: string;
  }): Promise<{ reservationId: string; reserved: number; duplicate: boolean }>;
}

export interface LifecycleJobsPort {
  enqueueRun(input: {
    runId: string;
    jobId: string;
    tenantId: string;
    idempotencyKey: string;
    reservationId: string;
    nowIso: string;
  }): Promise<{ runId: string; jobId: string; duplicate: boolean }>;
  requestJobCancel(input: { tenantId: string; jobId: string; nowIso: string }): Promise<void>;
}

export interface LifecycleEvidencePort {
  fetchArtifact(digest: string): Uint8Array;
}

/** Budgeted reproduction: re-execute an immutable submit under a new request identity. */
export interface LifecycleReproPort {
  retryRun(
    actor: { sessionId: string; nowIso: string },
    retry: { runId: string; idempotencyKey: string },
  ): Promise<{ runId: string; jobId: string; reservationId: string; submitDigest: string; duplicate: boolean }>;
}

/**
 * Support-access authority (FR3-41, WP3-30).
 *
 * Read paths consult active support grants for operator actors; every
 * grant-authorized read is logged. Membership roles never need this port.
 */
export interface SupportGrantScope {
  readonly grantId: string;
  readonly resourceType: 'run' | 'project' | 'repository' | 'evidence';
  readonly resourceId: string;
}

export interface SupportAccessPort {
  listActiveScopes(
    tenantId: string,
    userId: string,
    nowIso: string,
  ): Promise<readonly SupportGrantScope[]>;
  logAccess(input: {
    tenantId: string;
    userId: string;
    grantId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    nowIso: string;
  }): Promise<void>;
}

/** Mention fan-out from collaboration to the notifications inbox. */
export interface MentionNotifyPort {
  notifyMention(input: {
    tenantId: string;
    eventId: string;
    userId: string;
    threadId: string;
    runId: string;
    mentionedBy: string;
    nowIso: string;
  }): Promise<void>;
}
