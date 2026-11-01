import { describe, expect, it } from 'vitest';

import type { SecretBrokerPort } from '../../src/core/index.js';
import type { RepositoryConnection } from '../../src/core/index.js';
import {
  createGitHubClient,
  createMapSecretBroker,
  type GitHubApi,
} from '../../src/modules/github/index.js';

/**
 * WP3-22 — GitHub API client over broker-held credentials (FR3-30).
 *
 * Pure tests with a fake transport: no network, no GitHub App. They prove the
 * authorization layer (active connection, allowlisted repo, GitHub provider,
 * exact-sha fetch), broker-held secrets (the token reaches the transport only
 * from the broker), and specific provider errors without secret leakage.
 * Live installation/snapshot/CI proof needs an authorized App and stays blocked.
 */

const SHA = 'a'.repeat(40);

function connection(overrides: Partial<RepositoryConnection> = {}): RepositoryConnection {
  return {
    schemaVersion: '1',
    connectionId: 'conn-1',
    tenantId: 'tenant-a',
    installationId: 'install-1',
    provider: 'github',
    repositoryAllowlist: ['repo-1'],
    permissionMatrix: { contents: true },
    status: 'active',
    revocationVersion: 3,
    credentialRef: 'cred-github-install-1',
    ...overrides,
  };
}

function brokerWith(token: string): { broker: SecretBrokerPort; seen: string[] } {
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

function fakeApi(behavior: {
  commit?: { sha: string; message: string; committedAt: string };
  repos?: readonly { id: string; fullName: string; isPrivate: boolean }[];
  failWith?: { status?: number; message: string };
}): { api: GitHubApi } {
  const rejectWith = (failWith: { status?: number; message: string }): Promise<never> => {
    const failure = new Error(failWith.message) as Error & { status?: number | undefined };
    if (failWith.status !== undefined) {
      failure.status = failWith.status;
    }
    return Promise.reject(failure);
  };
  const api: GitHubApi = {
    getCommit: () => {
      if (behavior.failWith !== undefined) {
        return rejectWith(behavior.failWith);
      }
      return Promise.resolve(
        behavior.commit ?? { sha: SHA, message: 'fix orders', committedAt: '2026-10-31T00:00:00.000Z' },
      );
    },
    listAccessibleRepositories: () => {
      if (behavior.failWith !== undefined) {
        return rejectWith(behavior.failWith);
      }
      return Promise.resolve(behavior.repos ?? []);
    },
  };
  return { api };
}

describe('broker-held credentials', () => {
  it('refuses an unknown or empty credential ref without a default', async () => {
    const broker = createMapSecretBroker(new Map([['cred-empty', '']]));
    await expect(broker.readCredential('cred-missing')).rejects.toThrow(/credential/i);
    await expect(broker.readCredential('cred-empty')).rejects.toThrow(/credential/i);
  });

  it('hands the broker token to the transport, never a caller-held secret', async () => {
    const { broker, seen } = brokerWith('ghs_installation_token_value');
    const { api } = fakeApi({});
    let transported = '';
    const client = createGitHubClient({
      broker,
      transport: (token: string): GitHubApi => {
        transported = token;
        return api;
      },
    });

    await client.fetchCommit({
      connection: connection(),
      repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
      sha: SHA,
    });

    expect(seen).toEqual(['cred-github-install-1']);
    expect(transported).toBe('ghs_installation_token_value');
  });
});

describe('fetchCommit authorizes before calling', () => {
  it('fetches the exact commit for a granted repository', async () => {
    const { broker } = brokerWith('token-1');
    const { api } = fakeApi({ commit: { sha: SHA, message: 'fix orders', committedAt: '2026-10-31T00:00:00.000Z' } });
    const client = createGitHubClient({ broker, transport: () => api });

    const commit = await client.fetchCommit({
      connection: connection(),
      repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
      sha: SHA,
    });

    expect(commit).toEqual({ sha: SHA, message: 'fix orders', committedAt: '2026-10-31T00:00:00.000Z' });
  });

  it('rejects a revoked connection, an unlisted repo, and a malformed sha', async () => {
    const { broker } = brokerWith('token-1');
    const { api } = fakeApi({});
    const client = createGitHubClient({ broker, transport: () => api });
    const repository = { id: 'repo-1', owner: 'acme', repo: 'orders' };

    await expect(
      client.fetchCommit({ connection: connection({ status: 'revoked' }), repository, sha: SHA }),
    ).rejects.toThrow(/revoked|inactive/i);
    await expect(
      client.fetchCommit({
        connection: connection(),
        repository: { id: 'repo-evil', owner: 'acme', repo: 'orders' },
        sha: SHA,
      }),
    ).rejects.toThrow(/not authorized|allowlist|granted/i);
    await expect(client.fetchCommit({ connection: connection(), repository, sha: 'HEAD' })).rejects.toThrow(/sha/i);
    await expect(
      client.fetchCommit({
        connection: connection(),
        repository: { id: 'repo-1', owner: '../x', repo: 'orders' },
        sha: SHA,
      }),
    ).rejects.toThrow(/owner|repository|slug/i);
  });

  it('rejects non-GitHub providers instead of misrouting them (FR3-44/45 is WP3-32)', async () => {
    const { broker } = brokerWith('token-1');
    const { api } = fakeApi({});
    const client = createGitHubClient({ broker, transport: () => api });

    await expect(
      client.fetchCommit({
        connection: connection({ provider: 'gitlab' }),
        repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
        sha: SHA,
      }),
    ).rejects.toThrow(/provider|github/i);
  });

  it('maps provider failures specifically and never leaks the token', async () => {
    const { broker } = brokerWith('ghs_secret_token_value');
    const repository = { id: 'repo-1', owner: 'acme', repo: 'orders' };

    for (const [status, pattern] of [
      [404, /not found|not visible/i],
      [401, /credential|rejected|unauthorized/i],
      [403, /forbidden|denied|rate/i],
    ] as const) {
      const { api } = fakeApi({ failWith: { status, message: `provider said ${String(status)}` } });
      const client = createGitHubClient({ broker, transport: () => api });
      const error = await client
        .fetchCommit({ connection: connection(), repository, sha: SHA })
        .then(
          () => 'unexpected-pass',
          (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)),
        );
      expect(error).toMatch(pattern);
      expect(error).not.toContain('ghs_secret_token_value');
    }
  });
});

describe('listInstallationRepositories checks scope', () => {
  it('returns the accessible repositories for an active connection', async () => {
    const { broker } = brokerWith('token-1');
    const repos = [{ id: 'repo-1', fullName: 'acme/orders', isPrivate: true }] as const;
    const { api } = fakeApi({ repos });
    const client = createGitHubClient({ broker, transport: () => api });

    await expect(client.listInstallationRepositories({ connection: connection() })).resolves.toEqual(repos);
  });

  it('refuses a revoked connection without calling the provider', async () => {
    const { broker } = brokerWith('token-1');
    let called = false;
    const api: GitHubApi = {
      getCommit: () => Promise.reject(new Error('must not be called')),
      listAccessibleRepositories: () => {
        called = true;
        return Promise.resolve([]);
      },
    };
    const client = createGitHubClient({ broker, transport: () => api });

    await expect(
      client.listInstallationRepositories({ connection: connection({ status: 'revoked' }) }),
    ).rejects.toThrow(/revoked|inactive/i);
    expect(called).toBe(false);
  });
});
