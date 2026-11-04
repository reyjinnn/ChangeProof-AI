/* Run journey UI (T-45, WP3-25; Progress UI 6 mockup fidelity). Project/run
 * lists, template-driven draft + immutable submit, live run detail, and the
 * run-tab journey (review, impact, investigation, campaigns, publication,
 * outcome) over the real lifecycle/queries stores. Polling (never a fake
 * stream) with cursor, reconnect, and navigation-aware stop; no verdict is
 * ever invented — every page says exactly what the backend does not provide.
 * Layout follows .template-ui/mockup.html with real classes from tokens.css
 * (.filterbar/.chip, .table-tools/.table-search, .timeline/.stepmark,
 * .graph-board/.graph-node/.graph-edge, .trials/.trial, .diff/.diff-line,
 * .codebox/.code-head, .campaign-stat, .notice, .run-context, .route-tabs).
 * All runtime copy is English (FR3-40); dynamic text goes through textContent
 * via h() (NEG3-21). */

import type { PublicTemplate } from '../../../../src/core/contracts/schemas/publicsite.js';

import { apiGet, apiGetBytes, apiPost, ApiRequestError } from '../api.js';
import {
  badge,
  card,
  emptyState,
  errorState,
  field,
  h,
  iconSvg,
  modal,
  pageHead,
  row,
  staticBadge,
  table,
  tabs,
  type TabItem,
} from '../components.js';
import { currentRouteEpoch, isCurrentRouteEpoch, registerRoute, type RouteContext } from '../routes.js';
import { loadDraft, saveDraft, SecretDraftError } from '../store.js';

/** Poll timing; tests shrink it, production keeps the patient default. */
export const pollConfig = { intervalMs: 2500, maxFailures: 5 };

interface RunSession {
  readonly authenticated: boolean;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly role?: string;
  readonly grantVersion?: number;
  readonly projectGrants?: readonly string[];
  readonly repositoryGrants?: readonly string[];
}

interface SearchHit {
  readonly kind: 'project' | 'run' | 'audit-event';
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

type RunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface RunDetail {
  readonly runId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly state: RunState;
  readonly version: number;
  readonly jobId?: string;
  readonly reservationId?: string;
  readonly submitDigest: string;
  readonly repositoryIds: readonly string[];
  readonly createdAt: string;
  /** Shown only when the backend records it; otherwise "not recorded". */
  readonly executionMode?: string;
}

interface RunEventItem {
  readonly seq: number;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

interface EventsPage {
  readonly events: readonly RunEventItem[];
  readonly cursor: number;
}

interface SubmitReceipt {
  readonly runId: string;
  readonly jobId: string;
  readonly reservationId: string;
  readonly submitDigest: string;
  readonly duplicate: boolean;
}

interface DraftBody {
  readonly intent: string;
  readonly notes?: string;
  readonly budgetCap?: number;
  readonly environmentRevision?: string;
  readonly readinessRef?: string;
  readonly profileRef?: string;
}

const TERMINAL: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled']);

/** One tab-page read stays bounded; truncation is labeled, not silent. */
const TAB_EVENT_LIMIT = 100;
const TAB_MAX_EVENTS = 500;
const HEX64 = /^[0-9a-f]{64}$/;
/** Diff/file preview stays small; anything bigger is download-only. */
const MAX_FILE_PREVIEW_BYTES = 256 * 1024;

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

function stateBadge(state: string): HTMLElement {
  if (state === 'succeeded') return badge('ok', state);
  if (state === 'failed') return badge('bad', state);
  return badge('info', state);
}

/** 64 lowercase hex chars from the platform RNG (uniqueness, not secrecy). */
function idempotencyKey(): string {
  const bytes = new Uint8Array(32);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readSession(): Promise<RunSession> {
  return apiGet<RunSession>('/api/auth/session');
}

function authed(session: RunSession): session is RunSession & {
  userId: string;
  tenantId: string;
  role: string;
  grantVersion: number;
} {
  return (
    session.authenticated &&
    session.userId !== undefined &&
    session.tenantId !== undefined &&
    session.role !== undefined &&
    session.grantVersion !== undefined
  );
}

async function search(
  scope: 'projects' | 'runs',
  options: { text?: string; runState?: string; projectId?: string },
): Promise<SearchResult> {
  return apiPost<SearchResult>('/api/search', {
    schemaVersion: '1',
    scope,
    limit: 20,
    ...(options.text === undefined || options.text === '' ? {} : { text: options.text }),
    ...(options.runState === undefined || options.runState === '' ? {} : { runState: options.runState }),
    ...(options.projectId === undefined || options.projectId === '' ? {} : { projectId: options.projectId }),
  });
}

function hitArticle(hit: SearchHit): HTMLElement {
  const target = hit.kind === 'run' ? `#/run?id=${encodeURIComponent(hit.id)}` : '#/runs/new';
  return h('article', { class: 'faq-item' }, [
    h('h3', {}, [h('a', { href: target }, [hit.title])]),
    h('p', {}, [h('code', { class: 'inline' }, [hit.id]), document.createTextNode(` · ${hit.snippet}`)]),
    h('p', { class: 'muted' }, [`Created ${hit.createdAt}`]),
  ]);
}

/* Run-tab journey shared by review/impact/investigation/campaigns/evidence/
 * publication/outcome (mockup runTabs). Every tab carries the run id; without
 * one the page fails closed before any fetch. */

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

function runContext(run: RunDetail): HTMLElement {
  return h('div', { class: 'run-context' }, [
    h('strong', {}, [run.runId]),
    stateBadge(run.state),
    h('span', {}, [`Project ${run.projectId}`]),
    h('span', {}, [`version ${String(run.version)}`]),
    h('span', {}, ['Submit ', h('code', { class: 'inline' }, [run.submitDigest.slice(0, 12)]), '…']),
  ]);
}

function runCrumb(run: RunDetail, leaf: string): HTMLElement {
  return h('div', { class: 'breadcrumb' }, [
    h('a', { href: '#/runs' }, ['Runs']),
    document.createTextNode(' / '),
    h('a', { href: `#/run?id=${encodeURIComponent(run.runId)}` }, [run.runId]),
    document.createTextNode(` / ${leaf}`),
  ]);
}

interface LoadedRun {
  readonly session: RunSession & { userId: string; tenantId: string; role: string; grantVersion: number };
  readonly run: RunDetail;
}

/**
 * Fail-closed loader for the run-tab pages: missing run id renders before any
 * fetch, guests get the login card after the session read only.
 */
async function requireRun(outlet: HTMLElement, ctx: RouteContext): Promise<LoadedRun | undefined> {
  const runId = ctx.params.get('run') ?? ctx.params.get('id');
  if (runId === undefined || runId === '') {
    outlet.replaceChildren(
      errorState('Run link is incomplete', 'The link carries no run id. Open the run from the list.'),
    );
    outlet.appendChild(h('p', {}, [h('a', { class: 'button', href: '#/runs' }, ['Back to runs'])]));
    return undefined;
  }
  outlet.replaceChildren(emptyState('Loading…', 'Reading the run.'));
  let session: RunSession;
  try {
    session = await readSession();
  } catch (error) {
    outlet.replaceChildren(
      errorState('Run unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void requireRun(outlet, ctx).then(() => undefined),
      }),
    );
    return undefined;
  }
  if (!authed(session)) {
    loginCard(outlet, 'Run needs a login', 'Log in to see this run.');
    return undefined;
  }
  try {
    const run = await apiGet<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
    return { session, run };
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return undefined;
    }
    if (statusOf(error) === 404) {
      outlet.replaceChildren(errorState('Run not found', asErrorMessage(error)));
      return undefined;
    }
    outlet.replaceChildren(errorState('Run unavailable', asErrorMessage(error)));
    return undefined;
  }
}

async function readRunEvents(runId: string): Promise<{ events: RunEventItem[]; truncated: boolean }> {
  const events: RunEventItem[] = [];
  let afterSeq = 0;
  for (;;) {
    const page = await apiGet<EventsPage>(
      `/api/runs/${encodeURIComponent(runId)}/events?afterSeq=${String(afterSeq)}&limit=${String(TAB_EVENT_LIMIT)}`,
    );
    events.push(...page.events);
    if (page.events.length < TAB_EVENT_LIMIT || events.length >= TAB_MAX_EVENTS) {
      return { events, truncated: events.length >= TAB_MAX_EVENTS && page.events.length >= TAB_EVENT_LIMIT };
    }
    afterSeq = page.cursor;
  }
}

function artifactDigests(events: readonly RunEventItem[]): { seq: number; digest: string; createdAt: string }[] {
  const found: { seq: number; digest: string; createdAt: string }[] = [];
  for (const event of events) {
    if (event.kind !== 'artifact') continue;
    const digest = event.payload['digest'];
    if (typeof digest !== 'string' || !HEX64.test(digest)) continue;
    found.push({ seq: event.seq, digest, createdAt: event.createdAt });
  }
  return found;
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}

function decodeFilePreview(bytes: Uint8Array): string | undefined {
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

const RUN_STATE_FILTERS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

async function renderLists(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading your runs.'));
  let session: RunSession;
  try {
    session = await readSession();
  } catch (error) {
    outlet.replaceChildren(
      errorState('Runs unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderLists(outlet),
      }),
    );
    return;
  }
  if (!authed(session)) {
    loginCard(outlet, 'Runs need a login', 'Log in to see your projects and runs.');
    return;
  }
  const account = session;
  // The text box is the mockup #runSearch; the state select stays the form's
  // source of truth and the chips only present it (same request either way).
  const searchInput = h('input', {
    id: 'runSearch',
    name: 'run-filter-text',
    type: 'search',
    placeholder: 'Search title or run ID',
    'aria-label': 'Search runs',
  });
  const stateSelect = h('select', { id: 'run-filter-state', name: 'run-filter-state' }, [
    ...RUN_STATE_FILTERS.map((entry) => h('option', { value: entry.value }, [entry.label])),
  ]);
  const chips = h('div', { class: 'filterbar', role: 'group', 'aria-label': 'Filter runs by state' }, [
    ...RUN_STATE_FILTERS.map((entry) =>
      h(
        'button',
        {
          class: entry.value === '' ? 'chip selected' : 'chip',
          type: 'button',
          'data-filter': entry.value === '' ? 'all' : entry.value,
          'aria-pressed': entry.value === '' ? 'true' : 'false',
        },
        [entry.label],
      ),
    ),
  ]);
  const searchIcon = h('span', { class: 'table-search-icon', 'aria-hidden': 'true' }, []);
  searchIcon.appendChild(iconSvg('search'));
  const filterForm = h('form', { id: 'run-filter', novalidate: 'novalidate' }, [
    h('div', { class: 'table-tools' }, [
      h('label', { class: 'table-search' }, [searchIcon, searchInput]),
      chips,
    ]),
    h('div', { class: 'table-tools' }, [
      h('div', { class: 'field' }, [h('label', { for: 'run-filter-state' }, ['Run state']), stateSelect]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'button primary', type: 'submit' }, ['Apply filters']),
      ]),
    ]),
  ]);
  const runTable = h('div', { id: 'runTable' }, []);
  const runCount = h('span', { id: 'runCount' }, ['0']);
  const lists = h('div', {}, []);
  outlet.replaceChildren(
    pageHead({
      eyebrow: 'Workspace Runs',
      title: 'Runs',
      subtitle: 'Search active and historical verification runs and projects in your organization.',
    }),
    card(
      'Run list',
      h('div', {}, [
        filterForm,
        runTable,
        h('div', { class: 'table-footer' }, [
          h('span', {}, ['Showing ', runCount, ' runs']),
          h('div', { class: 'pagination' }, [
            h('button', { disabled: 'disabled', type: 'button', 'aria-label': 'Previous page' }, ['‹']),
            h('button', { class: 'active', type: 'button', 'aria-current': 'page' }, ['1']),
            h('button', { disabled: 'disabled', type: 'button', 'aria-label': 'Next page' }, ['›']),
          ]),
        ]),
      ]),
      'Service status and verification results are shown separately.',
      h('a', { class: 'button primary', href: '#/new-run' }, ['New run']),
    ),
    lists,
  );
  const syncChips = (): void => {
    for (const chip of chips.querySelectorAll('button.chip')) {
      const key = chip.getAttribute('data-filter') ?? 'all';
      const value = key === 'all' ? '' : key;
      const active = stateSelect.value === value;
      chip.classList.toggle('selected', active);
      chip.setAttribute('aria-pressed', String(active));
    }
  };
  const load = async (): Promise<void> => {
    runTable.replaceChildren(emptyState('Loading…', 'Searching runs and projects.'));
    try {
      const [runs, projects] = await Promise.all([
        search('runs', { text: searchInput.value.trim(), runState: stateSelect.value }),
        search('projects', { text: searchInput.value.trim() }),
      ]);
      runCount.replaceChildren(document.createTextNode(String(runs.hits.length)));
      if (runs.hits.length === 0) {
        runTable.replaceChildren(
          emptyState('No runs yet', 'File your first run to see it here.', h('a', { class: 'button', href: '#/runs/new' }, ['File your first run'])),
        );
      } else {
        runTable.replaceChildren(
          table(
            ['Run', 'Project', 'Mode', 'Targets', 'Outcome', 'Credits', 'Updated'],
            runs.hits.map((hit) => [
              h('div', {}, [
                h('div', { class: 'run-id mono' }, [hit.id]),
                h('a', { class: 'run-title', href: `#/run?id=${encodeURIComponent(hit.id)}` }, [hit.title]),
              ]),
              hit.projectId ?? '—',
              '—',
              '—',
              hit.snippet,
              '—',
              h('span', { class: 'muted' }, [hit.createdAt]),
            ]),
            { className: 'runs' },
          ),
        );
      }
      const stats = h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [
          h('div', { class: 'label' }, ['Matching runs']),
          h('div', { class: 'value' }, [String(runs.hits.length)]),
          h('div', { class: 'sub' }, ['Returned from /api/search']),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'label' }, ['Matching projects']),
          h('div', { class: 'value' }, [String(projects.hits.length)]),
          h('div', { class: 'sub' }, ['Active workspace projects']),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'label' }, ['State filter']),
          h('div', { class: 'value' }, [stateSelect.value === '' ? 'All' : stateSelect.value]),
          h('div', { class: 'sub' }, ['Lifecycle state filter']),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'label' }, ['Tenant scope']),
          h('div', { class: 'value' }, [account.tenantId]),
          h('div', { class: 'sub' }, [`Role: ${account.role}`]),
        ]),
      ]);
      const projectSection = h('section', { class: 'card' }, [h('h2', {}, ['Projects'])]);
      if (projects.hits.length === 0) {
        projectSection.appendChild(emptyState('No projects yet', 'Create one while filing a run.'));
      } else {
        for (const hit of projects.hits) projectSection.appendChild(hitArticle(hit));
      }
      lists.replaceChildren(
        stats,
        h('p', { class: 'help' }, [
          'Mode, targets, and credits are not part of search results, so those columns stay empty. Open a run for its manifest.',
        ]),
        projectSection,
      );
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      if (statusOf(error) === 403) {
        runTable.replaceChildren(errorState('Access denied', asErrorMessage(error)));
        return;
      }
      runTable.replaceChildren(
        errorState('Runs unavailable', asErrorMessage(error), { label: 'Retry', onClick: () => void load() }),
      );
    }
  };
  filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    syncChips();
    void load();
  });
  stateSelect.addEventListener('change', syncChips);
  for (const chip of chips.querySelectorAll('button.chip')) {
    chip.addEventListener('click', () => {
      const key = chip.getAttribute('data-filter') ?? 'all';
      stateSelect.value = key === 'all' ? '' : key;
      syncChips();
      void load();
    });
  }
  await load();
}

