import { Octokit } from 'octokit';

import {
  ChangeProofError,
  GitShaSchema,
  IdSchema,
  type RepositoryConnection,
  type SecretBrokerPort,
} from '../../core/index.js';

/**
 * GitHub API client (WP3-22, FR3-30).
 *
 * Fetches exact commits and installation scope through broker-held tokens: the
 * token is read at call time from the broker and handed to the transport; it
 * is never stored here, never logged, and never embedded in errors. Every call
 * first asserts an `active` GitHub connection and an allowlisted repository —
 * revocation and wrong-provider misuse fail before any network happens.
 *
 * Authorization binds to the opaque repository id. Owner/repo slugs are
 * validated for shape (no traversal, no encoding tricks); their authenticity
 * against the installation is verified live once an authorized App exists —
 * that live proof stays blocked, and these pure tests do not claim it.
 */

export interface RepositoryRef {
  readonly id: string;
  readonly owner: string;
  readonly repo: string;
}

export interface CommitSnapshot {
  readonly sha: string;
  readonly message: string;
  readonly committedAt: string;
}

export interface AccessibleRepository {
  readonly id: string;
  readonly fullName: string;
  readonly isPrivate: boolean;
}

export interface BranchHead {
  readonly sha: string;
}

export interface PullRequestRef {
  readonly number: number;
  readonly url: string;
  readonly headSha: string;
  readonly state: string;
}

export interface OpenPullRequestCall {
  readonly owner: string;
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly title: string;
  readonly body: string;
}

/** Narrow transport seam: production uses Octokit, tests use fakes. */
export interface GitHubApi {
  getCommit(input: { owner: string; repo: string; sha: string }): Promise<CommitSnapshot>;
  listAccessibleRepositories(): Promise<readonly AccessibleRepository[]>;
  getBranchHead(input: { owner: string; repo: string; branch: string }): Promise<BranchHead>;
  openPullRequest(input: OpenPullRequestCall): Promise<PullRequestRef>;
  findPullRequestByHead(input: { owner: string; repo: string; head: string }): Promise<PullRequestRef | null>;
}

export type GitHubTransport = (token: string) => GitHubApi;

export interface FetchCommitInput {
  readonly connection: RepositoryConnection;
  readonly repository: RepositoryRef;
  readonly sha: string;
}

export interface InstallationScopeInput {
  readonly connection: RepositoryConnection;
}

export interface BranchHeadInput {
  readonly connection: RepositoryConnection;
  readonly repository: RepositoryRef;
  readonly branch: string;
}

export interface OpenPullRequestInput {
  readonly connection: RepositoryConnection;
  readonly repository: RepositoryRef;
  readonly base: string;
  readonly head: string;
  readonly title: string;
  readonly body: string;
}

export interface FindPullRequestInput {
  readonly connection: RepositoryConnection;
  readonly repository: RepositoryRef;
  readonly head: string;
}

