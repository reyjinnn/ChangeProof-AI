import { describe, expect, it } from 'vitest';

import { bitbucketFetchTransport } from '../../src/modules/providers/bitbucket.js';
import { gitlabFetchTransport } from '../../src/modules/providers/gitlab.js';

/**
 * WP3-32 / T-32 — fetch transport mapping tests (FR3-45).
 *
 * Written before the live wiring. The transports build exact URLs, send the
 * frozen auth headers, and map provider payloads to the neutral seam — with
 * a stubbed fetch, so no network happens. Error statuses and malformed
 * bodies are refusals, never guesses.
 */

const SHA = 'd'.repeat(40);

interface SeenCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(routes: Readonly<Record<string, { status: number; body: unknown }>>): {
  fetchImpl: typeof fetch;
  calls: SeenCall[];
} {
  const calls: SeenCall[] = [];
  const fetchImpl = ((url: unknown, init?: unknown): Promise<unknown> => {
    const key = String(url);
    calls.push({ url: key, init: init as RequestInit | undefined });
    const route = routes[key];
    if (route === undefined) {
      return Promise.reject(new Error(`unstubbed request ${key}`));
    }
    return Promise.resolve({
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: (): Promise<unknown> => Promise.resolve(route.body),
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('GitLab fetch transport', () => {
  it('maps commits with the frozen v4 URL and token header', async () => {
    const url = 'https://gitlab.example.com/api/v4/projects/group%2Fproject/repository/commits/' + SHA;
    const { fetchImpl, calls } = stubFetch({
      [url]: { status: 200, body: { id: SHA, message: 'fix', committed_date: '2026-11-02T00:00:00.000Z' } },
    });
    const api = gitlabFetchTransport('https://gitlab.example.com/', fetchImpl)('token-1');
    const commit = await api.getCommit({ projectPath: 'group/project', sha: SHA });
    expect(commit).toMatchObject({ sha: SHA, message: 'fix' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(url);
    expect((calls[0]?.init?.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('token-1');
  });

  it('refuses error statuses and malformed bodies', async () => {
    const missing = 'https://gitlab.example.com/api/v4/projects/g%2Fp/repository/commits/' + SHA;
    const failing = stubFetch({ [missing]: { status: 404, body: { message: 'not found' } } });
    const api = gitlabFetchTransport('https://gitlab.example.com', failing.fetchImpl)('t');
    await expect(api.getCommit({ projectPath: 'g/p', sha: SHA })).rejects.toThrow(/answered 404/);
    const broken = stubFetch({ [missing]: { status: 200, body: { nope: true } } });
    const brokenApi = gitlabFetchTransport('https://gitlab.example.com', broken.fetchImpl)('t');
    await expect(brokenApi.getCommit({ projectPath: 'g/p', sha: SHA })).rejects.toThrow();
  });
});

describe('Bitbucket fetch transport', () => {
  it('maps commits and merge requests with Bearer auth', async () => {
    const commitUrl = `https://api.bitbucket.org/2.0/repositories/w/r/commit/${SHA}`;
    const mrUrl = 'https://api.bitbucket.org/2.0/repositories/w/r/pullrequests';
    const { fetchImpl, calls } = stubFetch({
      [commitUrl]: { status: 200, body: { hash: SHA, message: 'fix', date: '2026-11-02T00:00:00.000Z' } },
      [mrUrl]: {
        status: 201,
        body: {
          id: 7,
          links: { html: { href: 'https://bitbucket.org/w/r/pull-requests/7' } },
          source: { commit: { hash: SHA } },
          state: 'OPEN',
        },
      },
    });
    const api = bitbucketFetchTransport('https://api.bitbucket.org', fetchImpl)('token-2');
    const commit = await api.getCommit({ projectPath: 'w/r', sha: SHA });
    expect(commit).toMatchObject({ sha: SHA });
    const created = await api.openMergeRequest({
      projectPath: 'w/r',
      base: 'main',
      head: 'fix',
      title: 'Fix',
      body: 'Body',
    });
    expect(created).toMatchObject({ id: '7', headSha: SHA });
    expect((calls[0]?.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer token-2');
  });

  it('returns null when no request matches the head', async () => {
    const { fetchImpl } = stubFetch({
      ['https://api.bitbucket.org/2.0/repositories/w/r/pullrequests?q=' +
      encodeURIComponent('source.branch.name="fix"') +
      '&state=OPEN']: { status: 200, body: { values: [] } },
    });
    const api = bitbucketFetchTransport('https://api.bitbucket.org', fetchImpl)('t');
    await expect(api.findRequestByHead({ projectPath: 'w/r', head: 'fix' })).resolves.toBeNull();
  });
});
