import { z } from 'zod';

import { ChangeProofError, GitShaSchema } from '../../core/index.js';

import type { ProviderApi, ProviderTransport } from './client.js';

/**
 * Bitbucket Cloud 2.0 transport (WP3-32, FR3-45).
 *
 * Real HTTP over the injected fetch with Bearer auth (frozen in
 * `docs/decisions/t32-provider-catalog.md`). Every response is
 * schema-validated — a malformed provider body is a refusal, never a guess.
 * Live calls stay blocked until an authorized test workspace and token
 * exist; unit tests inject a fake fetch. Bitbucket Server/Data Center modes
 * are explicit qualification-catalog blockers, not silent fallbacks.
 */

const CommitSchema = z.object({
  hash: GitShaSchema,
  message: z.string(),
  date: z.iso.datetime({ offset: true }),
});

const BranchSchema = z.object({ target: z.object({ hash: GitShaSchema }) });

const PullRequestSchema = z.object({
  id: z.number(),
  links: z.object({ html: z.object({ href: z.string().min(1) }) }),
  source: z.object({ commit: z.object({ hash: GitShaSchema }) }),
  state: z.string().min(1),
});

const PullRequestPageSchema = z.object({ values: z.array(PullRequestSchema) });

const RepositorySchema = z.object({
  uuid: z.string().min(1),
  full_name: z.string().min(1),
  is_private: z.boolean(),
});

const RepositoryPageSchema = z.object({ values: z.array(RepositorySchema) });

const StatusSchema = z.object({
  key: z.string().min(1),
  state: z.string().min(1),
  commit: z.object({ hash: GitShaSchema }),
});

const StatusPageSchema = z.object({ values: z.array(StatusSchema) });

function splitPath(projectPath: string): { workspace: string; repo: string } {
  const segments = projectPath.split('/');
  const workspace = segments[0];
  const repo = segments[1];
  if (workspace === undefined || repo === undefined || segments.length !== 2) {
    throw new ChangeProofError('Bitbucket path must be workspace/repo; refusing.');
  }
  return { workspace, repo };
}

export function bitbucketFetchTransport(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): ProviderTransport {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.length === 0) {
    throw new ChangeProofError('Bitbucket base URL is empty; refusing.');
  }

  async function request(
    token: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const init: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}/2.0${path}`, init);
    } catch (error) {
      throw new ChangeProofError(
        `Bitbucket request failed: ${error instanceof Error ? error.message : 'unknown transport error'}; refusing to guess.`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new ChangeProofError(`Bitbucket API ${path} answered ${String(response.status)}; refusing to guess.`);
    }
    const payload: unknown = await response.json();
    return payload;
  }

  const repoPath = (projectPath: string): string => {
    const { workspace, repo } = splitPath(projectPath);
    return `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}`;
  };

  return (token: string): ProviderApi => ({
    async getCommit(input) {
      const raw = await request(token, `${repoPath(input.projectPath)}/commit/${encodeURIComponent(input.sha)}`);
      const commit = CommitSchema.parse(raw);
      return { sha: commit.hash, message: commit.message, committedAt: commit.date };
    },
    async getBranchHead(input) {
      const raw = await request(
        token,
        `${repoPath(input.projectPath)}/refs/branches/${encodeURIComponent(input.branch)}`,
      );
      return { sha: BranchSchema.parse(raw).target.hash };
    },
    async openMergeRequest(input) {
      const raw = await request(token, `${repoPath(input.projectPath)}/pullrequests`, {
        title: input.title,
        description: input.body,
        source: { branch: { name: input.head } },
        destination: { branch: { name: input.base } },
      });
      const created = PullRequestSchema.parse(raw);
      return {
        id: String(created.id),
        url: created.links.html.href,
        headSha: created.source.commit.hash,
        state: created.state,
      };
    },
    async findRequestByHead(input) {
      // Branch names cannot contain quotes (guards), so this interpolation is exact.
      const raw = await request(
        token,
        `${repoPath(input.projectPath)}/pullrequests?${new URLSearchParams({ q: `source.branch.name="${input.head}"`, state: 'OPEN' }).toString()}`,
      );
      const first = PullRequestPageSchema.parse(raw).values[0];
      if (first === undefined) {
        return null;
      }
      return {
        id: String(first.id),
        url: first.links.html.href,
        headSha: first.source.commit.hash,
        state: first.state,
      };
    },
    async listRepositories() {
      const raw = await request(token, '/repositories?role=member&pagelen=100');
      return RepositoryPageSchema.parse(raw).values.map((repo) => ({
        id: repo.uuid,
        fullName: repo.full_name,
        isPrivate: repo.is_private,
      }));
    },
    async getPipelineBySha(input) {
      const raw = await request(
        token,
        `${repoPath(input.projectPath)}/commit/${encodeURIComponent(input.sha)}/statuses?pagelen=1`,
      );
      const first = StatusPageSchema.parse(raw).values[0];
      if (first === undefined) {
        return null;
      }
      return { sha: first.commit.hash, pipelineId: first.key, status: first.state };
    },
  });
}
