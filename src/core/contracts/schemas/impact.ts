import { z } from 'zod';

import { GraphEntityIdSchema, NonEmptyStringSchema } from '../primitives.js';

/**
 * Impact — one subject affected by a change, with the provenance of the
 * conclusion.
 *
 * This contract lives in `core` because both the analyzer (which produces it)
 * and the graph module (which freezes a scope from it) depend on it. Leaf
 * modules may only import `core`, so a shared contract that crosses a module
 * boundary belongs here rather than in either producer.
 *
 * The resolution of an impact is `inferred` or `unresolved` — never `proven`.
 * An impact reports reachability through the graph, not proof that a subject
 * is affected; only an independent verifier run can support a stronger claim.
 */
export const ImpactSchema = z
  .strictObject({
    id: z.string().min(1),
    changeId: z.string().min(1),
    subjectId: GraphEntityIdSchema,
    subjectKind: z.string().min(1),
    resolution: z.enum(['inferred', 'unresolved']),
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
    unknowns: z.array(NonEmptyStringSchema).default([]),
    coverageGaps: z.array(GraphEntityIdSchema).default([]),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
  })
  .describe('One impacted subject, with the provenance of the conclusion');
export type Impact = z.infer<typeof ImpactSchema>;
