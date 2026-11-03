import {
  ChangeProofError,
  GitShaSchema,
  IdSchema,
  type RepositoryConnection,
  type RepositoryProvider,
} from '../../core/index.js';

/**
 * Shared provider guards (WP3-32, FR3-45).
 *
 * Every provider call passes the same three gates before any network
 * happens: the connection names this provider, it is still active, and the
 * repository is allowlisted. Paths and branch names are shape-checked so a
 * traversal or encoding trick never reaches a URL or a command (NEG3-39).
 */

const PATH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const BRANCH_NAME = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

export function assertProviderPath(path: string, provider: RepositoryProvider): void {
  if (path.length === 0 || path.length > 400) {
    throw new ChangeProofError('Repository path is empty or too long; refusing.');
  }
  const segments = path.split('/');
  if (provider === 'bitbucket' && segments.length !== 2) {
    throw new ChangeProofError('Bitbucket path must be workspace/repo; refusing.');
  }
  for (const segment of segments) {
    if (!PATH_SEGMENT.test(segment) || segment === '..' || segment === '.') {
      throw new ChangeProofError(`Repository path segment "${segment}" is not safe; refusing.`);
    }
  }
}

export function assertBranchName(branch: string): void {
  if (!BRANCH_NAME.test(branch) || branch.includes('..') || branch.includes('//')) {
    throw new ChangeProofError('Branch name is not safe; refusing.');
  }
}

export function assertConnectionActive(
  provider: 'gitlab' | 'bitbucket',
  connection: RepositoryConnection,
): void {
  if (connection.provider !== provider) {
    throw new ChangeProofError(
      `Connection names provider "${connection.provider}", not "${provider}"; refusing a provider mismatch.`,
    );
  }
  if (connection.status !== 'active') {
    throw new ChangeProofError('Repository connection is revoked or inactive; refusing new effects.');
  }
  if (connection.repositoryAllowlist.length === 0) {
    throw new ChangeProofError('Connection has an empty repository allowlist; refusing.');
  }
}

export function assertConnectionFor(
  provider: 'gitlab' | 'bitbucket',
  connection: RepositoryConnection,
  repositoryId: string,
): void {
  assertConnectionActive(provider, connection);
  if (!connection.repositoryAllowlist.includes(IdSchema.parse(repositoryId))) {
    throw new ChangeProofError('Repository is not allowlisted on this connection; refusing.');
  }
}

export function assertSha(sha: string): string {
  return GitShaSchema.parse(sha);
}
