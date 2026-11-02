import { ChangeProofError, NonEmptyStringSchema } from '../../core/index.js';

/**
 * Typed mutation gateway (WP3-07, FR3-07/09).
 *
 * Product-agent source mutations pass only through this authorizer: an
 * explicit path/operation allowlist plus protected roots that nothing
 * overrides. Paths are validated lexically — traversal escapes, absolute
 * paths, Windows-isms, encoding tricks, and control characters are rejected
 * before any comparison — then matched against writable roots and
 * protected roots on whole segments. Case-variant collisions, symlinks, and
 * hardlinked files are refused through caller-supplied tree state, since
 * only the filesystem holder can observe them. Oversized patches need an
 * explicit cap; there is no silent default.
 */

export interface MutationAuthorization {
  readonly operation: string;
  readonly path: string;
  readonly writableRoots: readonly string[];
  readonly protectedRoots: readonly string[];
  readonly allowedOperations: readonly string[];
  readonly sizeBytes?: number;
  readonly maxSizeBytes?: number;
}

function splitSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
}

/**
 * Lexically normalize a relative path. `..` pops one segment; popping past
 * the start is an escape, never silently clamped.
 */
function normalizeRelative(path: string, name: string): string[] {
  if (path.length === 0) {
    throw new ChangeProofError(`${name} is empty; refusing.`);
  }
  if (path.includes('\0')) {
    throw new ChangeProofError(`${name} carries a NUL byte; refusing.`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(path)) {
    throw new ChangeProofError(`${name} carries control characters; refusing.`);
  }
  if (path.includes('\\') || /^[A-Za-z]:/.test(path) || path.startsWith('/')) {
    throw new ChangeProofError(`${name} is absolute or Windows-shaped; only relative snapshot paths authorize.`);
  }
  if (path.includes('%')) {
    throw new ChangeProofError(`${name} carries percent-encoding; refusing an encoding trick.`);
  }
  const normalized: string[] = [];
  for (const segment of splitSegments(path)) {
    if (segment === '..') {
      const popped = normalized.pop();
      if (popped === undefined) {
        throw new ChangeProofError(`${name} escapes its root; refusing.`);
      }
    } else {
      normalized.push(segment);
    }
  }
  if (normalized.length === 0) {
    throw new ChangeProofError(`${name} names no file; refusing.`);
  }
  return normalized;
}

function underRoot(segments: readonly string[], root: readonly string[]): boolean {
  if (root.length > segments.length) {
    return false;
  }
  return root.every((segment, index) => segments[index] === segment);
}

/**
 * Authorize one mutation. Returns the writable root it landed in and the
 * root-relative path. Every rejection names the rule that fired.
 */
export function authorizeMutation(input: MutationAuthorization): { root: string; relativePath: string } {
  const operation = NonEmptyStringSchema.parse(input.operation);
  if (input.allowedOperations.length === 0) {
    throw new ChangeProofError('Mutation allowlist is empty; nothing authorizes.');
  }
  if (!input.allowedOperations.includes(operation)) {
    throw new ChangeProofError(`Operation "${operation}" is not in the mutation allowlist; refusing.`);
  }
  if (input.sizeBytes !== undefined) {
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
      throw new ChangeProofError('Patch size is unreadable; refusing.');
    }
    if (input.maxSizeBytes === undefined) {
      throw new ChangeProofError('Patch size has no explicit cap; refusing an uncapped write.');
    }
    if (input.sizeBytes > input.maxSizeBytes) {
      throw new ChangeProofError(
        `Patch size ${input.sizeBytes} exceeds the explicit cap ${input.maxSizeBytes}; refusing.`,
      );
    }
  }
  if (input.writableRoots.length === 0) {
    throw new ChangeProofError('Writable roots are empty; nothing authorizes.');
  }
  const segments = normalizeRelative(input.path, 'Mutation path');
  // A '.' root is the whole snapshot; anything else names an explicit subtree.
  const roots = input.writableRoots.map((root) =>
    root === '.' || root === '' ? [] : normalizeRelative(root, 'Writable root'),
  );
  const matched = roots.find((root) => underRoot(segments, root));
  if (matched === undefined) {
    throw new ChangeProofError('Mutation path is outside every writable root; refusing.');
  }
  for (const protectedRoot of input.protectedRoots) {
    if (underRoot(segments, normalizeRelative(protectedRoot, 'Protected root'))) {
      throw new ChangeProofError('Mutation path is inside a protected root; refusing.');
    }
  }
  return { root: matched.join('/'), relativePath: segments.slice(matched.length).join('/') };
}

/**
 * Reject a candidate that collides with a known path up to case. The caller
 * supplies the tree listing; comparison folds ASCII case only.
 */
export function assertNoPathCollision(knownPaths: readonly string[], candidate: string): void {
  const folded = candidate.toLowerCase();
  for (const known of knownPaths) {
    if (known !== candidate && known.toLowerCase() === folded) {
      throw new ChangeProofError(`Path collision with "${known}" (up to case); refusing.`);
    }
  }
}

/** Reject symlinks and hardlinked files from caller-observed file state. */
export function assertLinkFree(stat: { isSymbolicLink: boolean; hardLinkCount: number }): void {
  if (stat.isSymbolicLink) {
    throw new ChangeProofError('Path is a symlink; links never authorize as write targets.');
  }
  if (!Number.isInteger(stat.hardLinkCount) || stat.hardLinkCount < 1) {
    throw new ChangeProofError('Link count is unreadable; refusing.');
  }
  if (stat.hardLinkCount > 1) {
    throw new ChangeProofError('Path is hardlinked to a shared inode; hardlinks never authorize as write targets.');
  }
}
