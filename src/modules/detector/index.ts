import { z } from 'zod';

import {
  ChangeSetSchema,
  NormalizedChangeSchema,
  type ChangeSet,
  type NormalizedChange,
} from '../../core/index.js';

/**
 * Detector (FR3-04).
 *
 * Normalises API, data, event, dependency and configuration changes into one
 * versioned model without losing the raw evidence behind them.
 *
 * The detector does not interpret impact and does not decide anything. It
 * produces a change set the analyzer can reason over, and it keeps two things
 * visible that are easy to lose: the raw reference a change came from, and the
 * unknowns that remain about it.
 */

export const DetectChangesInputSchema = z
  .strictObject({
    snapshot: z.string().min(1),
    changes: z.array(NormalizedChangeSchema).min(1),
    /** Free-text hypotheses, kept separate from the facts. */
    hypotheses: z.array(z.string().min(1)).default([]),
  })
  .describe('A snapshot and the raw changes observed in it');
export type DetectChangesInput = z.input<typeof DetectChangesInputSchema>;

export interface DetectChangesResult {
  readonly changeSet: ChangeSet;
  readonly changes: readonly NormalizedChange[];
  readonly unknowns: readonly string[];
}

/**
 * Normalise the observed changes.
 *
 * Deterministic: the same input always yields the same change set, because a
 * verdict that depended on iteration order would not be reproducible
 * (NFR3-01, NFR3-03).
 */
export function detectChanges(input: DetectChangesInput): DetectChangesResult {
  const parsed = DetectChangesInputSchema.parse(input);

  const changes = [...parsed.changes].sort((left, right) => left.id.localeCompare(right.id));

  const unknowns = [
    ...new Set(
      changes.flatMap((candidate) => [
        ...candidate.unknowns,
        ...(candidate.understood ? [] : ['change is not fully understood']),
      ]),
    ),
  ].sort();

  const changeSet = ChangeSetSchema.parse({
    schemaVersion: '1',
    changeSetId: `changeset-${parsed.snapshot}`,
    snapshot: parsed.snapshot,
    changes,
    hypotheses: parsed.hypotheses,
    unknowns,
  });

  return { changeSet, changes: changeSet.changes, unknowns };
}
