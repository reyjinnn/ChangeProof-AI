import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { reduceMatchedWindows, type ReducerInput } from '../../src/modules/verifier/index.js';

/**
 * WP3-17 / T2-3 — measurement reducer failure-path tests (NEG3-18, FR3-27).
 *
 * Written before the implementation. The reducer pools raw observations from
 * matched windows through a deterministic algorithm bound to its digest; it
 * never averages per-window percentiles and never lets dropped traffic or
 * removed timeouts read as an improvement. A dimension whose measurement lost
 * data is inconclusive/invalid — never a pass.
 */

function input(overrides: Partial<ReducerInput> = {}): ReducerInput {
  return {
    dimension: 'performance',
    metricId: 'op-latency',
    algorithm: 'lower-median-p50',
    config: { p: 50 },
    threshold: { comparison: 'lt', value: 200 },
    windows: [
      { windowId: 'w-1', observations: [120, 140, 160] },
      { windowId: 'w-2', observations: [130, 150, 170] },
    ],
    rawRefs: ['runs/r1/w-1.json', 'runs/r1/w-2.json'],
    required: true,
    ...overrides,
  };
}

describe('the reducer never lets lost data read as improvement (NEG3-18)', () => {
  it('does not pass when traffic was dropped, even if the survivors look fast', () => {
    const assessment = reduceMatchedWindows(
      input({
        windows: [
          { windowId: 'w-1', observations: [10, 12, 14], droppedObservations: 900 },
          { windowId: 'w-2', observations: [11, 13, 15] },
        ],
      }),
    );

    expect(assessment.result).not.toBe('pass');
    expect(assessment.measurementValidity).toBe('invalid');
  });

  it('does not pass when timeouts were removed from the observation set', () => {
    const assessment = reduceMatchedWindows(
      input({
        windows: [
          { windowId: 'w-1', observations: [10, 12, 14], timeoutsRemoved: 40 },
          { windowId: 'w-2', observations: [11, 13, 15] },
        ],
      }),
    );

    expect(assessment.result).not.toBe('pass');
    expect(assessment.measurementValidity).toBe('invalid');
  });

  it('is inconclusive when there are no windows to compare', () => {
    const assessment = reduceMatchedWindows(input({ windows: [] }));

    expect(assessment.result).toBe('inconclusive');
    expect(assessment.measurementValidity).toBe('inconclusive');
  });

  it('fails closed on non-finite observations instead of reducing around them', () => {
    expect(() =>
      reduceMatchedWindows(
        input({ windows: [{ windowId: 'w-1', observations: [120, Number.NaN] }] }),
      ),
    ).toThrow(/finite/);
  });
});

describe('the reducer is deterministic and bound to its algorithm config', () => {
  it('passes a healthy window set against the threshold with a pinned digest', () => {
    const assessment = reduceMatchedWindows(input());

    expect(assessment.result).toBe('pass');
    expect(assessment.measurementValidity).toBe('valid');
    expect(assessment.reducerDigest).toBe(
      createHash('sha256').update('{"algorithm":"lower-median-p50","config":{"p":50}}').digest('hex'),
    );
    expect(assessment.rawRefs).toEqual(['runs/r1/w-1.json', 'runs/r1/w-2.json']);
  });

  it('fails a window set whose pooled median misses the threshold', () => {
    const assessment = reduceMatchedWindows(
      input({
        windows: [
          { windowId: 'w-1', observations: [300, 310, 320] },
          { windowId: 'w-2', observations: [305, 315, 325] },
        ],
      }),
    );

    expect(assessment.result).toBe('fail');
  });

  it('pools raw observations instead of averaging per-window summaries', () => {
    // Window means average to 50, which would pass `lt 75`; the pooled
    // lower-median is 100, which must fail. A reducer that averaged window
    // summaries would wrongly pass here.
    const assessment = reduceMatchedWindows(
      input({
        threshold: { comparison: 'lt', value: 75 },
        windows: [
          { windowId: 'w-1', observations: [100, 100, 100] },
          { windowId: 'w-2', observations: [0] },
        ],
      }),
    );

    expect(assessment.result).toBe('fail');
  });

  it('produces the same digest and result for the same input', () => {
    const first = reduceMatchedWindows(input());
    const second = reduceMatchedWindows(input());

    expect(second.reducerDigest).toBe(first.reducerDigest);
    expect(second.result).toBe(first.result);
  });

  it('changes the digest when the config changes', () => {
    const base = reduceMatchedWindows(input());
    const changed = reduceMatchedWindows(input({ config: { p: 95 } }));

    expect(changed.reducerDigest).not.toBe(base.reducerDigest);
  });

  it('requires raw observation refs instead of accepting a summary without evidence', () => {
    expect(() => reduceMatchedWindows(input({ rawRefs: [] }))).toThrow(/raw/);
  });
});
