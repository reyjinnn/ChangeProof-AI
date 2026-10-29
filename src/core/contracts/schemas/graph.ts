import { z } from 'zod';

import { DanglingReferenceError } from '../../errors/index.js';
import { EvidenceLocatorSchema, GraphEntityIdSchema, IdSchema, Sha256Schema } from '../primitives.js';
import { EdgeResolutionSchema } from '../vocabulary.js';

/**
 * SystemGraph — the shared cross-stack impact graph (FR3-05).
 *
 * The load-bearing property is that an edge's provenance stays visible.
 * `proven` means an extractor resolved it with evidence; `inferred` means a
 * heuristic suggested it; `unresolved` means the analysis knows there is a
 * relationship it could not follow (reflection, DI, dynamic dispatch).
 *
 * An `unresolved` edge is a coverage gap, not an absence. Dropping it from the
 * output would silently shrink the denominator — exactly what FR3-06 forbids
 * and NEG3-02 names. So it is required to remain present, marked, and explained.
 */

export const NodeKindSchema = z.enum([
  'repository',
  'component',
  'symbol',
  'endpoint',
  'dto',
  'db_table',
  'db_column',
  'event',
  'dependency_artifact',
  'cache_key',
  'business_workflow',
  'config',
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const EdgeKindSchema = z.enum([
  'calls',
  'reads',
  'writes',
  'serializes',
  'publishes',
  'consumes',
  'generates',
  'depends_on',
  'deployment_requires',
]);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

/**
 * How strong the evidence behind an edge is. Kept separate from `resolution`
 * so an inferred edge cannot borrow proven-grade evidence class retroactively.
 */
export const EvidenceClassSchema = z.enum(['proven', 'inferred', 'heuristic']);
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;

export const GraphNodeSchema = z
  .strictObject({
    id: GraphEntityIdSchema,
    kind: NodeKindSchema,
    locator: z.string().min(1),
    snapshot: IdSchema,
    /** Repository scope for multi-repo graphs. */
    repository: IdSchema.optional(),
    label: z.string().optional(),
  })
  .describe('A node in the shared system graph');
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const EdgeEvidenceSchema = z
  .strictObject({
    locator: EvidenceLocatorSchema,
    snapshot: IdSchema,
    method: z.string().min(1).describe('Extraction method, e.g. ts-morph-reference, oasdiff, bytecode-scan'),
  })
  .describe('Where and how an edge was observed');
export type EdgeEvidence = z.infer<typeof EdgeEvidenceSchema>;

export const GraphEdgeSchema = z
  .strictObject({
    id: GraphEntityIdSchema,
    kind: EdgeKindSchema,
    from: GraphEntityIdSchema,
    to: GraphEntityIdSchema,
    resolution: EdgeResolutionSchema,
    evidence: EdgeEvidenceSchema.optional(),
    evidenceClass: EvidenceClassSchema.optional(),
    /** Required when resolution is `unresolved`: what could not be followed. */
    unresolvedReason: z.string().min(1).optional(),
    runtimeObserved: z.boolean().default(false),
  })
  .superRefine((edge, ctx) => {
    if (edge.resolution === 'proven' && edge.evidence === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'A `proven` edge must carry an evidence locator. Without it the claim is ' +
          'indistinguishable from an inference (.claude/AGENTS.md §3 rule 8).',
      });
    }

    if (edge.resolution === 'unresolved') {
      if (edge.unresolvedReason === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['unresolvedReason'],
          message:
            'An `unresolved` edge must state what could not be resolved. Silently dropping ' +
            'it would shrink the coverage denominator (NEG3-02).',
        });
      }
      if (edge.evidence !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: 'An `unresolved` edge cannot also carry a resolved evidence locator.',
        });
      }
    }

    if (
      edge.resolution === 'inferred' &&
      edge.evidenceClass === 'proven'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceClass'],
        message:
          'An `inferred` edge cannot be labelled with proven-grade evidence. Promoting ' +
          'inferred to proven requires evidence, not relabelling (.claude/AGENTS.md §3 rule 8).',
      });
    }
  })
  .describe('An edge plus its provenance');
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const SystemGraphSchema = z
  .strictObject({
    schemaVersion: z.literal('1'),
    snapshot: IdSchema,
    nodes: z.array(GraphNodeSchema).min(1),
    edges: z.array(GraphEdgeSchema),
    /** Snapshot digests this graph was built from, for reproducibility. */
    sourceDigests: z.array(Sha256Schema).default([]),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set<string>();
    graph.nodes.forEach((node, index) => {
      if (ids.has(node.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'id'],
          message: `Duplicate node id "${node.id}". Duplicate ids make traversal ambiguous.`,
        });
      }
      ids.add(node.id);
    });

    const dangling: string[] = [];
    graph.edges.forEach((edge) => {
      if (!ids.has(edge.from)) dangling.push(edge.from);
      if (!ids.has(edge.to)) dangling.push(edge.to);
    });

    if (dangling.length > 0) {
      throw new DanglingReferenceError(
        `SystemGraph(snapshot=${graph.snapshot})`,
        dangling,
      );
    }
  })
  .describe('Versioned nodes and edges with provenance');
export type SystemGraph = z.infer<typeof SystemGraphSchema>;

/**
 * Verify every edge endpoint resolves to a node, reporting **all** dangling
 * references rather than stopping at the first. Used where a fold over the
 * graph must fail loudly instead of silently skipping edges.
 */
export function assertGraphReferencesResolve(graph: {
  nodes: readonly { id: string }[];
  edges: readonly { from: string; to: string }[];
  snapshot?: string;
}): void {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const dangling: string[] = [];
  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) dangling.push(edge.from);
    if (!ids.has(edge.to)) dangling.push(edge.to);
  }
  if (dangling.length > 0) {
    throw new DanglingReferenceError(`SystemGraph(snapshot=${graph.snapshot ?? 'unknown'})`, dangling);
  }
}

/** Unresolved edges visible as coverage gaps. Never filtered out of a report. */
export function unresolvedCoverageGaps(graph: SystemGraph): readonly GraphEdge[] {
  return graph.edges.filter((edge) => edge.resolution === 'unresolved');
}

export function provenEdges(graph: SystemGraph): readonly GraphEdge[] {
  return graph.edges.filter((edge) => edge.resolution === 'proven');
}
