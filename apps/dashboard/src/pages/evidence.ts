/* Evidence library + read-only viewer (T-46, WP3-12/29; Progress UI 6
 * mockup fidelity). Artifacts are the run's `artifact` events (the only
 * enumeration the backend owns); bytes come from the digest-verified
 * download endpoint. The viewer renders text escaped, refuses preview for
 * large/binary bytes, and repeats the server's integrity verdict verbatim —
 * it never judges. Layout follows .template-ui/mockup.html with real classes
 * from tokens.css. All runtime copy is English (FR3-40). */

import { apiGet, apiGetBytes, apiPost, ApiRequestError } from '../api.js';
import { card, emptyState, errorState, h, pageHead, row, staticBadge, table, tabs, type TabItem } from '../components.js';
import { registerRoute, type RouteContext } from '../routes.js';

const HEX64 = /^[0-9a-f]{64}$/;
/** Preview stays small; anything bigger is download-only. */
const MAX_PREVIEW_BYTES = 256 * 1024;
const PAGE_LIMIT = 100;
/** Honest cap on one library read; truncation is labeled, not silent. */
const MAX_LIST_EVENTS = 500;

interface EvidenceSession {
  readonly authenticated: boolean;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly role?: string;
}

interface RunHeader {
  readonly runId: string;
  readonly state: string;
  readonly version: number;
  readonly submitDigest: string;
  readonly projectId?: string;
  readonly createdAt?: string;
}

interface EventItem {
  readonly seq: number;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

interface EventsPage {
  readonly events: readonly EventItem[];
  readonly cursor: number;
}

interface ArtifactEntry {
  readonly seq: number;
  readonly digest: string;
  readonly createdAt: string;
}

interface SearchHit {
  readonly kind: string;
  readonly id: string;
  readonly projectId?: string;
  readonly title: string;
  readonly snippet: string;
  readonly createdAt: string;
}

interface SearchResult {
  readonly hits: readonly SearchHit[];
  readonly totalCount: number;
  readonly cursor: number;
}

function asErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
}

function statusOf(error: unknown): number {
  return error instanceof ApiRequestError ? error.failure.status : 0;
}

function loginCard(outlet: HTMLElement, title: string, body: string): void {
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, [title]),
      h('p', {}, [body]),
      h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
    ]),
  );
}

function expired(host: HTMLElement): void {
  window.location.hash = '#/session-expired';
  host.replaceChildren(emptyState('Session expired', 'Redirecting to login…'));
}

function runTabItems(runId: string): TabItem[] {
  const query = `?run=${encodeURIComponent(runId)}`;
  return [
    { id: 'review', label: 'Overview & diff', href: `#/review${query}` },
    { id: 'impact', label: 'Impact', href: `#/impact${query}` },
    { id: 'investigation', label: 'Investigation', href: `#/investigation${query}` },
    { id: 'campaigns', label: 'Verification', href: `#/campaigns${query}` },
    { id: 'evidence', label: 'Evidence', href: `#/evidence${query}` },
    { id: 'publication', label: 'Publication', href: `#/publication${query}` },
    { id: 'outcome', label: 'Owner validation', href: `#/outcome${query}` },
  ];
}

function artifactOf(event: EventItem): ArtifactEntry | undefined {
  if (event.kind !== 'artifact') return undefined;
  const digest = event.payload['digest'];
  if (typeof digest !== 'string' || !HEX64.test(digest)) return undefined;
  return { seq: event.seq, digest, createdAt: event.createdAt };
}

/** Client-side snapshot of already-fetched server data; labeled as such. */
export function buildEvidenceExport(input: {
  run: RunHeader;
  artifacts: readonly ArtifactEntry[];
  exportedAt: string;
}): string {
  return JSON.stringify(
    {
      kind: 'changeproof-evidence-export',
      schemaVersion: '1',
      runId: input.run.runId,
      runState: input.run.state,
      runVersion: input.run.version,
      submitDigest: input.run.submitDigest,
      artifacts: input.artifacts.map((entry) => ({
        seq: entry.seq,
        digest: entry.digest,
        createdAt: entry.createdAt,
      })),
      exportedAt: input.exportedAt,
      provenance:
        'Client-side snapshot of server data fetched by this dashboard; ' +
        'it carries no verdict and proves nothing by itself.',
    },
    undefined,
    2,
  );
}

