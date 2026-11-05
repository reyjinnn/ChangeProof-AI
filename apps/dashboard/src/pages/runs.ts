/* Run journey UI (T-45, WP3-25). Project/run lists, template-driven
 * draft + immutable submit, and live run detail over the real
 * lifecycle/queries stores. Polling (never a fake stream) with cursor,
 * reconnect, and navigation-aware stop; no verdict is ever invented —
 * the review panel says exactly what the backend does not provide. */

import type { PublicTemplate } from '../../../../src/core/contracts/schemas/publicsite.js';

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, emptyState, errorState, field, h, pageHead } from '../components.js';
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

function hitTable(hits: readonly SearchHit[]): HTMLElement {
  return h('div', { class: 'table-wrap' }, [h('table', { class: 'run-search-table' }, [
    h('caption', {}, ['Matches from current-grant search']),
    h('thead', {}, [h('tr', {}, ['Name & context', 'Reference', 'Created'].map(label => h('th', { scope: 'col' }, [label])))]),
    h('tbody', {}, hits.map(hit => h('tr', {}, [
      h('th', { scope: 'row' }, [h('a', { href: hit.kind === 'run' ? `#/run?id=${encodeURIComponent(hit.id)}` : '#/runs/new' }, [hit.title]), h('small', {}, [hit.snippet])]),
      h('td', { 'data-label': 'Reference' }, [h('code', { class: 'inline' }, [hit.id])]),
      h('td', { 'data-label': 'Created' }, [h('time', { datetime: hit.createdAt }, [hit.createdAt])]),
    ]))),
  ])]);
}

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
  const text = field({ id: 'run-filter-text', label: 'Filter text' });
  const stateSelect = h('select', { id: 'run-filter-state', name: 'run-filter-state' }, [
    h('option', { value: '' }, ['Any state']),
    h('option', { value: 'queued' }, ['Queued']),
    h('option', { value: 'running' }, ['Running']),
    h('option', { value: 'succeeded' }, ['Succeeded']),
    h('option', { value: 'failed' }, ['Failed']),
    h('option', { value: 'cancelled' }, ['Cancelled']),
  ]);
  const stateWrap = h('div', { class: 'field' }, [
    h('label', { for: 'run-filter-state' }, ['Run state']),
    stateSelect,
  ]);
  const filterForm = h('form', { id: 'run-filter', novalidate: 'novalidate' }, [
    text.wrap,
    stateWrap,
    h('p', {}, [h('button', { class: 'button primary', type: 'submit' }, ['Apply filters'])]),
  ]);
  const lists = h('div', {}, []);
  outlet.replaceChildren(
    pageHead({
      eyebrow: 'Workspace Runs',
      title: 'Runs',
      subtitle: 'Search active and historical verification runs and projects in your organization.',
      actions: [h('a', { class: 'button primary', href: '#/runs/new' }, ['File a run'])],
    }),
    h('section', { class: 'card' }, [
      h('h2', {}, ['Filter runs & projects']),
      filterForm,
    ]),
    lists,
  );
  const load = async (): Promise<void> => {
    lists.replaceChildren(emptyState('Loading…', 'Searching runs and projects.'));
    try {
      const [runs, projects] = await Promise.all([
        search('runs', { text: text.input.value.trim(), runState: stateSelect.value }),
        search('projects', { text: text.input.value.trim() }),
      ]);
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
          h('div', { class: 'value' }, [session.tenantId]),
          h('div', { class: 'sub' }, [`Role: ${session.role}`]),
        ]),
      ]);
      const runSection = h('section', { class: 'card' }, [h('h2', {}, ['Runs'])]);
      if (runs.hits.length === 0) {
        runSection.appendChild(
          emptyState('No runs yet', 'File your first run to see it here.', h('a', { class: 'button', href: '#/runs/new' }, ['File your first run'])),
        );
      } else {
        runSection.appendChild(hitTable(runs.hits));
      }
      const projectSection = h('section', { class: 'card' }, [h('h2', {}, ['Projects'])]);
      if (projects.hits.length === 0) {
        projectSection.appendChild(emptyState('No projects yet', 'Create one while filing a run.'));
      } else {
        projectSection.appendChild(hitTable(projects.hits));
      }
      lists.replaceChildren(stats, h('div', { class: 'split' }, [runSection, projectSection]));
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      if (statusOf(error) === 403) {
        lists.replaceChildren(errorState('Access denied', asErrorMessage(error)));
        return;
      }
      lists.replaceChildren(
        errorState('Runs unavailable', asErrorMessage(error), { label: 'Retry', onClick: () => void load() }),
      );
    }
  };
  filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void load();
  });
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
  const requestedTemplate = ctx.params.get('template');
  if (templates.some(template => template.id === requestedTemplate)) { templateSelect.value = requestedTemplate ?? ''; applyTemplate(); }

  const project = field({ id: 'run-project', label: 'Project id', required: true, hint: 'Pick a known id or create one.' });
  project.input.setAttribute('list', 'project-options');
  const requestedProject = ctx.params.get('project');
  if (projects.hits.some(hit => hit.id === requestedProject)) project.input.value = requestedProject ?? '';
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
      return h('label', { class: 'check' }, [box, document.createTextNode(` ${repoId}`)]);
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
  const consentBox = h('input', { id: 'submit-consent', type: 'checkbox' }, []);
  const submitButton = h('button', { id: 'submit-run', class: 'button primary', type: 'button' }, ['Submit run']);
  const submitAlert = h('div', {}, []);
  const submitResult = h('div', { id: 'submit-receipt', 'aria-live': 'polite' }, []);
  const submitSection = h('section', { class: 'card' }, [
    h('h2', {}, ['Submit']),
    h('p', { class: 'muted' }, [
      'The submit is immutable: retries reference the same bytes, and a changed submit is a new digest. ',
      `Grant version ${String(actor.grantVersion)} · key `,
      h('code', { class: 'inline', id: 'idempotency-key' }, [key]),
    ]),
    h('div', { class: 'field' }, [h('span', {}, ['Repositories']), repoBoxes]),
    sources.wrap,
    intentRef.wrap,
    invariants.wrap,
    plan.wrap,
    budgetProfile.wrap,
    h('div', { class: 'field' }, [h('label', { for: 'execution-mode' }, ['Execution mode']), executionMode]),
    requestedBudget.wrap,
    h('label', { class: 'check' }, [consentBox, document.createTextNode(' Publication consent')]),
    submitAlert,
    h('p', {}, [submitButton]),
    submitResult,
  ]);
  if (actor.role === 'viewer') {
    submitButton.disabled = true;
    submitAlert.replaceChildren(
      h('p', { class: 'error-text', role: 'alert' }, ['Viewers may read runs but cannot submit.']),
    );
  } else if (grants.length === 0) {
    submitButton.disabled = true;
    submitAlert.replaceChildren(
      h('p', { class: 'error-text', role: 'alert' }, [
        'No repositories are granted to this organization yet. Ask an owner to connect one, then return here.',
      ]),
    );
  }

  submitButton.addEventListener('click', () => {
    submitButton.disabled = true;
    void (async () => {
      try {
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
            h('a', { class: 'button', href: '#/runs/new' }, ['File another run']),
          ]),
        );
      } catch (error) {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        showAlert(submitAlert, asErrorMessage(error));
      } finally {
        if (submitButton.isConnected) submitButton.disabled = false;
      }
    })();
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

  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, ['File a run']),
      h('p', { class: 'muted' }, ['Template, project, versioned draft, then one immutable submit.']),
      h('div', { class: 'field' }, [h('label', { for: 'run-template' }, ['Template']), templateSelect]),
      templateFields,
    ]),
    h('section', { class: 'card' }, [
      h('h2', {}, ['Project']),
      project.wrap,
      projectOptions,
      newProject.wrap,
      projectAlert,
      h('p', {}, [createProjectButton]),
    ]),
    h('section', { class: 'card' }, [
      h('h2', {}, ['Draft']),
      draftAlert,
      intent.wrap,
      notes.wrap,
      budget.wrap,
      env.wrap,
      readiness.wrap,
      profile.wrap,
      h('p', {}, [saveDraftButton]),
      draftResult,
      h('h3', {}, ['Recent drafts']),
      recentList,
    ]),
    submitSection,
  );
  // Preserve the protected fields/handlers while matching the source's
  // main form + independent summary composition.
  const sections = [...outlet.children];
  const main = h('div', { class: 'run-form-main' });
  const summary = h('aside', { class: 'card run-form-summary', 'aria-label': 'Submission and proof requirements' }, [h('span', { class: 'mini-label' }, ['BEFORE YOU SUBMIT']), h('h2', {}, ['Scope, consent, and proof.']), h('p', {}, ['Save a versioned draft first. Submission preserves its exact identity and your current grants.']), h('p', {}, ['Muse and Modal are not configured for live repair in this demo. A queued run is not a verified repair.']), h('a', { href: '#/p/verification' }, ['Read the verification requirements'])]);
  main.append(...sections);
  outlet.replaceChildren(h('div', { class: 'form-grid run-form-layout' }, [main, summary]));

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

