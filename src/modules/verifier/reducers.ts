import { createHash } from 'node:crypto';

import {
  ChangeProofError,
  DimensionAssessmentSchema,
  type Dimension,
  type DimensionAssessment,
} from '../../core/index.js';

/**
 * Deterministic matched-window reducers (WP3-17, FR3-27).
 *
 * Preparation scope: this module reduces raw observations from matched
 * measurement windows to one `DimensionAssessment` per required dimension.
 * Dimensions are assessed separately — correctness, performance, resilience
 * and data integrity are never averaged, and a functional pass never hides an
 * inconclusive or failed dimension (policy enforces the precedence).
 *
 * Two NEG3-18 rules are structural here, not advisory:
 *
 *   - observations are pooled across windows and reduced to a lower-median;
 *     per-window percentiles are never averaged and the fastest window is
 *     never selected;
 *   - dropped traffic or removed timeouts make the measurement
 *     inconclusive/invalid — never a pass.
 *
 * The reducer is bound to its inputs: `reducerDigest` is the SHA-256 of the
 * canonical `{algorithm, config}` JSON, and `rawRefs` must reference the raw
 * observations behind the result. Non-finite observations and non-JSON
 * configs throw instead of being reduced around (fail closed).
 */

export type ReducerComparison = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

export interface ReducerThreshold {
  readonly comparison: ReducerComparison;
  readonly value: number;
}

export interface MatchedWindowInput {
  readonly windowId: string;
  readonly observations: readonly number[];
  readonly droppedObservations?: number;
  readonly timeoutsRemoved?: number;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ReducerInput {
  readonly dimension: Dimension;
  readonly metricId: string;
  readonly algorithm: string;
  readonly config: JsonValue;
  readonly threshold: ReducerThreshold;
  readonly windows: readonly MatchedWindowInput[];
  readonly rawRefs: readonly string[];
  readonly required?: boolean;
}

export function stableStringify(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new ChangeProofError('Reducer config must be finite JSON; NaN and infinities are not allowed.');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    // Array.isArray narrows to any[]; rebind to the known element type.
    const items = value as readonly JsonValue[];
    return `[${items.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
  return `{${entries.join(',')}}`;
}

export function reducerDigestFor(algorithm: string, config: JsonValue): string {
  return createHash('sha256')
    .update(stableStringify({ algorithm, config }))
    .digest('hex');
}

function passesThreshold(median: number, threshold: ReducerThreshold): boolean {
  switch (threshold.comparison) {
    case 'lt':
      return median < threshold.value;
    case 'lte':
      return median <= threshold.value;
    case 'gt':
      return median > threshold.value;
    case 'gte':
      return median >= threshold.value;
    case 'eq':
      return median === threshold.value;
  }
}

export function reduceMatchedWindows(input: ReducerInput): DimensionAssessment {
  if (input.metricId.length === 0) {
    throw new ChangeProofError('Reducer requires a metricId; an unnamed measurement cannot be assessed.');
  }
  if (input.algorithm.length === 0) {
    throw new ChangeProofError('Reducer requires a named algorithm; the digest must bind to something.');
  }
  if (input.rawRefs.length === 0) {
    throw new ChangeProofError(
      'Reducer requires raw observation refs; a dimension result without raw evidence is not assessable.',
    );
  }
  if (!Number.isFinite(input.threshold.value)) {
    throw new ChangeProofError('Reducer threshold must be a finite number.');
  }

  const required = input.required ?? true;
  const digest = reducerDigestFor(input.algorithm, input.config);
  const base = {
    schemaVersion: '1' as const,
    dimension: input.dimension,
    required,
    metricIds: [input.metricId],
    rawRefs: [...input.rawRefs],
    reducerDigest: digest,
    algorithm: input.algorithm,
  };

  if (input.windows.length === 0) {
    return DimensionAssessmentSchema.parse({
      ...base,
      result: 'inconclusive',
      measurementValidity: 'inconclusive',
      uncertainty: 'insufficient samples: no matched windows were measured.',
    });
  }

  const lossy = input.windows.filter(
    (window) => (window.droppedObservations ?? 0) > 0 || (window.timeoutsRemoved ?? 0) > 0,
  );
  if (lossy.length > 0) {
    const detail = lossy
      .map(
        (window) =>
          `${window.windowId}: dropped=${window.droppedObservations ?? 0} ` +
          `timeoutsRemoved=${window.timeoutsRemoved ?? 0}`,
      )
      .join('; ');
    return DimensionAssessmentSchema.parse({
      ...base,
      result: 'inconclusive',
      measurementValidity: 'invalid',
      uncertainty:
        `measurement loss in ${lossy.length} window(s) (${detail}); ` +
        'dropped traffic or removed timeouts must not read as an improvement (NEG3-18).',
    });
  }

  const pooled: number[] = [];
  for (const window of input.windows) {
    for (const observation of window.observations) {
      if (!Number.isFinite(observation)) {
        throw new ChangeProofError(
          `Window "${window.windowId}" carries a non-finite observation; ` +
            'the reducer does not reduce around malformed data (fail closed).',
        );
      }
      pooled.push(observation);
    }
  }

  if (pooled.length === 0) {
    return DimensionAssessmentSchema.parse({
      ...base,
      result: 'inconclusive',
      measurementValidity: 'inconclusive',
      uncertainty: 'insufficient samples: matched windows carry no observations.',
    });
  }

  // Pooled lower-median: one deterministic order statistic over every raw
  // observation. Per-window summaries are never averaged and the fastest
  // window is never selected.
  const sorted = [...pooled].sort((left, right) => left - right);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  if (median === undefined) {
    throw new ChangeProofError(
      'Reducer reached an empty pooled set after a non-empty check; refusing to assess.',
    );
  }

  if (passesThreshold(median, input.threshold)) {
    return DimensionAssessmentSchema.parse({
      ...base,
      result: 'pass',
      measurementValidity: 'valid',
      uncertainty:
        `pooled n=${pooled.length} lower-median=${median} ` +
        `vs ${input.threshold.comparison} ${input.threshold.value}.`,
    });
  }
  return DimensionAssessmentSchema.parse({
    ...base,
    result: 'fail',
    measurementValidity: 'valid',
    uncertainty:
      `pooled n=${pooled.length} lower-median=${median} ` +
      `misses ${input.threshold.comparison} ${input.threshold.value}.`,
  });
}
