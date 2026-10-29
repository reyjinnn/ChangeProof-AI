import { describe, expect, it } from 'vitest';

import {
  SystemGraphSchema,
  type GraphEdge,
  type NormalizedChange,
} from '../../src/core/index.js';
import { detectChanges } from '../../src/modules/detector/index.js';
import { analyseImpacts } from '../../src/modules/analyzer/index.js';
import { buildSystemGraph, resolveImpacts } from '../../src/modules/graph/index.js';

/**
 * WP3-05 / T1-8 — detector, analyzer and graph negatives (NEG3-06, NEG3-02).
 *
 * Written before the implementation. The load-bearing rules:
 *
 *  - an edge is never silently promoted to `proven`;
 *  - an unknown is never dropped from the output;
 *  - the same input produces the same output (FR3-04: deterministic normalisation).
 */

const change = (overrides: Partial<NormalizedChange> = {}): NormalizedChange => ({
  id: 'change-1',
  kind: 'api_contract',
  category: 'api-contract',
  beforeRef: 'openapi/old.yaml#/paths/~1api~1orders',
  afterRef: 'openapi/new.yaml#/paths/~1api~1orders',
  semanticIntent: 'The order total field was renamed.',
  provenance: [{ snapshot: 'snap-1', locator: 'openapi/new.yaml', method: 'oasdiff-style-diff' }],
  severity: 'high',
  understood: true,
  unknowns: [],
  relatedEntityIds: ['endpoint:GET /api/orders'],
  rawEvidenceRefs: ['runs/r1/diff.json'],
  ...overrides,
});

