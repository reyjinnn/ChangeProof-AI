import { describe, expect, it } from 'vitest';

import {
  assertOracleUnchanged,
  freezeOracle,
  type FrozenOracle,
} from '../../src/modules/fixtures/index.js';

/**
 * WP3-06 / T2-4 — oracle freeze failure-path tests (NEG3-03).
 *
 * Written before the implementation. The oracle is frozen before the run by a
 * trusted author, mounted read-only outside the candidate workspace, and
 * never changed to pass the candidate being assessed. A changed oracle
 * invalidates the proof, and other full passes do not rescue it. Real
 * old-valid/new-attributed-failure proof on an actual app+DB+broker stays
 * `blocked`; this is the freeze-and-verify core.
 */

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const SCOPE = 'c'.repeat(64);

function frozen(overrides: Partial<FrozenOracle> = {}): FrozenOracle {
  return freezeOracle({
    oracleDigest: DIGEST_A,
    authorId: 'owner-1',
    frozenAt: '2026-10-29T02:00:00.000Z',
    scopeDigest: SCOPE,
    ...overrides,
  });
}

describe('oracle freeze and drift detection (NEG3-03)', () => {
  it('freezes an oracle with its author, time, and scope', () => {
    const record = frozen();

    expect(record.oracleDigest).toBe(DIGEST_A);
    expect(record.frozenOracleDigest).toBe(DIGEST_A);
    expect(record.scopeDigest).toBe(SCOPE);
  });

  it('accepts the run when the oracle still matches the freeze', () => {
    expect(() => { assertOracleUnchanged(frozen(), DIGEST_A); }).not.toThrow();
  });

  it('invalidates the proof when the oracle drifted, whatever else passed', () => {
    expect(() => { assertOracleUnchanged(frozen(), DIGEST_B); }).toThrow(/oracle.*(drift|changed|invalid)/i);
  });

  it('refuses to freeze an oracle without an author (untrusted provenance)', () => {
    expect(() =>
      freezeOracle({ oracleDigest: DIGEST_A, authorId: '', frozenAt: '2026-10-29T02:00:00.000Z', scopeDigest: SCOPE }),
    ).toThrow(/author/);
  });

  it('refuses to freeze a malformed digest instead of pinning garbage', () => {
    expect(() =>
      freezeOracle({ oracleDigest: 'not-a-digest', authorId: 'owner-1', frozenAt: '2026-10-29T02:00:00.000Z', scopeDigest: SCOPE }),
    ).toThrow(/digest/);
  });

  it('refuses an unreadable freeze time instead of backdating trust', () => {
    expect(() =>
      freezeOracle({ oracleDigest: DIGEST_A, authorId: 'owner-1', frozenAt: 'yesterday', scopeDigest: SCOPE }),
    ).toThrow(/time/);
  });
});
