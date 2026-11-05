/**
 * Read-only trace rendering. Uses only class names that exist in the
 * `.modern-design` port (`apps/dashboard/src/tokens.css`), with the same
 * structures as the dashboard Investigation, Campaigns, and Evidence tabs
 * (`.timeline`/`.stepmark`, `.trials`/`.trial`, `.campaign-stat`,
 * `.metric-big`, `.table-wrap`, `.badge`, `.compact-detail`, `.notice`,
 * `.inset`, `.card`/`.card-head`, `.pagehead`, `.empty-state`), so an
 * auditor sees identical styling. Test hooks use `data-view` attributes,
 * never invented classes.
 *
 * Every dynamic string goes through `textContent`. Bundle content is
 * untrusted data (NEG3-21): no `innerHTML`, no string-built markup, and no
 * untrusted text in attributes.
 */

import type {
  ArtifactDigest,
  HypothesisNode,
  TraceBundle,
  TraceEvent,
  TrialReceipt,
} from './bundle.js';

type Child = Node | string;

function h(
  tag: string,
  attrs: Record<string, string>,
  children: readonly Child[],
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else el.setAttribute(key, value);
  }
  for (const child of children) {
    el.append(child);
  }
  return el;
}

function badge(label: string, modifier: string): HTMLElement {
  return h('span', { class: `badge ${modifier}` }, [label]);
}

function card(title: string, sub: string, body: HTMLElement): HTMLElement {
  return h('section', { class: 'card' }, [
    h('div', { class: 'card-head' }, [h('div', {}, [h('h2', {}, [title]), h('div', { class: 'help' }, [sub])])]),
    body,
  ]);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function emptyStateArt(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'modern-empty-art');
  svg.setAttribute('viewBox', '0 0 64 40');
  svg.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', '6');
  rect.setAttribute('y', '8');
  rect.setAttribute('width', '52');
  rect.setAttribute('height', '24');
  rect.setAttribute('rx', '8');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M18 20h28M18 15h14M18 25h20');
  svg.append(rect, path);
  return svg;
}

function emptyState(title: string, body: string): HTMLElement {
  const wrap = h('div', { class: 'empty-state' }, [h('h2', {}, [title]), h('p', {}, [body])]);
  wrap.prepend(emptyStateArt());
  return wrap;
}

const EVENT_BADGE: Record<TraceEvent['status'], string> = {
  ok: 'green',
  warn: 'amber',
  fail: 'red',
  info: 'blue',
};

function renderEventTimeline(events: readonly TraceEvent[]): HTMLElement {
  if (events.length === 0) {
    return emptyState('No events recorded', 'This trace bundle contains no timeline events.');
  }
  return h(
    'ol',
    { class: 'timeline', 'data-view': 'event-timeline' },
    events.map((event) =>
      h('li', {}, [
        h('span', { class: 'stepmark', 'aria-hidden': 'true' }, [String(event.seq)]),
        h('strong', {}, [event.title]),
        h('div', {}, [badge(event.kind, EVENT_BADGE[event.status])]),
        h('time', {}, [event.at]),
        ...(event.detail === undefined ? [] : [h('p', {}, [event.detail])]),
      ]),
    ),
  );
}

function renderHypothesisNode(node: HypothesisNode): HTMLElement {
  const parts: Child[] = [
    h('div', {}, [h('strong', { class: 'mono' }, [node.id]), badge(node.status, 'blue')]),
    h('p', {}, [node.mechanism]),
  ];
  if (node.probe !== undefined) {
    parts.push(h('p', { class: 'help' }, [`Probe: ${node.probe}`]));
  }
  if (node.result !== undefined) {
    parts.push(h('p', { class: 'help' }, [`Result: ${node.result}`]));
  }
  if (node.children.length > 0) {
    parts.push(
      h(
        'ol',
        { 'data-view': 'hypothesis-children' },
        node.children.map((child) => h('li', {}, [renderHypothesisNode(child)])),
      ),
    );
  }
  return h('div', { class: 'inset' }, parts);
}

function renderHypothesisTree(nodes: readonly HypothesisNode[]): HTMLElement {
  if (nodes.length === 0) {
    return emptyState(
      'No hypotheses recorded',
      'This trace bundle contains no causal hypothesis tree. Absence of hypotheses is not evidence of absence of cause.',
    );
  }
  return h(
    'ol',
    { 'data-view': 'hypothesis-tree' },
    nodes.map((node) => h('li', {}, [renderHypothesisNode(node)])),
  );
}

function trialBoxClass(status: TrialReceipt['status']): string {
  if (status === 'pass') return 'trial pass';
  if (status === 'fail') return 'trial fail';
  if (status === 'pending') return 'trial pending';
  return 'trial';
}

function trialBadge(status: TrialReceipt['status']): HTMLElement {
  if (status === 'pass') return badge(status, 'green');
  if (status === 'fail') return badge(status, 'red');
  if (status === 'warn') return badge(status, 'amber');
  return badge(status, 'blue');
}

