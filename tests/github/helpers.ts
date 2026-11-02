import type { RepositoryConnection, SecretBrokerPort } from '../../src/core/index.js';
import { createMapSecretBroker } from '../../src/modules/github/index.js';

export function connection(overrides: Partial<RepositoryConnection> = {}): RepositoryConnection {
  return {
    schemaVersion: '1',
    connectionId: 'conn-1',
    tenantId: 'tenant-a',
    installationId: 'install-1',
    provider: 'github',
    repositoryAllowlist: ['repo-1'],
    permissionMatrix: { contents: true, pull_requests: true },
    status: 'active',
    revocationVersion: 3,
    credentialRef: 'cred-github-install-1',
    ...overrides,
  };
}

export function brokerWith(token: string): { broker: SecretBrokerPort; seen: string[] } {
  const seen: string[] = [];
  const inner = createMapSecretBroker(new Map([['cred-github-install-1', token]]));
  const broker: SecretBrokerPort = {
    readCredential: async (refId: string): Promise<string> => {
      seen.push(refId);
      return inner.readCredential(refId);
    },
  };
  return { broker, seen };
}
