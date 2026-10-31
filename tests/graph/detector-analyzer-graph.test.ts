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

  it('propagates a dependency change through depends_on edges', () => {
    const dependencyGraph = SystemGraphSchema.parse({
      schemaVersion: '1',
      snapshot: 'snap-1',
      nodes: [
        { id: 'component:orders-api', kind: 'component', locator: 'svc/orders', snapshot: 'snap-1' },
        { id: 'symbol:lib.parse', kind: 'symbol', locator: 'lib/parse.ts', snapshot: 'snap-1' },
      ],
      edges: [
        {
          id: 'edge-dep',
          kind: 'depends_on',
          from: 'component:orders-api',
          to: 'symbol:lib.parse',
          resolution: 'proven',
          evidence: { locator: 'svc/orders/package.json', snapshot: 'snap-1', method: 'lockfile-reference' },
          runtimeObserved: false,
        },
      ],
    });

    const result = analyseImpacts({
      graph: dependencyGraph,
      changes: [
        change({
          id: 'dep-change',
          kind: 'dependency',
          category: 'dependency',
          relatedEntityIds: ['component:orders-api'],
        }),
      ],
    });

    expect(result.impacts.some((impact) => impact.subjectId === 'symbol:lib.parse')).toBe(true);
    expect(result.coverageGaps).toHaveLength(0);
  });
});

