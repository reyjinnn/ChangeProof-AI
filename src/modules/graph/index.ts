import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  ImpactSchema,
  SystemGraphSchema,
  type SystemGraph,
} from '../../core/index.js';

/**
 * Graph (FR3-05, FR3-06).
 *
 * Assembles the shared system graph and freezes a verification scope from a
 * set of impacts.
 *
 * Two properties are enforced rather than assumed:
 *
 *  - Every edge keeps its resolution class. Nothing here rewrites `inferred`
 *    into `proven`, and an `unresolved` edge survives into the coverage gaps
 *    instead of being dropped (NEG3-02, NEG3-06).
 *  - A target that could not be mapped stays in the required set. FR3-06 says
 *    an unmapped target must not disappear from the denominator.
 */

export const BuildSystemGraphInputSchema = z
  .strictObject({
    snapshot: z.string().min(1),
    graph: SystemGraphSchema,
  })
  .describe('The extracted graph for one snapshot');
export type BuildSystemGraphInput = z.infer<typeof BuildSystemGraphInputSchema>;

export interface BuiltSystemGraph {
  readonly graph: SystemGraph;
  readonly coverageGaps: readonly string[];
  readonly nodeCount: number;
  readonly edgeCount: number;
}

/**
 * Assemble the graph and surface its coverage gaps.
 *
 * The graph is validated rather than trusted: an edge whose endpoints do not
 * resolve is a hard error, not a silently dropped relation.
 */
export function buildSystemGraph(input: BuildSystemGraphInput): BuiltSystemGraph {
  const parsed = BuildSystemGraphInputSchema.parse(input);
  const graph = parsed.graph;

  const coverageGaps = graph.edges
    .filter((edge) => edge.resolution === 'unresolved')
    .map((edge) => edge.id)
    .sort();

  return {
    graph,
    coverageGaps,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}

export const ResolveImpactsInputSchema = z
  .strictObject({
    graph: SystemGraphSchema,
    impacts: z.array(ImpactSchema).min(1),
  })
  .describe('The graph and the impacts to scope');
export type ResolveImpactsInput = z.infer<typeof ResolveImpactsInputSchema>;

export interface ResolvedScope {
  /** Subjects that must be verified. Unmapped targets are included. */
  readonly requiredTargets: readonly string[];
  /** Graph edges the scope depends on. */
  readonly requiredEdges: readonly string[];
  /** Coverage gaps that remain inside the scope. */
  readonly coverageGaps: readonly string[];
  /** Digest over the frozen scope; a scope change produces a new revision. */
  readonly scopeDigest: string;
}

/**
 * Freeze the verification scope implied by a set of impacts.
 *
 * The scope is frozen by digest: changing the set of required targets or the
 * unresolved edges changes the digest, so a scope can never be narrowed after
 * a candidate failed (FR3-06).
 */
export function resolveImpacts(input: ResolveImpactsInput): ResolvedScope {
  const parsed = ResolveImpactsInputSchema.parse(input);
  const graph = parsed.graph;

  const requiredTargets = [...new Set(parsed.impacts.map((impact) => impact.subjectId))].sort();

  const requiredEdges = [
    ...new Set(
      graph.edges
        .filter((edge) => requiredTargets.includes(edge.from) || requiredTargets.includes(edge.to))
        .map((edge) => edge.id),
    ),
  ].sort();

  const coverageGaps = [
    ...new Set([
      ...parsed.impacts.flatMap((impact) => impact.coverageGaps),
      ...requiredTargets.filter((target) => !graph.nodes.some((node) => node.id === target)),
    ]),
  ].sort();

  const scopeDigest = createHash('sha256')
    .update(
      JSON.stringify({
        requiredTargets,
        requiredEdges,
        coverageGaps,
      }),
      'utf8',
    )
    .digest('hex');

  return { requiredTargets, requiredEdges, coverageGaps, scopeDigest };
}
