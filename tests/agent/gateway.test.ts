import { describe, expect, it } from 'vitest';

import {
  assertLinkFree,
  assertNoPathCollision,
  authorizeMutation,
  reviewPatch,
} from '../../src/modules/agent/index.js';

/**
 * WP3-07 / T-20 — typed mutation gateway and patch guard (FR3-07/09, NEG3-04/10).
 *
 * Written before the implementation. Mutations pass only through an explicit
 * path/operation allowlist: traversal, encoding tricks, protected roots,
 * scope creep, oversized patches, and test/auth deletions are rejected with
 * specific reasons. The guard is report-only — it never applies anything.
 */

const ROOTS = {
  writableRoots: ['customer/acme/src'],
  protectedRoots: ['customer/acme/src/oracle', 'src/modules/policy', 'src/modules/verifier'],
  allowedOperations: ['write_file', 'edit_file'],
  maxSizeBytes: 100_000,
};

describe('path authorization (NEG3-10)', () => {
  it('authorizes a plain in-scope write', () => {
    const authorized = authorizeMutation({ ...ROOTS, operation: 'write_file', path: 'customer/acme/src/a.ts' });

    expect(authorized.relativePath).toBe('a.ts');
  });

  it('rejects traversal escapes, absolute paths, and encoding tricks', () => {
    for (const path of [
      'customer/acme/src/../../etc/passwd',
      'customer/acme/src/..\\..\\windows',
      '/etc/passwd',
      'C:\\windows\\file',
      'customer/acme/src/%2e%2e/secret',
      'customer/acme/src/a.ts\0',
      'customer/acme/src/././../secret',
      '../customer/acme/src/a.ts',
      '',
    ]) {
      expect(() => authorizeMutation({ ...ROOTS, operation: 'write_file', path })).toThrow(
        /escape|absolute|encoding|empty|outside|nul|control/i,
      );
    }
  });

  it('normalizes harmless dot segments instead of rejecting them', () => {
    const authorized = authorizeMutation({ ...ROOTS, operation: 'edit_file', path: 'customer/acme/src/./a.ts' });

    expect(authorized.relativePath).toBe('a.ts');
  });

  it('rejects writes outside the writable roots', () => {
    expect(() => authorizeMutation({ ...ROOTS, operation: 'write_file', path: 'customer/other/src/a.ts' })).toThrow(
      /outside|writable/i,
    );
  });

  it('rejects protected roots even when nested inside writable ones', () => {
    expect(() => authorizeMutation({ ...ROOTS, operation: 'edit_file', path: 'customer/acme/src/oracle/check.ts' }))
      .toThrow(/protected/i);
  });

  it('rejects operations outside the allowlist and oversized patches', () => {
    expect(() => authorizeMutation({ ...ROOTS, operation: 'delete_file', path: 'customer/acme/src/a.ts' })).toThrow(
      /operation/i,
    );
    expect(() =>
      authorizeMutation({ ...ROOTS, operation: 'write_file', path: 'customer/acme/src/a.ts', sizeBytes: 100_001 }),
    ).toThrow(/size|oversized/i);
  });
});

describe('collisions and links (AGENTS §9)', () => {
  it('rejects a case-variant of a known path', () => {
    expect(() => { assertNoPathCollision(['src/App.ts'], 'src/app.ts'); }).toThrow(/collision/i);
    expect(() => { assertNoPathCollision(['src/App.ts'], 'src/App.ts'); }).not.toThrow();
    expect(() => { assertNoPathCollision(['src/App.ts'], 'src/Other.ts'); }).not.toThrow();
  });

  it('rejects symlinks and hardlinked files', () => {
    expect(() => { assertLinkFree({ isSymbolicLink: true, hardLinkCount: 1 }); }).toThrow(/symlink/i);
    expect(() => { assertLinkFree({ isSymbolicLink: false, hardLinkCount: 2 }); }).toThrow(/hardlink/i);
    expect(() => { assertLinkFree({ isSymbolicLink: false, hardLinkCount: 1 }); }).not.toThrow();
  });
});

describe('patch guard is report-only (NEG3-04)', () => {
  const scope = {
    ...ROOTS,
    approvedScope: ['customer/acme/src/orders.ts', 'customer/acme/src/cart.ts'],
  };

  it('accepts a scoped patch with no violations', () => {
    const report = reviewPatch({
      ...scope,
      operations: [{ operation: 'edit_file', path: 'customer/acme/src/orders.ts', sizeBytes: 500 }],
    });

    expect(report.accepted).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it('rejects a patch that deletes tests or weakens checks', () => {
    const report = reviewPatch({
      ...scope,
      writableRoots: ['customer/acme/src', 'customer/acme/tests'],
      allowedOperations: ['write_file', 'edit_file', 'delete_file'],
      approvedScope: ['customer/acme/src/orders.ts', 'customer/acme/tests/orders.test.ts'],
      operations: [
        { operation: 'delete_file', path: 'customer/acme/tests/orders.test.ts' },
        { operation: 'edit_file', path: 'customer/acme/src/orders.ts' },
      ],
    });

    expect(report.accepted).toBe(false);
    expect(report.violations.join('\n')).toMatch(/test/i);
  });

  it('rejects scope creep as needs-revision instead of silently allowing it', () => {
    const report = reviewPatch({
      ...scope,
      operations: [{ operation: 'edit_file', path: 'customer/acme/src/billing.ts' }],
    });

    expect(report.accepted).toBe(false);
    expect(report.violations.join('\n')).toMatch(/scope/i);
  });

  it('collects every violation instead of stopping at the first', () => {
    const report = reviewPatch({
      ...scope,
      operations: [
        { operation: 'edit_file', path: 'customer/acme/src/billing.ts' },
        { operation: 'edit_file', path: 'customer/acme/src/oracle/check.ts' },
        { operation: 'delete_file', path: 'customer/acme/src/cart.ts' },
      ],
    });

    expect(report.accepted).toBe(false);
    expect(report.violations).toHaveLength(3);
  });
});