async function renderDetail(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const runId = ctx.params.get('id');
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
  const header = h('section', { class: 'card' }, []);
  const actions = h('div', {}, []);
  const actionNote = h('div', { 'aria-live': 'polite' }, []);
  const eventsList = h('div', { id: 'events-list', class: 'timeline' }, []);
  const pollNote = h('div', { id: 'poll-note', 'aria-live': 'polite' }, []);
  const review = h('section', { class: 'card' }, [
    h('div', { class: 'eyebrow' }, ['Deterministic Policy']),
    h('h2', {}, ['Review']),
    h('p', {}, [
      'No assessment records on this run yet — events above are the complete record. ',
      'Target and bundle verdicts need the review aggregation backend, which is not exposed yet.',
    ]),
  ]);

  const renderHeader = (current: RunDetail): void => {
    header.replaceChildren(
      h('div', { class: 'eyebrow' }, ['Run Manifest & Lifecycle']),
      h('h1', {}, ['Run']),
      h('p', {}, [stateBadge(current.state), document.createTextNode(` version ${String(current.version)}`)]),
      h('dl', { class: 'detail-list' }, [
        h('dt', {}, ['Run id']),
        h('dd', {}, [h('code', { class: 'inline' }, [current.runId])]),
        h('dt', {}, ['Draft']),
        h('dd', {}, [
          h('a', { href: `#/runs/new?draft=${encodeURIComponent(current.draftId)}` }, [
            `${current.draftId} · revision ${String(current.draftRevision)}`,
          ]),
        ]),
        h('dt', {}, ['Submit digest']),
        h('dd', {}, [h('code', { class: 'inline' }, [current.submitDigest])]),
        h('dt', {}, ['Repositories']),
        h('dd', {}, [current.repositoryIds.join(', ')]),
        h('dt', {}, ['Created']),
        h('dd', {}, [current.createdAt]),
        ...(current.jobId === undefined ? [] : [h('dt', {}, ['Job']), h('dd', {}, [h('code', { class: 'inline' }, [current.jobId])])]),
        ...(current.reservationId === undefined
          ? []
          : [h('dt', {}, ['Reservation']), h('dd', {}, [h('code', { class: 'inline' }, [current.reservationId])])]),
      ]),
      h('p', { class: 'btn-row' }, [
        h('a', { class: 'button', href: `#/evidence?run=${encodeURIComponent(current.runId)}` }, ['Open the evidence library']),
        h('a', { class: 'button', href: `#/threads?run=${encodeURIComponent(current.runId)}` }, ['Open discussions']),
      ]),
    );
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
  const eventsCard = h('section', { class: 'card' }, [
    h('div', { class: 'eyebrow' }, ['Live Execution Stream']),
    h('h2', {}, ['Events']),
    eventsList,
    pollNote,
  ]);
  outlet.replaceChildren(header, h('section', { class: 'card' }, [actions, actionNote]), h('div', { class: 'split' }, [eventsCard, review]));

  let cursor = 0;
  let failures = 0;
  let stopped = false;

  const appendEvents = (events: readonly RunEventItem[]): boolean => {
    let terminal = false;
    for (const event of events) {
      eventsList.appendChild(eventArticle(runId, event));
      if (TERMINAL.has(event.kind)) terminal = true;
    }
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
    path: '/run',
    title: 'Run detail',
    render: (outlet, ctx) => {
      void renderDetail(outlet, ctx);
    },
  });
}
