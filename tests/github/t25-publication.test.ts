import { describe, expect, it } from 'vitest';

import type { RepositoryConnection } from '../../src/core/index.js';
import {
  assemblePullRequestPayload,
  createGitHubClient,
  planEvidenceBranch,
  type GitHubApi,
} from '../../src/modules/github/index.js';

import { brokerWith, connection } from './helpers.js';

const SHA = 'a'.repeat(40);
const KEY = 'b'.repeat(64);
const MANIFEST = 'c'.repeat(64);

function conn(overrides: Partial<RepositoryConnection> = {}): RepositoryConnection {
  return connection(overrides);
}

function prApi(behavior: {
  head?: string;
  pr?: { number: number; url: string; headSha: string; state: string } | null;
  failWith?: { status?: number; message: string };
  calls?: string[];
}): GitHubApi {
  const fail = (): Promise<never> => {
    const failure = new Error(behavior.failWith?.message ?? 'boom') as Error & { status?: number };
    if (behavior.failWith?.status !== undefined) failure.status = behavior.failWith.status;
    return Promise.reject(failure);
  };
  return {
    getCommit: () => Promise.resolve({ sha: SHA, message: 'x', committedAt: '2026-10-31T00:00:00.000Z' }),
    listAccessibleRepositories: () => Promise.resolve([]),
    getBranchHead: (input) => {
      behavior.calls?.push(`head:${input.branch}`);
      if (behavior.failWith !== undefined) return fail();
      return Promise.resolve({ sha: behavior.head ?? SHA });
    },
    openPullRequest: (input) => {
      behavior.calls?.push(`open:${input.head}`);
      if (behavior.failWith !== undefined) return fail();
      return Promise.resolve(
        behavior.pr ?? { number: 7, url: 'https://github.com/acme/orders/pull/7', headSha: SHA, state: 'open' },
      );
    },
    findPullRequestByHead: (input) => {
      behavior.calls?.push(`find:${input.head}`);
      if (behavior.failWith !== undefined) return fail();
      return Promise.resolve(behavior.pr ?? null);
    },
  };
}

describe('planEvidenceBranch (WP3-12)', () => {
  it('derives a stable branch name from the idempotency key', () => {
    const first = planEvidenceBranch({ idempotencyKey: KEY, base: 'main', headSha: SHA });
    const second = planEvidenceBranch({ idempotencyKey: KEY, base: 'main', headSha: SHA });
    expect(first.branch).toBe('changeproof/ev-bbbbbbbbbbbb');
    expect(second).toEqual(first);
    expect(first.base).toBe('main');
    expect(first.headSha).toBe(SHA);
  });

  it('rejects malformed branch plans (code-security: no shell metachars later)', () => {
    expect(() => planEvidenceBranch({ idempotencyKey: 'nope', base: 'main', headSha: SHA })).toThrow();
    expect(() => planEvidenceBranch({ idempotencyKey: KEY, base: 'main', headSha: 'xyz' })).toThrow();
    expect(() => planEvidenceBranch({ idempotencyKey: KEY, base: 'main; rm -rf /', headSha: SHA })).toThrow();
    expect(() => planEvidenceBranch({ idempotencyKey: KEY, base: '../escape', headSha: SHA })).toThrow();
    expect(() => planEvidenceBranch({ idempotencyKey: KEY, base: 'has space', headSha: SHA })).toThrow();
  });
});

