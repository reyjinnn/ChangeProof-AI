export * from './bundle.js';
export * from './configuration.js';
export * from './distribution.js';
export * from './errors.js';
export * from './github-auth.js';
export * from './github-install.js';
export * from './installation-connect.js';
export * from './providers.js';
export * from './publication.js';

export type { GitHubClient } from '../modules/github/index.js';

import {
  type BundleAssessment,
  type EmailDeliveryPort,
  type ModelClientPort,
  type SecretBrokerPort,
  type TargetAssessment,
  type TelemetryConnectorPort,
} from '../core/index.js';
import {
  createGitHubClient,
  octokitTransport,
  type GitHubClient,
} from '../modules/github/index.js';
import {
  assertOracleUnchanged,
  freezeOracle,
} from '../modules/fixtures/index.js';
import {
  assessTelemetryQuality,
  characterizeLegacyBehaviour,
  createFileTelemetryConnector,
  type FileConnectorOptions,
} from '../modules/observability/index.js';
import {
  assertNoLastOwnerLockout,
  createEmailIdentityStore,
  createIdentityStore,
  createSamlStore,
  createScimStore,
  createSmtpDelivery,
  type EmailIdentityDb,
  type EmailIdentityDeps,
  type EmailIdentityStore,
  type IdentityDb,
  type IdentityStore,
  type SmtpDeliveryOptions,
} from '../modules/identity/index.js';
import {
  createJobsStore,
  type JobsDb,
  type JobsStore,
} from '../modules/jobs/index.js';
import {
  createUsageStore,
  type UsageDb,
  type UsageStore,
} from '../modules/usage/index.js';
import {
  authorizeMutation,
  createHypothesisLedger,
  createModelClient,
  modelFetchTransport,
  reviewPatch,
  type ModelClientConfig,
} from '../modules/agent/index.js';
import {
  assessBundle,
  assessTarget,
  type BundleFacts,
  type TargetFacts,
} from '../modules/policy/index.js';
import {
  reduceMatchedWindows,
  summarizeCampaign,
  validateFaultTarget,
  CleanupReceiptSchema,
  GuestRunner,
  QuarantineError,
  MODAL_PROBE_APP,
  runModalProbe,
  type CleanupReceipt,
  type ModalProbeSummary,
  type ModalSpawner,
} from '../modules/verifier/index.js';
import {
  type DependencyBroker,
  assertManifestLockfileMatch,
  planUpgrade,
  type PlanUpgradeRequest,
  type UpgradePlan,
} from '../modules/dependencies/index.js';
import {
  MigrationRunner,
  type MigrationDb,
  type MigrationManifest,
} from '../modules/migrations/index.js';
import {
  assertPublicSafe,
  checkAllDestinations,
  getRoute,
  getSampleReport,
  getTemplate,
  listDesignNotes,
  listReleases,
  listRoutes,
  loadManifestFile,
  loadPublicSiteManifest,
  requestTemplateApply,
  searchFaq,
} from '../modules/publicsite/index.js';
import { createFileEvidenceStore, type EvidenceStore } from '../modules/evidence/index.js';
import {
  createLifecycleStore,
  type LifecycleDb,
  type LifecycleStore,
} from '../modules/lifecycle/index.js';
import {
  createNotificationsStore,
  type NotificationsDb,
  type NotificationsStore,
} from '../modules/notifications/index.js';
import { createQueriesStore, type QueriesDb, type QueriesStore } from '../modules/queries/index.js';
import {
  createCollaborationStore,
  type CollaborationDb,
  type CollaborationStore,
} from '../modules/collaboration/index.js';
import {
  createSupportStore,
  type SupportDb,
  type SupportStore,
} from '../modules/support/index.js';
import {
  AdapterRegistry,
  DOTNET_ADAPTER_RECORD,
  GO_ADAPTER_RECORD,
  GO_FIBER_RECORD,
  PHP_ADAPTER_RECORD,
  PYTHON_ADAPTER_RECORD,
  PYTHON_DJANGO_RECORD,
  PYTHON_PYDANTIC_RECORD,
  PYTHON_SQLALCHEMY_RECORD,
  TYPESCRIPT_ADAPTER_RECORD,
  TYPESCRIPT_EXPRESS_RECORD,
  TYPESCRIPT_FASTIFY_RECORD,
  TYPESCRIPT_NESTJS_RECORD,
  TYPESCRIPT_PRISMA_RECORD,
  TYPESCRIPT_REACT_RECORD,
} from '../modules/adapters/index.js';

