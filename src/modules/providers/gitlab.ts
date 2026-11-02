import { z } from 'zod';

import { ChangeProofError, GitShaSchema } from '../../core/index.js';

import type { ProviderApi, ProviderTransport } from './client.js';

/**
 * GitLab REST v4 transport (WP3-32, FR3-45).
 *
 * Real HTTP over the injected fetch: the default base is `https://gitlab.com`
 * and a self-managed base URL is pinned per connection at provisioning time
 * (catalog freeze in `docs/decisions/t32-provider-catalog.md`). Every
 * response is schema-validated — a malformed provider body is a refusal,
 * never a guess. Live calls stay blocked until an authorized test
 * organization and token exist; unit tests inject a fake fetch.
 */

const CommitSchema = z.object({
  id: GitShaSchema,
  message: z.string(),
  committed_date: z.iso.datetime({ offset: true }),
});

const BranchSchema = z.object({ commit: z.object({ id: GitShaSchema }) });

const MergeRequestSchema = z.object({
  iid: z.number(),
  web_url: z.string().min(1),
  sha: GitShaSchema,
  state: z.string().min(1),
});

const MergeRequestListItemSchema = MergeRequestSchema.extend({ source_branch: z.string() });

const ProjectSchema = z.object({
  id: z.number(),
  path_with_namespace: z.string().min(1),
  visibility: z.string(),
});

const PipelineSchema = z.object({
  sha: GitShaSchema,
  id: z.number(),
  status: z.string().min(1),
});

export function gitlabFetchTransport(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): ProviderTransport {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.length === 0) {
    throw new ChangeProofError('GitLab base URL is empty; refusing.');
  }

  async function request(
    token: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const init: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}/api/v4${path}`, init);
    } catch (error) {
      throw new ChangeProofError(
        `GitLab request failed: ${error instanceof Error ? error.message : 'unknown transport error'}; refusing to guess.`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new ChangeProofError(`GitLab API ${path} answered ${String(response.status)}; refusing to guess.`);
    }
    const payload: unknown = await response.json();
    return payload;
  }

  return (token: string): ProviderApi => ({
    async getCommit(input) {
      const raw = await request(token, `/projects/${encodeURIComponent(input.projectPath)}/repository/commits/${encodeURIComponent(input.sha)}`);
      const commit = CommitSchema.parse(raw);
      return { sha: commit.id, message: commit.message, committedAt: commit.committed_date };
    },
    async getBranchHead(input) {
      const raw = await request(
        token,
        `/projects/${encodeURIComponent(input.projectPath)}/repository/branches/${encodeURIComponent(input.branch)}`,
      );
      return { sha: BranchSchema.parse(raw).commit.id };
    },
    async openMergeRequest(input) {
      const raw = await request(token, `/projects/${encodeURIComponent(input.projectPath)}/merge_requests`, {
        source_branch: input.head,
        target_branch: input.base,
        title: input.title,
        description: input.body,
      });
      const created = MergeRequestSchema.parse(raw);
      return { id: String(created.iid), url: created.web_url, headSha: created.sha, state: created.state };
    },
    async findRequestByHead(input) {
      const raw = await request(
        token,
        `/projects/${encodeURIComponent(input.projectPath)}/merge_requests?${new URLSearchParams({ source_branch: input.head, state: 'opened', per_page: '5' }).toString()}`,
      );
      const items = z.array(MergeRequestListItemSchema).parse(raw);
      const found = items.find((item) => item.source_branch === input.head);
      if (found === undefined) {
        return null;
      }
      return { id: String(found.iid), url: found.web_url, headSha: found.sha, state: found.state };
    },
    async listRepositories() {
      const raw = await request(token, '/projects?membership=true&per_page=100');
      return z.array(ProjectSchema).parse(raw).map((project) => ({
        id: String(project.id),
        fullName: project.path_with_namespace,
        isPrivate: project.visibility !== 'public',
      }));
    },
    async getPipelineBySha(input) {
      const raw = await request(
        token,
        `/projects/${encodeURIComponent(input.projectPath)}/pipelines?${new URLSearchParams({ sha: input.sha, per_page: '1' }).toString()}`,
      );
      const pipelines = z.array(PipelineSchema).parse(raw);
      const first = pipelines[0];
      if (first === undefined) {
        return null;
      }
      return { sha: first.sha, pipelineId: String(first.id), status: first.status };
    },
  });
}