async function readEvents(runId: string): Promise<{ events: EventItem[]; truncated: boolean }> {
  const events: EventItem[] = [];
  let afterSeq = 0;
  for (;;) {
    const page = await apiGet<EventsPage>(
      `/api/runs/${encodeURIComponent(runId)}/events?afterSeq=${String(afterSeq)}&limit=${String(PAGE_LIMIT)}`,
    );
    events.push(...page.events);
    if (page.events.length < PAGE_LIMIT || events.length >= MAX_LIST_EVENTS) {
      return { events, truncated: events.length >= MAX_LIST_EVENTS && page.events.length >= PAGE_LIMIT };
    }
    afterSeq = page.cursor;
  }
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}

function copyButton(digest: string): HTMLElement {
  const button = h('button', { class: 'button', type: 'button', 'data-copy-digest': digest }, ['Copy digest']);
  const note = h('span', { class: 'muted', 'aria-live': 'polite' }, []);
  button.addEventListener('click', () => {
    const holder = globalThis.navigator as unknown as { clipboard?: Clipboard | undefined };
    const clipboard = holder.clipboard;
    if (clipboard === undefined) {
      note.replaceChildren(document.createTextNode('Copy unavailable in this browser.'));
      return;
    }
    void clipboard
      .writeText(digest)
      .then(() => {
        note.replaceChildren(document.createTextNode('Copied.'));
      })
      .catch(() => {
        note.replaceChildren(document.createTextNode('Copy failed.'));
      });
  });
  return h('span', {}, [button, document.createTextNode(' '), note]);
}

function downloadLink(runId: string, digest: string): HTMLElement {
  return h(
    'a',
    { class: 'button', href: `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(digest)}` },
    [`Download ${shortDigest(digest)}`],
  );
}

function publicationSection(host: HTMLElement): void {
  host.replaceChildren(
    h('section', { class: 'card' }, [
      h('h2', {}, ['Publication']),
      h('p', { class: 'muted' }, ['Checking pull request availability…']),
    ]),
  );
  void apiGet<{ github: boolean; githubApp?: boolean }>('/api/auth/providers')
    .then((providers) => {
      host.replaceChildren(
        h('section', { class: 'card' }, [
          h('h2', {}, ['Publication']),
          // Sign-in (`github`) is not repository authority: only an App
          // installation (`githubApp`) can back pull request state.
          providers.githubApp === true
            ? h('p', {}, [
                'A GitHub App is configured, but pull request and CI state are not exposed by the API yet. ' +
                  'Nothing is shown rather than guessed.',
              ])
            : h('p', {}, [
                'Publication state is unavailable: no authorized GitHub App is configured for this service, ' +
                  'so there are no pull requests to show. Connect one before expecting publication here.',
              ]),
        ]),
      );
    })
    .catch((error: unknown) => {
      host.replaceChildren(
        h('section', { class: 'card' }, [
          h('h2', {}, ['Publication']),
          h('p', {}, [`Availability is unknown right now: ${asErrorMessage(error)}`]),
        ]),
      );
    });
}

