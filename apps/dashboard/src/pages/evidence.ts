/* Evidence library + read-only viewer (T-46, WP3-12/29). Artifacts are
 * the run's `artifact` events (the only enumeration the backend owns);
 * bytes come from the digest-verified download endpoint. The viewer
 * renders text escaped, refuses preview for large/binary bytes, and
 * repeats the server's integrity verdict verbatim — it never judges. */

import { apiGet, apiGetBytes, ApiRequestError } from '../api.js';
import { emptyState, errorState, h } from '../components.js';
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
  void apiGet<{ github: boolean }>('/api/auth/providers')
    .then((providers) => {
      host.replaceChildren(
        h('section', { class: 'card' }, [
          h('h2', {}, ['Publication']),
          providers.github
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
  const runId = ctx.params.get('run');
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
      ? h('p', {}, ['No artifacts on this run yet — workers attach them as the run proceeds.'])
      : h(
          'ul',
          {},
          artifacts.map((entry) =>
            h('li', {}, [
              h('p', {}, [
                h('code', { class: 'inline' }, [entry.digest]),
                document.createTextNode(` · event #${String(entry.seq)} · ${entry.createdAt}`),
              ]),
              h('p', {}, [
                h(
                  'a',
                  {
                    class: 'button',
                    href: `#/evidence/view?run=${encodeURIComponent(runId)}&digest=${encodeURIComponent(entry.digest)}`,
                  },
                  [`View ${shortDigest(entry.digest)}`],
                ),
                document.createTextNode(' '),
                downloadLink(runId, entry.digest),
                document.createTextNode(' '),
                copyButton(entry.digest),
              ]),
            ]),
          ),
        );
  const publication = h('div', {}, []);
  publicationSection(publication);
  const exportButton = h('button', { class: 'button', type: 'button' }, ['Download run evidence (JSON)']);
  exportButton.addEventListener('click', () => {
    const text = buildEvidenceExport({ run, artifacts, exportedAt: new Date().toISOString() });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = h('a', { href: url, download: `evidence-${runId}.json` }, []);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  });
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('div', { class: 'eyebrow' }, ['Content-Addressed Artifact Store']),
      h('h1', {}, ['Evidence']),
      h('p', { class: 'muted' }, [
        `Run ${run.runId} · ${run.state} · version ${String(run.version)}. Artifacts below are the run's own records; the list shows everything attached, in event order.`,
      ]),
      ...(listed.truncated
        ? [h('p', { role: 'status' }, [`Showing the first ${String(MAX_LIST_EVENTS)} events; older runs may carry more.`])]
        : []),
      list,
    ]),
    publication,
    h('div', { class: 'split' }, [
      h('section', { class: 'card' }, [
        h('div', { class: 'eyebrow' }, ['Manifest Snapshot']),
        h('h2', {}, ['Export']),
        h('p', {}, [
          'A JSON snapshot of the run header and artifact list above, generated in your browser from data this page already fetched. ',
          'It carries no verdict and proves nothing by itself.',
        ]),
        h('p', {}, [exportButton]),
      ]),
      h('section', { class: 'card' }, [
        h('div', { class: 'eyebrow' }, ['Assurance Boundaries']),
        h('h2', {}, ['Outcomes and evaluations']),
        h('p', {}, [
          'Owner outcome reporting and evaluation denominators are not exposed by the API yet, so this page shows no figures. ',
          'Any number here would be invented; invented numbers stay out.',
        ]),
      ]),
    ]),
    h('p', {}, [
      h('a', { class: 'button', href: `#/run?id=${encodeURIComponent(runId)}` }, ['Back to the run']),
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

export function registerEvidencePages(): void {
  registerRoute({ path: '/evidence', title: 'Evidence', render: renderLibrary });
  registerRoute({ path: '/evidence/view', title: 'Evidence viewer', render: renderViewer });
}
