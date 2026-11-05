import { beforeEach, describe, expect, it } from 'vitest';

import type { TraceBundle } from './bundle.js';
import { renderTrace, renderTraceError } from './view.js';

const EVIL = '<img src=x onerror="alert(1)">';

function sampleBundle(): TraceBundle {
  return {
    version: 1,
    runId: 'run_77',
    bundle: 'verified',
    labels: { origin: 'controlled_change', executionMode: 'real_runtime', proposalMode: 'live_model' },
    events: [
      { seq: 0, at: '2026-11-03T10:00:00Z', kind: 'snapshot', title: 'Snapshot frozen', status: 'ok' },
      {
        seq: 1,
        at: '2026-11-03T10:02:00Z',
        kind: 'verdict',
        title: 'Policy assessed bundle',
        detail: 'all required dimensions passing',
        status: 'info',
      },
    ],
    hypotheses: [
      {
        id: 'H-1',
        status: 'supported_cause',
        mechanism: 'Dropped null guard',
        probe: 'replay with guard',
        result: 'failure disappears',
        children: [],
      },
    ],
    trials: [
      { id: 'T-001', label: 'baseline', status: 'pass' },
      { id: 'T-002', label: 'fault window', status: 'warn', detail: 'flaky infra, retried' },
    ],
    artifacts: [
      { name: 'manifest.json', sha256: 'deadbeef', sizeBytes: 1536, access: 'authenticated proxy' },
    ],
  };
}

describe('renderTrace', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
  });

  it('renders all four evidence views with dashboard class vocabulary', () => {
    renderTrace(root, sampleBundle());
    expect(root.querySelector('h1')?.textContent).toContain('run_77');
    expect(root.querySelector('ol.timeline')?.children).toHaveLength(2);
    expect(root.querySelector('[data-view="hypothesis-tree"]')?.children).toHaveLength(1);
    expect(root.querySelector('[data-view="trial-stats"]')?.querySelectorAll('.campaign-stat')).toHaveLength(4);
    expect(root.querySelector('[data-view="trial-grid"]')?.children).toHaveLength(2);
    expect(root.querySelector('.table-wrap table')).not.toBeNull();
    expect(root.querySelector('details.compact-detail')).not.toBeNull();
  });

  it('shows provenance labels and the no-new-verdict notice', () => {
    renderTrace(root, sampleBundle());
    expect(root.textContent).toContain('origin: controlled_change');
    expect(root.textContent).toContain('execution: real_runtime');
    expect(root.textContent).toContain('proposal: live_model');
    expect(root.querySelector('.notice.soft')).not.toBeNull();
  });

  it('escapes hostile bundle content instead of rendering markup', () => {
    const hostile: TraceBundle = {
      ...sampleBundle(),
      runId: EVIL,
      events: [
        { seq: 0, at: EVIL, kind: EVIL, title: EVIL, detail: EVIL, status: 'fail' },
      ],
      hypotheses: [
        { id: EVIL, status: EVIL, mechanism: EVIL, probe: EVIL, result: EVIL, children: [] },
      ],
      trials: [{ id: EVIL, label: EVIL, detail: EVIL, status: 'fail' }],
      artifacts: [{ name: EVIL, sha256: EVIL, sizeBytes: 1, access: EVIL }],
    };
    renderTrace(root, hostile);
    expect(root.querySelector('img')).toBeNull();
    expect(root.innerHTML).not.toContain('<img');
    expect(root.textContent).toContain(EVIL);
  });

  it('renders honest empty states when sections are absent', () => {
    renderTrace(root, { ...sampleBundle(), events: [], hypotheses: [], trials: [], artifacts: [] });
    expect(root.textContent).toContain('No events recorded');
    expect(root.textContent).toContain('No hypotheses recorded');
    expect(root.textContent).toContain('No trial receipts');
    expect(root.textContent).toContain('No artifacts recorded');
  });

  it('renders error states with specifics and a retry control', () => {
    renderTraceError(root, 'Trace bundle invalid', ['events[3].status: must be one of ok, warn, fail, info']);
    expect(root.querySelector('h1')?.textContent).toBe('Trace bundle invalid');
    expect(root.textContent).toContain('events[3].status');
    expect(root.querySelector('#trace-retry')).not.toBeNull();
  });
});