async function renderLibrary(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const runId = ctx.params.get('run') ?? ctx.params.get('id');
  if (runId === undefined || runId === '') {
    outlet.replaceChildren(
      errorState('Evidence needs a run', 'Open evidence from a run, where artifacts live.', undefined),
    );
    outlet.appendChild(h('p', {}, [h('a', { class: 'button', href: '#/runs' }, ['Back to runs'])]));
    return;
  }
  outlet.replaceChildren(emptyState('Loading…', 'Reading the run evidence.'));
  let session: EvidenceSession;
  try {
    session = await apiGet<EvidenceSession>('/api/auth/session');
  } catch (error) {
    outlet.replaceChildren(
      errorState('Evidence unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderLibrary(outlet, ctx),
      }),
    );
    return;
  }
  if (!session.authenticated) {
    loginCard(outlet, 'Evidence needs a login', 'Log in to see this run evidence.');
    return;
  }
  let run: RunHeader;
  let listed: { events: EventItem[]; truncated: boolean };
  try {
    [run, listed] = await Promise.all([
      apiGet<RunHeader>(`/api/runs/${encodeURIComponent(runId)}`),
      readEvents(runId),
    ]);
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    if (statusOf(error) === 404) {
      outlet.replaceChildren(errorState('Run not found', asErrorMessage(error)));
      return;
    }
    outlet.replaceChildren(
      errorState('Evidence unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderLibrary(outlet, ctx),
      }),
    );
    return;
  }
  const artifacts = listed.events.flatMap((event) => {
    const entry = artifactOf(event);
    return entry === undefined ? [] : [entry];
  });
  const list =
    artifacts.length === 0
      ? emptyState('No artifacts yet', 'Workers attach artifacts as the run proceeds; none are on this run yet.')
      : table(
          ['Artifact digest', 'Attached', 'Actions'],
          artifacts.map((entry) => [
            h('div', {}, [
              h('code', { class: 'inline' }, [entry.digest]),
              h('div', { class: 'help' }, [`Event #${String(entry.seq)} · ${entry.createdAt}`]),
            ]),
            entry.createdAt,
            h('div', { class: 'actions' }, [
              h(
                'a',
                {
                  class: 'button small',
                  href: `#/evidence/view?run=${encodeURIComponent(runId)}&digest=${encodeURIComponent(entry.digest)}`,
                },
                [`View ${shortDigest(entry.digest)}`],
              ),
              downloadLink(runId, entry.digest),
              copyButton(entry.digest),
            ]),
          ]),
        );
  const publication = h('div', {}, []);
  publicationSection(publication);
  const exportButton = h('button', { class: 'button', type: 'button' }, ['Download run evidence (JSON)']);
  const downloadExport = (): void => {
    const text = buildEvidenceExport({ run, artifacts, exportedAt: new Date().toISOString() });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = h('a', { href: url, download: `evidence-${runId}.json` }, []);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };
  exportButton.addEventListener('click', downloadExport);
  const manifestPreview = buildEvidenceExport({ run, artifacts, exportedAt: 'preview — export stamps the time' });
  outlet.replaceChildren(
    h('div', { class: 'breadcrumb' }, [
      h('a', { href: '#/runs' }, ['Runs']),
      document.createTextNode(' / '),
      h('a', { href: `#/run?id=${encodeURIComponent(runId)}` }, [runId]),
      document.createTextNode(' / Evidence'),
    ]),
    pageHead({
      title: `Evidence ${runId}`,
      subtitle: `Run ${run.runId} · ${run.state} · version ${String(run.version)}. Artifacts below are the run's own records, in event order.`,
      actions: [
        h('a', { class: 'button', href: `#/run?id=${encodeURIComponent(runId)}` }, ['Back to the run']),
        h('a', { class: 'button primary', href: `#/review?run=${encodeURIComponent(runId)}` }, ['Back to review']),
      ],
    }),
    h('div', { class: 'run-context' }, [
      h('strong', {}, [run.runId]),
      staticBadge(run.state, run.state === 'succeeded' ? 'green' : run.state === 'failed' ? 'red' : 'blue'),
      h('span', {}, [`Version ${String(run.version)}`]),
      h('span', {}, [`${String(artifacts.length)} artifacts`]),
    ]),
    tabs(runTabItems(runId), 'evidence'),
    ...(listed.truncated
      ? [
          h('div', { class: 'notice', role: 'status' }, [
            h('span', {}, [`Showing the first ${String(MAX_LIST_EVENTS)} events; older runs may carry more.`]),
          ]),
        ]
      : []),
    h('div', { class: 'split' }, [
      h('div', {}, [
        card(
          'Raw artifacts',
          h('div', {}, [
            list,
            h('div', { class: 'footer-note' }, [
              'Logs are shown as escaped text and are never executed. Downloads go through the authenticated artifact endpoint, never a public URL.',
            ]),
          ]),
          'Downloads follow current repository grants.',
        ),
        card(
          'Reproduction manifest',
          h('div', {}, [
            h('pre', { class: 'codebox', 'aria-label': 'Reproduction manifest preview' }, [manifestPreview]),
            h('p', {}, [exportButton]),
          ]),
          'A JSON snapshot of the run header and artifact list, generated in your browser. It carries no verdict and proves nothing by itself.',
        ),
        publication,
      ]),
      h('aside', {}, [
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Identity bound to the run']),
          row('Run', h('code', {}, [run.runId])),
          row('State', run.state),
          row('Version', String(run.version)),
          row('Submit digest', h('code', {}, [run.submitDigest])),
          ...(run.projectId === undefined ? [] : [row('Project', run.projectId)]),
          ...(run.createdAt === undefined ? [] : [row('Created', run.createdAt)]),
        ]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Retention']),
          row(h('span', { class: 'muted' }, ['Immutable until']), 'Not exposed'),
          row(h('span', { class: 'muted' }, ['Storage location']), 'Private object storage'),
          h('p', { class: 'help' }, [
            'Immutable means not overwritten during retention, not that it cannot be deleted.',
          ]),
        ]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Discussions']),
          h('p', { class: 'help' }, ['Threads pin to a candidate digest. Comments never change verdicts.']),
          h('p', {}, [
            h('a', { class: 'button full', href: `#/threads?run=${encodeURIComponent(runId)}` }, ['Open discussions']),
          ]),
        ]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Outcomes and evaluations']),
          h('p', {}, [
            'Owner outcome reporting and evaluation denominators are not exposed by the API yet, so this page shows no figures. ',
            'Any number here would be invented; invented numbers stay out.',
          ]),
        ]),
      ]),
    ]),
  );
}