describe('T-03 event-flow impact acceptance', () => {
  // Synthetic extraction facts, not evidence of native broker execution.
  const eventGraph = SystemGraphSchema.parse({
    schemaVersion: '1',
    snapshot: 'snap-1',
    nodes: [
      { id: 'component:orders-publisher', kind: 'component', locator: 'services/orders/publisher.ts', snapshot: 'snap-1' },
      { id: 'event:OrderCreated', kind: 'event', locator: 'schemas/OrderCreated.v2.json', snapshot: 'snap-1' },
      { id: 'component:inventory-consumer', kind: 'component', locator: 'services/inventory/subscriber.ts', snapshot: 'snap-1' },
      { id: 'workflow:reserve-inventory', kind: 'business_workflow', locator: 'workflows/reserve-inventory.json', snapshot: 'snap-1' },
    ],
    edges: [
      {
        id: 'edge:order-published',
        kind: 'publishes',
        from: 'component:orders-publisher',
        to: 'event:OrderCreated',
        resolution: 'proven',
        evidence: { locator: 'services/orders/publisher.ts:24', snapshot: 'snap-1', method: 'publisher-registration' },
        runtimeObserved: false,
      },
      {
        id: 'edge:inventory-subscription',
        kind: 'consumes',
        from: 'component:inventory-consumer',
        to: 'event:OrderCreated',
        resolution: 'proven',
        evidence: { locator: 'services/inventory/subscriber.ts:18', snapshot: 'snap-1', method: 'subscription-registration' },
        runtimeObserved: false,
      },
      {
        id: 'edge:reservation-workflow',
        kind: 'depends_on',
        from: 'workflow:reserve-inventory',
        to: 'component:inventory-consumer',
        resolution: 'proven',
        evidence: { locator: 'workflows/reserve-inventory.json#/consumer', snapshot: 'snap-1', method: 'workflow-contract-reference' },
        runtimeObserved: false,
      },
    ],
  });
  const eventChange = change({
    id: 'event-change',
    kind: 'event_schema',
    category: 'event',
    beforeRef: 'schemas/OrderCreated.v1.json',
    afterRef: 'schemas/OrderCreated.v2.json',
    semanticIntent: 'OrderCreated now carries the order amount in minor units.',
    provenance: [{ snapshot: 'snap-1', locator: 'schemas/OrderCreated.v2.json', method: 'event-schema-diff' }],
    relatedEntityIds: ['event:OrderCreated'],
    rawEvidenceRefs: ['runs/r1/events/OrderCreated.diff.json'],
  });

  it('reaches the publisher, consumer and workflow with edge evidence and inferred impacts', () => {
    const built = buildSystemGraph({ snapshot: 'snap-1', graph: eventGraph });
    // Only the changed event is a seed; the publisher and consumer/workflow
    // must be discovered through publishes, consumes and depends_on edges.
    const result = analyseImpacts({ graph: built.graph, changes: [eventChange] });

    expect(built.graph.edges).toEqual(eventGraph.edges);
    expect(built.graph.edges.map((edge) => edge.evidence)).toEqual([
      { locator: 'services/orders/publisher.ts:24', snapshot: 'snap-1', method: 'publisher-registration' },
      { locator: 'services/inventory/subscriber.ts:18', snapshot: 'snap-1', method: 'subscription-registration' },
      { locator: 'workflows/reserve-inventory.json#/consumer', snapshot: 'snap-1', method: 'workflow-contract-reference' },
    ]);
    expect(result.impacts.map((impact) => impact.subjectId)).toEqual([
      'component:inventory-consumer',
      'component:orders-publisher',
      'workflow:reserve-inventory',
    ]);
    for (const impact of result.impacts) {
      expect(impact).toMatchObject({
        changeId: 'event-change',
        resolution: 'inferred',
        evidenceRefs: ['runs/r1/events/OrderCreated.diff.json'],
      });
    }
    expect(built.coverageGaps).toEqual([]);
    expect(result.coverageGaps).toEqual([]);

    // The same schema change can be anchored at its evidenced publisher.
    // This also exercises the forward publishes step before reaching consumers.
    const publisherResult = analyseImpacts({
      graph: built.graph,
      changes: [{ ...eventChange, relatedEntityIds: ['component:orders-publisher'] }],
    });
    expect(publisherResult.impacts.map(({ subjectId, resolution }) => ({ subjectId, resolution }))).toEqual([
      { subjectId: 'component:inventory-consumer', resolution: 'inferred' },
      { subjectId: 'event:OrderCreated', resolution: 'inferred' },
      { subjectId: 'workflow:reserve-inventory', resolution: 'inferred' },
    ]);
    expect(publisherResult.coverageGaps).toEqual([]);
  });

  it('retains an unresolved subscription and its reason as a gap rather than a proven or unaffected consumer', () => {
    const unresolvedSubscription: GraphEdge = {
      id: 'edge:inventory-subscription',
      kind: 'consumes',
      from: 'component:inventory-consumer',
      to: 'event:OrderCreated',
      resolution: 'unresolved',
      unresolvedReason: 'Subscription topic is computed from tenant configuration.',
      runtimeObserved: false,
    };
    const graph = SystemGraphSchema.parse({
      ...eventGraph,
      edges: eventGraph.edges.map((edge) =>
        edge.id === unresolvedSubscription.id ? unresolvedSubscription : edge,
      ),
    });
    const built = buildSystemGraph({ snapshot: 'snap-1', graph });
    const result = analyseImpacts({ graph: built.graph, changes: [eventChange] });

    expect(built.coverageGaps).toEqual(['edge:inventory-subscription']);
    // Graph gaps identify edges; their records retain the explanation.
    expect(built.graph.edges.filter((edge) => built.coverageGaps.includes(edge.id))).toEqual([
      unresolvedSubscription,
    ]);
    // Analyzer gaps identify subjects. The consumer remains explicitly unknown,
    // and traversal cannot claim an impact on it or the workflow beyond it.
    expect(result.coverageGaps).toEqual(['component:inventory-consumer']);
    expect(result.impacts.map((impact) => impact.subjectId)).toEqual(['component:orders-publisher']);
    expect(result.impacts[0]?.resolution).toBe('inferred');
    expect(built.graph.nodes.map((node) => node.id)).toContain('workflow:reserve-inventory');
  });
});