interface RecentDraft {
  readonly draftId: string;
  readonly revision: number;
  readonly projectId: string;
  readonly savedAt: string;
}

function readRecents(accountKey: string): RecentDraft[] {
  try {
    const raw = loadDraft(accountKey, 'recent-drafts');
    if (raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentDraft =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { draftId?: unknown }).draftId === 'string',
    );
  } catch {
    return [];
  }
}

function writeRecents(accountKey: string, recents: readonly RecentDraft[]): void {
  try {
    saveDraft(accountKey, 'recent-drafts', JSON.stringify(recents.slice(0, 10)));
  } catch (error) {
    if (error instanceof SecretDraftError) return;
    throw error;
  }
}

function textareaField(id: string, label: string, hint?: string): { wrap: HTMLElement; input: HTMLTextAreaElement } {
  const input = h('textarea', { id, name: id, rows: '3' }, []);
  const wrap = h('div', { class: 'field' }, [h('label', { for: id }, [label])]);
  if (hint !== undefined) wrap.appendChild(h('p', { class: 'muted' }, [hint]));
  wrap.appendChild(input);
  return { wrap, input };
}

function showAlert(host: HTMLElement, message: string): void {
  host.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [message]));
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/* Change-type presets behind #changeTemplate (mockup changeTemplates, runtime
 * copy in English). A preset fills the intent and invariants only when those
 * fields are still empty, and says what it did in #templateExtra. */

interface ChangePreset {
  readonly name: string;
  readonly description: string;
  readonly intent: string;
  readonly invariants: string;
}

const CHANGE_PRESETS: Readonly<Record<string, ChangePreset>> = {
  contract: {
    name: 'API / contract change',
    description: 'Endpoint, schema, or API contract changes.',
    intent:
      'The order service now sends id as a string and amount as an integer minor unit. ' +
      'Storefront and inventory-service must still create orders, reserve stock, and read order status ' +
      'without changing customer-facing behavior.',
    invariants: 'Amount precision stays correct. Tenant isolation holds. Order and stock reservation keep working.',
  },
  dependency: {
    name: 'Dependency upgrade',
    description: 'Library, framework, or runtime upgrades.',
    intent:
      'Upgrade Spring Boot 3.2 to 3.3 on orders-service while keeping the HTTP contract, ' +
      'query order, and consumer behavior.',
    invariants: 'Manifest and lockfile stay consistent. Native build and required checks pass. No unexplained behavior change.',
  },
  migration: {
    name: 'Schema / data migration',
    description: 'Schema changes and data migrations.',
    intent:
      'Add amount_minor with expand/backfill/transition. Readers and writers stay compatible during rollout.',
    invariants:
      'No lost acknowledged write. Precision, uniqueness, tenant isolation, and journal reconciliation stay correct.',
  },
  incident: {
    name: 'Organic incident',
    description: 'Investigate errors from the running system.',
    intent:
      'Investigate checkout 500s when two orders run together. Reproduce the failure before proposing a patch.',
    invariants: 'No oversell or duplicate reservation. Bounded completion and transaction safety hold.',
  },
  coordinated: {
    name: 'Cross-repo rollout',
    description: 'Coordinated changes across repositories.',
    intent:
      'Coordinate the order ID representation across producer, storefront, and inventory-service, ' +
      'with mixed-version compatibility.',
    invariants: 'Required target and edge proof complete. Explicit deployment order. Consistent candidate identities.',
  },
  legacy: {
    name: 'Legacy investigation',
    description: 'Understand system behavior before repair.',
    intent:
      'Characterize legacy-admin: map observed behavior, unknowns, and independent invariants before repair.',
    invariants: 'Read-only probes or an isolated clone. No mutation until a known-valid baseline and intent exist.',
  },
};

const SOURCE_TABS: readonly { id: string; label: string; placeholder: string }[] = [
  { id: 'pr', label: 'Pull request', placeholder: 'northwind/orders-service#412' },
  { id: 'issue', label: 'Issue', placeholder: 'northwind/orders-service#418' },
  { id: 'ref', label: 'Ref / commit', placeholder: 'Commit SHA or branch' },
  { id: 'intent', label: 'Free-form intent', placeholder: 'Describe the change to check' },
];

