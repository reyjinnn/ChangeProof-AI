import { ChangeProofError, Sha256Schema } from '../../core/index.js';

/**
 * Protected oracle freeze (WP3-06, FR3-15).
 *
 * Preparation scope: the freeze-and-verify core. A trusted author pins the
 * oracle digest with its scope before the run; the verifier mounts it
 * read-only outside the candidate workspace (`planGuestRun` already enforces
 * the mount boundary) and every stage checks the digest it actually used
 * against the frozen one. A drift invalidates the proof — other passes never
 * rescue it (NEG3-03) — and the oracle, budget, support level, and thresholds
 * never change to pass the candidate under assessment. Real old-valid /
 * new-attributed-failure proof on an actual app+DB+broker stays `blocked`.
 */

export interface FreezeOracleInput {
  readonly oracleDigest: string;
  readonly authorId: string;
  readonly frozenAt: string;
  readonly scopeDigest: string;
}

export interface FrozenOracle {
  readonly schemaVersion: '1';
  readonly oracleDigest: string;
  readonly frozenOracleDigest: string;
  readonly authorId: string;
  readonly frozenAt: string;
  readonly scopeDigest: string;
}

/** Pin an oracle under a trusted author identity. Untrusted input fails closed. */
export function freezeOracle(input: FreezeOracleInput): FrozenOracle {
  const digest = Sha256Schema.safeParse(input.oracleDigest);
  if (!digest.success) {
    throw new ChangeProofError('Oracle digest is malformed; garbage is never pinned as truth.');
  }
  const scope = Sha256Schema.safeParse(input.scopeDigest);
  if (!scope.success) {
    throw new ChangeProofError('Oracle scope digest is malformed; an unscoped oracle is never frozen.');
  }
  if (input.authorId.length === 0) {
    throw new ChangeProofError('Oracle needs a trusted author; authorless freezes are not proof.');
  }
  if (!Number.isFinite(Date.parse(input.frozenAt))) {
    throw new ChangeProofError('Freeze time is unreadable; trust is never backdated.');
  }
  return {
    schemaVersion: '1',
    oracleDigest: digest.data,
    frozenOracleDigest: digest.data,
    authorId: input.authorId,
    frozenAt: input.frozenAt,
    scopeDigest: scope.data,
  };
}

/** A stage passes only with the frozen digest; drift invalidates the proof. */
export function assertOracleUnchanged(frozen: FrozenOracle, actualDigest: string): void {
  if (actualDigest !== frozen.frozenOracleDigest) {
    throw new ChangeProofError(
      'Oracle drifted from the frozen digest; the proof is invalid and no other pass rescues it (NEG3-03).',
    );
  }
}