/**
 * Composition root (.prepare/architecture.md §3).
 *
 * The orchestrator wires ports and passes already-computed facts to the pure
 * policy reducer. It does not interpret framework details, inspect source,
 * decide a verdict, or call external services directly.
 */
export interface Phase1Composition {
  assessTarget(facts: TargetFacts): TargetAssessment;
  assessBundle(facts: BundleFacts): BundleAssessment;
}

export function composePhase1(): Phase1Composition {
  return {
    assessTarget,
    assessBundle,
  };
}

/**
 * Composition root for the phase-2 preparation surface (revision 2, §22).
 *
 * The orchestrator wires the already-proven pure functions; it adds no
 * verdict, grant, scheduling, or persistence behavior of its own. Hosted
 * wiring (sessions, dispatcher, ledger store) arrives with the full WPs.
 */
export interface Phase2Preparation {
  assessTelemetryQuality: typeof assessTelemetryQuality;
  characterizeLegacyBehaviour: typeof characterizeLegacyBehaviour;
  summarizeCampaign: typeof summarizeCampaign;
  validateFaultTarget: typeof validateFaultTarget;
  reduceMatchedWindows: typeof reduceMatchedWindows;
  freezeOracle: typeof freezeOracle;
  assertOracleUnchanged: typeof assertOracleUnchanged;
}

export function composePhase2(): Phase2Preparation {
  return {
    assessTelemetryQuality,
    characterizeLegacyBehaviour,
    summarizeCampaign,
    validateFaultTarget,
    reduceMatchedWindows,
    freezeOracle,
    assertOracleUnchanged,
  };
}

/**
 * Hosted identity wiring (WP3-21).
 *
 * The composition root injects the database handle into the identity store;
 * it adds no grant, session, or persistence behavior of its own. The handle
 * is the store's narrow interface — production passes a `pg` pool.
 */
export interface IdentityComposition {
  store: IdentityStore;
  saml: ReturnType<typeof createSamlStore>;
  scim: ReturnType<typeof createScimStore>;
  assertNoLastOwnerLockout: typeof assertNoLastOwnerLockout;
}

export function composeIdentityStore(db: IdentityDb): IdentityComposition {
  return {
    store: createIdentityStore(db),
    saml: createSamlStore(db),
    scim: createScimStore(db),
    assertNoLastOwnerLockout,
  };
}

/**
 * Hosted jobs wiring (WP3-23).
 *
 * The composition root injects the database handle into the jobs store; it
 * adds no admission, scheduling, or persistence behavior of its own. The
 * handle is the store's narrow interface — production passes a `pg` pool.
 */
export interface JobsComposition {
  store: JobsStore;
}

export function composeJobs(db: JobsDb): JobsComposition {
  return {
    store: createJobsStore(db),
  };
}

/**
 * Hosted usage wiring (WP3-24).
 *
 * The composition root injects the database handle into the usage store; it
 * adds no entitlement, reservation, or persistence behavior of its own. The
 * handle is the store's narrow interface — production passes a `pg` pool.
 */
export interface UsageComposition {
  store: UsageStore;
}

export function composeUsage(db: UsageDb): UsageComposition {
  return {
    store: createUsageStore(db),
  };
}

/**
 * Hosted email-identity wiring (WP3-28).
 *
 * The composition root injects the database handle, the delivery transport,
 * and the secret broker into the email store; it adds no identity, session,
 * or delivery behavior of its own.
 */
export interface EmailIdentityComposition {
  store: EmailIdentityStore;
}

export function composeSmtpDelivery(options: SmtpDeliveryOptions): EmailDeliveryPort {
  return createSmtpDelivery(options);
}

export function composeEmailIdentity(db: EmailIdentityDb, deps: EmailIdentityDeps): EmailIdentityComposition {
  return {
    store: createEmailIdentityStore(db, deps),
  };
}

/**
 * Reasoning-engine wiring (WP3-07).
 *
 * The composition root injects the model transport, secret broker, and
 * budgets into the broker; it adds no reasoning, mutation, or persistence
 * behavior of its own. Gateway and guard are pure and pass straight through.
 */