function renderTrialGrid(trials: readonly TrialReceipt[]): HTMLElement {
  if (trials.length === 0) {
    return emptyState('No trial receipts', 'This trace bundle contains no trial receipts.');
  }
  const passes = trials.filter((trial) => trial.status === 'pass').length;
  const problems = trials.filter((trial) => trial.status === 'warn' || trial.status === 'fail').length;
  const pending = trials.filter((trial) => trial.status === 'pending').length;
  const stats = h('div', { class: 'grid3', 'data-view': 'trial-stats' }, [
    h('div', { class: 'campaign-stat' }, [
      h('small', {}, ['Scheduled trials']),
      h('div', { class: 'metric-big' }, [String(trials.length)]),
    ]),
    h('div', { class: 'campaign-stat' }, [
      h('small', {}, ['Valid passes']),
      h('div', { class: 'metric-big' }, [String(passes)]),
    ]),
    h('div', { class: 'campaign-stat' }, [
      h('small', {}, ['Failed / needs attention']),
      h('div', { class: 'metric-big' }, [String(problems)]),
    ]),
    h('div', { class: 'campaign-stat' }, [
      h('small', {}, ['Pending']),
      h('div', { class: 'metric-big' }, [String(pending)]),
    ]),
  ]);
  const grid = h(
    'div',
    { class: 'trials', 'aria-label': 'Trial receipts', 'data-view': 'trial-grid' },
    trials.map((trial) => h('span', { class: trialBoxClass(trial.status) }, [])),
  );
  const receipts = h('div', { class: 'table-wrap' }, [
    h('table', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', {}, ['Trial']),
          h('th', {}, ['Label']),
          h('th', {}, ['Status']),
          h('th', {}, ['Details']),
        ]),
      ]),
      h(
        'tbody',
        {},
        trials.map((trial) =>
          h('tr', {}, [
            h('td', { class: 'mono' }, [trial.id]),
            h('td', {}, [trial.label]),
            h('td', {}, [trialBadge(trial.status)]),
            h('td', {}, [trial.detail ?? '—']),
          ]),
        ),
      ),
    ]),
  ]);
  return h('div', {}, [stats, grid, receipts]);
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${String(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function renderArtifactTable(artifacts: readonly ArtifactDigest[]): HTMLElement {
  if (artifacts.length === 0) {
    return emptyState('No artifacts recorded', 'This trace bundle contains no artifact digests.');
  }
  return h('div', { class: 'table-wrap', 'data-view': 'artifact-table' }, [
    h('table', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', {}, ['Artifact']),
          h('th', {}, ['SHA-256 digest']),
          h('th', {}, ['Size']),
          h('th', {}, ['Access']),
        ]),
      ]),
      h(
        'tbody',
        {},
        artifacts.map((artifact) => {
          const nameCell =
            artifact.href === undefined
              ? h('span', {}, [artifact.name])
              : h('a', { href: artifact.href, rel: 'noopener' }, [artifact.name]);
          return h('tr', {}, [
            h('td', {}, [nameCell]),
            h('td', { class: 'mono' }, [artifact.sha256]),
            h('td', {}, [formatBytes(artifact.sizeBytes)]),
            h('td', {}, [artifact.access]),
          ]);
        }),
      ),
    ]),
  ]);
}

/** Render the full read-only audit of one validated trace bundle. */
export function renderTrace(root: HTMLElement, bundle: TraceBundle): void {
  root.replaceChildren();
  const header = h('header', { class: 'pagehead' }, [
    h('div', {}, [
      h('div', { class: 'eyebrow' }, ['READ-ONLY EVIDENCE AUDIT']),
      h('h1', {}, [`Run ${bundle.runId}`]),
      h('p', { class: 'sub' }, [`Bundle assessment: ${bundle.bundle}`]),
    ]),
    h('div', { class: 'actions' }, [
      badge(`origin: ${bundle.labels.origin}`, 'blue'),
      badge(`execution: ${bundle.labels.executionMode}`, 'blue'),
      badge(`proposal: ${bundle.labels.proposalMode}`, 'blue'),
    ]),
  ]);
  const notice = h('div', { class: 'notice soft' }, [
    h('p', {}, [
      'This viewer renders a frozen evidence snapshot. It performs no checks of its own; ' +
        'assessment shown here is the recorded bundle value, not a new verdict.',
    ]),
  ]);
  const manifest = h('details', { class: 'compact-detail' }, [
    h('summary', {}, ['Why these four views']),
    h('p', {}, [
      'The event timeline, hypothesis tree, trial receipts, and artifact digests mirror the ' +
        'dashboard Investigation, Campaigns, and Evidence tabs so an auditor can cross-check ' +
        'the same evidence in both places.',
    ]),
  ]);
  root.append(
    header,
    notice,
    card('Event timeline', 'TIMELINE', renderEventTimeline(bundle.events)),
    card('Causal hypothesis tree', 'INVESTIGATION', renderHypothesisTree(bundle.hypotheses)),
    card('Trial receipts', 'CAMPAIGNS', renderTrialGrid(bundle.trials)),
    card('Artifact digests', 'EVIDENCE', renderArtifactTable(bundle.artifacts)),
    manifest,
  );
}

/** Render an honest failure state: what was attempted, why it failed, what to do next. */
export function renderTraceError(root: HTMLElement, title: string, lines: readonly string[]): void {
  root.replaceChildren();
  const retry = h('button', { type: 'button', class: 'button primary', id: 'trace-retry' }, ['Retry']);
  retry.addEventListener('click', () => { window.location.reload(); });
  root.append(
    h('header', { class: 'pagehead' }, [
      h('div', {}, [h('div', { class: 'eyebrow' }, ['READ-ONLY EVIDENCE AUDIT']), h('h1', {}, [title])]),
    ]),
    h('div', { class: 'notice' }, [
      h('p', {}, ['The trace could not be displayed. Nothing below is evidence of anything.']),
    ]),
    card(
      'What went wrong',
      'ERROR',
      h('div', {}, [
        h('div', { class: 'inset' }, lines.map((line) => h('p', { class: 'mono' }, [line]))),
        h('div', { class: 'actions' }, [retry]),
      ]),
    ),
  );
}
