import { z } from 'zod';

import {
  NormalizedChangeSchema,
  SystemGraphSchema,
  type Impact,
  type NormalizedChange,
  type SystemGraph,
} from '../../core/index.js';

/**
 * Analyzer (FR3-05, FR3-06).
 *
 * Walks the shared graph from each changed entity and reports which subjects
 * are impacted, with the provenance of each conclusion.
 *
 * The analyzer never promotes an edge. An impact reached through the graph is
 * reported as `inferred` — the graph records which edges were resolved with
 * evidence, and the analyzer reports *reachability*, not proof of impact. A
 * neighbour reached only through an `unresolved` edge is a coverage gap, not an
 * impact: "we could not follow this" is not "this is unaffected" (NEG3-02).
 */

export const AnalyseImpactsInputSchema = z
  .strictObject({
    graph: SystemGraphSchema,
    changes: z.array(NormalizedChangeSchema).min(1),
  })
  .describe('A graph and the changes observed against it');
export type AnalyseImpactsInput = z.input<typeof AnalyseImpactsInputSchema>;

export interface AnalyseImpactsResult {
  readonly impacts: readonly Impact[];
  readonly coverageGaps: readonly string[];
}

/**
 * Analyse the impact of a set of changes on the shared graph.
 *
 * Deterministic: neighbours are visited in edge order and results are sorted
 * by id, so the same graph always produces the same impact list.
 */
export function analyseImpacts(input: AnalyseImpactsInput): AnalyseImpactsResult {
  const parsed = AnalyseImpactsInputSchema.parse(input);
  const graph: SystemGraph = parsed.graph;

  const nodeKind = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const coverageGaps = new Set<string>();
  const impacts = new Map<string, Impact>();

  for (const change of parsed.changes as readonly NormalizedChange[]) {
    for (const seed of change.relatedEntityIds) {
      for (const step of traverse(graph, seed)) {
        if (step.resolution === 'unresolved') {
          coverageGaps.add(step.subjectId);
          continue;
        }

        const existing = impacts.get(step.subjectId);
        impacts.set(step.subjectId, {
          id: `impact-${change.id}-${step.subjectId}`,
          changeId: change.id,
          subjectId: step.subjectId,
          subjectKind: nodeKind.get(step.subjectId) ?? 'symbol',
          resolution: 'inferred',
          evidenceRefs: [...new Set([...(existing?.evidenceRefs ?? []), ...change.rawEvidenceRefs])],
          unknowns: [...new Set([...(existing?.unknowns ?? []), ...change.unknowns])],
          coverageGaps: [...(existing?.coverageGaps ?? [])],
          severity: change.severity,
        });
      }
    }
  }

  return {
    impacts: [...impacts.values()].sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
    coverageGaps: [...coverageGaps].sort(),
  };
}

interface TraversalStep {
  readonly subjectId: string;
  readonly resolution: 'inferred' | 'unresolved';
}

/**
 * Breadth-first walk from a seed.
 *
 * An `unresolved` edge stops the walk: the relationship exists but could not
 * be followed, so the neighbour beyond it is unknown rather than unaffected.
 */
function traverse(graph: SystemGraph, seed: string): TraversalStep[] {
  const visited = new Set<string>([seed]);
  const queue: string[] = [seed];
  const results: TraversalStep[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const edge of graph.edges) {
      const nextId = edge.from === current ? edge.to : edge.to === current ? edge.from : undefined;
      if (nextId === undefined) continue;
      if (visited.has(nextId)) continue;

      visited.add(nextId);

      if (edge.resolution === 'unresolved') {
        results.push({ subjectId: nextId, resolution: 'unresolved' });
        continue;
      }

      results.push({ subjectId: nextId, resolution: 'inferred' });
      queue.push(nextId);
    }
  }

  return results;
}