export interface GitHubClient {
  fetchCommit(input: FetchCommitInput): Promise<CommitSnapshot>;
  listInstallationRepositories(input: InstallationScopeInput): Promise<readonly AccessibleRepository[]>;
  fetchBranchHead(input: BranchHeadInput): Promise<BranchHead>;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef>;
  findPullRequestByHead(input: FindPullRequestInput): Promise<PullRequestRef | null>;
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSlug(value: string, label: string): void {
  if (!SLUG.test(value)) {
    throw new ChangeProofError(`${label} is not a plain owner/repo slug; refusing to call.`);
  }
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function assertBranchName(value: string, label: string): void {
  if (
    !BRANCH.test(value) ||
    value.includes('..') ||
    value.includes('//') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.includes('@{')
  ) {
    throw new ChangeProofError(`${label} is not a safe git branch name; refusing to call.`);
  }
}

function assertAuthorizedGitHub(connection: RepositoryConnection, repositoryId?: string): void {
  if (connection.provider !== 'github') {
    throw new ChangeProofError(
      `Provider "${connection.provider}" is not served by the GitHub client; GitLab/Bitbucket arrive with WP3-32.`,
    );
  }
  if (connection.status !== 'active') {
    throw new ChangeProofError(
      'Repository connection is revoked or inactive; the provider is never called.',
    );
  }
  if (repositoryId !== undefined && !connection.repositoryAllowlist.includes(repositoryId)) {
    throw new ChangeProofError('Repository is not in the installation allowlist; refusing to fetch.');
  }
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return undefined;
}

/** Map a provider failure to a specific error; the token never escapes. */
function refuse(operation: string, error: unknown): never {
  const status = providerStatus(error);
  if (status === 404) {
    throw new ChangeProofError(`${operation}: not found or not visible to this installation.`);
  }
  if (status === 401) {
    throw new ChangeProofError(`${operation}: the installation credential was rejected; re-authorize the App.`);
  }
  if (status === 403) {
    throw new ChangeProofError(`${operation}: forbidden or rate-limited; check App permissions and retry later.`);
  }
  if (status !== undefined) {
    throw new ChangeProofError(`${operation}: provider refused with status ${String(status)}.`);
  }
  throw new ChangeProofError(`${operation}: provider unreachable or request failed before a response.`);
}

/** Production transport: one Octokit per call, auth from the broker token. */
export function octokitTransport(token: string): GitHubApi {
  if (token.length === 0) {
    throw new ChangeProofError('GitHub transport needs a broker token; refusing anonymous calls.');
  }
  const octokit = new Octokit({ auth: token });
  return {
    getCommit: async (input): Promise<CommitSnapshot> => {
      const response = await octokit.rest.repos.getCommit({
        owner: input.owner,
        repo: input.repo,
        ref: input.sha,
      });
      const commit = response.data.commit;
      return {
        sha: response.data.sha,
        message: commit.message,
        committedAt:
          commit.committer?.date ?? commit.author?.date ?? '1970-01-01T00:00:00.000Z',
      };
    },
    listAccessibleRepositories: async (): Promise<readonly AccessibleRepository[]> => {
      const response = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 });
      return response.data.repositories.map((repository) => ({
        id: String(repository.id),
        fullName: repository.full_name,
        isPrivate: repository.private,
      }));
    },
    getBranchHead: async (input): Promise<BranchHead> => {
      const response = await octokit.rest.repos.getBranch({
        owner: input.owner,
        repo: input.repo,
        branch: input.branch,
      });
      return { sha: response.data.commit.sha };
    },
    openPullRequest: async (input): Promise<PullRequestRef> => {
      const response = await octokit.rest.pulls.create({
        owner: input.owner,
        repo: input.repo,
        base: input.base,
        head: input.head,
        title: input.title,
        body: input.body,
      });
      return {
        number: response.data.number,
        url: response.data.html_url,
        headSha: response.data.head.sha,
        state: response.data.state,
      };
    },
    findPullRequestByHead: async (input): Promise<PullRequestRef | null> => {
      const response = await octokit.rest.pulls.list({
        owner: input.owner,
        repo: input.repo,
        head: `${input.owner}:${input.head}`,
        state: 'open',
      });
      const found = response.data[0];
      if (found === undefined) return null;
      return {
        number: found.number,
        url: found.html_url,
        headSha: found.head.sha,
        state: found.state,
      };
    },
  };
}