async function renderForm(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading your account.'));
  let session: RunSession;
  try {
    session = await readSession();
  } catch (error) {
    outlet.replaceChildren(
      errorState('Run filing unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderForm(outlet, ctx),
      }),
    );
    return;
  }
  if (!authed(session)) {
    loginCard(outlet, 'New run needs a login', 'Log in to file a run.');
    return;
  }
  const actor = session;
  const accountKey = `${actor.tenantId}:${actor.userId}`;
  const resumeId = ctx.params.get('draft');

  let templates: readonly PublicTemplate[];
  let projects: SearchResult;
  try {
    const [fetchedTemplates, fetchedProjects] = await Promise.all([
      apiGet<readonly PublicTemplate[]>('/api/site/templates'),
      search('projects', {}),
    ]);
    templates = fetchedTemplates;
    projects = fetchedProjects;
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    outlet.replaceChildren(
      errorState('Run filing unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderForm(outlet, ctx),
      }),
    );
    return;
  }

  const key = idempotencyKey();
  let draftRef: { draftId: string; revision: number } | undefined;

  // Template section: the manifest drives the fields; the form maps the
  // `intent` field to the draft intent and every other field to notes.
  const templateSelect = h('select', { id: 'run-template', name: 'run-template' }, [
    h('option', { value: '' }, ['No template — write freely']),
    ...templates.map((template) => h('option', { value: template.id }, [template.title])),
  ]);
  const templateFields = h('div', { id: 'template-fields' }, []);
  let renderedTemplate = '';
  const intent = textareaField('draft-intent', 'Intent', 'What should work again? Required.');
  const notes = textareaField('draft-notes', 'Notes', 'Context the template fields append to.');
  const applyTemplate = (): void => {
    const chosen = templates.find((template) => template.id === templateSelect.value);
    if (chosen === undefined) return;
    if (renderedTemplate !== chosen.id) {
      renderedTemplate = chosen.id;
      templateFields.replaceChildren(
        ...chosen.fields.map((templateField) => {
          const input = h('input', { id: `tpl-${templateField.name}`, name: `tpl-${templateField.name}`, type: 'text' }, []);
          return h('div', { class: 'field' }, [
            h('label', { for: `tpl-${templateField.name}` }, [templateField.label]),
            h('p', { class: 'muted' }, [templateField.help]),
            input,
          ]);
        }),
      );
      return;
    }
    const lines: string[] = [];
    for (const templateField of chosen.fields) {
      const input = templateFields.querySelector<HTMLInputElement>(`#tpl-${CSS.escape(templateField.name)}`);
      const value = input?.value.trim() ?? '';
      if (value === '') continue;
      if (templateField.name === 'intent') intent.input.value = value;
      else lines.push(`${templateField.label}: ${value}`);
    }
    if (lines.length > 0) notes.input.value = lines.join('\n');
  };
  templateSelect.addEventListener('change', applyTemplate);

  const project = field({ id: 'run-project', label: 'Project id', required: true, hint: 'Pick a known id or create one.' });
  project.input.setAttribute('list', 'project-options');
  const projectOptions = h('datalist', { id: 'project-options' }, [
    ...projects.hits.map((hit) => h('option', { value: hit.id }, [hit.title])),
  ]);
  const newProject = field({ id: 'new-project-name', label: 'New project name' });
  const createProjectButton = h('button', { id: 'create-project', class: 'button', type: 'button' }, ['Create project']);
  const projectAlert = h('div', {}, []);

  const budget = field({ id: 'draft-budget', label: 'Draft budget cap (optional)', type: 'number' });
  const env = field({ id: 'draft-env', label: 'Environment revision (optional)' });
  const readiness = field({ id: 'draft-readiness', label: 'Readiness ref (optional)' });
  const profile = field({ id: 'draft-profile', label: 'Profile ref (optional)' });
  const saveDraftButton = h('button', { id: 'save-draft', class: 'button', type: 'button' }, ['Save draft']);
  const draftAlert = h('div', {}, []);
  const draftResult = h('div', { id: 'draft-result', 'aria-live': 'polite' }, []);
  const recentList = h('div', { id: 'recent-drafts' }, []);

  const renderRecents = (): void => {
    const recents = readRecents(accountKey);
    recentList.replaceChildren(
      ...(recents.length === 0
        ? [h('p', { class: 'muted' }, ['No saved drafts on this account yet.'])]
        : recents.map((recent) =>
            h('p', {}, [
              h('a', { href: `#/runs/new?draft=${encodeURIComponent(recent.draftId)}` }, [
                `${recent.draftId} · revision ${String(recent.revision)}`,
              ]),
            ]),
          )),
    );
  };
  renderRecents();

  const saveDraftRevision = async (): Promise<{ draftId: string; revision: number } | undefined> => {
    if (project.input.value.trim() === '') {
      showAlert(draftAlert, 'Name the project first.');
      project.input.focus();
      return undefined;
    }
    if (intent.input.value.trim() === '') {
      showAlert(draftAlert, 'Describe the intent first.');
      intent.input.focus();
      return undefined;
    }
    const budgetValue = budget.input.value.trim();
    const body: DraftBody = {
      intent: intent.input.value.trim(),
      ...(notes.input.value.trim() === '' ? {} : { notes: notes.input.value.trim() }),
      ...(budgetValue === '' ? {} : { budgetCap: Number(budgetValue) }),
      ...(env.input.value.trim() === '' ? {} : { environmentRevision: env.input.value.trim() }),
      ...(readiness.input.value.trim() === '' ? {} : { readinessRef: readiness.input.value.trim() }),
      ...(profile.input.value.trim() === '' ? {} : { profileRef: profile.input.value.trim() }),
    };
    saveDraftButton.disabled = true;
    try {
      const saved = await apiPost<{ draftId: string; revision: number }>('/api/drafts', {
        projectId: project.input.value.trim(),
        ...(draftRef === undefined ? {} : { draftId: draftRef.draftId }),
        body,
      });
      draftRef = saved;
      draftResult.replaceChildren(
        h('p', {}, [
          `Draft ${saved.draftId} · revision ${String(saved.revision)} saved. `,
          h('a', { href: `#/runs/new?draft=${encodeURIComponent(saved.draftId)}` }, ['Resume it later']),
          document.createTextNode('.'),
        ]),
      );
      const recents = [
        { draftId: saved.draftId, revision: saved.revision, projectId: project.input.value.trim(), savedAt: new Date().toISOString() },
        ...readRecents(accountKey).filter((recent) => recent.draftId !== saved.draftId),
      ];
      writeRecents(accountKey, recents);
      renderRecents();
      return saved;
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return undefined;
      }
      showAlert(draftAlert, asErrorMessage(error));
      return undefined;
    } finally {
      saveDraftButton.disabled = false;
    }
  };

  // Submit section: every submit field maps 1:1 to the request the
  // server files; nothing here is decorative.
  const grants = actor.repositoryGrants ?? [];
  const repoBoxes = h('div', { id: 'repos' }, [
    ...grants.map((repoId) => {
      const box = h('input', { type: 'checkbox', name: 'repo', value: repoId }, []);
      return h('label', { class: 'checkrow' }, [box, h('span', {}, [h('code', {}, [repoId])])]);
    }),
  ]);
  const sources = field({ id: 'submit-sources', label: 'Source refs (comma-separated)', required: true });
  const intentRef = field({ id: 'submit-intent', label: 'Intent ref', required: true });
  const invariants = field({ id: 'submit-invariants', label: 'Invariant refs (comma-separated)', required: true });
  const plan = field({ id: 'submit-plan', label: 'Verification plan ref', required: true });
  const budgetProfile = field({ id: 'submit-budget-profile', label: 'Budget profile id', required: true });
  const executionMode = h('select', { id: 'execution-mode', name: 'execution-mode' }, [
    h('option', { value: 'real_runtime' }, ['Real runtime']),
    h('option', { value: 'replay' }, ['Replay']),
    h('option', { value: 'mock' }, ['Mock']),
  ]);
  const requestedBudget = field({ id: 'submit-budget', label: 'Requested budget', required: true, type: 'number' });
  const minutes = field({ id: 'run-minutes', label: 'Time limit (minutes)', type: 'number' });
  minutes.input.value = '90';
  minutes.input.min = '1';
  minutes.input.max = '180';
  const attempts = field({ id: 'run-attempts', label: 'Max attempts', type: 'number' });
  attempts.input.value = '3';
  attempts.input.min = '1';
  attempts.input.max = '3';
  const consentBox = h('input', { id: 'submit-consent', type: 'checkbox' }, []);
  const submitButton = h('button', { id: 'submit-run', class: 'button primary', type: 'button' }, ['Submit run']);
  const submitAlert = h('div', {}, []);
  const submitResult = h('div', { id: 'submit-receipt', 'aria-live': 'polite' }, []);

  const doSubmit = async (): Promise<void> => {
    const checked = [...repoBoxes.querySelectorAll<HTMLInputElement>('input[name="repo"]:checked')].map(
      (box) => box.value,
    );
    if (checked.length === 0) {
      showAlert(submitAlert, 'Grant at least one repository to the run.');
      return;
    }
    const sourceRefs = splitList(sources.input.value);
    const invariantRefs = splitList(invariants.input.value);
    if (sourceRefs.length === 0 || intentRef.input.value.trim() === '' || invariantRefs.length === 0) {
      showAlert(submitAlert, 'Source refs, intent ref, and invariant refs are all required.');
      return;
    }
    if (plan.input.value.trim() === '' || budgetProfile.input.value.trim() === '') {
      showAlert(submitAlert, 'The verification plan ref and budget profile id are required.');
      return;
    }
    if (requestedBudget.input.value.trim() === '' || Number(requestedBudget.input.value) <= 0) {
      showAlert(submitAlert, 'Request a positive budget.');
      return;
    }
    const saved = await saveDraftRevision();
    if (saved === undefined) return;
    const receipt = await apiPost<SubmitReceipt>('/api/runs', {
      projectId: project.input.value.trim(),
      repositoryIds: checked,
      sourceRefs,
      intentRef: intentRef.input.value.trim(),
      executionMode: executionMode.value,
      invariantRefs,
      verificationPlanRef: plan.input.value.trim(),
      budgetProfileId: budgetProfile.input.value.trim(),
      publicationConsent: consentBox.checked,
      idempotencyKey: key,
      expectedGrantVersion: actor.grantVersion,
      draftId: saved.draftId,
      draftRevision: saved.revision,
      requestedBudget: Number(requestedBudget.input.value),
    });
    reserveButton.disabled = true;
    submitSection.replaceChildren(
      h('h2', {}, ['Run filed']),
      h('p', {}, [receipt.duplicate ? 'Duplicate of an earlier submit — the same run, not a second one.' : 'New run.']),
      h('dl', { class: 'detail-list' }, [
        h('dt', {}, ['Run']),
        h('dd', {}, [h('code', { class: 'inline' }, [receipt.runId])]),
        h('dt', {}, ['Job']),
        h('dd', {}, [h('code', { class: 'inline' }, [receipt.jobId])]),
        h('dt', {}, ['Reservation']),
        h('dd', {}, [h('code', { class: 'inline' }, [receipt.reservationId])]),
        h('dt', {}, ['Submit digest']),
        h('dd', {}, [h('code', { class: 'inline' }, [receipt.submitDigest])]),
      ]),
      h('p', {}, [
        h('a', { class: 'button primary', href: `#/run?id=${encodeURIComponent(receipt.runId)}` }, ['Open run']),
        document.createTextNode(' '),
        h('a', { class: 'button', href: `#/run-created?id=${encodeURIComponent(receipt.runId)}` }, ['Open receipt']),
        document.createTextNode(' '),
        h('a', { class: 'button', href: '#/runs/new' }, ['File another run']),
      ]),
    );
  };

  const submitSection = h('section', { class: 'card' }, [
    h('h2', {}, ['Submit']),
    h('p', { class: 'muted' }, [
      'The submit is immutable: retries reference the same bytes, and a changed submit is a new digest. ',
      `Grant version ${String(actor.grantVersion)} · key `,
      h('code', { class: 'inline', id: 'idempotency-key' }, [key]),
    ]),
    submitAlert,
    h('p', {}, [submitButton]),
    submitResult,
  ]);
  const reserveButton = h('button', { id: 'reserve-run', class: 'button primary full', type: 'button' }, ['Reserve credits & run']);
  const updateGuards = (mode: string): void => {
    if (actor.role === 'viewer') {
      submitButton.disabled = true;
      reserveButton.disabled = true;
      submitAlert.replaceChildren(
        h('p', { class: 'error-text', role: 'alert' }, ['Viewers may read runs but cannot submit.']),
      );
    } else if (grants.length === 0) {
      submitButton.disabled = true;
      reserveButton.disabled = true;
      submitAlert.replaceChildren(
        h('p', { class: 'error-text', role: 'alert' }, [
          'No repositories are granted to this organization yet. Ask an owner to connect one, then return here.',
        ]),
      );
    } else if (mode === 'Diagnosis-only') {
      submitButton.disabled = true;
      reserveButton.disabled = true;
      submitAlert.replaceChildren(
        h('p', { class: 'error-text', role: 'alert' }, [
          'Diagnosis-only submits are not supported by the API yet. Switch to a repair run to file.',
        ]),
      );
    } else {
      submitButton.disabled = false;
      reserveButton.disabled = false;
      submitAlert.replaceChildren();
    }
    guardBody.replaceChildren(
      row('Role', actor.role === 'viewer' ? staticBadge('Viewer — cannot submit', 'amber') : staticBadge(`${actor.role} — may submit`, 'green')),
      row('Repository grants', grants.length === 0 ? staticBadge('None — submit blocked', 'red') : staticBadge(`${String(grants.length)} granted`, 'green')),
      row('Grant version', h('code', {}, [`v${String(actor.grantVersion)}`])),
      row('Mode', mode === 'Diagnosis-only' ? staticBadge('Not supported by the API', 'amber') : staticBadge('Repair run', 'blue')),
    );
  };
  const guardBody = h('div', {}, []);

  submitButton.addEventListener('click', () => {
    submitButton.disabled = true;
    void doSubmit()
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        showAlert(submitAlert, asErrorMessage(error));
      })
      .finally(() => {
        if (submitButton.isConnected) submitButton.disabled = false;
      });
  });

  createProjectButton.addEventListener('click', () => {
    createProjectButton.disabled = true;
    void (async () => {
      try {
        if (newProject.input.value.trim() === '') {
          showAlert(projectAlert, 'Name the project first.');
          return;
        }
        const created = await apiPost<{ projectId: string; name: string }>('/api/projects', {
          name: newProject.input.value.trim(),
        });
        project.input.value = created.projectId;
        projectOptions.appendChild(h('option', { value: created.projectId }, [created.name]));
        projectAlert.replaceChildren(h('p', { class: 'muted' }, [`Project ${created.projectId} created and selected.`]));
      } catch (error) {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        showAlert(projectAlert, asErrorMessage(error));
      } finally {
        createProjectButton.disabled = false;
      }
    })();
  });

  saveDraftButton.addEventListener('click', () => {
    void saveDraftRevision();
  });

  // Change-type presets + source tabs + live summary (mockup newRun).
  const changeTemplate = h('select', { id: 'changeTemplate', name: 'changeTemplate' }, [
    h('option', { value: '' }, ['Start from a change type…']),
    ...Object.entries(CHANGE_PRESETS).map(([id, preset]) => h('option', { value: id }, [preset.name])),
  ]);
  const templateExtra = h('div', { id: 'templateExtra' }, []);
  changeTemplate.addEventListener('change', () => {
    const preset = CHANGE_PRESETS[changeTemplate.value];
    if (preset === undefined) {
      templateExtra.replaceChildren();
      return;
    }
    const filled: string[] = [];
    if (intent.input.value.trim() === '') {
      intent.input.value = preset.intent;
      filled.push('intent');
    }
    if (invariants.input.value.trim() === '') {
      invariants.input.value = preset.invariants;
      filled.push('invariants');
    }
    templateExtra.replaceChildren(
      h('p', { class: 'help' }, [
        `${preset.name}: ${preset.description} `,
        filled.length === 0
          ? 'Intent and invariants were already filled, so nothing was overwritten.'
          : `Filled ${filled.join(' and ')}. Review every field before the run is accepted.`,
      ]),
    );
  });

  const sourceChips = h('div', { class: 'filterbar', id: 'sourceTabs', role: 'group', 'aria-label': 'Source of the problem' }, [
    ...SOURCE_TABS.map((entry, index) =>
      h(
        'button',
        {
          class: index === 0 ? 'chip selected' : 'chip',
          type: 'button',
          'data-source': entry.id,
          'aria-pressed': index === 0 ? 'true' : 'false',
        },
        [entry.label],
      ),
    ),
  ]);
  const sourceField = h('div', { id: 'sourceField' }, []);
  let sourceTab = 'pr';
  const renderSourceField = (): void => {
    const tab = SOURCE_TABS.find((entry) => entry.id === sourceTab) ?? SOURCE_TABS[0];
    if (tab === undefined) return;
    const input = h('input', { id: 'source-value', name: 'source-value', type: 'text', placeholder: tab.placeholder }, []);
    input.setAttribute('aria-label', tab.label);
    const add = h('button', { id: 'source-add', class: 'button', type: 'button' }, ['Add to sources']);
    add.addEventListener('click', () => {
      const value = input.value.trim();
      if (value === '') return;
      sources.input.value = sources.input.value.trim() === '' ? value : `${sources.input.value.trim()}, ${value}`;
      input.value = '';
      input.focus();
    });
    sourceField.replaceChildren(
      h('div', { class: 'field' }, [
        h('label', { for: 'source-value' }, [tab.label]),
        input,
        h('p', { class: 'field-note' }, ['Added values append to the source refs below.']),
      ]),
      h('p', {}, [add]),
    );
  };
  renderSourceField();
  for (const chip of sourceChips.querySelectorAll('button.chip')) {
    chip.addEventListener('click', () => {
      sourceTab = chip.getAttribute('data-source') ?? 'pr';
      for (const other of sourceChips.querySelectorAll('button.chip')) {
        const active = other === chip;
        other.classList.toggle('selected', active);
        other.setAttribute('aria-pressed', String(active));
      }
      renderSourceField();
    });
  }

  const modeRepair = h('input', { type: 'radio', name: 'mode', value: 'Repair', checked: 'checked' }, []);
  const modeDiagnosis = h('input', { type: 'radio', name: 'mode', value: 'Diagnosis-only' }, []);
  const currentMode = (): string => (modeDiagnosis.checked ? 'Diagnosis-only' : 'Repair');
  const sumMode = h('span', { id: 'sumMode' }, ['Repair']);
  const sumTargets = h('span', { id: 'sumTargets' }, ['0 repositories']);
  const sumCredits = h('span', { id: 'sumCredits' }, ['—']);
  const sumTime = h('span', { id: 'sumTime' }, ['90 min']);
  const updateSummary = (): void => {
    const mode = currentMode();
    sumMode.replaceChildren(document.createTextNode(mode));
    const count = repoBoxes.querySelectorAll('input[name="repo"]:checked').length;
    sumTargets.replaceChildren(document.createTextNode(`${String(count)} repositories`));
    const credits = requestedBudget.input.value.trim();
    sumCredits.replaceChildren(document.createTextNode(credits === '' ? '—' : `${credits} cr`));
    const limit = minutes.input.value.trim();
    sumTime.replaceChildren(document.createTextNode(limit === '' ? '—' : `${limit} min`));
    updateGuards(mode);
  };

  reserveButton.addEventListener('click', () => {
    const checked = [...repoBoxes.querySelectorAll<HTMLInputElement>('input[name="repo"]:checked')].map((box) => box.value);
    const credits = requestedBudget.input.value.trim() === '' ? '—' : `${requestedBudget.input.value.trim()} cr`;
    const limit = minutes.input.value.trim() === '' ? '—' : `${minutes.input.value.trim()} min`;
    const tries = attempts.input.value.trim() === '' ? '—' : attempts.input.value.trim();
    const content = h('div', {}, [
      h('p', {}, ['Review the locked submit before it is filed.']),
      row('Mode', currentMode()),
      row('Targets', checked.length === 0 ? 'None selected' : checked.join(', ')),
      row('Requested budget', credits),
      row('Time limit', limit),
      row('Max attempts', tries),
      row('Idempotency key', h('code', {}, [key.slice(0, 16)])),
      h('p', { class: 'help' }, [
        'Limits are final for this run. Retries reference the same bytes; a changed submit is a new digest.',
      ]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'button', type: 'button', id: 'reserve-cancel' }, ['Cancel']),
        h('button', { class: 'button primary', type: 'button', id: 'reserve-confirm' }, ['File run']),
      ]),
    ]);
    const handle = modal(reserveButton, 'Review run submission', content);
    content.querySelector('#reserve-cancel')?.addEventListener('click', () => { handle.close(); });
    content.querySelector('#reserve-confirm')?.addEventListener('click', () => {
      handle.close();
      reserveButton.disabled = true;
      void doSubmit()
        .catch((error: unknown) => {
          if (statusOf(error) === 401) {
            expired(outlet);
            return;
          }
          showAlert(submitAlert, asErrorMessage(error));
        })
        .finally(() => {
          if (reserveButton.isConnected && submitButton.isConnected) reserveButton.disabled = false;
        });
    });
  });

  const runForm = h('form', { id: 'runForm', novalidate: 'novalidate' }, [
    h('div', { class: 'split' }, [
      h('div', {}, [
        h('section', { class: 'card form-section' }, [
          h('h2', {}, ['1 · Source of the problem']),
          sourceChips,
          sourceField,
          h('h3', {}, ['Project']),
          project.wrap,
          projectOptions,
          newProject.wrap,
          projectAlert,
          h('p', {}, [createProjectButton]),
          intent.wrap,
          notes.wrap,
        ]),
        h('section', { class: 'card form-section' }, [
          h('h2', {}, ['2 · Targets']),
          h('p', { class: 'help' }, ['The submit grants only the repositories checked here.']),
          h('div', { class: 'field' }, [h('span', {}, ['Repositories']), repoBoxes]),
          h('div', { class: 'locknote' }, [
            'Locked out of run inputs: policy, verifier, oracle, CI configuration, secrets, and publication authority are never part of the submit.',
          ]),
        ]),
        h('section', { class: 'card form-section' }, [
          h('h2', {}, ['3 · Mode and invariants']),
          h('div', { class: 'choices' }, [
            h('label', { class: 'choice' }, [
              modeRepair,
              h('span', {}, [
                h('strong', {}, ['Repair run']),
                h('small', {}, ['Diagnosis, candidate patch, then full verification on a system that actually runs.']),
              ]),
            ]),
            h('label', { class: 'choice' }, [
              modeDiagnosis,
              h('span', {}, [
                h('strong', {}, ['Diagnosis-only']),
                h('small', {}, ['Impact analysis, hypotheses, and planning only. No code mutations.']),
              ]),
            ]),
          ]),
          h('div', { class: 'field' }, [h('label', { for: 'execution-mode' }, ['Execution mode']), executionMode]),
          intentRef.wrap,
          invariants.wrap,
          plan.wrap,
        ]),
        h('section', { class: 'card form-section' }, [
          h('h2', {}, ['4 · Budget and submit']),
          h('div', { class: 'budget-fields' }, [requestedBudget.wrap, budget.wrap, minutes.wrap, attempts.wrap]),
          h('p', { class: 'help' }, [
            'Limits are final for this run. Retries do not silently reset the budget. ',
            'Time limit and max attempts are planning limits reviewed before submit; enforcement follows the budget profile.',
          ]),
          budgetProfile.wrap,
          env.wrap,
          readiness.wrap,
          profile.wrap,
          h('label', { class: 'checkrow' }, [consentBox, h('span', {}, ['Publication consent'])]),
          sources.wrap,
          submitSection,
        ]),
      ]),
      h('aside', {}, [
        h('section', { class: 'card pad summary' }, [
          h('h2', {}, ['Run summary']),
          row(h('span', { class: 'muted' }, ['Mode']), sumMode),
          row(h('span', { class: 'muted' }, ['Targets']), sumTargets),
          row(h('span', { class: 'muted' }, ['Budget']), sumCredits),
          row(h('span', { class: 'muted' }, ['Time limit']), sumTime),
          h('div', { class: 'costbox' }, [
            h('small', {}, ['Requested budget (not the final bill)']),
            h('strong', { id: 'sumBudgetBox' }, ['—']),
            h('div', { class: 'help' }, ['Settled on actual usage after the run.']),
          ]),
          h('p', {}, [reserveButton]),
          h('p', {}, [saveDraftButton]),
          draftResult,
        ]),
        h('section', { class: 'card pad' }, [h('h2', {}, ['Admission guard']), guardBody]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Draft']),
          draftAlert,
          h('h3', {}, ['Recent drafts']),
          recentList,
        ]),
      ]),
    ]),
  ]);
  runForm.addEventListener('submit', (event) => {
    event.preventDefault();
  });
  runForm.addEventListener('change', updateSummary);
  runForm.addEventListener('input', () => {
    updateSummary();
    const credits = requestedBudget.input.value.trim();
    runForm.querySelector('#sumBudgetBox')?.replaceChildren(document.createTextNode(credits === '' ? '—' : `${credits} cr`));
  });

  outlet.replaceChildren(
    pageHead({
      eyebrow: 'File a run',
      title: 'Submit a problem and review the plan',
      subtitle: 'Template, project, versioned draft, then one immutable submit. Nothing runs until the run is filed.',
      actions: [h('a', { class: 'button', href: '#/runs' }, ['Back to runs'])],
    }),
    h('section', { class: 'card pad' }, [
      h('div', { class: 'grid2' }, [
        h('div', { class: 'field' }, [
          h('label', { for: 'changeTemplate' }, ['Change type']),
          changeTemplate,
        ]),
        h('div', { class: 'help' }, ['Start from the kind of problem. Review intent, scope, invariants, and budget before the run is accepted.']),
      ]),
      templateExtra,
    ]),
    h('section', { class: 'card pad' }, [
      h('h2', {}, ['Workspace template']),
      h('div', { class: 'field' }, [h('label', { for: 'run-template' }, ['Template']), templateSelect]),
      templateFields,
    ]),
    runForm,
  );
  updateSummary();

  if (resumeId !== undefined && resumeId !== '') {
    try {
      const draft = await apiGet<{
        draftId: string;
        projectId: string;
        revision: number;
        body: DraftBody;
      }>(`/api/drafts/${encodeURIComponent(resumeId)}`);
      project.input.value = draft.projectId;
      intent.input.value = draft.body.intent;
      notes.input.value = draft.body.notes ?? '';
      budget.input.value = draft.body.budgetCap === undefined ? '' : String(draft.body.budgetCap);
      env.input.value = draft.body.environmentRevision ?? '';
      readiness.input.value = draft.body.readinessRef ?? '';
      profile.input.value = draft.body.profileRef ?? '';
      draftRef = { draftId: draft.draftId, revision: draft.revision };
      draftResult.replaceChildren(
        h('p', {}, [`Resuming draft ${draft.draftId} · revision ${String(draft.revision)}. Saving adds a new revision.`]),
      );
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      showAlert(draftAlert, asErrorMessage(error));
    }
  }
}

