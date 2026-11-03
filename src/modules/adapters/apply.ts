import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import { AdapterPatchSchema, ChangeProofError, digestAdapterPatch } from '../../core/index.js';

import type { AdapterApplyInput, AdapterApplyResult } from './types.js';

/**
 * Shared patch applier for every adapter (FR3-09).
 *
 * The applier writes bytes; it authorizes nothing. Every operation needs a
 * matching gateway authorization handed in as data (the orchestrator obtains
 * it through the typed gateway), and the patch digest must still match what
 * was reviewed — a candidate that changed after review is refused (NEG3-07).
 */

function splitSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function assertCovered(path: string, authorizedRoot: string): void {
  if (path.length === 0 || path.includes('\\') || path.startsWith('/')) {
    throw new ChangeProofError(`Refusing to apply "${path}": not a snapshot-relative path.`);
  }
  const segments = splitSegments(path);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new ChangeProofError(`Refusing to apply "${path}": path escapes or names no file.`);
  }
  if (authorizedRoot === '') return;
  const root = splitSegments(authorizedRoot);
  const covered = root.length <= segments.length && root.every((segment, index) => segments[index] === segment);
  if (!covered) {
    throw new ChangeProofError(`Refusing to apply "${path}": outside authorized root "${authorizedRoot}".`);
  }
}

export async function applyAdapterPatch(input: AdapterApplyInput): Promise<AdapterApplyResult> {
  const patch = AdapterPatchSchema.parse(input.patch);
  if (digestAdapterPatch(patch) !== patch.patchDigest) {
    throw new ChangeProofError('Patch digest does not match the reviewed operations; refusing a changed candidate.');
  }
  const applied: string[] = [];
  for (const operation of patch.operations) {
    const authorization = input.authorizations.find((candidate) => candidate.path === operation.path);
    if (authorization === undefined) {
      throw new ChangeProofError(`Refusing to apply "${operation.path}": no gateway authorization covers it.`);
    }
    assertCovered(operation.path, authorization.authorizedRoot);
    const target = join(input.root, operation.path);
    // A planted symlink must not redirect the write outside the snapshot:
    // refuse a symlinked target and re-resolve the parent after creating it.
    try {
      if ((await lstat(target)).isSymbolicLink()) {
        throw new ChangeProofError(`Refusing to apply "${operation.path}": target is a symlink.`);
      }
    } catch (error) {
      if (error instanceof ChangeProofError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(dirname(target), { recursive: true });
    const realRoot = await realpath(input.root);
    const realParent = await realpath(dirname(target));
    if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${sep}`)) {
      throw new ChangeProofError(`Refusing to apply "${operation.path}": parent escapes the snapshot.`);
    }
    await writeFile(target, operation.content, 'utf8');
    applied.push(operation.path);
  }
  return { applied, patchDigest: patch.patchDigest };
}