export interface AgentComposition {
  client: ReturnType<typeof createModelClient>;
  authorizeMutation: typeof authorizeMutation;
  reviewPatch: typeof reviewPatch;
  createLedger: typeof createHypothesisLedger;
}

export function composeAgent(config: ModelClientConfig): AgentComposition {
  return {
    client: createModelClient(config),
    authorizeMutation,
    reviewPatch,
    createLedger: createHypothesisLedger,
  };
}

/**
 * Hosted GitHub wiring (WP3-22).
 *
 * The composition root injects the secret broker and the Octokit transport
 * into the client; it adds no provider behavior of its own. Live installation
 * proof needs an authorized App and stays blocked (see the phase report).
 */
export interface GitHubComposition {
  client: GitHubClient;
}

export function composeGitHub(broker: SecretBrokerPort): GitHubComposition {
  return {
    client: createGitHubClient({ broker, transport: octokitTransport }),
  };
}

/**
 * Live model client wiring (P3, WP3-07).
 *
 * The composition root binds the live HTTP transport to the broker; it adds
 * no reasoning or budget behavior of its own. The credential stays behind
 * the broker ref; budgets come from the caller and are never reset.
 */
export interface LiveModelClientOptions {
  readonly baseUrl: string;
  readonly secrets: SecretBrokerPort;
  readonly secretRef: string;
  readonly provider: string;
  readonly model: string;
  readonly configId: string;
  readonly tokenCeiling: number;
}

export function composeLiveModelClient(options: LiveModelClientOptions): ModelClientPort {
  return createModelClient({ ...options, transport: modelFetchTransport(options.baseUrl) });
}

/**
 * Modal Sandbox runner wiring (P4, WP3-04).
 *
 * The composition root injects the secret broker, the trusted helper paths,
 * and the spawn seam into the leaf runner; it adds no guest behavior of its
 * own. Each probe run maps to a cleanup receipt recorded on a
 * per-composition quarantine ledger: an unconfirmed cleanup quarantines
 * instead of passing.
 */
export interface ModalRunnerOptions {
  readonly secrets: SecretBrokerPort;
  readonly tokenIdRef: string;
  readonly tokenSecretRef: string;
  readonly pythonBin: string;
  readonly scriptPath: string;
  readonly expectedApp?: string | undefined;
  readonly timeoutMs: number;
  readonly spawner?: ModalSpawner | undefined;
}

export interface ModalProbeRunResult {
  readonly summary: ModalProbeSummary;
  readonly cleanup: CleanupReceipt;
  readonly quarantined: boolean;
  readonly quarantineReason?: string | undefined;
}

export interface ModalRunnerComposition {
  runProbes(nowIso: string): Promise<ModalProbeRunResult>;
}

export function composeModalRunner(options: ModalRunnerOptions): ModalRunnerComposition {
  const guestRunner = new GuestRunner();
  return {
    runProbes: async (nowIso: string): Promise<ModalProbeRunResult> => {
      const run = await runModalProbe({
        config: {
          pythonBin: options.pythonBin,
          scriptPath: options.scriptPath,
          expectedApp: options.expectedApp ?? MODAL_PROBE_APP,
          timeoutMs: options.timeoutMs,
        },
        secrets: options.secrets,
        tokenIdRef: options.tokenIdRef,
        tokenSecretRef: options.tokenSecretRef,
        ...(options.spawner === undefined ? {} : { spawner: options.spawner }),
      });
      const removed = run.summary.cleanup.terminated && run.summary.cleanup.confirmed;
      const cleanup = CleanupReceiptSchema.parse({
        schemaVersion: '1',
        runId: run.summary.runId,
        completedAt: nowIso,
        targets: [{ kind: 'container', id: run.summary.sandboxId, removed }],
        environmentReusable: run.summary.verdict === 'pass' && removed,
      });
      try {
        guestRunner.recordCleanup(cleanup);
        return { summary: run.summary, cleanup, quarantined: false };
      } catch (error) {
        if (!(error instanceof QuarantineError)) {
          throw error;
        }
        return { summary: run.summary, cleanup, quarantined: true, quarantineReason: error.message };
      }
    },
  };
}