function eventArticle(runId: string, event: RunEventItem): HTMLElement {
  const digest = event.payload['digest'];
  const download =
    event.kind === 'artifact' && typeof digest === 'string' && digest !== ''
      ? h('p', {}, [
          h(
            'a',
            {
              class: 'button',
              href: `#/evidence/view?run=${encodeURIComponent(runId)}&digest=${encodeURIComponent(digest)}`,
            },
            [`View ${digest.slice(0, 12)}…`],
          ),
          document.createTextNode(' '),
          h('a', { class: 'button', href: `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(digest)}` }, [
            `Download ${digest.slice(0, 12)}…`,
          ]),
        ])
      : h('p', {}, []);
  return h('article', { class: 'faq-item' }, [
    h('h3', {}, [`${event.kind} · #${String(event.seq)}`]),
    h('p', { class: 'muted' }, [event.createdAt]),
    h('details', {}, [
      h('summary', {}, ['Payload']),
      h('pre', {}, [h('code', {}, [JSON.stringify(event.payload, undefined, 2)])]),
    ]),
    download,
  ]);
}

interface StageMark {
  readonly name: string;
  readonly cls: string;
  readonly mark: string;
  readonly note: string;
}

/**
 * Six progress markers derived only from the lifecycle state and observed
 * event counts. They mark progress, never a verdict.
 */