describe('T-09 data-schema impact acceptance', () => {
  // Synthetic extraction facts; no database or migration is executed.
  const dataGraph = SystemGraphSchema.parse({
    schemaVersion: '1',
    snapshot: 'snap-1',
    nodes: [
      { id: 'db_table:orders', kind: 'db_table', locator: 'schema/orders.v2.sql:1', snapshot: 'snap-1' },
      { id: 'db_column:orders.total_cents', kind: 'db_column', locator: 'schema/orders.v2.sql:4', snapshot: 'snap-1' },
      { id: 'symbol:orders.loadTotal', kind: 'symbol', locator: 'services/orders/read.ts:12', snapshot: 'snap-1' },
      { id: 'symbol:orders.saveTotal', kind: 'symbol', locator: 'services/orders/write.ts:20', snapshot: 'snap-1' },
      { id: 'workflow:checkout', kind: 'business_workflow', locator: 'workflows/checkout.json', snapshot: 'snap-1' },
    ],
    edges: [
      {
        id: 'edge:orders-total-column', kind: 'depends_on',
        from: 'db_table:orders', to: 'db_column:orders.total_cents', resolution: 'proven',
        evidence: { locator: 'schema/orders.v2.sql:4', snapshot: 'snap-1', method: 'ddl-column-definition' },
        runtimeObserved: false,
      },
      {
        id: 'edge:read-order-total', kind: 'reads',
        from: 'symbol:orders.loadTotal', to: 'db_column:orders.total_cents', resolution: 'proven',
        evidence: { locator: 'services/orders/read.ts:12', snapshot: 'snap-1', method: 'sql-column-reference' },
        runtimeObserved: false,
      },
      {
        id: 'edge:write-orders', kind: 'writes',
        from: 'symbol:orders.saveTotal', to: 'db_table:orders', resolution: 'proven',
        evidence: { locator: 'services/orders/write.ts:20', snapshot: 'snap-1', method: 'sql-table-reference' },
        runtimeObserved: false,
      },
      {
        id: 'edge:checkout-total', kind: 'depends_on',
        from: 'workflow:checkout', to: 'symbol:orders.loadTotal', resolution: 'proven',
        evidence: { locator: 'workflows/checkout.json#/total', snapshot: 'snap-1', method: 'workflow-contract-reference' },
        runtimeObserved: false,
      },
    ],
  });
  const dataChange = change({
    id: 'data-change', kind: 'data_schema', category: 'schema',
    beforeRef: 'schema/orders.v1.sql:4', afterRef: 'schema/orders.v2.sql:4',
    semanticIntent: 'Order totals now use a wider integer column.',
    provenance: [{ snapshot: 'snap-1', locator: 'schema/orders.v2.sql:4', method: 'ddl-schema-diff' }],
    relatedEntityIds: ['db_column:orders.total_cents'],
    rawEvidenceRefs: ['runs/r1/data/orders.diff.json'],
  });

  it('reaches the table, reader, writer and workflow from the changed column with preserved evidence', () => {
    const detected = detectChanges({ snapshot: 'snap-1', changes: [dataChange] });
    const built = buildSystemGraph({ snapshot: 'snap-1', graph: dataGraph });
    const result = analyseImpacts({ graph: built.graph, changes: [...detected.changes] });

    expect(detected.changes).toEqual([dataChange]);
    expect(built.graph.nodes).toEqual(dataGraph.nodes);
    expect(built.graph.edges).toEqual(dataGraph.edges);
    expect(result.impacts.map((impact) => impact.subjectId)).toEqual([
      'db_table:orders', 'symbol:orders.loadTotal', 'symbol:orders.saveTotal', 'workflow:checkout',
    ]);
    for (const impact of result.impacts) {
      expect(impact).toMatchObject({
        changeId: 'data-change', resolution: 'inferred', evidenceRefs: ['runs/r1/data/orders.diff.json'],
      });
    }
    expect(built.coverageGaps).toEqual([]);
    expect(result.coverageGaps).toEqual([]);
  });

  it('retains an unresolved column reader as an explained gap and does not infer its downstream workflow', () => {
    const unresolvedRead: GraphEdge = {
      id: 'edge:read-order-total', kind: 'reads',
      from: 'symbol:orders.loadTotal', to: 'db_column:orders.total_cents', resolution: 'unresolved',
      unresolvedReason: 'Column selection is computed at services/orders/read.ts:12.',
      runtimeObserved: false,
    };
    const graph = SystemGraphSchema.parse({
      ...dataGraph,
      edges: dataGraph.edges.map((edge) => edge.id === unresolvedRead.id ? unresolvedRead : edge),
    });
    const detected = detectChanges({ snapshot: 'snap-1', changes: [dataChange] });
    const built = buildSystemGraph({ snapshot: 'snap-1', graph });
    const result = analyseImpacts({ graph: built.graph, changes: [...detected.changes] });

    expect(built.coverageGaps).toEqual(['edge:read-order-total']);
    expect(built.graph.edges.filter((edge) => built.coverageGaps.includes(edge.id))).toEqual([unresolvedRead]);
    expect(built.graph.edges.find((edge) => edge.id === unresolvedRead.id)?.evidence).toBeUndefined();
    expect(built.graph.nodes.find((node) => node.id === unresolvedRead.from)).toMatchObject({
      locator: 'services/orders/read.ts:12', snapshot: 'snap-1',
    });
    expect(result.coverageGaps).toEqual(['symbol:orders.loadTotal']);
    expect(result.impacts.map((impact) => impact.subjectId)).toEqual(['db_table:orders', 'symbol:orders.saveTotal']);
    expect(result.impacts.every((impact) => impact.resolution === 'inferred')).toBe(true);
    expect(built.graph.nodes.map((node) => node.id)).toContain('workflow:checkout');
  });
});