describe('detector normalises changes without losing raw evidence', () => {
  it('keeps the raw reference and the provenance of every change', () => {
    const result = detectChanges({
      snapshot: 'snap-1',
      changes: [change()],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.rawEvidenceRefs).toContain('runs/r1/diff.json');
    expect(result.changes[0]?.provenance[0]?.method).toBe('oasdiff-style-diff');
  });

  it('normalises API, data, event, dependency and configuration changes', () => {
    const changes: NormalizedChange[] = [
      change({ id: 'api', kind: 'api_contract', category: 'api-contract' }),
      change({ id: 'data', kind: 'data_schema', category: 'schema' }),
      change({ id: 'event', kind: 'event_schema', category: 'event' }),
      change({ id: 'dependency', kind: 'dependency', category: 'dependency' }),
      change({ id: 'config', kind: 'configuration', category: 'config' }),
    ];

    const result = detectChanges({ snapshot: 'snap-1', changes });
    expect(result.changes.map((candidate) => candidate.kind)).toEqual([
      'api_contract',
      'configuration',
      'data_schema',
      'dependency',
      'event_schema',
    ]);
    expect(result.changes).toHaveLength(5);
    expect(result.changes.every((candidate) => candidate.rawEvidenceRefs.length > 0)).toBe(true);
    expect(result.changes.every((candidate) => candidate.provenance.length > 0)).toBe(true);
  });

  it('retains an unsupported change instead of dropping it', () => {
    // A change the detector cannot classify is still a change the owner must see.
    const result = detectChanges({
      snapshot: 'snap-1',
      changes: [change({ understood: false, unknowns: ['unsupported configuration shape'] })],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.unknowns).toContain('unsupported configuration shape');
    expect(result.unknowns).toContain('unsupported configuration shape');
  });

  it('is deterministic: the same input produces the same output', () => {
    const input = { snapshot: 'snap-1', changes: [change(), change({ id: 'change-2' })] };
    const first = detectChanges(input);
    const second = detectChanges(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('keeps the unknowns of a change visible in the change set', () => {
    const result = detectChanges({
      snapshot: 'snap-1',
      changes: [change({ understood: false, unknowns: ['replacement endpoint not identified'] })],
    });

    expect(result.unknowns).toContain('replacement endpoint not identified');
  });
});

describe('analyzer produces impacts with provenance and unknowns', () => {
  const graph = SystemGraphSchema.parse({
    schemaVersion: '1',
    snapshot: 'snap-1',
    nodes: [
      { id: 'endpoint:GET /api/orders', kind: 'endpoint', locator: 'openapi/new.yaml', snapshot: 'snap-1' },
      { id: 'symbol:client.fetchOrder', kind: 'symbol', locator: 'src/client.ts', snapshot: 'snap-1' },
      { id: 'dto:OrderDto', kind: 'dto', locator: 'src/dto.ts', snapshot: 'snap-1' },
    ],
    edges: [
      {
        id: 'edge-1',
        kind: 'calls',
        from: 'symbol:client.fetchOrder',
        to: 'endpoint:GET /api/orders',
        resolution: 'proven',
        evidence: { locator: 'src/client.ts:42', snapshot: 'snap-1', method: 'ts-morph-reference' },
        runtimeObserved: false,
      },
      {
        id: 'edge-2',
        kind: 'serializes',
        from: 'endpoint:GET /api/orders',
        to: 'dto:OrderDto',
        resolution: 'unresolved',
        unresolvedReason: 'dynamic response typing in the consumer',
        runtimeObserved: false,
      },
    ],
  });

  it('propagates an impact to the reachable targets', () => {
    const result = analyseImpacts({
      graph,
      changes: [change()],
    });

    const impacted = result.impacts.map((impact) => impact.subjectId);
    expect(impacted).toContain('symbol:client.fetchOrder');
  });

  it('records an unresolved edge as a coverage gap, not as an impact', () => {
    const result = analyseImpacts({
      graph,
      changes: [change()],
    });

    expect(result.coverageGaps.length).toBeGreaterThan(0);
    expect(result.coverageGaps.some((gap) => gap.includes('dto:OrderDto'))).toBe(true);
  });

  it('does not drop an unknown relationship from the impact output', () => {
    const result = analyseImpacts({ graph, changes: [change()] });
    expect(result.coverageGaps).toContain('dto:OrderDto');
  });

  it('never claims an unresolved edge is proven', () => {
    const result = analyseImpacts({
      graph,
      changes: [change()],
    });

    for (const impact of result.impacts) {
      expect(impact.resolution).not.toBe('proven');
      expect(['inferred', 'unresolved']).toContain(impact.resolution);
    }
  });
});

describe('graph keeps every resolution class distinguishable', () => {
  it('preserves proven, inferred and unresolved as separate classes', () => {
    const edges: GraphEdge[] = [
      {
        id: 'edge-proven',
        kind: 'calls',
        from: 'a',
        to: 'b',
        resolution: 'proven',
        evidence: { locator: 'src/a.ts:1', snapshot: 'snap-1', method: 'ts-morph-reference' },
        runtimeObserved: false,
      },
      {
        id: 'edge-inferred',
        kind: 'calls',
        from: 'a',
        to: 'c',
        resolution: 'inferred',
        evidence: { locator: 'src/a.ts:9', snapshot: 'snap-1', method: 'name-similarity' },
        evidenceClass: 'heuristic',
        runtimeObserved: false,
      },
      {
        id: 'edge-unresolved',
        kind: 'calls',
        from: 'a',
        to: 'd',
        resolution: 'unresolved',
        unresolvedReason: 'dynamic dispatch',
        runtimeObserved: false,
      },
    ];

    const graph = SystemGraphSchema.parse({
      schemaVersion: '1',
      snapshot: 'snap-1',
      nodes: [
        { id: 'a', kind: 'component', locator: 'src/a.ts', snapshot: 'snap-1' },
        { id: 'b', kind: 'symbol', locator: 'src/b.ts', snapshot: 'snap-1' },
        { id: 'c', kind: 'symbol', locator: 'src/c.ts', snapshot: 'snap-1' },
        { id: 'd', kind: 'symbol', locator: 'src/d.ts', snapshot: 'snap-1' },
      ],
      edges,
    });

    const byClass = (resolution: string): GraphEdge[] =>
      graph.edges.filter((edge) => edge.resolution === resolution);

    expect(byClass('proven')).toHaveLength(1);
    expect(byClass('inferred')).toHaveLength(1);
    expect(byClass('unresolved')).toHaveLength(1);
  });

  it('rejects a graph whose edge endpoints do not resolve', () => {
    expect(() =>
      SystemGraphSchema.parse({
        schemaVersion: '1',
        snapshot: 'snap-1',
        nodes: [{ id: 'a', kind: 'component', locator: 'src/a.ts', snapshot: 'snap-1' }],
        edges: [
          {
            id: 'edge-1',
            kind: 'calls',
            from: 'a',
            to: 'missing',
            resolution: 'proven',
            evidence: { locator: 'src/a.ts:1', snapshot: 'snap-1', method: 'ts-morph-reference' },
            runtimeObserved: false,
          },
        ],
      }),
    ).toThrow(/dangling/i);
  });
});

describe('graph construction is deterministic and keeps unknowns', () => {
  const baseGraph = SystemGraphSchema.parse({
    schemaVersion: '1',
    snapshot: 'snap-1',
    nodes: [
      { id: 'endpoint:GET /api/orders', kind: 'endpoint', locator: 'openapi/new.yaml', snapshot: 'snap-1' },
      { id: 'symbol:client.fetchOrder', kind: 'symbol', locator: 'src/client.ts', snapshot: 'snap-1' },
    ],
    edges: [
      {
        id: 'edge-1',
        kind: 'calls',
        from: 'symbol:client.fetchOrder',
        to: 'endpoint:GET /api/orders',
        resolution: 'proven',
        evidence: { locator: 'src/client.ts:42', snapshot: 'snap-1', method: 'ts-morph-reference' },
        runtimeObserved: false,
      },
    ],
  });

  it('produces the same graph for the same input', () => {
    const first = buildSystemGraph({ snapshot: 'snap-1', graph: baseGraph });
    const second = buildSystemGraph({ snapshot: 'snap-1', graph: baseGraph });

    expect(JSON.stringify(first.graph)).toBe(JSON.stringify(second.graph));
    expect(first.coverageGaps).toEqual(second.coverageGaps);
  });

  it('carries the unresolved edges into the coverage gaps', () => {
    const graph = SystemGraphSchema.parse({
      ...baseGraph,
      nodes: [
        ...baseGraph.nodes,
        { id: 'endpoint:GET /api/payments', kind: 'endpoint', locator: 'openapi/new.yaml', snapshot: 'snap-1' },
      ],
      edges: [
        ...baseGraph.edges,
        {
          id: 'edge-2',
          kind: 'calls',
          from: 'symbol:client.fetchOrder',
          to: 'endpoint:GET /api/payments',
          resolution: 'unresolved',
          unresolvedReason: 'dynamic dispatch through a computed key',
          runtimeObserved: false,
        },
      ],
    });

    const built = buildSystemGraph({ snapshot: 'snap-1', graph });
    expect(built.coverageGaps.length).toBeGreaterThan(0);
  });

  it('resolves an impact to a set of required targets and checks', () => {
    const resolved = resolveImpacts({
      graph: baseGraph,
      impacts: [
        {
          id: 'impact-1',
          changeId: 'change-1',
          subjectId: 'symbol:client.fetchOrder',
          subjectKind: 'symbol',
          resolution: 'inferred',
          evidenceRefs: ['runs/r1/diff.json'],
          unknowns: [],
          coverageGaps: [],
          severity: 'high',
        },
      ],
    });

    expect(resolved.requiredTargets.length).toBeGreaterThan(0);
    expect(resolved.requiredTargets).toContain('symbol:client.fetchOrder');
    expect(resolved.scopeDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps an unmapped target in the denominator rather than dropping it', () => {
    const resolved = resolveImpacts({
      graph: baseGraph,
      impacts: [
        {
          id: 'impact-1',
          changeId: 'change-1',
          subjectId: 'symbol:client.fetchOrder',
          subjectKind: 'symbol',
          resolution: 'inferred',
          evidenceRefs: [],
          unknowns: [],
          coverageGaps: [],
          severity: 'high',
        },
        {
          id: 'impact-2',
          changeId: 'change-1',
          subjectId: 'symbol:notInTheGraph',
          subjectKind: 'symbol',
          resolution: 'unresolved',
          evidenceRefs: [],
          unknowns: ['target was not found in the graph'],
          coverageGaps: ['symbol:notInTheGraph'],
          severity: 'medium',
        },
      ],
    });

    expect(resolved.requiredTargets).toContain('symbol:notInTheGraph');
    expect(resolved.coverageGaps).toContain('symbol:notInTheGraph');
  });
});