export function createGitHubClient(input: { broker: SecretBrokerPort; transport: GitHubTransport }): GitHubClient {
  return {
    async fetchCommit(fetch: FetchCommitInput): Promise<CommitSnapshot> {
      assertAuthorizedGitHub(fetch.connection, fetch.repository.id);
      const sha = GitShaSchema.parse(fetch.sha);
      assertSlug(fetch.repository.owner, 'Repository owner');
      assertSlug(fetch.repository.repo, 'Repository name');
      IdSchema.parse(fetch.repository.id);
      const token = await input.broker.readCredential(fetch.connection.credentialRef);
      try {
        const snapshot = await input.transport(token).getCommit({
          owner: fetch.repository.owner,
          repo: fetch.repository.repo,
          sha,
        });
        if (snapshot.sha !== sha) {
          throw new ChangeProofError('Provider returned a different commit than requested; refusing to accept it.');
        }
        return { sha: GitShaSchema.parse(snapshot.sha), message: snapshot.message, committedAt: snapshot.committedAt };
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Commit fetch failed.', error);
      }
    },

    async listInstallationRepositories(scope: InstallationScopeInput): Promise<readonly AccessibleRepository[]> {
      assertAuthorizedGitHub(scope.connection);
      const token = await input.broker.readCredential(scope.connection.credentialRef);
      try {
        return await input.transport(token).listAccessibleRepositories();
      } catch (error) {
        refuse('Installation scope read failed.', error);
      }
    },

    async fetchBranchHead(fetch: BranchHeadInput): Promise<BranchHead> {
      assertAuthorizedGitHub(fetch.connection, fetch.repository.id);
      assertBranchName(fetch.branch, 'Branch');
      assertSlug(fetch.repository.owner, 'Repository owner');
      assertSlug(fetch.repository.repo, 'Repository name');
      IdSchema.parse(fetch.repository.id);
      const token = await input.broker.readCredential(fetch.connection.credentialRef);
      try {
        const head = await input.transport(token).getBranchHead({
          owner: fetch.repository.owner,
          repo: fetch.repository.repo,
          branch: fetch.branch,
        });
        return { sha: GitShaSchema.parse(head.sha) };
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Branch head read failed.', error);
      }
    },

    async openPullRequest(open: OpenPullRequestInput): Promise<PullRequestRef> {
      assertAuthorizedGitHub(open.connection, open.repository.id);
      assertBranchName(open.base, 'Base branch');
      assertBranchName(open.head, 'Head branch');
      assertSlug(open.repository.owner, 'Repository owner');
      assertSlug(open.repository.repo, 'Repository name');
      IdSchema.parse(open.repository.id);
      if (open.title.length === 0 || open.body.length === 0) {
        throw new ChangeProofError('A pull request needs a non-empty title and body; refusing to open.');
      }
      const token = await input.broker.readCredential(open.connection.credentialRef);
      try {
        const pr = await input.transport(token).openPullRequest({
          owner: open.repository.owner,
          repo: open.repository.repo,
          base: open.base,
          head: open.head,
          title: open.title,
          body: open.body,
        });
        return checkedPullRequest(pr);
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Pull request open failed.', error);
      }
    },

    async findPullRequestByHead(find: FindPullRequestInput): Promise<PullRequestRef | null> {
      assertAuthorizedGitHub(find.connection, find.repository.id);
      assertBranchName(find.head, 'Head branch');
      assertSlug(find.repository.owner, 'Repository owner');
      assertSlug(find.repository.repo, 'Repository name');
      IdSchema.parse(find.repository.id);
      const token = await input.broker.readCredential(find.connection.credentialRef);
      try {
        const pr = await input.transport(token).findPullRequestByHead({
          owner: find.repository.owner,
          repo: find.repository.repo,
          head: find.head,
        });
        return pr === null ? null : checkedPullRequest(pr);
      } catch (error) {
        if (error instanceof ChangeProofError) {
          throw error;
        }
        refuse('Pull request lookup failed.', error);
      }
    },
  };
}

function checkedPullRequest(pr: PullRequestRef): PullRequestRef {
  if (!Number.isInteger(pr.number) || pr.number <= 0) {
    throw new ChangeProofError('Provider returned a malformed pull request number; refusing it.');
  }
  if (!pr.url.startsWith('https://')) {
    throw new ChangeProofError('Provider returned a non-https pull request URL; refusing it.');
  }
  return {
    number: pr.number,
    url: pr.url,
    headSha: GitShaSchema.parse(pr.headSha),
    state: pr.state,
  };
}