/**
 * Observability connector wiring (WP3-15).
 *
 * The composition root binds the file connector to its allowlisted root; it
 * adds no ingestion or assessment behavior. Backend-profile live connectors
 * implement the same port once catalogued backends and authorized access exist.
 */
export interface TelemetryComposition {
  connector: TelemetryConnectorPort;
}

export function composeTelemetryConnector(
  rootDir: string,
  options?: FileConnectorOptions,
): TelemetryComposition {
  return {
    connector: createFileTelemetryConnector(rootDir, options),
  };
}

/**
 * Migration + upgrade wiring (WP3-10).
 *
 * The composition root injects the database handle into the migration
 * runner and the trusted broker into upgrade planning; it adds no
 * migration, resolution, or persistence behavior of its own.
 */
export interface MigrationsComposition {
  createRunner(manifest: MigrationManifest): MigrationRunner;
  planUpgrade(request: PlanUpgradeRequest): UpgradePlan;
  assertManifestLockfileMatch: typeof assertManifestLockfileMatch;
}

export function composeMigrations(db: MigrationDb, broker: DependencyBroker): MigrationsComposition {
  return {
    createRunner: (manifest) => new MigrationRunner(db, manifest),
    planUpgrade: (request) => planUpgrade(broker, request),
    assertManifestLockfileMatch,
  };
}

/**
 * Public website wiring (WP3-27).
 *
 * The composition root exposes the leaf module's public functions; it adds
 * no content, ranking, or boundary behavior of its own. The dashboard serves
 * this surface over HTTP in phase-6.
 */
export interface PublicSiteComposition {
  loadPublicSiteManifest: typeof loadPublicSiteManifest;
  loadManifestFile: typeof loadManifestFile;
  listRoutes: typeof listRoutes;
  getRoute: typeof getRoute;
  searchFaq: typeof searchFaq;
  getTemplate: typeof getTemplate;
  requestTemplateApply: typeof requestTemplateApply;
  getSampleReport: typeof getSampleReport;
  listDesignNotes: typeof listDesignNotes;
  listReleases: typeof listReleases;
  checkAllDestinations: typeof checkAllDestinations;
  assertPublicSafe: typeof assertPublicSafe;
}

export function composePublicSite(): PublicSiteComposition {
  return {
    loadPublicSiteManifest,
    loadManifestFile,
    listRoutes,
    getRoute,
    searchFaq,
    getTemplate,
    requestTemplateApply,
    getSampleReport,
    listDesignNotes,
    listReleases,
    checkAllDestinations,
    assertPublicSafe,
  };
}

/**
 * Run-lifecycle wiring (WP3-25).
 *
 * The composition root binds the lifecycle store to the identity, usage,
 * jobs, and evidence stores through the core ports; it adds no grant,
 * reservation, scheduling, or persistence behavior of its own.
 */
export interface EvidenceComposition {
  store: EvidenceStore;
}

/**
 * File evidence wiring (T-45, WP3-25).
 *
 * Passthrough so `src/http` never imports a leaf module directly; the
 * directory comes from explicit environment, never a silent default.
 */
export function composeFileEvidence(dir: string): EvidenceComposition {
  return {
    store: createFileEvidenceStore(dir),
  };
}

export interface LifecycleComposition {
  store: LifecycleStore;
}

export function composeLifecycle(
  db: LifecycleDb,
  deps: { identity: IdentityStore; usage: UsageStore; jobs: JobsStore; evidence: EvidenceStore },
): LifecycleComposition {
  return {
    store: createLifecycleStore(db, {
      session: {
        deriveContext: (input) => deps.identity.deriveContext(input),
      },
      usage: {
        reserveRun: (input) =>
          deps.usage.admitReservation({
            tenantId: input.tenantId,
            runId: input.runId,
            reservationId: input.reservationId,
            effectId: input.effectId,
            requested: input.requested,
            nowIso: input.nowIso,
          }),
      },
      jobs: {
        enqueueRun: (input) =>
          deps.jobs.admitRun({
            runId: input.runId,
            jobId: input.jobId,
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
            reservationId: input.reservationId,
            nowIso: input.nowIso,
          }),
        requestJobCancel: (input) => deps.jobs.requestCancel(input),
      },
      evidence: {
        fetchArtifact: (digest) => deps.evidence.get(digest),
      },
    }),
  };
}

