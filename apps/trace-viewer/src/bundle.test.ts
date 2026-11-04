import { describe, expect, it } from 'vitest';

import { parseTraceBundle } from './bundle.js';

function validBundle(): Record<string, unknown> {
  return {
    version: 1,
    runId: 'run_01',
    bundle: 'incomplete',
    labels: { origin: 'controlled_change', executionMode: 'real_runtime', proposalMode: 'live_model' },
    events: [
      { seq: 0, at: '2026-11-03T10:00:00Z', kind: 'snapshot', title: 'Snapshot frozen', status: 'ok' },
      {
        seq: 1,
        at: '2026-11-03T10:01:00Z',
        kind: 'probe',
        title: 'Probe executed',
        detail: 'distinguishing probe H-2',
        status: 'warn',
      },
    ],
    hypotheses: [
      {
        id: 'H-1',
        status: 'supported_cause',
        mechanism: 'Null guard dropped in refactor',
        probe: 'replay with guard restored',
        result: 'failure disappears',
        children: [{ id: 'H-1a', status: 'refuted', mechanism: 'Alternative path', children: [] }],
      },
    ],
    trials: [
      { id: 'T-001', label: 'baseline replay', status: 'pass' },
      { id: 'T-002', label: 'fault injection', status: 'pending' },
    ],
    artifacts: [
      {
        name: 'evidence-manifest.json',
        sha256: 'abc123',
        sizeBytes: 2048,
        access: 'authenticated proxy',
        href: '/api/evidence/artifacts/manifest',
      },
    ],
  };
}

describe('parseTraceBundle', () => {
  it('accepts a fully populated bundle', () => {
    const parsed = parseTraceBundle(validBundle());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle.runId).toBe('run_01');
    expect(parsed.bundle.events).toHaveLength(2);
    expect(parsed.bundle.hypotheses).toHaveLength(1);
    expect(parsed.bundle.trials).toHaveLength(2);
    expect(parsed.bundle.artifacts).toHaveLength(1);
  });

  it('accepts empty evidence arrays as an honest empty trace', () => {
    const payload = { ...validBundle(), events: [], hypotheses: [], trials: [], artifacts: [] };
    const parsed = parseTraceBundle(payload);
    expect(parsed.ok).toBe(true);
  });

  it('rejects non-objects and wrong versions', () => {
    expect(parseTraceBundle(null).ok).toBe(false);
    expect(parseTraceBundle('nope').ok).toBe(false);
    expect(parseTraceBundle({ ...validBundle(), version: 2 }).ok).toBe(false);
  });

  it('rejects missing identity and labels with specific errors', () => {
    const parsed = parseTraceBundle({ ...validBundle(), runId: '  ', labels: {} });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.some((error) => error.startsWith('runId:'))).toBe(true);
    expect(parsed.errors.some((error) => error.startsWith('labels.origin:'))).toBe(true);
  });

  it('rejects unknown event and trial statuses', () => {
    const badEvent = {
      ...validBundle(),
      events: [{ seq: 0, at: 't', kind: 'k', title: 'x', status: 'verified' }],
    };
    const parsedEvent = parseTraceBundle(badEvent);
    expect(parsedEvent.ok).toBe(false);

    const badTrial = {
      ...validBundle(),
      trials: [{ id: 'T-1', label: 'x', status: 'green' }],
    };
    const parsedTrial = parseTraceBundle(badTrial);
    expect(parsedTrial.ok).toBe(false);
  });

  it('rejects oversized arrays instead of truncating silently', () => {
    const trials = Array.from({ length: 501 }, (_, index) => ({
      id: `T-${String(index)}`,
      label: 'x',
      status: 'pass',
    }));
    const parsed = parseTraceBundle({ ...validBundle(), trials });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.some((error) => error.startsWith('trials:'))).toBe(true);
  });

  it('rejects cross-origin artifact links', () => {
    const payload = {
      ...validBundle(),
      artifacts: [
        { name: 'x', sha256: 'y', sizeBytes: 1, access: 'z', href: 'https://evil.example/x' },
      ],
    };
    const parsed = parseTraceBundle(payload);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.some((error) => error.includes('.href'))).toBe(true);
  });

  it('rejects deeply nested hypotheses instead of recursing forever', () => {
    let nested: Record<string, unknown> = { id: 'deep', status: 's', mechanism: 'm', children: [] };
    for (let depth = 0; depth < 12; depth += 1) {
      nested = { id: `H-${String(depth)}`, status: 's', mechanism: 'm', children: [nested] };
    }
    const parsed = parseTraceBundle({ ...validBundle(), hypotheses: [nested] });
    expect(parsed.ok).toBe(false);
  });
});