function stageMarks(run: RunDetail, observed: { events: number; artifacts: number }): StageMark[] {
  const active = run.state === 'queued' || run.state === 'running';
  const terminal = TERMINAL.has(run.state);
  const mid: StageMark['cls'] = run.state === 'queued' ? 'pending' : run.state === 'running' ? 'running' : 'done';
  const midNote =
    run.state === 'queued'
      ? 'Waiting for a worker lease.'
      : run.state === 'running'
        ? 'Worker active; per-stage events are not itemized by the API.'
        : `Lifecycle state: ${run.state}.`;
  const outcome: StageMark =
    run.state === 'succeeded'
      ? { name: 'Outcome', cls: 'done', mark: '✓', note: 'Lifecycle state: succeeded.' }
      : run.state === 'failed'
        ? { name: 'Outcome', cls: 'failed', mark: '×', note: 'Lifecycle state: failed.' }
        : run.state === 'cancelled'
          ? { name: 'Outcome', cls: 'failed', mark: '×', note: 'Lifecycle state: cancelled.' }
          : { name: 'Outcome', cls: 'pending', mark: '', note: 'No outcome while the run is active.' };
  return [
    { name: 'Accepted', cls: 'done', mark: '✓', note: `Run record created ${run.createdAt}.` },
    run.state === 'queued'
      ? { name: 'Queued & leased', cls: 'running', mark: '●', note: 'Waiting for a worker lease.' }
      : { name: 'Queued & leased', cls: 'done', mark: '✓', note: `Lifecycle state: ${run.state}.` },
    { name: 'Snapshot & impact', cls: mid, mark: mid === 'done' ? '✓' : mid === 'running' ? '●' : '', note: midNote },
    { name: 'Baselines', cls: mid, mark: mid === 'done' ? '✓' : mid === 'running' ? '●' : '', note: midNote },
    {
      name: 'Verification & evidence',
      cls: terminal ? 'done' : active && observed.artifacts > 0 ? 'running' : active ? 'running' : 'pending',
      mark: terminal ? '✓' : active ? '●' : '',
      note: `${String(observed.artifacts)} artifact events observed; ${String(observed.events)} events in total.`,
    },
    outcome,
  ];
}

async function renderDetail(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const runId = ctx.params.get('id') ?? ctx.params.get('run');
  if (runId === undefined || runId === '') {
    outlet.replaceChildren(errorState('Run link is incomplete', 'The link carries no run id. Open the run from the list.'));
    return;
  }
  outlet.replaceChildren(emptyState('Loading…', 'Reading the run.'));
  let session: RunSession;
  try {
    session = await readSession();
  } catch (error) {
    outlet.replaceChildren(
      errorState('Run unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderDetail(outlet, ctx),
      }),
    );
    return;
  }
  if (!authed(session)) {
    loginCard(outlet, 'Run needs a login', 'Log in to see this run.');
    return;
  }
  let run: RunDetail;
  try {
    run = await apiGet<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
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
      errorState('Run unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderDetail(outlet, ctx),
      }),
    );
    return;
  }

  const epoch = currentRouteEpoch();
  const observed = { events: 0, artifacts: 0, failures: 0 };
  const head = h('div', {}, []);
  const context = h('div', {}, []);
  const stages = h('ol', { class: 'timeline', id: 'run-stages' }, []);
  const actions = h('div', {}, []);
  const actionNote = h('div', { 'aria-live': 'polite' }, []);
  const eventLog = h('div', { id: 'event-log', class: 'codebox', 'aria-label': 'Live execution log' }, []);
  const eventsList = h('div', { id: 'events-list', class: 'timeline' }, []);
  const pollNote = h('div', { id: 'poll-note', 'aria-live': 'polite' }, []);
  const resEvents = h('strong', { class: 'mono', id: 'res-events' }, ['0']);
  const resArtifacts = h('strong', { class: 'mono', id: 'res-artifacts' }, ['0']);
  const resPolls = h('strong', { class: 'mono', id: 'res-polls' }, ['0']);
  const pollMeter = h('span', { id: 'poll-meter-fill' }, []);
  const review = h('section', { class: 'card' }, [
    h('div', { class: 'eyebrow' }, ['Deterministic Policy']),
    h('h2', {}, ['Review']),
    h('p', {}, [
      'No assessment records on this run yet — events above are the complete record. ',
      'Target and bundle verdicts need the review aggregation backend, which is not exposed yet.',
    ]),
    h('p', {}, [
      h('a', { class: 'button', href: `#/review?run=${encodeURIComponent(runId)}` }, ['Open structured review']),
    ]),
  ]);

  const renderStages = (current: RunDetail): void => {
    stages.replaceChildren(
      ...stageMarks(current, observed).map((stage) =>
        h('li', { class: stage.cls }, [
          h('span', { class: 'stepmark', 'aria-hidden': 'true' }, [stage.mark]),
          h('strong', {}, [stage.name]),
          h('p', {}, [stage.note]),
        ]),
      ),
    );
  };

  const renderResources = (): void => {
    resEvents.replaceChildren(document.createTextNode(String(observed.events)));
    resArtifacts.replaceChildren(document.createTextNode(String(observed.artifacts)));
    resPolls.replaceChildren(document.createTextNode(`${String(observed.failures)} / ${String(pollConfig.maxFailures)}`));
    const ratio = Math.min(1, observed.failures / pollConfig.maxFailures);
    pollMeter.setAttribute('style', `width:${String(Math.round(ratio * 100))}%`);
  };

  const renderHeader = (current: RunDetail): void => {
    head.replaceChildren(
      pageHead({
        eyebrow: 'Run Manifest & Lifecycle',
        title: `Run ${current.runId}`,
        subtitle: `Project ${current.projectId} · created ${current.createdAt}.`,
        actions: [
          h('a', { class: 'button', href: `#/evidence?run=${encodeURIComponent(current.runId)}` }, ['Open the evidence library']),
          h('a', { class: 'button', href: `#/threads?run=${encodeURIComponent(current.runId)}` }, ['Open discussions']),
        ],
      }),
    );
    context.replaceChildren(runContext(current));
    renderStages(current);
  };

  const renderActions = (current: RunDetail): void => {
    if (current.state === 'queued' || current.state === 'running') {
      const cancel = h('button', { id: 'cancel-run', class: 'button', type: 'button' }, ['Cancel run']);
      cancel.addEventListener('click', () => {
        cancel.disabled = true;
        void (async () => {
          try {
            await apiPost<{ state: string }>(`/api/runs/${encodeURIComponent(current.runId)}/cancel`, {});
            const refreshed = await apiGet<RunDetail>(`/api/runs/${encodeURIComponent(current.runId)}`);
            if (!isCurrentRouteEpoch(epoch)) return;
            actionNote.replaceChildren(h('p', {}, ['Run cancelled.']));
            renderHeader(refreshed);
            renderActions(refreshed);
          } catch (error) {
            if (!isCurrentRouteEpoch(epoch)) return;
            if (statusOf(error) === 401) {
              expired(outlet);
              return;
            }
            actionNote.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
            cancel.disabled = false;
          }
        })();
      });
      actions.replaceChildren(h('p', {}, [cancel]));
    } else if (current.state === 'failed' || current.state === 'cancelled') {
      const retry = h('button', { id: 'retry-run', class: 'button primary', type: 'button' }, ['Retry run']);
      retry.addEventListener('click', () => {
        retry.disabled = true;
        void (async () => {
          try {
            const retried = await apiPost<SubmitReceipt>(`/api/runs/${encodeURIComponent(current.runId)}/retry`, {
              idempotencyKey: idempotencyKey(),
            });
            if (!isCurrentRouteEpoch(epoch)) return;
            actionNote.replaceChildren(
              h('p', {}, [
                `Retried as ${retried.runId}. `,
                h('a', { href: `#/run?id=${encodeURIComponent(retried.runId)}` }, ['Open retried run']),
                document.createTextNode('.'),
              ]),
            );
          } catch (error) {
            if (!isCurrentRouteEpoch(epoch)) return;
            if (statusOf(error) === 401) {
              expired(outlet);
              return;
            }
            actionNote.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
            retry.disabled = false;
          }
        })();
      });
      actions.replaceChildren(h('p', {}, [retry]));
    } else {
      actions.replaceChildren();
    }
  };

  renderHeader(run);
  renderActions(run);
  renderResources();
  const isolation = h('section', { class: 'card pad' }, [
    h('h2', {}, ['Isolation status']),
    row('Execution mode', run.executionMode === undefined ? 'Not recorded' : h('code', {}, [run.executionMode])),
    row('Worker & lease', 'Not exposed for this run'),
    row('Sandbox', 'Not exposed for this run'),
    row('Egress', 'Not exposed for this run'),
  ]);
  outlet.replaceChildren(
    head,
    context,
    h('div', { class: 'split' }, [
      h('div', {}, [
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Stages']),
          h('p', { class: 'help' }, [
            'Stages follow the run lifecycle state and observed event kinds. They mark progress, never a verdict.',
          ]),
          stages,
        ]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Live execution log']),
          eventLog,
        ]),
        h('section', { class: 'card pad' }, [
          h('div', { class: 'eyebrow' }, ['Live Execution Stream']),
          h('h2', {}, ['Events']),
          eventsList,
          pollNote,
        ]),
      ]),
      h('aside', {}, [
        h('section', { class: 'card pad' }, [actions, actionNote]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Resource consumption']),
          row(h('span', { class: 'muted' }, ['Events observed']), resEvents),
          row(h('span', { class: 'muted' }, ['Artifacts attached']), resArtifacts),
          row(h('span', { class: 'muted' }, ['Poll failures']), resPolls),
          h('div', { class: 'meter', role: 'img', 'aria-label': 'Poll failures against the reconnect limit' }, [pollMeter]),
          h('p', { class: 'help' }, ['Credit and time consumption are not exposed by the API yet.']),
        ]),
        isolation,
        review,
      ]),
    ]),
  );

  let cursor = 0;
  let failures = 0;
  let stopped = false;

  const appendEvents = (events: readonly RunEventItem[]): boolean => {
    let terminal = false;
    for (const event of events) {
      observed.events += 1;
      if (event.kind === 'artifact') observed.artifacts += 1;
      eventsList.appendChild(eventArticle(runId, event));
      eventLog.appendChild(h('div', {}, [`#${String(event.seq)} ${event.kind} · ${event.createdAt}`]));
      if (TERMINAL.has(event.kind)) terminal = true;
    }
    renderResources();
    return terminal;
  };

  const finish = (terminal: boolean): void => {
    stopped = true;
    pollNote.replaceChildren(
      terminal ? h('p', { class: 'muted' }, ['Final state reached; polling stopped.']) : h('p', {}, []),
    );
  };

  const pollOnce = async (): Promise<boolean> => {
    const page = await apiGet<EventsPage>(
      `/api/runs/${encodeURIComponent(runId)}/events?afterSeq=${String(cursor)}&limit=50`,
    );
    if (!isCurrentRouteEpoch(epoch)) return true;
    failures = 0;
    observed.failures = 0;
    pollNote.replaceChildren();
    cursor = page.cursor;
    if (appendEvents(page.events)) {
      const refreshed = await apiGet<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
      if (!isCurrentRouteEpoch(epoch)) return true;
      renderHeader(refreshed);
      renderActions(refreshed);
      return true;
    }
    return false;
  };

  const reconnect = (): void => {
    failures = 0;
    observed.failures = 0;
    pollNote.replaceChildren();
    void loop();
  };

  const loop = async (): Promise<void> => {
    for (;;) {
      if (stopped || !isCurrentRouteEpoch(epoch)) return;
      try {
        if (await pollOnce()) {
          finish(true);
          return;
        }
      } catch (error) {
        if (!isCurrentRouteEpoch(epoch)) return;
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        failures += 1;
        observed.failures = failures;
        renderResources();
        if (failures >= pollConfig.maxFailures) {
          stopped = true;
          const again = h('button', { class: 'button', type: 'button' }, ['Reconnect now']);
          again.addEventListener('click', () => {
            stopped = false;
            reconnect();
          });
          pollNote.replaceChildren(
            h('section', { class: 'card state-block', role: 'alert' }, [
              h('h2', {}, ['Polling paused']),
              h('p', {}, [`${asErrorMessage(error)} Reconnect to resume the timeline.`]),
              again,
            ]),
          );
          return;
        }
        pollNote.replaceChildren(h('p', { class: 'muted' }, ['Connection lost — retrying…']));
      }
      await new Promise((resolve) => setTimeout(resolve, pollConfig.intervalMs));
    }
  };

  if (TERMINAL.has(run.state)) {
    try {
      const page = await apiGet<EventsPage>(`/api/runs/${encodeURIComponent(runId)}/events?afterSeq=0&limit=50`);
      if (!isCurrentRouteEpoch(epoch)) return;
      cursor = page.cursor;
      appendEvents(page.events);
    } catch (error) {
      if (!isCurrentRouteEpoch(epoch)) return;
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      pollNote.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
    }
    finish(true);
    return;
  }
  void loop();
}

