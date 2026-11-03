import {
  ChangeProofError,
  InstantSchema,
  NonEmptyStringSchema,
  type ProviderBranchHead,
  type ProviderCommit,
  type ProviderCommitInput,
  type ProviderFindRequestInput,
  type ProviderHeadInput,
  type ProviderMergeRequest,
  type ProviderOpenRequestInput,
  type ProviderPipelineInput,
  type ProviderPipelineStatus,
  type ProviderRepository,
  type ProviderScopeInput,
  type RepositoryProviderPort,
  type SecretBrokerPort,
} from '../../core/index.js';

import {
  assertBranchName,
  assertConnectionActive,
  assertConnectionFor,
  assertProviderPath,
  assertSha,
} from './guards.js';

/**
 * Provider-neutral repository client (WP3-32, FR3-45).
 *
 * One client serves GitLab and Bitbucket: provider differences live in the
 * injected transport (URL shapes, auth headers, response mapping), while the
 * guards, the exact-head CI binding, and the failure discipline stay shared.
 * The credential is read at call time from the broker and handed to the
 * transport; it is never stored, logged, or embedded in errors. CI status
 * for any sha other than the requested head is a refusal, never an
 * attestation (NEG3-39).
 */

/** Narrow transport seam: production uses fetch, tests use fakes. */
export interface ProviderApi {
  getCommit(input: { projectPath: string; sha: string }): Promise<ProviderCommit>;
  getBranchHead(input: { projectPath: string; branch: string }): Promise<ProviderBranchHead>;
  openMergeRequest(input: {
    projectPath: string;
    base: string;
    head: string;
    title: string;
    body: string;
  }): Promise<ProviderMergeRequest>;
  findRequestByHead(input: {
    projectPath: string;
    head: string;
  }): Promise<ProviderMergeRequest | null>;
  listRepositories(): Promise<readonly ProviderRepository[]>;
  getPipelineBySha(input: {
    projectPath: string;
    sha: string;
  }): Promise<{ sha: string; pipelineId: string; status: string } | null>;
}

export type ProviderTransport = (token: string) => ProviderApi;

export function createProviderClient(input: {
  provider: 'gitlab' | 'bitbucket';
  transport: ProviderTransport;
  secrets: SecretBrokerPort;
}): RepositoryProviderPort {
  const provider = input.provider;
  const check = (
    connection: ProviderCommitInput['connection'],
    repositoryId: string,
    path: string,
  ): void => {
    assertConnectionFor(provider, connection, repositoryId);
    assertProviderPath(path, provider);
  };

  async function apiFor(connection: ProviderCommitInput['connection']): Promise<ProviderApi> {
    const token = await input.secrets.readCredential(connection.credentialRef);
    return input.transport(token);
  }

  return {
    provider,
    async fetchCommit(call: ProviderCommitInput): Promise<ProviderCommit> {
      check(call.connection, call.repository.id, call.repository.path);
      const sha = assertSha(call.sha);
      const api = await apiFor(call.connection);
      const commit = await api.getCommit({ projectPath: call.repository.path, sha });
      if (commit.sha !== sha) {
        throw new ChangeProofError('Provider returned a different commit than requested; refusing.');
      }
      return commit;
    },
    async fetchBranchHead(call: ProviderHeadInput): Promise<ProviderBranchHead> {
      check(call.connection, call.repository.id, call.repository.path);
      assertBranchName(call.branch);
      const api = await apiFor(call.connection);
      const head = await api.getBranchHead({ projectPath: call.repository.path, branch: call.branch });
      assertSha(head.sha);
      return head;
    },
    async openMergeRequest(call: ProviderOpenRequestInput): Promise<ProviderMergeRequest> {
      check(call.connection, call.repository.id, call.repository.path);
      assertBranchName(call.base);
      assertBranchName(call.head);
      const api = await apiFor(call.connection);
      const request = await api.openMergeRequest({
        projectPath: call.repository.path,
        base: call.base,
        head: call.head,
        title: NonEmptyStringSchema.parse(call.title),
        body: call.body,
      });
      assertSha(request.headSha);
      return request;
    },
    async findRequestByHead(call: ProviderFindRequestInput): Promise<ProviderMergeRequest | null> {
      check(call.connection, call.repository.id, call.repository.path);
      assertBranchName(call.head);
      const api = await apiFor(call.connection);
      return api.findRequestByHead({ projectPath: call.repository.path, head: call.head });
    },
    async listAccessibleRepositories(call: ProviderScopeInput): Promise<readonly ProviderRepository[]> {
      assertConnectionActive(provider, call.connection);
      const api = await apiFor(call.connection);
      return api.listRepositories();
    },
    async fetchHeadPipeline(call: ProviderPipelineInput): Promise<ProviderPipelineStatus> {
      check(call.connection, call.repository.id, call.repository.path);
      const sha = assertSha(call.sha);
      const fetchedAt = InstantSchema.parse(call.nowIso);
      const api = await apiFor(call.connection);
      const pipeline = await api.getPipelineBySha({ projectPath: call.repository.path, sha });
      if (pipeline === null) {
        throw new ChangeProofError('Provider reports no pipeline for this head; refusing to attest.');
      }
      if (pipeline.sha !== sha) {
        throw new ChangeProofError('Provider pipeline names a different sha; refusing to attest.');
      }
      return { sha, pipelineId: pipeline.pipelineId, status: pipeline.status, fetchedAt };
    },
  };
}