describe('T-09 deployment/configuration impact acceptance', () => {
  // Synthetic manifest relationships, not execution of a deployment.
  const configGraph = SystemGraphSchema.parse({
    schemaVersion: '1',
    snapshot: 'snap-1',
    nodes: [
      { id: 'config:orders-database-url', kind: 'config', locator: 'deploy/orders.v2.yaml#/env/DATABASE_URL', snapshot: 'snap-1' },
      { id: 'component:orders-api', kind: 'component', locator: 'services/orders', snapshot: 'snap-1' },
      { id: 'workflow:checkout', kind: 'business_workflow', locator: 'workflows/checkout.json', snapshot: 'snap-1' },
    ],
    edges: [
      {
        id: 'edge:orders-database-requirement', kind: 'deployment_requires',
        from: 'component:orders-api', to: 'config:orders-database-url', resolution: 'proven',
        evidence: { locator: 'deploy/orders.v2.yaml#/env/DATABASE_URL', snapshot: 'snap-1', method: 'deployment-env-reference' },
        runtimeObserved: false,
      },
      {
        id: 'edge:checkout-orders-api', kind: 'depends_on',
        from: 'workflow:checkout', to: 'component:orders-api', resolution: 'proven',
        evidence: { locator: 'workflows/checkout.json#/orders', snapshot: 'snap-1', method: 'workflow-contract-reference' },
        runtimeObserved: false,
      },
    ],
  });
  const configChange = change({
    id: 'config-change', kind: 'configuration', category: 'config',
    beforeRef: 'deploy/orders.v1.yaml#/env/DATABASE_URL', afterRef: 'deploy/orders.v2.yaml#/env/DATABASE_URL',
    semanticIntent: 'The orders deployment switches to a new database endpoint.',
    provenance: [{ snapshot: 'snap-1', locator: 'deploy/orders.v2.yaml#/env/DATABASE_URL', method: 'deployment-config-diff' }],
    relatedEntityIds: ['config:orders-database-url'],
    rawEvidenceRefs: ['runs/r1/config/orders.diff.json'],
  });

  it('follows deployment_requires from the changed config to its component and workflow with inferred impacts', () => {
    const detected = detectChanges({ snapshot: 'snap-1', changes: [configChange] });
    const built = buildSystemGraph({ snapshot: 'snap-1', graph: configGraph });
    const result = analyseImpacts({ graph: built.graph, changes: [...detected.changes] });

    expect(detected.changes).toEqual([configChange]);
    expect(built.graph.nodes).toEqual(configGraph.nodes);
    expect(built.graph.edges).toEqual(configGraph.edges);
    expect(result.impacts.map((impact) => impact.subjectId)).toEqual(['component:orders-api', 'workflow:checkout']);
    for (const impact of result.impacts) {
      expect(impact).toMatchObject({
        changeId: 'config-change', resolution: 'inferred', evidenceRefs: ['runs/r1/config/orders.diff.json'],
      });
    }
    expect(built.coverageGaps).toEqual([]);
    expect(result.coverageGaps).toEqual([]);
  });

  it('retains an unresolved deployment requirement without treating the component or workflow as unaffected', () => {
    const unresolvedRequirement: GraphEdge = {
      id: 'edge:orders-database-requirement', kind: 'deployment_requires',
      from: 'component:orders-api', to: 'config:orders-database-url', resolution: 'unresolved',
      unresolvedReason: 'The database binding uses runtime secret references in deploy/orders.v2.yaml.',
      runtimeObserved: false,
    };
    const graph = SystemGraphSchema.parse({
      ...configGraph,
      edges: configGraph.edges.map((edge) => edge.id === unresolvedRequirement.id ? unresolvedRequirement : edge),
    });
    const detected = detectChanges({ snapshot: 'snap-1', changes: [configChange] });
    const built = buildSystemGraph({ snapshot: 'snap-1', graph });
    const result = analyseImpacts({ graph: built.graph, changes: [...detected.changes] });

    expect(built.coverageGaps).toEqual(['edge:orders-database-requirement']);
    expect(built.graph.edges.filter((edge) => built.coverageGaps.includes(edge.id))).toEqual([unresolvedRequirement]);
    expect(built.graph.edges.find((edge) => edge.id === unresolvedRequirement.id)?.evidence).toBeUndefined();
    expect(result.coverageGaps).toEqual(['component:orders-api']);
    expect(result.impacts).toEqual([]);
    expect(built.graph.nodes).toEqual(configGraph.nodes);
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