async function renderRunCreated(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const loaded = await requireRun(outlet, ctx);
  if (loaded === undefined) return;
  const { run } = loaded;
  const note = h('div', { 'aria-live': 'polite' }, []);
  const cancel = h('button', { id: 'cancel-created', class: 'button danger', type: 'button' }, ['Cancel run']);
  if (run.state !== 'queued' && run.state !== 'running') cancel.disabled = true;
  cancel.addEventListener('click', () => {
    cancel.disabled = true;
    void apiPost(`/api/runs/${encodeURIComponent(run.runId)}/cancel`, {})
      .then(() => {
        note.replaceChildren(h('p', {}, ['Run cancelled. Cleanup runs on the worker; costs used stay recorded.']));
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        note.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        cancel.disabled = false;
      });
  });
  outlet.replaceChildren(
    pageHead({
      eyebrow: 'Run accepted',
      title: `Run ${run.runId} filed`,
      subtitle: `Project ${run.projectId} · created ${run.createdAt}.`,
      actions: [
        h('a', { class: 'button primary', href: `#/run?id=${encodeURIComponent(run.runId)}` }, ['Open live run']),
        h('a', { class: 'button', href: '#/runs' }, ['Back to runs']),
      ],
    }),
    runContext(run),
    h('section', { class: 'card pad' }, [
      h('h2', {}, ['Run accepted']),
      stateBadge(run.state),
      h('div', { style: 'margin-top:20px' }, [
        row('Mode', run.executionMode === undefined ? 'Not recorded' : h('code', {}, [run.executionMode])),
        row('Targets', run.repositoryIds.length === 0 ? 'None' : run.repositoryIds.join(', ')),
        row('Reservation', 'Not exposed by the API yet'),
        row('Time limit', 'Not exposed by the API yet'),
        row('Verdict', 'None yet'),
        row('Candidate identity', 'Not created yet'),
      ]),
      h('p', { class: 'help' }, [
        'The run entered the durable queue. Results, actual cost, and evidence stay available after this tab closes.',
      ]),
      h('p', {}, [cancel]),
      note,
    ]),
  );
}

function reviewNotice(): HTMLElement {
  return h('div', { class: 'notice soft' }, [
    h('h2', {}, ['No assessment to show yet']),
    h('p', {}, [
      'Target and bundle verdicts need the review aggregation backend, which is not exposed yet. ',
      'Nothing below is a verdict: states come from the run record, files from attached artifact bytes.',
    ]),
  ]);
}

async function renderReview(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const loaded = await requireRun(outlet, ctx);
  if (loaded === undefined) return;
  const { run } = loaded;
  let listed: { events: RunEventItem[]; truncated: boolean };
  try {
    listed = await readRunEvents(run.runId);
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    outlet.replaceChildren(errorState('Review unavailable', asErrorMessage(error)));
    return;
  }
  const files = artifactDigests(listed.events);
  const diffView = h('div', { id: 'diffView' }, [
    h('p', { class: 'help' }, ['Select a file to preview its served bytes.']),
  ]);
  const diffTabs = h('div', { class: 'filterbar', role: 'group', 'aria-label': 'Attached files' }, [
    ...files.map((file, index) =>
      h(
        'button',
        {
          class: index === 0 ? 'chip selected' : 'chip',
          type: 'button',
          'data-diff': file.digest,
          'aria-pressed': index === 0 ? 'true' : 'false',
        },
        [shortDigest(file.digest)],
      ),
    ),
  ]);
  const renderFile = async (digest: string): Promise<void> => {
    diffView.replaceChildren(h('p', { class: 'help' }, ['Reading the served bytes…']));
    let bytes: Uint8Array;
    try {
      bytes = await apiGetBytes(`/api/runs/${encodeURIComponent(run.runId)}/artifacts/${encodeURIComponent(digest)}`);
    } catch (error) {
      const status = statusOf(error);
      if (status === 401) {
        expired(outlet);
        return;
      }
      if (status === 400) {
        diffView.replaceChildren(errorState('File failed its integrity check', asErrorMessage(error)));
        return;
      }
      diffView.replaceChildren(errorState('File unavailable', asErrorMessage(error)));
      return;
    }
    const download = h(
      'a',
      { class: 'button', href: `/api/runs/${encodeURIComponent(run.runId)}/artifacts/${encodeURIComponent(digest)}` },
      [`Download ${shortDigest(digest)}`],
    );
    if (bytes.length > MAX_FILE_PREVIEW_BYTES) {
      diffView.replaceChildren(
        h('div', { class: 'code-head' }, [shortDigest(digest)]),
        h('p', {}, [
          `This file is too large to preview in the browser (${String(bytes.length)} bytes). Download it to inspect the full bytes.`,
        ]),
        h('p', {}, [download]),
      );
      return;
    }
    const text = decodeFilePreview(bytes);
    if (text === undefined) {
      diffView.replaceChildren(
        h('div', { class: 'code-head' }, [shortDigest(digest)]),
        h('p', {}, ['These bytes are not plain text, so there is no preview. Download them to inspect the original.']),
        h('p', {}, [download]),
      );
      return;
    }
    const lines = text.split('\n');
    diffView.replaceChildren(
      h('div', { class: 'code-head' }, [`${shortDigest(digest)} · ${String(bytes.length)} bytes · shown exactly as served`]),
      h(
        'pre',
        { class: 'diff', 'aria-label': `Attached file ${shortDigest(digest)}` },
        lines.map((line) =>
          h(
            'span',
            {
              class: `diff-line ${line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'remove' : line.startsWith('@@') ? 'hunk' : ''}`.trimEnd(),
            },
            [line === '' ? ' ' : line],
          ),
        ),
      ),
      h('p', {}, [download]),
    );
  };
  for (const tab of diffTabs.querySelectorAll('button.chip')) {
    tab.addEventListener('click', () => {
      for (const other of diffTabs.querySelectorAll('button.chip')) {
        const active = other === tab;
        other.classList.toggle('selected', active);
        other.setAttribute('aria-pressed', String(active));
      }
      void renderFile(tab.getAttribute('data-diff') ?? '');
    });
  }
  const targetTable =
    run.repositoryIds.length === 0
      ? emptyState('No targets', 'This run grants no repositories, so there is nothing to assess.')
      : table(
          ['Target', 'TargetOutcome', 'Correctness', 'Performance', 'Resilience', 'Data integrity'],
          run.repositoryIds.map((repo) => [
            h('strong', {}, [repo]),
            staticBadge('unverified'),
            'Not assessed',
            'Not assessed',
            'Not assessed',
            'Not assessed',
          ]),
          { className: 'proof-grid' },
        );
  const checksCard =
    listed.events.length === 0
      ? emptyState('No checks yet', 'No events observed on this run, so there is nothing to list.')
      : table(
          ['Stage · check', 'Result', 'Notes'],
          listed.events
            .filter((event) => event.kind !== 'artifact')
            .map((event) => [event.kind, staticBadge('observed'), `#${String(event.seq)} · ${event.createdAt}`]),
        );
  const details = h('details', { class: 'compact-detail' }, [
    h('summary', {}, ['Claim limits']),
    h('div', { class: 'card pad' }, [
      h('ul', { class: 'claim-list' }, [
        h('li', {}, ['Evidence applies to the workload and fault envelope in the run manifest.']),
        h('li', {}, ['A controlled change does not yet prove adoption by the owner.']),
        h('li', {}, ['Observed states are lifecycle facts, not fix verdicts.']),
      ]),
    ]),
  ]);
  outlet.replaceChildren(
    runCrumb(run, 'Review'),
    pageHead({
      eyebrow: 'Review run',
      title: `Review ${run.runId}`,
      subtitle: `Lifecycle state ${run.state} · version ${String(run.version)} · actual cost is not exposed yet.`,
      actions: [
        h('a', { class: 'button', href: `#/evidence?run=${encodeURIComponent(run.runId)}` }, ['Open evidence']),
        h('a', { class: 'button primary', href: `#/publication?run=${encodeURIComponent(run.runId)}` }, ['Review publication']),
      ],
    }),
    runContext(run),
    tabs(runTabItems(run.runId), 'review'),
    reviewNotice(),
    h('div', { class: 'split' }, [
      h('div', {}, [
        card(
          'Results per target',
          h('div', {}, [
            targetTable,
            h('div', { class: 'footer-note' }, [
              'Every result names its proof scope. Dimensions are assessed separately; nothing here is assessed yet.',
            ]),
          ]),
          'The review aggregation backend is not exposed, so every target stays unverified.',
        ),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Diagnosis: symptom, cause, hypothesis']),
          h('p', { class: 'help' }, ['Symptoms, causes, and hypotheses are not exposed by the API yet.']),
        ]),
        card(
          'Attached files',
          files.length === 0
            ? emptyState('No attached files', 'Workers attach files as the run proceeds; none are on this run yet.')
            : h('div', {}, [diffTabs, diffView]),
          files.length === 0 ? undefined : 'Bytes shown exactly as served; the dashboard does not judge which file is the candidate.',
        ),
        card(
          'Observed run events',
          checksCard,
          'Events are lifecycle facts. Required check results are not exposed yet; observed is not pass.',
        ),
        details,
      ]),
      h('aside', {}, [
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Publication']),
          ...(run.repositoryIds.length === 0
            ? [h('p', { class: 'help' }, ['No targets, so no PR plan.'])]
            : run.repositoryIds.map((repo) => row(repo, staticBadge('no PR yet')))),
          h('p', {}, [
            h('a', { class: 'button full', href: `#/publication?run=${encodeURIComponent(run.runId)}` }, ['Open publication']),
          ]),
        ]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Evidence labels']),
          row(h('span', { class: 'muted' }, ['origin']), 'Not recorded'),
          row(h('span', { class: 'muted' }, ['executionMode']), run.executionMode ?? 'Not recorded'),
          row(h('span', { class: 'muted' }, ['proposalMode']), 'Not recorded'),
        ]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Actual usage']),
          h('p', { class: 'help' }, ['Model, compute, and storage usage are not exposed by the API yet.']),
        ]),
      ]),
    ]),
  );
}