function decodePreview(bytes: Uint8Array): string | undefined {
  const head = bytes.subarray(0, 8192);
  for (const byte of head) {
    if (byte === 0) return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function renderViewer(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const runId = ctx.params.get('run');
  const digest = ctx.params.get('digest');
  if (runId === undefined || runId === '' || digest === undefined || digest === '') {
    outlet.replaceChildren(
      errorState('Evidence link is incomplete', 'The link carries no run or artifact digest. Open the artifact from the evidence library.'),
    );
    return;
  }
  if (!HEX64.test(digest)) {
    outlet.replaceChildren(
      errorState('Evidence link is invalid', 'The digest in the link is not a valid artifact digest (64 lowercase hex chars).'),
    );
    return;
  }
  outlet.replaceChildren(emptyState('Loading…', 'Reading the artifact bytes.'));
  let session: EvidenceSession;
  try {
    session = await apiGet<EvidenceSession>('/api/auth/session');
  } catch (error) {
    outlet.replaceChildren(
      errorState('Artifact unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderViewer(outlet, ctx),
      }),
    );
    return;
  }
  if (!session.authenticated) {
    loginCard(outlet, 'Evidence needs a login', 'Log in to see this artifact.');
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await apiGetBytes(`/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(digest)}`);
  } catch (error) {
    const status = statusOf(error);
    if (status === 401) {
      expired(outlet);
      return;
    }
    if (status === 400) {
      // The server recomputes the digest on every download; a 400 here
      // is its integrity refusal (NEG3-33), repeated verbatim.
      outlet.replaceChildren(errorState('Artifact failed its integrity check', asErrorMessage(error)));
      return;
    }
    if (status === 404) {
      outlet.replaceChildren(errorState('Artifact unknown', asErrorMessage(error)));
      return;
    }
    if (status === 403) {
      outlet.replaceChildren(errorState('Artifact is not shared with you', asErrorMessage(error)));
      return;
    }
    outlet.replaceChildren(
      errorState('Artifact unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderViewer(outlet, ctx),
      }),
    );
    return;
  }
  const back = h('p', {}, [
    h('a', { href: `#/evidence?run=${encodeURIComponent(runId)}` }, ['Back to the evidence library']),
  ]);
  const digestLine = h('p', {}, [
    'Digest ',
    h('code', { class: 'inline' }, [digest]),
    document.createTextNode(` · ${String(bytes.length)} bytes · verified by the server when served.`),
  ]);
  if (bytes.length > MAX_PREVIEW_BYTES) {
    outlet.replaceChildren(
      h('section', { class: 'card' }, [
        h('h1', {}, ['Evidence viewer']),
        digestLine,
        h('p', {}, [
          `This artifact is too large to preview in the browser (${String(bytes.length)} bytes). Download it to inspect the full bytes.`,
        ]),
        h('p', {}, [downloadLink(runId, digest), document.createTextNode(' '), copyButton(digest)]),
      ]),
      back,
    );
    return;
  }
  const text = decodePreview(bytes);
  if (text === undefined) {
    outlet.replaceChildren(
      h('section', { class: 'card' }, [
        h('h1', {}, ['Evidence viewer']),
        digestLine,
        h('p', {}, [
          'These bytes are not plain text, so there is no preview. Download them to inspect the original.',
        ]),
        h('p', {}, [downloadLink(runId, digest), document.createTextNode(' '), copyButton(digest)]),
      ]),
      back,
    );
    return;
  }
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, ['Evidence viewer']),
      digestLine,
      h('p', { class: 'muted' }, ['Read-only preview. The bytes below are shown exactly as served; nothing here is editable.']),
      h('pre', {}, [h('code', {}, [text])]),
      h('p', {}, [downloadLink(runId, digest), document.createTextNode(' '), copyButton(digest)]),
    ]),
    back,
  );
}