describe('assemblePullRequestPayload (WP3-12)', () => {
  it('assembles a validated payload', () => {
    const payload = assemblePullRequestPayload({
      owner: 'acme',
      repo: 'orders',
      base: 'main',
      head: 'changeproof/ev-bbbbbbbbbbbb',
      title: 'fix: restore order pipeline (verified)',
      body: 'Evidence: manifest c…c. All required checks passed.',
      manifestDigest: MANIFEST,
    });
    expect(payload.head).toBe('changeproof/ev-bbbbbbbbbbbb');
    expect(payload.base).toBe('main');
  });

  it('rejects malformed payloads', () => {
    const good = {
      owner: 'acme',
      repo: 'orders',
      base: 'main',
      head: 'changeproof/ev-bbbbbbbbbbbb',
      title: 'fix: restore order pipeline (verified)',
      body: 'Evidence manifest attached.',
      manifestDigest: MANIFEST,
    };
    expect(() => assemblePullRequestPayload({ ...good, owner: '../x' })).toThrow();
    expect(() => assemblePullRequestPayload({ ...good, title: '' })).toThrow();
    expect(() => assemblePullRequestPayload({ ...good, title: 't'.repeat(201) })).toThrow();
    expect(() => assemblePullRequestPayload({ ...good, manifestDigest: 'nope' })).toThrow();
    expect(() => assemblePullRequestPayload({ ...good, head: 'main; evil' })).toThrow();
  });
});

describe('GitHubClient pull-request methods (WP3-12)', () => {
  it('reads the exact branch head for a granted repository', async () => {
    const { broker } = brokerWith('token-1');
    const client = createGitHubClient({ broker, transport: () => prApi({ head: SHA }) });
    const head = await client.fetchBranchHead({
      connection: conn(),
      repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
      branch: 'main',
    });
    expect(head.sha).toBe(SHA);
  });

  it('opens a pull request through the broker-held token', async () => {
    const { broker, seen } = brokerWith('[REDACTED]');
    const calls: string[] = [];
    let transported = '';
    const client = createGitHubClient({
      broker,
      transport: (token: string): GitHubApi => {
        transported = token;
        return prApi({ calls });
      },
    });
    const pr = await client.openPullRequest({
      connection: conn(),
      repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
      base: 'main',
      head: 'changeproof/ev-bbbbbbbbbbbb',
      title: 'fix: restore order pipeline (verified)',
      body: 'Evidence manifest attached.',
    });
    expect(pr.number).toBe(7);
    expect(seen).toEqual(['cred-github-install-1']);
    expect(transported).toBe('[REDACTED]');
    expect(calls).toEqual(['open:changeproof/ev-bbbbbbbbbbbb']);
  });

  it('finds an existing pull request by head branch', async () => {
    const { broker } = brokerWith('token-1');
    const found = { number: 7, url: 'https://github.com/acme/orders/pull/7', headSha: SHA, state: 'open' };
    const client = createGitHubClient({ broker, transport: () => prApi({ pr: found }) });
    await expect(
      client.findPullRequestByHead({
        connection: conn(),
        repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
        head: 'changeproof/ev-bbbbbbbbbbbb',
      }),
    ).resolves.toEqual(found);
  });

  it('refuses before any network on revoked, wrong-provider, or unallowlisted repos', async () => {
    const { broker } = brokerWith('token-1');
    const calls: string[] = [];
    const client = createGitHubClient({ broker, transport: () => prApi({ calls }) });
    const input = {
      connection: conn({ status: 'revoked' }),
      repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
      base: 'main',
      head: 'changeproof/ev-bbbbbbbbbbbb',
      title: 't',
      body: 'b',
    };
    await expect(client.openPullRequest(input)).rejects.toThrow(/revoked|inactive/i);
    await expect(
      client.openPullRequest({ ...input, connection: conn({ provider: 'gitlab' }) }),
    ).rejects.toThrow(/provider/i);
    await expect(
      client.openPullRequest({
        ...input,
        connection: conn(),
        repository: { id: 'repo-9', owner: 'acme', repo: 'other' },
      }),
    ).rejects.toThrow(/allowlist/i);
    expect(calls).toEqual([]);
  });

  it('maps provider failures to specific errors without leaking the token', async () => {
    const { broker } = brokerWith('token-1');
    const client = createGitHubClient({
      broker,
      transport: () => prApi({ failWith: { status: 404, message: 'nope' } }),
    });
    const attempt = client.fetchBranchHead({
      connection: conn(),
      repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
      branch: 'main',
    });
    await expect(attempt).rejects.toThrow(/not found|not visible/i);
    await expect(attempt).rejects.not.toThrow(/token-1/);
  });
});
