import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AdapterCheckPlanSchema,
  AdapterFixRequestSchema,
  AdapterPatchSchema,
  ChangeProofError,
  digestAdapterPatch,
  type AdapterPatch,
} from '../../src/core/index.js';
import { applyAdapterPatch } from '../../src/modules/adapters/index.js';
import { createFixture } from './fixtures.js';

function fixRequest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1',
    requestId: 'req-001',
    changeKind: 'field_rename',
    entity: 'client.OrderDto',
    before: 'totalCents',
    after: 'amountCents',
    intentRef: 'intent-001',
    scope: ['src'],
    ...overrides,
  };
}

function patchFixture(): AdapterPatch {
  const operations = [
    {
      operation: 'write' as const,
      path: 'src/orders/checkout.ts',
      content: 'export const total = 1;\n',
      impactRefs: ['edge:component:src/orders/checkout.ts->symbol:client#OrderDto'],
    },
  ];
  const intentRefs = ['intent-001'];
  return AdapterPatchSchema.parse({
    schemaVersion: '1',
    patchId: 'patch-001',
    intentRefs,
    operations,
    patchDigest: digestAdapterPatch({ intentRefs, operations }),
  });
}

describe('adapter fix request contract', () => {
  it('accepts a well-formed field rename request', () => {
    expect(AdapterFixRequestSchema.parse(fixRequest()).changeKind).toBe('field_rename');
  });

  it('rejects a request with identical before/after', () => {
    expect(() => AdapterFixRequestSchema.parse(fixRequest({ after: 'totalCents' }))).toThrow();
  });

  it('rejects a request with an empty scope', () => {
    expect(() => AdapterFixRequestSchema.parse(fixRequest({ scope: [] }))).toThrow();
  });

  it('rejects an unknown change kind', () => {
    expect(() => AdapterFixRequestSchema.parse(fixRequest({ changeKind: 'rewrite_everything' }))).toThrow();
  });
});

describe('adapter patch digest', () => {
  it('is stable across operation and key order', () => {
    const first = patchFixture();
    const reordered = AdapterPatchSchema.parse({
      ...first,
      patchId: 'patch-002',
      intentRefs: [...first.intentRefs],
      operations: [...first.operations].reverse(),
    });
    expect(digestAdapterPatch(reordered)).toBe(first.patchDigest);
  });

  it('changes when any operation content changes', () => {
    const first = patchFixture();
    const op = first.operations[0];
    if (op === undefined) throw new Error('fixture op is missing');
    const changed = {
      ...first,
      operations: [{ ...op, content: 'export const total = 2;\n' }],
    };
    expect(digestAdapterPatch(changed)).not.toBe(first.patchDigest);
  });
});

describe('shared patch applier', () => {
  it('writes an authorized patch and reports what it applied', async () => {
    const fixture = createFixture({});
    try {
      const patch = patchFixture();
      const result = await applyAdapterPatch({
        root: fixture.root,
        patch,
        authorizations: [{ operation: 'write', path: 'src/orders/checkout.ts', authorizedRoot: 'src' }],
      });
      expect(result.applied).toEqual(['src/orders/checkout.ts']);
      expect(result.patchDigest).toBe(patch.patchDigest);
      expect(readFileSync(`${fixture.root}/src/orders/checkout.ts`, 'utf8')).toBe('export const total = 1;\n');
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses an operation without a matching authorization', async () => {
    const fixture = createFixture({});
    try {
      await expect(
        applyAdapterPatch({ root: fixture.root, patch: patchFixture(), authorizations: [] }),
      ).rejects.toBeInstanceOf(ChangeProofError);
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses a patch whose digest no longer matches its operations', async () => {
    const fixture = createFixture({});
    try {
      const patch = patchFixture();
      const op = patch.operations[0];
      if (op === undefined) throw new Error('fixture op is missing');
      const tampered = {
        ...patch,
        operations: [{ ...op, content: 'tampered\n' }],
      } as AdapterPatch;
      await expect(
        applyAdapterPatch({
          root: fixture.root,
          patch: tampered,
          authorizations: [{ operation: 'write', path: 'src/orders/checkout.ts', authorizedRoot: '' }],
        }),
      ).rejects.toThrow(/digest/);
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses a traversal path even when an authorization is present', async () => {
    const fixture = createFixture({});
    try {
      const operations = [
        { operation: 'write' as const, path: '../escape.ts', content: 'x', impactRefs: ['edge:1'] },
      ];
      const intentRefs = ['intent-001'];
      const patch = AdapterPatchSchema.parse({
        schemaVersion: '1',
        patchId: 'patch-escape',
        intentRefs,
        operations,
        patchDigest: digestAdapterPatch({ intentRefs, operations }),
      });
      await expect(
        applyAdapterPatch({
          root: fixture.root,
          patch,
          authorizations: [{ operation: 'write', path: '../escape.ts', authorizedRoot: '' }],
        }),
      ).rejects.toThrow(/escapes|snapshot-relative/);
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses to write through a planted symlink', async () => {
    const fixture = createFixture({ 'src/orders/checkout.ts': 'original\n' });
    try {
      const { symlinkSync } = await import('node:fs');
      const link = `${fixture.root}/src/orders/link.ts`;
      try {
        symlinkSync(`${fixture.root}/src/orders/checkout.ts`, link);
      } catch {
        return; // symlink creation needs privileges the host may not grant; nothing to prove here
      }
      const operations = [
        { operation: 'write' as const, path: 'src/orders/link.ts', content: 'x', impactRefs: ['edge:1'] },
      ];
      const intentRefs = ['intent-001'];
      const patch = AdapterPatchSchema.parse({
        schemaVersion: '1',
        patchId: 'patch-link',
        intentRefs,
        operations,
        patchDigest: digestAdapterPatch({ intentRefs, operations }),
      });
      await expect(
        applyAdapterPatch({
          root: fixture.root,
          patch,
          authorizations: [{ operation: 'write', path: 'src/orders/link.ts', authorizedRoot: '' }],
        }),
      ).rejects.toThrow(/symlink/);
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses an operation outside its authorized root', async () => {
    const fixture = createFixture({});
    try {
      await expect(
        applyAdapterPatch({
          root: fixture.root,
          patch: patchFixture(),
          authorizations: [{ operation: 'write', path: 'src/orders/checkout.ts', authorizedRoot: 'other' }],
        }),
      ).rejects.toThrow(/outside authorized root/);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('adapter check plan contract', () => {
  it('rejects a plan with no checks', () => {
    expect(() =>
      AdapterCheckPlanSchema.parse({
        schemaVersion: '1',
        planId: 'plan-001',
        patchDigest: '0'.repeat(64),
        checks: [],
        runnerIdentity: 'node-linux',
      }),
    ).toThrow();
  });

  it('rejects a check without a positive timeout', () => {
    expect(() =>
      AdapterCheckPlanSchema.parse({
        schemaVersion: '1',
        planId: 'plan-001',
        patchDigest: '0'.repeat(64),
        checks: [{ checkId: 'build', kind: 'build', command: 'pnpm', args: [], cwd: '/tmp/x', timeoutMs: 0 }],
        runnerIdentity: 'node-linux',
      }),
    ).toThrow();
  });
});
