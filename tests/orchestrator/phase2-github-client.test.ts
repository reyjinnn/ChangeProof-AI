import { describe, expect, it } from 'vitest';

import type { SecretBrokerPort } from '../../src/core/index.js';
import { createMapSecretBroker } from '../../src/modules/github/index.js';
import { composeGitHub } from '../../src/orchestrator/index.js';

/**
 * WP3-22 composition wiring.
 *
 * The composition root injects the broker and the Octokit transport without
 * adding behavior. No network happens here — live proof needs an authorized
 * App and stays blocked; the client behavior is proven with fakes in
 * `tests/github/client.test.ts`.
 */
describe('composeGitHub', () => {
  it('exposes the client surface and refuses before any network', async () => {
    const broker: SecretBrokerPort = createMapSecretBroker(new Map());
    const composed = composeGitHub(broker);

    expect(typeof composed.client.fetchCommit).toBe('function');
    expect(typeof composed.client.listInstallationRepositories).toBe('function');
    // Revoked connection: refused locally, the transport is never built.
    await expect(
      composed.client.fetchCommit({
        connection: {
          schemaVersion: '1',
          connectionId: 'conn-1',
          tenantId: 'tenant-a',
          installationId: 'install-1',
          provider: 'github',
          repositoryAllowlist: ['repo-1'],
          permissionMatrix: {},
          status: 'revoked',
          revocationVersion: 4,
          credentialRef: 'cred-1',
        },
        repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
        sha: 'a'.repeat(40),
      }),
    ).rejects.toThrow(/revoked|inactive/i);
  });
});