async function renderEvidenceLibrary(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the evidence library.'));
  let session: EvidenceSession;
  try {
    session = await apiGet<EvidenceSession>('/api/auth/session');
  } catch (error) {
    outlet.replaceChildren(
      errorState('Evidence library unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderEvidenceLibrary(outlet),
      }),
    );
    return;
  }
  if (!session.authenticated) {
    loginCard(outlet, 'Evidence library needs a login', 'Log in to browse run evidence.');
    return;
  }
  let runs: SearchResult;
  try {
    runs = await apiPost<SearchResult>('/api/search', { schemaVersion: '1', scope: 'runs', limit: 20 });
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    if (statusOf(error) === 403) {
      outlet.replaceChildren(errorState('Access denied', asErrorMessage(error)));
      return;
    }
    outlet.replaceChildren(
      errorState('Evidence library unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderEvidenceLibrary(outlet),
      }),
    );
    return;
  }
  outlet.replaceChildren(
    pageHead({
      title: 'Evidence library',
      subtitle: 'Private evidence that binds changes, candidates, and verification.',
      actions: [h('a', { class: 'button', href: '#/runs' }, ['Back to runs'])],
    }),
    h('div', { class: 'stats' }, [
      h('div', { class: 'card stat' }, [
        h('div', { class: 'label' }, ['Runs with evidence']),
        h('div', { class: 'value' }, [String(runs.hits.length)]),
        h('div', { class: 'sub' }, ['Returned from /api/search']),
      ]),
      h('div', { class: 'card stat' }, [
        h('div', { class: 'label' }, ['Access']),
        h('div', { class: 'value' }, ['Private']),
        h('div', { class: 'sub' }, ['Downloads follow current grants']),
      ]),
    ]),
    card(
      'Bundle & manifest',
      runs.hits.length === 0
        ? emptyState('No runs yet', 'File your first run to see its evidence here.', h('a', { class: 'button', href: '#/new-run' }, ['File a run']))
        : table(
            ['Run / manifest', 'Project', 'State', 'Updated', ''],
            runs.hits.map((hit) => [
              h('div', {}, [
                h('strong', {}, [hit.id]),
                h('div', { class: 'help' }, [hit.title]),
              ]),
              hit.projectId ?? '—',
              staticBadge(hit.snippet === '' ? 'unknown' : hit.snippet),
              hit.createdAt,
              h('a', { class: 'button small', href: `#/evidence?run=${encodeURIComponent(hit.id)}` }, ['Open evidence']),
            ]),
          ),
      'Downloads and search follow current repository grants.',
    ),
    h('section', { class: 'card pad' }, [
      h('h2', {}, ['Traceable review']),
      h('div', { class: 'grid3' }, [
        h('div', { class: 'inset' }, [
          h('h3', {}, ['Source identity']),
          h('p', { class: 'help' }, ['Exact base, head, candidate, and dependency refs.']),
        ]),
        h('div', { class: 'inset' }, [
          h('h3', {}, ['Independent checks']),
          h('p', { class: 'help' }, ['Required check results, trial validity, and inconclusive dimensions.']),
        ]),
        h('div', { class: 'inset' }, [
          h('h3', {}, ['Reproducible scope']),
          h('p', { class: 'help' }, ['Pinned topology, dataset, runner, and budget from the manifest.']),
        ]),
      ]),
    ]),
  );
}

export function registerEvidencePages(): void {
  registerRoute({ path: '/evidence', title: 'Evidence', navLabel: 'Evidence', navSection: 'workspace', render: renderLibrary });
  registerRoute({ path: '/evidence/view', title: 'Evidence viewer', render: renderViewer });
  registerRoute({
    path: '/evidence-library',
    title: 'Evidence library',
    navLabel: 'Evidence',
    navSection: 'workspace',
    render: renderEvidenceLibrary,
  });
}