async function renderImpact(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const loaded = await requireRun(outlet, ctx);
  if (loaded === undefined) return;
  const { run } = loaded;
  const nodeDetail = h('div', { class: 'inset', id: 'nodeDetail' }, [
    h('p', { class: 'help' }, ['Select a component to see what this run records about it.']),
  ]);
  const board = h('div', { class: 'graph-board' }, [
    ...run.repositoryIds.map((repo, index) => {
      const node = h(
        'button',
        { class: index === 0 ? 'graph-node selected' : 'graph-node', type: 'button', 'data-node': repo },
        [h('strong', {}, [repo]), h('small', {}, ['Granted repository']), staticBadge('in scope', 'blue')],
      );
      node.addEventListener('click', () => {
        for (const other of board.querySelectorAll('.graph-node')) other.classList.toggle('selected', other === node);
        nodeDetail.replaceChildren(
          h('h3', {}, [repo]),
          row('Grant', 'Recorded at submit'),
          row('Provenance', 'Dependency edges are not exposed by the API yet'),
          row('Resolution', staticBadge('unknown')),
        );
      });
      return node;
    }),
  ]);
  outlet.replaceChildren(
    runCrumb(run, 'Impact'),
    pageHead({
      eyebrow: 'Dependency graph',
      title: `Impact ${run.runId}`,
      subtitle: 'Granted components with honest resolution states. Unknowns stay visible.',
      actions: [h('a', { class: 'button primary', href: `#/investigation?run=${encodeURIComponent(run.runId)}` }, ['Open hypothesis ledger'])],
    }),
    runContext(run),
    tabs(runTabItems(run.runId), 'impact'),
    h('section', { class: 'card pad' }, [
      h('h2', {}, ['Dependency graph']),
      h('p', { class: 'help' }, ['Select a component to see provenance and resolution status.']),
      run.repositoryIds.length === 0
        ? emptyState('No components', 'This run grants no repositories, so the graph is empty.')
        : board,
      h('div', { class: 'badges', style: 'margin-top:16px' }, [
        staticBadge(`${String(run.repositoryIds.length)} components in scope`, 'blue'),
        staticBadge('edges: none exposed'),
      ]),
      nodeDetail,
    ]),
    h('div', { class: 'grid2' }, [
      card(
        'Impact paths',
        emptyState('No impact paths', 'Source-to-target edges are not exposed by the API yet, so none are drawn.'),
      ),
      h('section', { class: 'card pad' }, [
        h('h2', {}, ['Scope & unknowns']),
        row('Required targets', `${String(run.repositoryIds.length)} retained`),
        row('Scope digest', 'Not exposed'),
        row('Dynamic lookup', staticBadge('unknown')),
        h('p', { class: 'help' }, ['Targets that are not yet mapped remain in the denominator.']),
        h('p', {}, [
          h('a', { class: 'button full', href: `#/investigation?run=${encodeURIComponent(run.runId)}` }, ['Open hypothesis ledger']),
        ]),
      ]),
    ]),
  );
}

function attemptLike(event: RunEventItem): boolean {
  const kind = event.kind.toLowerCase();
  return kind.includes('attempt') || kind.includes('candidate') || kind.includes('hypothesis') || kind.includes('retry');
}

async function renderInvestigation(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const loaded = await requireRun(outlet, ctx);
  if (loaded === undefined) return;
  const { run } = loaded;
  let listed: { events: RunEventItem[]; truncated: boolean };
  try {
    listed = await readRunEvents(run.runId);
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    outlet.replaceChildren(errorState('Investigation unavailable', asErrorMessage(error)));
    return;
  }
  const attempts = listed.events.filter(attemptLike);
  outlet.replaceChildren(
    runCrumb(run, 'Investigation'),
    pageHead({
      eyebrow: 'Investigation',
      title: `Hypothesis ledger ${run.runId}`,
      subtitle: 'Symptoms, proven causes, and explanations that still need testing.',
      actions: [h('a', { class: 'button', href: `#/campaigns?run=${encodeURIComponent(run.runId)}` }, ['Open verification'])],
    }),
    runContext(run),
    tabs(runTabItems(run.runId), 'investigation'),
    h('div', { class: 'grid3' }, [
      h('section', { class: 'card pad' }, [
        h('h2', {}, ['Symptom']),
        staticBadge('unknown'),
        h('p', { class: 'help' }, ['The hypothesis ledger is not exposed by the API yet.']),
      ]),
      h('section', { class: 'card pad' }, [
        h('h2', {}, ['Supported cause']),
        staticBadge('unknown'),
        h('p', { class: 'help' }, ['No causal claim is made without ledger records.']),
      ]),
      h('section', { class: 'card pad' }, [
        h('h2', {}, ['Active hypothesis']),
        staticBadge('unknown'),
        h('p', { class: 'help' }, ['Close timestamps alone never prove cause and effect.']),
      ]),
    ]),
    card(
      'Evidence and next probes',
      emptyState('No ledger entries', 'Hypotheses and probes are not exposed by the API yet, so none are listed.'),
      'Every probe needs a predicted outcome, competing explanation, cost cap, and stop rule.',
    ),
    h('section', { class: 'card pad' }, [
      h('h2', {}, ['Adaptive recovery']),
      attempts.length === 0
        ? emptyState('No attempt events', 'No attempt, candidate, hypothesis, or retry events observed on this run yet.')
        : h(
            'ol',
            { class: 'timeline' },
            attempts.map((event, index) =>
              h('li', {}, [
                h('span', { class: 'stepmark', 'aria-hidden': 'true' }, [String(index + 1)]),
                h('strong', {}, [event.kind]),
                h('time', {}, [event.createdAt]),
                h('p', {}, [`Event #${String(event.seq)} observed on this run.`]),
              ]),
            ),
          ),
    ]),
  );
}

function trialLike(event: RunEventItem): boolean {
  return event.kind.toLowerCase().includes('trial');
}

async function renderCampaigns(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const loaded = await requireRun(outlet, ctx);
  if (loaded === undefined) return;
  const { run } = loaded;
  let listed: { events: RunEventItem[]; truncated: boolean };
  try {
    listed = await readRunEvents(run.runId);
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    outlet.replaceChildren(errorState('Verification unavailable', asErrorMessage(error)));
    return;
  }
  const trials = listed.events.filter(trialLike);
  const trialGrid = h('div', { class: 'trials', 'aria-label': 'Trial receipts' }, [
    ...trials.slice(0, 60).map((event) => {
      const excluded = event.kind.toLowerCase().includes('exclud') || event.kind.toLowerCase().includes('invalid');
      const box = h('span', { class: excluded ? 'trial excluded' : 'trial' }, []);
      box.setAttribute('title', `Event #${String(event.seq)}: ${event.kind}`);
      return box;
    }),
  ]);
  const planDetails = h('details', { class: 'compact-detail' }, [
    h('summary', {}, ['Experiment plan']),
    h('div', { class: 'card pad' }, [
      h('p', { class: 'help' }, ['The frozen experiment plan is not exposed by the API yet.']),
    ]),
  ]);
  outlet.replaceChildren(
    runCrumb(run, 'Verification'),
    pageHead({
      eyebrow: 'Verification campaign',
      title: `Verification ${run.runId}`,
      subtitle: 'Complete trials, four dimensions, and explicit claim limits.',
      actions: [h('a', { class: 'button primary', href: `#/evidence?run=${encodeURIComponent(run.runId)}` }, ['Open evidence'])],
    }),
    runContext(run),
    tabs(runTabItems(run.runId), 'campaigns'),
    h('div', { class: 'grid3', style: 'margin-bottom:22px' }, [
      h('div', { class: 'campaign-stat' }, [
        h('small', {}, ['Scheduled trials']),
        h('div', { class: 'metric-big' }, ['—']),
        staticBadge('plan not exposed'),
      ]),
      h('div', { class: 'campaign-stat' }, [
        h('small', {}, ['Valid receipts']),
        h('div', { class: 'metric-big' }, ['—']),
        staticBadge('receipts not exposed'),
      ]),
      h('div', { class: 'campaign-stat' }, [
        h('small', {}, ['Campaign result']),
        h('div', { style: 'margin:12px 0' }, [staticBadge('not assessed', 'amber')]),
        h('small', {}, ['No campaign verdict without trial receipts.']),
      ]),
      h('div', { class: 'campaign-stat' }, [
        h('small', {}, ['Events observed']),
        h('div', { class: 'metric-big' }, [String(listed.events.length)]),
        staticBadge('run lifecycle facts', 'blue'),
      ]),
    ]),
    h('div', { class: 'split' }, [
      h('div', {}, [
        card(
          'Verification dimensions',
          table(
            ['Dimension', 'Required', 'Assessment', 'Proof scope'],
            ['Correctness', 'Performance', 'Resilience', 'Data integrity'].map((dimension) => [
              dimension,
              'Not recorded',
              staticBadge('not assessed', 'amber'),
              'Not exposed',
            ]),
          ),
          'Dimensions are assessed separately. A missing dimension withholds assurance.',
        ),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Trial receipts']),
          trials.length === 0
            ? h('p', { class: 'help' }, ['Trial receipts are not exposed by the API yet. All trials remain recorded once they exist.'])
            : trialGrid,
          h('p', { class: 'help' }, ['Reruns use a new plan and budget, not repeats until green.']),
        ]),
        card(
          'Observed trial events',
          trials.length === 0
            ? emptyState('No trial events', 'No trial events observed on this run yet.')
            : table(
                ['Event', 'Kind', 'Observed at'],
                trials.map((event) => [`#${String(event.seq)}`, event.kind, event.createdAt]),
              ),
        ),
        card(
          'Mixed-version rollout',
          emptyState('No rollout states', 'Mixed-version combinations are not exposed by the API yet.'),
        ),
        planDetails,
      ]),
      h('aside', {}, [
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Experiment plan']),
          row('Revision', 'Not exposed'),
          row('Workload', 'Not exposed'),
          row('Fault', 'Not exposed'),
          row('Candidate', 'Not recorded'),
        ]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Next steps']),
          h('p', { class: 'help' }, ['File a new run once the plan and budget are frozen.']),
          h('p', {}, [h('a', { class: 'button primary full', href: '#/new-run' }, ['Submit new run'])]),
        ]),
      ]),
    ]),
  );
}