/**
 * Notifications wiring (WP3-29).
 *
 * The composition root binds the notifications store to the identity store
 * for session context; it adds no inbox, preference, or outbox behavior.
 */
export interface NotificationsComposition {
  store: NotificationsStore;
}

export function composeNotifications(db: NotificationsDb, identity: IdentityStore): NotificationsComposition {
  return {
    store: createNotificationsStore(db, {
      deriveContext: (input) => identity.deriveContext(input),
    }),
  };
}

/**
 * Queries wiring (WP3-29).
 *
 * The composition root binds the queries store to the identity store for
 * session context and to the lifecycle store for budgeted reproduction; it
 * adds no search, export, or cache behavior of its own.
 */
export interface QueriesComposition {
  store: QueriesStore;
}

export function composeQueries(
  db: QueriesDb,
  deps: { identity: IdentityStore; lifecycle: LifecycleStore },
): QueriesComposition {
  return {
    store: createQueriesStore(db, {
      session: { deriveContext: (input) => deps.identity.deriveContext(input) },
      repro: { retryRun: (actor, retry) => deps.lifecycle.retryRun(actor, retry) },
    }),
  };
}

/**
 * Support wiring (WP3-30).
 *
 * The composition root binds the support store to the identity store for
 * session context and to the jobs store for fenced drains; it adds no
 * ticket, grant, incident, or operator behavior of its own.
 */
export interface SupportComposition {
  store: SupportStore;
}

export function composeSupport(
  db: SupportDb,
  deps: { identity: IdentityStore; jobs: JobsStore },
): SupportComposition {
  return {
    store: createSupportStore(db, {
      session: { deriveContext: (input) => deps.identity.deriveContext(input) },
      jobs: { requestJobCancel: (input) => deps.jobs.requestCancel(input) },
    }),
  };
}

/**
 * Adapter-capability wiring (WP3-30 capability matrix).
 *
 * The composition root builds the registry from the fourteen trusted,
 * explicitly-versioned adapter records; it adds no support claim of its
 * own. Target levels are claimed support, proven levels are evidenced
 * support — the route reports both side by side, never merged.
 */
export interface AdapterCapabilitiesComposition {
  registry: AdapterRegistry;
}

export function composeAdapterCapabilities(): AdapterCapabilitiesComposition {
  return {
    registry: new AdapterRegistry([
      TYPESCRIPT_ADAPTER_RECORD,
      TYPESCRIPT_EXPRESS_RECORD,
      TYPESCRIPT_REACT_RECORD,
      TYPESCRIPT_NESTJS_RECORD,
      TYPESCRIPT_FASTIFY_RECORD,
      TYPESCRIPT_PRISMA_RECORD,
      PYTHON_ADAPTER_RECORD,
      PYTHON_DJANGO_RECORD,
      PYTHON_PYDANTIC_RECORD,
      PYTHON_SQLALCHEMY_RECORD,
      GO_ADAPTER_RECORD,
      GO_FIBER_RECORD,
      PHP_ADAPTER_RECORD,
      DOTNET_ADAPTER_RECORD,
    ]),
  };
}

/**
 * Collaboration wiring (WP3-30).
 *
 * The composition root binds the collaboration store to the identity store
 * for session context and to the notifications store for mention fan-out; it
 * adds no thread, comment, or sharing behavior of its own.
 */
export interface CollaborationComposition {
  store: CollaborationStore;
}

export function composeCollaboration(
  db: CollaborationDb,
  deps: { identity: IdentityStore; notifications: NotificationsStore },
): CollaborationComposition {
  return {
    store: createCollaborationStore(db, {
      session: { deriveContext: (input) => deps.identity.deriveContext(input) },
      mentions: {
        notifyMention: (input) =>
          deps.notifications
            .publishFromEvent({
              tenantId: input.tenantId,
              eventId: input.eventId,
              category: 'results',
              title: 'Mentioned in a discussion',
              body: `${input.mentionedBy} mentioned you in thread ${input.threadId}.`,
              userId: input.userId,
              deepLink: `/app/runs/${input.runId}`,
              runId: input.runId,
              nowIso: input.nowIso,
            })
            .then(() => undefined),
      },
    }),
  };
}
