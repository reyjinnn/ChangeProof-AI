import { describe, expect, it } from 'vitest';

import {
  DanglingReferenceError,
  SystemGraphSchema,
  VerifyResultSchema,
  assertGraphReferencesResolve,
} from '../../src/core/index.js';

/**
 * WP3-01 / T1-1 — semantic validation negatives.
 *
 * Shape validation is not enough. These cases prove the contract rejects
 * structurally valid but semantically incoherent input:
 *
 *  - a dangling reference (NEG3-06: a target pass whose required edge is absent)
 *  - an unresolved dynamic edge silently promoted to `proven` (NEG3-02)
 *  - an oracle that changed after freeze (NEG3-03)
 */
describe('SystemGraph edge provenance (NEG3-02)', () => {
  const node = (id: string) => ({ id, kind: 'symbol' as const, locator: `src/${id}.ts`, snapshot: 'snap-1' });

  const edge = (overrides: Record<string, unknown> = {}) => ({
    id: 'edge-1',
    kind: 'calls' as const,
    from: 'consumer-a',
    to: 'orders-api',
    resolution: 'proven' as const,
    evidence: { locator: 'src/consumer-a/client.ts:42', snapshot: 'snap-1', method: 'ts-morph-reference' },
    ...overrides,
  });

  const graph = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const,
    snapshot: 'snap-1',
    nodes: [node('consumer-a'), node('orders-api')],
    edges: [edge()],
    ...overrides,
  });

  it('accepts a fully resolved graph', () => {
    expect(SystemGraphSchema.parse(graph()).edges[0]?.resolution).toBe('proven');
  });

  it('accepts an unresolved edge as long as it stays marked unresolved', () => {
    const g = graph({
      edges: [
        edge({
          resolution: 'unresolved',
          evidence: undefined,
          unresolvedReason: 'dynamic property access through a computed key',
        }),
      ],
    });
    expect(SystemGraphSchema.parse(g).edges[0]?.resolution).toBe('unresolved');
  });

  it('rejects a proven edge with no evidence locator', () => {
    expect(() => SystemGraphSchema.parse(graph({ edges: [edge({ evidence: undefined })] }))).toThrow();
  });

  it('rejects an unresolved edge that carries no reason', () => {
    expect(() =>
      SystemGraphSchema.parse(
        graph({ edges: [edge({ resolution: 'unresolved', evidence: undefined })] }),
      ),
    ).toThrow();
  });

  it('rejects an inferred edge that claims proven-level evidence (no silent promotion)', () => {
    // An inferred edge must not be indistinguishable from a proven one. If it
    // carries a "proven" evidence class it has been promoted without evidence.
    expect(() =>
      SystemGraphSchema.parse(
        graph({ edges: [edge({ resolution: 'inferred', evidenceClass: 'proven' })] }),
      ),
    ).toThrow();
  });

  it('rejects an edge whose endpoints are not in the node set (dangling reference)', () => {
    expect(() => SystemGraphSchema.parse(graph({ edges: [edge({ to: 'missing-node' })] }))).toThrow(
      DanglingReferenceError,
    );
  });

  it('reports every dangling reference rather than the first one only', () => {
    const g = {
      schemaVersion: '1' as const,
      snapshot: 'snap-1',
      nodes: [node('consumer-a'), node('orders-api')],
      edges: [edge({ id: 'e1', from: 'ghost-1' }), edge({ id: 'e2', to: 'ghost-2' })],
    };

    let caught: unknown;
    try {
      assertGraphReferencesResolve(g);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DanglingReferenceError);
    expect([...(caught as DanglingReferenceError).references].sort()).toEqual(['ghost-1', 'ghost-2']);
  });

  it('rejects duplicate node ids', () => {
    expect(() => SystemGraphSchema.parse(graph({ nodes: [node('a'), node('a')] }))).toThrow();
  });
});

describe('VerifyResult oracle identity (NEG3-03)', () => {
  const verify = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const,
    stage: 'post_fix_full' as const,
    mode: 'real_runtime' as const,
    runnerIdentity: 'runner@sha256:' + 'a'.repeat(64),
    oracleDigest: 'b'.repeat(64),
    frozenOracleDigest: 'b'.repeat(64),
    checks: [{ checkId: 'check-1', result: 'pass' as const }],
    validity: 'valid' as const,
    ...overrides,
  });

  it('accepts a run whose oracle digest still matches the frozen one', () => {
    expect(VerifyResultSchema.parse(verify()).validity).toBe('valid');
  });

  it('rejects a pass whose oracle digest drifted from the frozen value', () => {
    // Oracle changes invalidate proof. Other full passes must not rescue it.
    expect(() =>
      VerifyResultSchema.parse(verify({ oracleDigest: 'c'.repeat(64), validity: 'valid' })),
    ).toThrow();
  });

  it('rejects a run that claims valid while carrying a skipped check as a pass', () => {
    expect(() =>
      VerifyResultSchema.parse(
        verify({ checks: [{ checkId: 'check-1', result: 'skipped' as const }], validity: 'valid' }),
      ),
    ).toThrow();
  });

  it('requires a reason whenever validity is not valid', () => {
    expect(() => VerifyResultSchema.parse(verify({ validity: 'invalid' }))).toThrow();
    expect(
      VerifyResultSchema.parse(verify({ validity: 'invalid', validityReason: 'hash mismatch on evidence blob' }))
        .validityReason,
    ).toBe('hash mismatch on evidence blob');
  });
});