async function renderPublication(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const loaded = await requireRun(outlet, ctx);
  if (loaded === undefined) return;
  const { session, run } = loaded;
  const grants = session.repositoryGrants ?? [];
  const previewButton = h('button', { id: 'pr-preview', class: 'button full', type: 'button' }, ['Preview draft contents']);
  previewButton.addEventListener('click', () => {
    const body = [
      `Run ${run.runId} · project ${run.projectId}`,
      `Lifecycle state: ${run.state} · version ${String(run.version)}`,
      `Targets: ${run.repositoryIds.length === 0 ? 'none' : run.repositoryIds.join(', ')}`,
      `Submit digest: ${run.submitDigest}`,
      '',
      'No PR has been created. This preview is assembled from run identifiers only.',
      'No automatic merge or deploy. A maintainer reviews and integrates outside ChangeProof.',
    ].join('\n');
    const content = h('div', {}, [
      h('p', {}, ['Draft PR body preview.']),
      h('pre', { class: 'codebox' }, [h('code', {}, [body])]),
      h('div', { class: 'actions' }, [h('button', { class: 'button primary', type: 'button', id: 'pr-close' }, ['Close'])]),
    ]);
    const handle = modal(previewButton, 'Draft PR preview', content);
    content.querySelector('#pr-close')?.addEventListener('click', () => { handle.close(); });
  });
  outlet.replaceChildren(
    runCrumb(run, 'Publication'),
    pageHead({
      eyebrow: 'Publication',
      title: `Publication ${run.runId}`,
      subtitle: 'Review candidates, dependencies, and proof before preparing a PR.',
      actions: [h('a', { class: 'button', href: `#/evidence?run=${encodeURIComponent(run.runId)}` }, ['Open evidence'])],
    }),
    runContext(run),
    tabs(runTabItems(run.runId), 'publication'),
    h('div', { class: 'notice' }, [
      h('strong', {}, ['Bundle proof is not available.']),
      h('span', {}, [' Only draft preparation applies. No automatic merge or deploy.']),
    ]),
    card(
      'Candidate bundle',
      run.repositoryIds.length === 0
        ? emptyState('Empty bundle', 'This run grants no repositories, so there is no bundle to publish.')
        : table(
            ['Order', 'Target', 'Expected head', 'Publication', 'CI attestation'],
            run.repositoryIds.map((repo, index) => [
              String(index + 1).padStart(2, '0'),
              h('strong', {}, [repo]),
              'Not exposed',
              staticBadge('not published yet'),
              staticBadge('not exposed'),
            ]),
          ),
      'The dashboard creates no PR URL. Publication needs the broker, which is not exposed here.',
    ),
    h('div', { class: 'grid2' }, [
      h('section', { class: 'card pad' }, [
        h('h2', {}, ['Publication checks']),
        row('Role & project scope', staticBadge(session.role, 'blue')),
        row(
          'Current repository grants',
          grants.length === 0 ? staticBadge('none granted', 'red') : staticBadge(`${String(grants.length)} granted`, 'green'),
        ),
        row('Head freshness', staticBadge('cannot verify')),
        row('Bundle proof', staticBadge('not available', 'amber')),
        row('Idempotency identity', h('code', {}, [run.runId])),
      ]),
      h('section', { class: 'card pad' }, [
        h('h2', {}, ['Merge prerequisites']),
        h('ol', { class: 'claim-list' }, [
          h('li', {}, ['Recheck current grants and exact heads.']),
          h('li', {}, ['Complete required dimension and mixed-version proof.']),
          h('li', {}, ['CI must match the head in the evidence.']),
          h('li', {}, ['A maintainer performs review and integration outside ChangeProof.']),
        ]),
        h('p', {}, [previewButton]),
      ]),
    ]),
  );
}

interface OutcomeRecord {
  readonly owner: string;
  readonly environment: string;
  readonly origin: string;
  readonly observation: string;
  readonly effort: string;
  readonly adoption: string;
  readonly humanEdits: boolean;
  readonly savedAt: string;
}

async function renderOutcome(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const loaded = await requireRun(outlet, ctx);
  if (loaded === undefined) return;
  const { session, run } = loaded;
  const accountKey = `${session.tenantId}:${session.userId}`;
  const storageKey = `outcome:${run.runId}`;
  const owner = field({ id: 'outcome-owner', label: 'Owner / reviewer', required: true });
  const environment = h('select', { id: 'outcome-env', name: 'environment' }, [
    h('option', {}, ['Staging · order workflow']),
    h('option', {}, ['Isolated pilot clone']),
  ]);
  const origin = field({ id: 'outcome-origin', label: 'Issue / origin', required: true });
  const observation = textareaField('outcome-observation', 'Observed result');
  observation.input.setAttribute('placeholder', 'Describe the workload, observation window, before/after results, and evidence limits.');
  const effort = field({ id: 'outcome-effort', label: 'Review effort (min)', type: 'number' });
  const adoption = h('select', { id: 'outcome-adoption', name: 'adoption' }, [
    h('option', {}, ['Not yet integrated']),
    h('option', {}, ['In owner review']),
    h('option', {}, ['Accepted in pilot']),
    h('option', {}, ['Rejected / needs revision']),
  ]);
  const humanEdits = h('input', { id: 'outcome-edits', type: 'checkbox' }, []);
  const formNote = h('div', { 'aria-live': 'polite' }, []);
  const savedView = h('div', { id: 'outcome-saved' }, []);
  const validation = h('div', { id: 'outcome-validation' }, [staticBadge('not recorded yet')]);

  const showSaved = (record: OutcomeRecord): void => {
    savedView.replaceChildren(
      h('div', { class: 'inset' }, [
        row('Owner', record.owner),
        row('Environment', record.environment),
        row('Origin', record.origin),
        row('Observation', record.observation),
        row('Review effort', `${record.effort} min`),
        row('Adoption', record.adoption),
        row('Human edits', record.humanEdits ? 'Yes — a new candidate and full re-verification are required' : 'No'),
        row('Saved at', record.savedAt),
      ]),
    );
    validation.replaceChildren(staticBadge('recorded locally', 'blue'));
  };

  try {
    const raw = loadDraft(accountKey, storageKey);
    if (raw !== undefined) {
      const parsed = JSON.parse(raw) as OutcomeRecord;
      owner.input.value = parsed.owner;
      environment.value = parsed.environment;
      origin.input.value = parsed.origin;
      observation.input.value = parsed.observation;
      effort.input.value = parsed.effort;
      adoption.value = parsed.adoption;
      humanEdits.checked = parsed.humanEdits;
      showSaved(parsed);
    }
  } catch {
    // A malformed local record never blocks the form; saving overwrites it.
  }

  const outcomeForm = h('form', { id: 'outcomeForm', novalidate: 'novalidate' }, [
    owner.wrap,
    h('div', { class: 'field' }, [h('label', { for: 'outcome-env' }, ['Representative environment']), environment]),
    origin.wrap,
    observation.wrap,
    h('div', { class: 'grid2' }, [
      effort.wrap,
      h('div', { class: 'field' }, [h('label', { for: 'outcome-adoption' }, ['Adoption state']), adoption]),
    ]),
    h('label', { class: 'checkrow' }, [
      humanEdits,
      h('span', {}, ['Human edits were made after the candidate was created; a new candidate and full re-verification are required.']),
    ]),
    formNote,
    h('p', {}, [h('button', { class: 'button primary', type: 'submit' }, ['Save local outcome'])]),
  ]);
  outcomeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (owner.input.value.trim() === '' || origin.input.value.trim() === '' || observation.input.value.trim() === '') {
      showAlert(formNote, 'Owner, origin, and observation are all required.');
      return;
    }
    const record: OutcomeRecord = {
      owner: owner.input.value.trim(),
      environment: environment.value,
      origin: origin.input.value.trim(),
      observation: observation.input.value.trim(),
      effort: effort.input.value.trim(),
      adoption: adoption.value,
      humanEdits: humanEdits.checked,
      savedAt: new Date().toISOString(),
    };
    try {
      saveDraft(accountKey, storageKey, JSON.stringify(record));
    } catch (error) {
      if (error instanceof SecretDraftError) {
        showAlert(formNote, 'This account id cannot persist browser records. The record below is for this view only.');
        showSaved(record);
        return;
      }
      throw error;
    }
    formNote.replaceChildren(h('p', { class: 'muted' }, ['Outcome saved in this browser.']));
    showSaved(record);
  });

  outlet.replaceChildren(
    runCrumb(run, 'Outcome'),
    pageHead({
      eyebrow: 'Owner validation',
      title: `Outcome ${run.runId}`,
      subtitle: 'Record workflow recovery, adoption evidence, and human contribution.',
    }),
    runContext(run),
    tabs(runTabItems(run.runId), 'outcome'),
    h('div', { class: 'notice' }, [
      h('strong', {}, ['Owner approval does not replace independent runtime proof.']),
      h('span', {}, [' Adoption proof comes from observed runs, not from this form.']),
    ]),
    h('div', { class: 'split' }, [
      h('div', {}, [
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Outcome record']),
          outcomeForm,
          savedView,
          h('p', { class: 'help' }, [
            'Owner outcome reporting is not exposed by the API yet, so records stay in this browser. They carry no verdict.',
          ]),
        ]),
      ]),
      h('aside', {}, [
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Before / after']),
          row('Before', 'Not recorded'),
          row('After', `Lifecycle state: ${run.state}`),
          row('Proof gap', staticBadge('not assessed', 'amber')),
          row('Owner validation', validation),
        ]),
        h('section', { class: 'card pad' }, [
          h('h2', {}, ['Attribution']),
          h('p', { class: 'help' }, [
            'Human-authored replacements are not counted as autonomous fixes. Any change to a candidate invalidates the checks that depend on it.',
          ]),
        ]),
      ]),
    ]),
  );
}

export function registerRunPages(): void {
  registerRoute({ path: '/runs', title: 'Runs', navLabel: 'Runs', navSection: 'workspace', render: renderLists });
  registerRoute({
    path: '/runs/new',
    title: 'File a run',
    render: (outlet, ctx) => {
      void renderForm(outlet, ctx);
    },
  });
  registerRoute({
    path: '/new-run',
    title: 'File a run',
    navLabel: 'New run',
    navSection: 'workspace',
    render: (outlet, ctx) => {
      void renderForm(outlet, ctx);
    },
  });
  registerRoute({
    path: '/run',
    title: 'Run details',
    render: (outlet, ctx) => {
      void renderDetail(outlet, ctx);
    },
  });
  registerRoute({
    path: '/running',
    title: 'Active run',
    render: (outlet, ctx) => {
      void renderDetail(outlet, ctx);
    },
  });
  registerRoute({
    path: '/run-created',
    title: 'Run created',
    render: (outlet, ctx) => {
      void renderRunCreated(outlet, ctx);
    },
  });
  registerRoute({
    path: '/review',
    title: 'Review run',
    render: (outlet, ctx) => {
      void renderReview(outlet, ctx);
    },
  });
  registerRoute({
    path: '/impact',
    title: 'Dependency graph',
    render: (outlet, ctx) => {
      void renderImpact(outlet, ctx);
    },
  });
  registerRoute({
    path: '/investigation',
    title: 'Investigation',
    render: (outlet, ctx) => {
      void renderInvestigation(outlet, ctx);
    },
  });
  registerRoute({
    path: '/campaigns',
    title: 'Verification campaign',
    render: (outlet, ctx) => {
      void renderCampaigns(outlet, ctx);
    },
  });
  registerRoute({
    path: '/publication',
    title: 'Publication',
    render: (outlet, ctx) => {
      void renderPublication(outlet, ctx);
    },
  });
  registerRoute({
    path: '/outcome',
    title: 'Owner validation',
    render: (outlet, ctx) => {
      void renderOutcome(outlet, ctx);
    },
  });
}
