import type {
  DeploymentProfile,
  DeploymentReceipt,
  SecretBrokerPort,
  TenantContext,
} from '../core/index.js';
import { createMapSecretBroker } from '../modules/github/index.js';
import {
  assertDeploymentQualified,
  backupSelfHost,
  createByokStore,
  createRevocationCheckedBroker,
  installSelfHost,
  readInstallState,
  restoreSelfHost,
  teardownSelfHost,
  upgradeSelfHost,
  type ByokStore,
  type DistributionDb,
  type InstallState,
  type NamedMigration,
  type ProfileRuntime,
} from '../modules/distribution/index.js';

export type { DistributionDb, InstallState } from '../modules/distribution/index.js';

/**
 * Distribution wiring (WP3-31).
 *
 * The composition root injects the database handles and the secret broker
 * into the BYOK store and binds the deployment operations to their
 * databases; it adds no credential, gate, or persistence behavior of its
 * own. Handles are the store's narrow interface — production passes `pg`
 * pools. The map broker is the runtime secret map; a vault/KMS broker
 * arrives behind the same stable port.
 */
export interface DistributionComposition {
  assertQualified: typeof assertDeploymentQualified;
  byok: ByokStore;
  /** Raw broker for provision/rotate verification; values are never returned. */
  secrets: SecretBrokerPort;
  /** Per-request broker that refuses revoked refs against current store state. */
  secretsFor: (context: TenantContext) => SecretBrokerPort;
  install: (input: {
    dbName: string;
    profile: DeploymentProfile;
    runtime: ProfileRuntime;
    workdir: string;
    migrations: readonly NamedMigration[];
    nowIso: string;
  }) => Promise<DeploymentReceipt>;
  upgrade: (input: {
    dbName: string;
    profile: DeploymentProfile;
    runtime: ProfileRuntime;
    workdir: string;
    migrations: readonly NamedMigration[];
    nowIso: string;
  }) => Promise<DeploymentReceipt>;
  backup: (input: { workdir: string; nowIso: string }) => Promise<{
    receipt: DeploymentReceipt;
    path: string;
    rows: number;
    digest: string;
  }>;
  restore: (input: {
    dbName: string;
    profile: DeploymentProfile;
    runtime: ProfileRuntime;
    workdir: string;
    backupPath: string;
    migrations: readonly NamedMigration[];
    confirm: string;
    nowIso: string;
  }) => Promise<DeploymentReceipt>;
  teardown: (input: {
    dbName: string;
    workdir: string;
    confirm: string;
  }) => Promise<{ dbName: string; workdirRemoved: boolean }>;
  status: (workdir: string) => InstallState | null;
}

export function composeMapSecrets(values: ReadonlyMap<string, string>): SecretBrokerPort {
  return createMapSecretBroker(values);
}

export function composeDistribution(input: {
  db: DistributionDb;
  maintenanceDb: DistributionDb;
  secrets: SecretBrokerPort;
}): DistributionComposition {
  const byok = createByokStore(input.db);
  return {
    assertQualified: assertDeploymentQualified,
    byok,
    secrets: input.secrets,
    secretsFor: (context: TenantContext): SecretBrokerPort =>
      createRevocationCheckedBroker(input.secrets, byok, context),
    install: (operation) => installSelfHost({ ...operation, db: input.db }),
    upgrade: (operation) => upgradeSelfHost({ ...operation, db: input.db }),
    backup: (operation) => backupSelfHost({ ...operation, db: input.db }),
    restore: (operation) =>
      restoreSelfHost({ ...operation, maintenanceDb: input.maintenanceDb, targetDb: input.db }),
    teardown: (operation) =>
      teardownSelfHost({ ...operation, maintenanceDb: input.maintenanceDb }),
    status: (workdir: string): InstallState | null => readInstallState(workdir),
  };
}
