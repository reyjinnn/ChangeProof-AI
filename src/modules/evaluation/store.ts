import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ChangeProofError,
  Sha256Schema,
  type EvalManifest,
} from '../../core/index.js';

import { sha256Hex } from './canonical.js';

/**
 * Content-addressed case store (WP3-13, FR3-24).
 *
 * Case inputs live here by digest; manifests and results carry digests only.
 * Reads are role-checked against the manifest: holdout bytes refuse proposer
 * reads even by digest, and unknown digests fail closed (NEG3-03). The store
 * holds dev bytes during development; frozen holdout bytes arrive with the
 * phase-7 trusted dataset, behind these same checks.
 */

export type EvalRole = 'proposer' | 'evaluator';

export interface EvalCaseStore {
  put(text: string): string;
  has(digest: string): boolean;
  get(digest: string, role: EvalRole, manifest: EvalManifest): string;
}

export function createFileCaseStore(dir: string): EvalCaseStore {
  if (dir.length === 0) {
    throw new ChangeProofError('Case store dir is empty; refusing.');
  }
  mkdirSync(dir, { recursive: true });

  const pathFor = (digest: string): string => {
    const valid = Sha256Schema.parse(digest);
    return join(dir, `${valid}.txt`);
  };

  return {
    put(text: string): string {
      if (text.length === 0) {
        throw new ChangeProofError('Case input is empty; refusing to store it.');
      }
      const digest = sha256Hex(text);
      const path = pathFor(digest);
      if (existsSync(path)) {
        const current = readFileSync(path, 'utf8');
        if (current !== text) {
          throw new ChangeProofError('Case store digest collision; refusing to overwrite.');
        }
        return digest;
      }
      writeFileSync(path, text, 'utf8');
      return digest;
    },

    has(digest: string): boolean {
      return existsSync(pathFor(digest));
    },

    get(digest: string, role: EvalRole, manifest: EvalManifest): string {
      const valid = Sha256Schema.parse(digest);
      const owner = manifest.cases.find((c) => c.inputDigest === valid);
      if (owner === undefined) {
        throw new ChangeProofError('Case digest is unknown to this manifest; refusing.');
      }
      if (owner.dataset === 'holdout' && role === 'proposer') {
        throw new ChangeProofError('Holdout bytes are not available to the proposer role; refusing.');
      }
      const path = pathFor(valid);
      if (!existsSync(path)) {
        throw new ChangeProofError('Case bytes are missing from the store; refusing.');
      }
      return readFileSync(path, 'utf8');
    },
  };
}
