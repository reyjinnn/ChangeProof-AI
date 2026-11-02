import { ChangeProofError, GitShaSchema, Sha256Schema } from '../../core/index.js';

import { assertBranchName, assertSlug } from './client.js';

/**
 * Evidence publication planning (WP3-12): branch names and PR payloads.
 *
 * Pure shaping and validation only. Branch names are allowlisted so a later
 * git/transport execution cannot meet shell metacharacters, traversal, or
 * ref-format tricks. Execution and credentials stay in the client/transport.
 */

const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 8000;

export interface EvidenceBranchPlan {
  readonly branch: string;
  readonly base: string;
  readonly headSha: string;
}

export function planEvidenceBranch(input: {
  idempotencyKey: string;
  base: string;
  headSha: string;
}): EvidenceBranchPlan {
  const key = Sha256Schema.parse(input.idempotencyKey);
  assertBranchName(input.base, 'Base branch');
  const headSha = GitShaSchema.parse(input.headSha);
  return { branch: `changeproof/ev-${key.slice(0, 12)}`, base: input.base, headSha };
}

export interface PullRequestPayload {
  readonly owner: string;
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly title: string;
  readonly body: string;
  readonly manifestDigest: string;
}

export function assemblePullRequestPayload(input: {
  owner: string;
  repo: string;
  base: string;
  head: string;
  title: string;
  body: string;
  manifestDigest: string;
}): PullRequestPayload {
  assertSlug(input.owner, 'Repository owner');
  assertSlug(input.repo, 'Repository name');
  assertBranchName(input.base, 'Base branch');
  assertBranchName(input.head, 'Head branch');
  if (input.title.length === 0 || input.title.length > MAX_TITLE_CHARS) {
    throw new ChangeProofError(`PR title must be 1-${MAX_TITLE_CHARS} characters.`);
  }
  if (input.body.length === 0 || input.body.length > MAX_BODY_CHARS) {
    throw new ChangeProofError(`PR body must be 1-${MAX_BODY_CHARS} characters.`);
  }
  const manifestDigest = Sha256Schema.parse(input.manifestDigest);
  return {
    owner: input.owner,
    repo: input.repo,
    base: input.base,
    head: input.head,
    title: input.title,
    body: input.body,
    manifestDigest,
  };
}
