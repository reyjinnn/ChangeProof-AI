export * from './bundle.js';
export * from './configuration.js';
export * from './errors.js';
export * from './publication.js';

import {
  type BundleAssessment,
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
  type EmailIdentityDb,
  type EmailIdentityDeps,
  type EmailIdentityStore,
  type IdentityDb,
  type IdentityStore,
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
  assertNoLastOwnerLockout: typeof assertNoLastOwnerLockout;
}

export function composeIdentityStore(db: IdentityDb): IdentityComposition {
  return {
    store: createIdentityStore(db),
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
