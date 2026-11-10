/* Workspace overview + project/topology pages (Progress UI 5).
 * #/dashboard: welcome panel, quick actions, stat cards, recent runs.
 * #/projects: searchable project grid. Tab family shared by
 * #/project-detail, #/repositories, #/capabilities, #/environments,
 * #/telemetry, #/characterization, #/project-settings.
 * DOM shapes follow .template-ui/mockup.html with classes verified in
 * tokens.css (.overview-grid, .welcome-panel.workspace-focus,
 * .workspace-live-summary, .quick-card/.quick-action, .stats/.stat,
 * .dashboard-run-table, .dashboard-mobile-runs/.mobile-run,
 * .project-grid/.project-card/.project-mark/.create-card/.metric-row,
 * .route-tabs, .map-flow/.repo-node/.map-edge, .listrow, .meter,
 * .compact-detail). Every API read is defensive: malformed or missing
 * data renders an honest empty/error state, never invented content.
 * All copy is English (FR3-40); dynamic text renders via textContent. */

import { apiGet, apiPatch, apiPost, ApiRequestError } from '../api.js';
import {
  badge,
  card,
  drawer,
  emptyState,
  errorState,
  field,
  h,
  iconSvg,
  padcard,
  pageHead,
  pillIcon,
  row,
  staticBadge,
  table,
  tabs,
} from '../components.js';
import { registerRoute, type RouteContext } from '../routes.js';

interface WorkspaceSession {
  readonly authenticated: boolean;
}

function asErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
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

async function readSession(): Promise<WorkspaceSession> {
  return apiGet<WorkspaceSession>('/api/auth/session');
}

/* Defensive JSON narrowing: API payloads are untrusted (NEG3-21). */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const found = asNumber(record[key]);
    if (found !== null) return found;
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const found = asString(record[key]);
    if (found !== null) return found;
  }
  return null;
}

function note(text = ''): HTMLElement {
  return h('p', { 'aria-live': 'polite' }, [text]);
}

/* Project tab family (mockup projectTabs, extended with Capabilities and
 * Characterization per the workspace plan). The ?id= project context is
 * carried across tabs when present. */

const PROJECT_TABS: readonly { readonly id: string; readonly label: string; readonly path: string }[] = [
  { id: 'project-detail', label: 'Overview', path: '/project-detail' },
  { id: 'repositories', label: 'Repositories', path: '/repositories' },
  { id: 'capabilities', label: 'Capabilities', path: '/capabilities' },
  { id: 'environments', label: 'Environment', path: '/environments' },
  { id: 'telemetry', label: 'Telemetry', path: '/telemetry' },
  { id: 'characterization', label: 'Characterization', path: '/characterization' },
  { id: 'project-settings', label: 'Settings', path: '/project-settings' },
];

function projectTabs(currentId: string, projectId: string | null): HTMLElement {
  const suffix = projectId === null ? '' : `?id=${encodeURIComponent(projectId)}`;
  return tabs(
    PROJECT_TABS.map((tab) => ({ id: tab.id, label: tab.label, href: `#${tab.path}${suffix}` })),
    currentId,
  );
}

function projectIdOf(ctx: RouteContext): string | null {
  const id = ctx.params.get('id');
  return id === undefined || id === '' ? null : id;
}

function statCard(label: string, value: string, help: string, icon: 'runs' | 'clock' | 'check' | 'usage'): HTMLElement {
  return h('section', { class: 'card stat' }, [
    h('div', { class: 'stat-top' }, [h('span', { class: 'label' }, [label]), pillIcon(icon)]),
    h('div', { class: 'value' }, [value]),
    h('div', { class: 'help' }, [help]),
  ]);
}

/* Dashboard ---------------------------------------------------------- */

interface DashboardRun {
  readonly runId: string;
  readonly title: string;
  readonly state: string;
  readonly result: string | null;
  readonly updated: string;
}

function parseDashboardRuns(data: unknown): DashboardRun[] | null {
  const record = asRecord(data);
  const list = asArray(data) ?? (record === null ? null : asArray(record['runs']) ?? asArray(record['items']));
  if (list === null) return null;
  const runs: DashboardRun[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (item === null) return null;
    const runId = firstString(item, ['runId', 'id']);
    if (runId === null) return null;
    runs.push({
      runId,
      title: firstString(item, ['title', 'name']) ?? 'Untitled run',
      state: firstString(item, ['state', 'status']) ?? 'unknown',
      result: firstString(item, ['result', 'outcome']),
      updated: firstString(item, ['updatedAt', 'createdAt']) ?? 'date unknown',
    });
  }
  return runs;
}

interface BillingSummary {
  readonly used: number | null;
  readonly limit: number | null;
}

function parseBillingSummary(data: unknown): BillingSummary | null {
  const record = asRecord(data);
  if (record === null) return null;
  return {
    used: firstNumber(record, ['used', 'consumed']),
    limit: firstNumber(record, ['limit', 'cap']),
  };
}

interface ConnectionStatus {
  readonly total: number;
  readonly attention: number;
}

function parseConnectionStatus(data: unknown): ConnectionStatus | null {
  const record = asRecord(data);
  const list = asArray(data) ?? (record === null ? null : asArray(record['connections']) ?? asArray(record['items']));
  if (list === null) return null;
  let attention = 0;
  for (const entry of list) {
    const item = asRecord(entry);
    if (item === null) return null;
    if (firstString(item, ['status']) !== 'active') attention += 1;
  }
  return { total: list.length, attention };
}

function runStateBadge(state: string): HTMLElement {
  if (state === 'succeeded') return staticBadge(state, 'green');
  if (state === 'failed') return staticBadge(state, 'red');
  if (state === 'running' || state === 'queued') return staticBadge(state, 'blue');
  return staticBadge(state, '');
}

function quickAction(icon: 'plus' | 'runs' | 'evidence', title: string, sub: string, href: string): HTMLElement {
  const link = h('a', { class: 'quick-action', href }, [
    pillIcon(icon),
    h('span', {}, [title, h('small', {}, [sub])]),
  ]);
  link.appendChild(iconSvg('chevron'));
  return link;
}

async function renderDashboard(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the workspace overview.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Workspace needs a login', 'Log in to see your runs, projects, and credits.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Workspace unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderDashboard(outlet),
      }),
    );
    return;
  }

  const [runsSettled, billingSettled, connectionsSettled] = await Promise.allSettled([
    apiGet<unknown>('/api/runs'),
    apiGet<unknown>('/api/billing/summary'),
    apiGet<unknown>('/api/github/connections'),
  ]);
  const runs = runsSettled.status === 'fulfilled' ? parseDashboardRuns(runsSettled.value) : null;
  const runsError = runsSettled.status === 'rejected' ? asErrorMessage(runsSettled.reason) : 'The run list was unreadable.';
  const billing = billingSettled.status === 'fulfilled' ? parseBillingSummary(billingSettled.value) : null;
  const connections =
    connectionsSettled.status === 'fulfilled' ? parseConnectionStatus(connectionsSettled.value) : null;

  const running = runs === null ? 0 : runs.filter((run) => run.state === 'running').length;
  const queued = runs === null ? 0 : runs.filter((run) => run.state === 'queued').length;
  const finished =
    runs === null ? 0 : runs.filter((run) => run.state === 'succeeded' || run.state === 'failed' || run.state === 'cancelled').length;

  const attentionCount = running + queued;
  const attentionLine =
    runs === null
      ? 'Welcome to your workspace.'
      : attentionCount === 1
        ? '1 run needs attention.'
        : `${String(attentionCount)} runs need attention.`;
  const finishedLine =
    runs === null
      ? 'Run data is unavailable right now. Queued work below may be stale; retry to refresh.'
      : finished === 1
        ? '1 finished run on record. Open the queue to continue where you left off.'
        : `${String(finished)} finished runs on record. Open the queue to continue where you left off.`;

  const welcomeCopy = h('div', { class: 'workspace-focus-copy' }, [
    h('div', { class: 'mini-label' }, ['WORKSPACE SUMMARY']),
    h('h2', {}, [attentionLine]),
    h('p', {}, [finishedLine]),
    h('div', { class: 'actions' }, [
      h('a', { class: 'button primary', href: '#/runs' }, ['Open run queue']),
      h('a', { href: '#/runs' }, [running > 0 ? 'Monitor active runs' : 'See all runs']),
    ]),
  ]);

  const liveSummary = h('div', { class: 'workspace-live-summary' }, [
    h('div', { class: 'live-summary-caption' }, ['LIVE ACTIVITY']),
    h('div', { class: 'live-summary-row' }, [
      h('i', { class: runs === null ? 'live-dot' : 'live-dot is-running', 'aria-hidden': 'true' }, []),
      h('span', {}, [h('strong', {}, [runs === null ? '—' : String(running)]), running === 1 ? ' run running' : ' runs running']),
    ]),
    h('div', { class: 'live-summary-row' }, [
      h('i', { class: 'live-dot queued-dot', 'aria-hidden': 'true' }, []),
      h('span', {}, [h('strong', {}, [runs === null ? '—' : String(queued)]), ' queued']),
    ]),
  ]);
  if (connections === null) {
    liveSummary.appendChild(
      h('div', { class: 'live-summary-row' }, [h('span', {}, ['Repository status unknown'])]),
    );
  } else if (connections.total === 0) {
    liveSummary.appendChild(
      h('div', { class: 'live-summary-row' }, [h('a', { href: '#/repositories' }, ['No GitHub connections yet'])]),
    );
  } else if (connections.attention > 0) {
    const alert = h('a', { class: 'live-summary-alert', href: '#/repositories' }, [
      h(
        'span',
        {},
        [
          connections.attention === 1
            ? '1 connection needs attention'
            : `${String(connections.attention)} connections need attention`,
        ],
      ),
    ]);
    alert.prepend(iconSvg('git'));
    alert.appendChild(iconSvg('chevron'));
    liveSummary.appendChild(alert);
  } else {
    const clear = h('div', { class: 'live-summary-clear' }, [h('span', {}, ['Repository connections active'])]);
    clear.prepend(iconSvg('check'));
    liveSummary.appendChild(clear);
  }

  const overview = h('div', { class: 'overview-grid' }, [
    h('section', { class: 'welcome-panel workspace-focus' }, [welcomeCopy, liveSummary]),
    h('section', { class: 'quick-card' }, [
      h('div', { class: 'mini-label' }, ['MAKE YOUR NEXT MOVE']),
      h('h2', {}, ['Quick actions']),
      quickAction('plus', 'File a run', 'Issue, PR, or change intent', '#/runs/new'),
      quickAction('runs', 'Review runs', 'Queue and run history', '#/runs'),
      quickAction('evidence', 'Browse evidence', 'Manifests and verification results', '#/evidence'),
    ]),
  ]);

  const creditsUsed = billing?.used ?? null;
  const creditsLimit = billing?.limit ?? null;
  const creditsValue =
    creditsUsed !== null && creditsLimit !== null
      ? `${String(creditsUsed)} / ${String(creditsLimit)}`
      : 'Unavailable';
  const stats = h('div', { class: 'stats' }, [
    statCard('Active runs', runs === null ? '—' : String(running), runs === null ? 'Run list unavailable' : 'Running now', 'runs'),
    statCard('Queued runs', runs === null ? '—' : String(queued), runs === null ? 'Run list unavailable' : 'Waiting for a slot', 'clock'),
    statCard(
      'Finished runs',
      runs === null ? '—' : String(finished),
      runs === null ? 'Run list unavailable' : 'Reached a terminal state',
      'check',
    ),
    statCard('Credits used', creditsValue, billing === null ? 'Billing summary unavailable' : 'This billing period', 'usage'),
  ]);

  const recentBody = h('div', {}, []);
  if (runs === null) {
    recentBody.replaceChildren(
      errorState('Recent runs unavailable', runsError, {
        label: 'Retry',
        onClick: () => void renderDashboard(outlet),
      }),
    );
  } else if (runs.length === 0) {
    recentBody.replaceChildren(
      emptyState('No runs yet', 'File your first run to see it here.', h('a', { class: 'button', href: '#/runs/new' }, ['File a run'])),
    );
  } else {
    const recent = runs.slice(0, 4);
    const wrapped = table(
      ['Change', 'Status', 'Result', 'Updated'],
      recent.map((run) => [
        h('div', {}, [
          h('div', { class: 'run-id mono' }, [run.runId]),
          h('a', { class: 'run-title dashboard-run-title', href: `#/run?id=${encodeURIComponent(run.runId)}` }, [run.title]),
        ]),
        runStateBadge(run.state),
        run.result ?? '—',
        run.updated,
      ]),
    );
    wrapped.classList.add('dashboard-run-table');
    const mobile = h('div', { class: 'dashboard-mobile-runs' }, []);
    for (const run of recent) {
      mobile.appendChild(
        h('a', { class: 'mobile-run', href: `#/run?id=${encodeURIComponent(run.runId)}` }, [
          h('div', { class: 'mobile-run-top' }, [h('span', {}, [run.runId]), runStateBadge(run.state)]),
          h('strong', {}, [run.title]),
          h('small', {}, [run.result ?? 'No result reported', h('span', {}, [run.updated])]),
        ]),
      );
    }
    recentBody.replaceChildren(wrapped, mobile);
  }
  const recent = card(
    'Recent runs',
    recentBody,
    undefined,
    h('a', { href: '#/runs', style: 'font-size:10px' }, ['All runs →']),
  );

  outlet.replaceChildren(
    pageHead({
      title: 'Workspace overview',
      subtitle: 'Every important change, in one view.',
    }),
    overview,
    stats,
    recent,
  );
}

/* Projects ----------------------------------------------------------- */

interface ProjectHit {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly createdAt: string;
}

function parseProjectHits(data: unknown): ProjectHit[] | null {
  const record = asRecord(data);
  const list = record === null ? null : asArray(record['hits']);
  if (list === null) return null;
  const hits: ProjectHit[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (item === null) return null;
    const id = asString(item['id']);
    if (id === null) return null;
    hits.push({
      id,
      title: asString(item['title']) ?? 'Untitled project',
      snippet: asString(item['snippet']) ?? 'No description reported.',
      createdAt: asString(item['createdAt']) ?? 'date unknown',
    });
  }
  return hits;
}

function projectCard(hit: ProjectHit): HTMLElement {
  const mark = h('span', { class: 'project-mark', 'aria-hidden': 'true' }, []);
  mark.appendChild(iconSvg('projects'));
  return h('article', { class: 'card project-card' }, [
    h('div', { class: 'project-card-top section-row', style: 'margin:0' }, [mark, staticBadge('project', 'blue')]),
    h('h2', {}, [hit.title]),
    h('p', {}, [hit.snippet]),
    h('div', { class: 'metric-row' }, [
      h('span', {}, [h('strong', {}, [hit.createdAt.slice(0, 10)]), h('small', {}, ['CREATED'])]),
      h('span', {}, [h('strong', {}, [hit.id.slice(0, 12)]), h('small', {}, ['PROJECT ID'])]),
    ]),
    h('div', { class: 'bottom-actions' }, [
      h('a', { class: 'button small', href: `#/project-detail?id=${encodeURIComponent(hit.id)}` }, ['Open']),
      h('a', { href: '#/runs/new' }, ['File a run']),
    ]),
  ]);
}

function createProjectCard(): HTMLElement {
  return h('article', { class: 'card project-card create-card' }, [
    pillIcon('plus'),
    h('h2', {}, ['New project']),
    h('p', {}, ['Projects are created while filing a run.']),
    h('p', {}, [h('a', { class: 'button small', href: '#/runs/new' }, ['File a run'])]),
  ]);
}

function openProjectFilter(trigger: HTMLElement, current: string, onApply: (text: string) => void): void {
  const input = field({ id: 'project-filter-text', label: 'Filter text' });
  input.input.value = current;
  const form = h('form', { id: 'project-filter-form' }, [
    input.wrap,
    h('p', { class: 'help' }, ['Matches project names and descriptions.']),
  ]);
  const applyFooter = h('div', {}, [
    h('button', { class: 'button primary', type: 'submit', form: 'project-filter-form' }, ['Apply filter']),
  ]);
  const handle = drawer(trigger, 'Filter projects', h('div', {}, [form]), applyFooter);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onApply(input.input.value.trim());
    handle.close();
  });
}

async function renderProjects(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading projects.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Projects need a login', 'Log in to see this workspace’s projects.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Projects unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderProjects(outlet, ctx),
      }),
    );
    return;
  }

  let filterText = ctx.params.get('text') ?? '';
  const filterButton = h('button', { class: 'button small tonal-action', type: 'button' }, ['Filter']);
  filterButton.prepend(iconSvg('filter'));
  const createButton = h('a', { class: 'button primary', href: '#/runs/new' }, ['New project']);
  const countSpan = h('span', { class: 'muted section-desc', style: 'font-size:11px' }, ['']);
  const toolbar = h('div', { class: 'section-row' }, [
    countSpan,
    h('div', { class: 'project-list-tools' }, [filterButton, createButton]),
  ]);
  const head = pageHead({
    title: 'Projects',
    subtitle: 'Repositories, readiness, and verification setup per project.',
  });
  head.classList.add('project-heading');
  const gridHost = h('div', {}, []);
  outlet.replaceChildren(head, toolbar, gridHost);

  const load = async (): Promise<void> => {
    gridHost.replaceChildren(emptyState('Loading…', 'Searching projects.'));
    let hits: ProjectHit[];
    try {
      const data = await apiPost<unknown>('/api/search', {
        schemaVersion: '1',
        scope: 'projects',
        limit: 20,
        ...(filterText === '' ? {} : { text: filterText }),
      });
      const parsed = parseProjectHits(data);
      if (parsed === null) throw new Error('The project list was unreadable.');
      hits = parsed;
    } catch (error) {
      countSpan.textContent = '';
      gridHost.replaceChildren(
        errorState('Projects unavailable', asErrorMessage(error), { label: 'Retry', onClick: () => void load() }),
      );
      return;
    }
    const grid = h('div', { class: 'project-grid' }, []);
    if (hits.length === 0) {
      countSpan.textContent = filterText === '' ? 'No projects yet.' : `No projects match “${filterText}”.`;
      grid.replaceChildren(createProjectCard());
      gridHost.replaceChildren(grid);
      return;
    }
    for (const hit of hits) grid.appendChild(projectCard(hit));
    grid.appendChild(createProjectCard());
    countSpan.textContent = `${String(hits.length)} ${hits.length === 1 ? 'project' : 'projects'} in this workspace.`;
    gridHost.replaceChildren(grid);
  };

  filterButton.addEventListener('click', () => {
    openProjectFilter(filterButton, filterText, (text) => {
      filterText = text;
      void load();
    });
  });
  await load();
}

/* Project detail ----------------------------------------------------- */

interface TopologyRepo {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly status: string;
}

interface ReadinessItem {
  readonly label: string;
  readonly status: string;
}

interface ProjectDetail {
  readonly name: string;
  readonly description: string;
  readonly repositories: readonly TopologyRepo[];
  readonly readiness: readonly ReadinessItem[];
  readonly baselineRevision: string | null;
  readonly baselinePinnedAt: string | null;
}

function parseProjectDetail(data: unknown): ProjectDetail | null {
  const record = asRecord(data);
  if (record === null) return null;
  const repositories: TopologyRepo[] = [];
  const repoList = asArray(record['repositories']) ?? [];
  for (const entry of repoList) {
    const item = asRecord(entry);
    if (item === null) return null;
    const id = firstString(item, ['id', 'repositoryId']);
    if (id === null) return null;
    repositories.push({
      id,
      name: firstString(item, ['name', 'fullName']) ?? id,
      role: firstString(item, ['role', 'ownership']) ?? 'Not reported',
      status: firstString(item, ['status']) ?? 'unknown',
    });
  }
  const readiness: ReadinessItem[] = [];
  const readinessList = asArray(record['readiness']) ?? [];
  for (const entry of readinessList) {
    const item = asRecord(entry);
    if (item === null) return null;
    const label = firstString(item, ['label', 'check']);
    if (label === null) return null;
    readiness.push({ label, status: firstString(item, ['status', 'state']) ?? 'unknown' });
  }
  const baseline = asRecord(record['baseline']);
  return {
    name: firstString(record, ['name', 'title']) ?? 'Project overview',
    description: firstString(record, ['description', 'snippet']) ?? 'No description reported.',
    repositories,
    readiness,
    baselineRevision: baseline === null ? null : firstString(baseline, ['revision', 'ref']),
    baselinePinnedAt: baseline === null ? null : firstString(baseline, ['pinnedAt', 'createdAt']),
  };
}

function readinessBadge(status: string): HTMLElement {
  if (status === 'ready' || status === 'passed' || status === 'complete') return badge('ok', status);
  if (status === 'failed' || status === 'blocked' || status === 'missing') return badge('bad', status);
  return badge('info', status);
}

function openRepoDrawer(trigger: HTMLElement, repo: TopologyRepo): void {
  drawer(
    trigger,
    repo.name,
    h('div', {}, [
      row('Repository id', h('code', {}, [repo.id])),
      row('Role', repo.role),
      row('Status', readinessBadge(repo.status)),
      h('p', { class: 'help' }, ['Connection health and webhooks live under the Repositories tab.']),
    ]),
  );
}

async function renderProjectDetail(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the project.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Project needs a login', 'Log in to see this project.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Project unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderProjectDetail(outlet, ctx),
      }),
    );
    return;
  }

  const projectId = projectIdOf(ctx);
  if (projectId === null) {
    outlet.replaceChildren(
      pageHead({ title: 'Project overview', subtitle: 'Topology, readiness, and baseline.' }),
      projectTabs('project-detail', null),
      emptyState('No project selected', 'Choose a project to see its topology and readiness.', h('a', { class: 'button', href: '#/projects' }, ['Open projects'])),
    );
    return;
  }

  const body = h('div', {}, [emptyState('Loading…', 'Reading project topology.')]);
  outlet.replaceChildren(
    pageHead({ title: 'Project overview', subtitle: 'Topology, readiness, and baseline.' }),
    projectTabs('project-detail', projectId),
    body,
  );

  let detail: ProjectDetail;
  try {
    detail = parseProjectDetail(await apiGet<unknown>(`/api/projects/${encodeURIComponent(projectId)}`)) ?? (() => {
      throw new Error('The project response was unreadable.');
    })();
  } catch (error) {
    body.replaceChildren(
      errorState('Project unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderProjectDetail(outlet, ctx),
      }),
    );
    return;
  }

  const title = outlet.querySelector('.pagehead h1');
  if (title !== null) title.textContent = detail.name;

  const flow = h('div', { class: 'map-flow' }, []);
  detail.repositories.forEach((repo, index) => {
    if (index > 0) flow.appendChild(h('div', { class: 'map-edge' }, ['calls']));
    const node = h('button', { class: 'repo-node', type: 'button' }, [
      h('strong', {}, [repo.name]),
      h('small', {}, [repo.role]),
      readinessBadge(repo.status),
    ]);
    node.prepend(iconSvg('git'));
    node.addEventListener('click', () => { openRepoDrawer(node, repo); });
    flow.appendChild(node);
  });
  const topologyCard =
    detail.repositories.length === 0
      ? card('Repository topology', emptyState('No topology reported', 'The project service did not report any repositories.'))
      : card('Repository topology', flow, 'Select a repository for details.');
  const readinessCard = padcard(
    'Readiness checklist',
    detail.readiness.length === 0
      ? h('p', {}, ['No readiness checks reported for this project.'])
      : h('div', {}, detail.readiness.map((item) => row(item.label, readinessBadge(item.status)))),
  );
  body.replaceChildren(
    h('div', { class: 'split' }, [
      h('div', { class: 'stack' }, [topologyCard, readinessCard]),
      h('aside', {}, [
        padcard(
          'Baseline',
          h('div', {}, [
            row('Revision', detail.baselineRevision ?? 'No baseline pinned'),
            row('Pinned', detail.baselinePinnedAt ?? '—'),
          ]),
        ),
        padcard(
          'Quick actions',
          h('div', {}, [
            h('p', {}, [h('a', { href: '#/runs/new' }, ['File a run →'])]),
            h('p', {}, [h('a', { href: '#/runs' }, ['View runs →'])]),
            h('p', {}, [h('a', { href: `#/project-settings?id=${encodeURIComponent(projectId)}` }, ['Project settings →'])]),
          ]),
        ),
      ]),
    ]),
  );
}

/* Repositories ------------------------------------------------------- */

interface RepositoryConnection {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly webhookState: string | null;
  readonly lastDelivery: string | null;
  readonly updatedAt: string;
}

function parseRepositoryConnections(data: unknown): RepositoryConnection[] | null {
  const record = asRecord(data);
  const list = asArray(data) ?? (record === null ? null : asArray(record['connections']) ?? asArray(record['items']));
  if (list === null) return null;
  const connections: RepositoryConnection[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (item === null) return null;
    const id = firstString(item, ['id', 'connectionId']);
    if (id === null) return null;
    const webhook = asRecord(item['webhook']);
    connections.push({
      id,
      name: firstString(item, ['name', 'fullName', 'repository']) ?? id,
      status: firstString(item, ['status']) ?? 'unknown',
      webhookState: webhook === null ? firstString(item, ['webhookState']) : firstString(webhook, ['state', 'status']),
      lastDelivery:
        webhook === null ? firstString(item, ['lastDelivery']) : firstString(webhook, ['lastDelivery', 'deliveredAt']),
      updatedAt: firstString(item, ['updatedAt', 'createdAt']) ?? 'date unknown',
    });
  }
  return connections;
}

function connectionBadge(status: string): HTMLElement {
  if (status === 'active') return badge('ok', status);
  if (status === 'revoked' || status === 'failed' || status === 'expired') return badge('bad', status);
  return badge('warn', status);
}

const INSTALL_ERROR_COPY: ReadonlyMap<string, string> = new Map([
  ['state_invalid', 'The install session expired or was forged. Start the install again.'],
  ['login_required', 'Sign in first, then start the install again.'],
  ['cancelled', 'The GitHub App install was cancelled. Nothing was connected.'],
  ['setup_rejected', 'GitHub did not complete an installation. Install the App, then retry.'],
  ['connect_unavailable', 'This server has no GitHub App key; an operator must provision it.'],
  ['installation_not_found', 'That installation is unknown to this GitHub App.'],
  ['github_unavailable', 'GitHub did not answer; retry the install later.'],
]);

/** One-shot banner for the install-callback landing (?connected=N / ?githubError=code). */
function installResultBanner(params: ReadonlyMap<string, string>): HTMLElement | null {
  const connected = params.get('connected') ?? '';
  if (/^[0-9]+$/.test(connected)) {
    const count = Number(connected);
    return h('div', { class: 'notice', role: 'status' }, [
      count === 1 ? 'Connected 1 repository.' : `Connected ${String(count)} repositories.`,
    ]);
  }
  const code = params.get('githubError') ?? '';
  if (code === '') return null;
  return h('div', { class: 'notice', role: 'alert' }, [INSTALL_ERROR_COPY.get(code) ?? 'The install did not complete; retry.']);
}

async function renderRepositories(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading repository connections.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Repositories need a login', 'Log in to manage GitHub connections.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Repositories unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderRepositories(outlet, ctx),
      }),
    );
    return;
  }

  const projectId = projectIdOf(ctx);
  const body = h('div', {}, []);
  outlet.replaceChildren(
    pageHead({
      title: 'GitHub connections',
      subtitle: 'Repository access, webhook health, and revocation.',
      actions: [h('a', { class: 'button primary', href: '/api/github/install/start' }, ['Install GitHub App'])],
    }),
    projectTabs('repositories', projectId),
    body,
  );
  const installResult = installResultBanner(ctx.params);
  if (installResult !== null) outlet.insertBefore(installResult, body);

  const load = async (): Promise<void> => {
    body.replaceChildren(emptyState('Loading…', 'Reading repository connections.'));
    let connections: RepositoryConnection[];
    try {
      const parsed = parseRepositoryConnections(await apiGet<unknown>('/api/github/connections'));
      if (parsed === null) throw new Error('The connection list was unreadable.');
      connections = parsed;
    } catch (error) {
      body.replaceChildren(
        errorState('Repositories unavailable', asErrorMessage(error), { label: 'Retry', onClick: () => void load() }),
      );
      return;
    }
    if (connections.length === 0) {
      body.replaceChildren(
        emptyState(
          'No connections',
          'Install the GitHub App on your repositories, then retry.',
          h('button', { class: 'button', type: 'button', id: 'connections-retry' }, ['Retry']),
        ),
      );
      body.querySelector('#connections-retry')?.addEventListener('click', () => void load());
      return;
    }
    const rows = connections.map((connection) => [
      h('strong', {}, [connection.name]),
      connectionBadge(connection.status),
      connection.webhookState ?? 'Not reported',
      connection.updatedAt,
    ]);
    const details = h('div', {}, []);
    for (const connection of connections) {
      const revokeNote = note();
      const revoke = h('button', { class: 'button danger', type: 'button' }, ['Revoke access']);
      revoke.addEventListener('click', () => {
        revoke.disabled = true;
        revokeNote.replaceChildren('Revoking…');
        void apiPost<unknown>(`/api/github/connections/${encodeURIComponent(connection.id)}/revoke`, {})
          .then(() => {
            revokeNote.replaceChildren(`${connection.name} revoked. Refreshing…`);
            void load();
          })
          .catch((error: unknown) => {
            revoke.disabled = false;
            revokeNote.replaceChildren(asErrorMessage(error));
          });
      });
      const panel = h('details', { class: 'compact-detail' }, [
        h('summary', {}, [`${connection.name} — webhooks and revocation`]),
        h('div', { class: 'card' }, [
          h('div', { class: 'pad' }, [
            row('Webhook state', connection.webhookState ?? 'Not reported'),
            row('Last delivery', connection.lastDelivery ?? 'Not reported'),
            row('Status', connectionBadge(connection.status)),
            h('p', { class: 'help' }, ['Revocation stops new runs immediately; queued work is cancelled.']),
            h('p', {}, [revoke]),
            revokeNote,
          ]),
        ]),
      ]);
      details.appendChild(panel);
    }
    body.replaceChildren(card('Repository connections', table(['Repository', 'Status', 'Webhook', 'Updated'], rows)), details);
  };
  const installNote = note();
  const connectButton = h('button', { class: 'button primary', type: 'button' }, ['Connect']);
  const connectPanel = h('details', { class: 'compact-detail' }, [
    h('summary', {}, ['Or connect with an installation id']),
    h('div', { class: 'card' }, [
      h('div', { class: 'pad' }, [
        h('p', { class: 'help' }, [
          'Installed the App directly from GitHub settings? Enter its numeric installation id instead. The server verifies it live before storing anything.',
        ]),
        h('p', {}, [
          h('input', {
            class: 'input',
            id: 'connect-installation-id',
            inputmode: 'numeric',
            autocomplete: 'off',
            placeholder: 'e.g. 178697398',
            'aria-label': 'Installation id',
          }),
          ' ',
          connectButton,
        ]),
        installNote,
      ]),
    ]),
  ]);
  connectButton.addEventListener('click', () => {
    const field = connectPanel.querySelector('input');
    const installationId = field?.value.trim() ?? '';
    if (!/^[1-9][0-9]*$/.test(installationId)) {
      installNote.replaceChildren('Enter the numeric installation id from the GitHub App settings page.');
      return;
    }
    connectButton.disabled = true;
    installNote.replaceChildren('Verifying with GitHub…');
    void apiPost<{ installationId: string; connectionIds: string[]; repositoryCount: number }>(
      '/api/github/connections',
      { installationId },
    )
      .then((created) => {
        installNote.replaceChildren(`Connected ${String(created.repositoryCount)} repositories. Refreshing…`);
        void load();
      })
      .catch((error: unknown) => {
        installNote.replaceChildren(asErrorMessage(error));
      })
      .finally(() => {
        connectButton.disabled = false;
      });
  });
  outlet.insertBefore(connectPanel, body);
  await load();
}

/* Capabilities ------------------------------------------------------- */

interface CapabilityRecord {
  readonly ecosystem: string;
  readonly framework: string;
  readonly version: string;
  readonly feature: string;
  readonly changeType: string;
  readonly targetLevel: string;
  readonly provenLevel: string;
}

function parseCapabilityRecords(data: unknown): CapabilityRecord[] | null {
  const record = asRecord(data);
  const list = asArray(data) ?? (record === null ? null : asArray(record['capabilities']) ?? asArray(record['items']));
  if (list === null) return null;
  const capabilities: CapabilityRecord[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (item === null) return null;
    const ecosystem = firstString(item, ['ecosystem']);
    if (ecosystem === null) return null;
    capabilities.push({
      ecosystem,
      framework: firstString(item, ['framework']) ?? 'Not reported',
      version: firstString(item, ['version']) ?? 'Not reported',
      feature: firstString(item, ['feature']) ?? 'Not reported',
      changeType: firstString(item, ['changeType', 'change_type']) ?? 'Not reported',
      targetLevel: firstString(item, ['targetLevel', 'target_level']) ?? 'unknown',
      provenLevel: firstString(item, ['provenLevel', 'proven_level']) ?? 'none',
    });
  }
  return capabilities;
}

function levelBadge(level: string): HTMLElement {
  if (level === 'L3') return badge('ok', level);
  if (level === 'L2') return badge('info', level);
  if (level === 'none' || level === 'unknown') return badge('warn', level);
  return badge('info', level);
}

function openLevelsDrawer(trigger: HTMLElement): void {
  drawer(
    trigger,
    'Understand support levels',
    h('div', {}, [
      h('p', {}, ['Target level is the support this release aims for. Proven level is what verification evidence actually shows. The two are assessed separately: a target is never proof.']),
      row('L1', 'Discovery, extraction, and impact analysis.'),
      row('L2', 'Candidate patch plus guard rails.'),
      row('L3', 'Full proof on the claimed stack.'),
      row('none', 'No evidence yet. New records start here.'),
      h('div', { class: 'drawer-note' }, ['Results from one stack never prove another stack. Versions are claimed and proven one tuple at a time.']),
    ]),
  );
}

async function renderCapabilities(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the capability matrix.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Capabilities need a login', 'Log in to see supported stacks.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Capabilities unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderCapabilities(outlet, ctx),
      }),
    );
    return;
  }

  const projectId = projectIdOf(ctx);
  const levelsButton = h('button', { class: 'button', type: 'button' }, ['Understand levels']);
  levelsButton.addEventListener('click', () => { openLevelsDrawer(levelsButton); });
  const body = h('div', {}, []);
  outlet.replaceChildren(
    pageHead({
      title: 'Capability matrix',
      subtitle: 'Claimed support next to proven support, per stack. Targets are not proof.',
      actions: [levelsButton],
    }),
    projectTabs('capabilities', projectId),
    body,
  );

  const load = async (): Promise<void> => {
    body.replaceChildren(emptyState('Loading…', 'Reading the capability matrix.'));
    let capabilities: CapabilityRecord[];
    try {
      const parsed = parseCapabilityRecords(await apiGet<unknown>('/api/support/capabilities'));
      if (parsed === null) throw new Error('The capability matrix was unreadable.');
      capabilities = parsed;
    } catch (error) {
      body.replaceChildren(
        errorState('Capabilities unavailable', asErrorMessage(error), { label: 'Retry', onClick: () => void load() }),
      );
      return;
    }
    if (capabilities.length === 0) {
      body.replaceChildren(emptyState('No capability records', 'No stack has a recorded support tuple yet.'));
      return;
    }
    body.replaceChildren(
      card(
        'Capability matrix',
        table(
          ['Ecosystem', 'Framework', 'Version', 'Feature', 'Change type', 'Target level', 'Proven level'],
          capabilities.map((capability) => [
            capability.ecosystem,
            capability.framework,
            capability.version,
            capability.feature,
            capability.changeType,
            levelBadge(capability.targetLevel),
            levelBadge(capability.provenLevel),
          ]),
        ),
        'Target level is claimed support; proven level is evidenced support.',
      ),
    );
  };
  await load();
}

/* Environments ------------------------------------------------------- */

interface EnvironmentService {
  readonly name: string;
  readonly engine: string;
  readonly ownership: string;
  readonly network: string;
}

interface EnvironmentProfile {
  readonly services: readonly EnvironmentService[];
  readonly dataset: string | null;
  readonly migration: string | null;
  readonly journal: string | null;
  readonly reset: string | null;
  readonly isolation: string | null;
  readonly egress: string | null;
  readonly dependencyFetch: string | null;
  readonly mounts: string | null;
  readonly cleanup: string | null;
  readonly wallTime: string | null;
  readonly attempts: string | null;
  readonly creditCap: string | null;
}

function parseEnvironmentProfile(data: unknown): EnvironmentProfile | null {
  const record = asRecord(data);
  if (record === null) return null;
  const services: EnvironmentService[] = [];
  const serviceList = asArray(record['services']) ?? [];
  for (const entry of serviceList) {
    const item = asRecord(entry);
    if (item === null) return null;
    const name = firstString(item, ['name', 'service']);
    if (name === null) return null;
    services.push({
      name,
      engine: firstString(item, ['engine', 'image']) ?? 'Not reported',
      ownership: firstString(item, ['ownership', 'owner']) ?? 'Not reported',
      network: firstString(item, ['network']) ?? 'Not reported',
    });
  }
  const boundary = asRecord(record['boundary']);
  const resources = asRecord(record['resources']);
  return {
    services,
    dataset: firstString(record, ['dataset', 'datasetRef']),
    migration: firstString(record, ['migration', 'migrationRevision']),
    journal: firstString(record, ['journal', 'operationJournal']),
    reset: firstString(record, ['reset', 'resetSemantics']),
    isolation: boundary === null ? null : firstString(boundary, ['isolation']),
    egress: boundary === null ? null : firstString(boundary, ['egress', 'externalEgress']),
    dependencyFetch: boundary === null ? null : firstString(boundary, ['dependencyFetch', 'fetch']),
    mounts: boundary === null ? null : firstString(boundary, ['mounts', 'protectedMounts']),
    cleanup: boundary === null ? null : firstString(boundary, ['cleanup']),
    wallTime: resources === null ? null : firstString(resources, ['wallTime']),
    attempts: resources === null ? null : firstString(resources, ['attempts']),
    creditCap: resources === null ? null : firstString(resources, ['creditCap']),
  };
}

function openEnvironmentDrawer(trigger: HTMLElement, profile: EnvironmentProfile | null): void {
  const name = field({ id: 'environment-name', label: 'Profile name' });
  const dataset = field({ id: 'environment-dataset', label: 'Dataset reference' });
  if (profile !== null && profile.dataset !== null) dataset.input.value = profile.dataset;
  const migration = field({ id: 'environment-migration', label: 'Migration revision' });
  if (profile !== null && profile.migration !== null) migration.input.value = profile.migration;
  const saveNote = note();
  const form = h('form', { id: 'environmentForm' }, [
    name.wrap,
    dataset.wrap,
    migration.wrap,
    h('div', { class: 'drawer-note' }, ['Saving creates a new profile revision. It never rewrites identities on historical evidence.']),
    saveNote,
  ]);
  const saveFooter = h('div', {}, [
    h('button', { class: 'button primary full', type: 'submit', form: 'environmentForm' }, ['Save revision']),
  ]);
  drawer(trigger, 'Edit environment profile', h('div', {}, [form]), saveFooter);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveNote.replaceChildren('Saving…');
    void apiPost<unknown>('/api/environments', {
      name: name.input.value.trim(),
      dataset: dataset.input.value.trim(),
      migration: migration.input.value.trim(),
    })
      .then(() => {
        saveNote.replaceChildren('Revision saved.');
      })
      .catch((error: unknown) => {
        saveNote.replaceChildren(asErrorMessage(error));
      });
  });
}

async function renderEnvironments(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the environment profile.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Environment needs a login', 'Log in to see the execution profile.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Environment unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderEnvironments(outlet, ctx),
      }),
    );
    return;
  }

  const projectId = projectIdOf(ctx);
  const editButton = h('button', { class: 'button primary', type: 'button' }, ['Edit profile']);
  const body = h('div', {}, []);
  let currentProfile: EnvironmentProfile | null = null;
  outlet.replaceChildren(
    pageHead({
      title: 'Environment & topology',
      subtitle: 'Pin services, dependencies, dataset, and resource profile before verification.',
      actions: [editButton],
    }),
    projectTabs('environments', projectId),
    body,
  );

  const load = async (): Promise<void> => {
    body.replaceChildren(emptyState('Loading…', 'Reading the environment profile.'));
    let profile: EnvironmentProfile;
    try {
      const parsed = parseEnvironmentProfile(await apiGet<unknown>('/api/environments'));
      if (parsed === null) throw new Error('The environment profile was unreadable.');
      profile = parsed;
    } catch (error) {
      body.replaceChildren(
        errorState('Environment unavailable', asErrorMessage(error), { label: 'Retry', onClick: () => void load() }),
      );
      return;
    }
    const serviceCard =
      profile.services.length === 0
        ? card('Service mapping', emptyState('No services pinned', 'Pin the services this project verifies.'))
        : card(
            'Service mapping',
            table(
              ['Service', 'Engine / image', 'Ownership', 'Network'],
              profile.services.map((service) => [service.name, service.engine, service.ownership, service.network]),
            ),
          );
    const dataCard = padcard(
      'Data & recovery prerequisites',
      h('div', {}, [
        row('Dataset identity', profile.dataset ?? 'Not reported'),
        row('Migration revision', profile.migration ?? 'Not reported'),
        row('Operation journal', profile.journal ?? 'Not reported'),
        row('Reset semantics', profile.reset ?? 'Not reported'),
        h('p', { class: 'help' }, ['Migrations run against a populated dataset with active readers and writers.']),
      ]),
    );
    const boundaryCard = padcard(
      'Execution boundary',
      h('div', {}, [
        row('Isolation', profile.isolation ?? 'Not reported'),
        row('External egress', profile.egress ?? 'Not reported'),
        row('Dependency fetch', profile.dependencyFetch ?? 'Not reported'),
        row('Protected mounts', profile.mounts ?? 'Not reported'),
        row('Cleanup', profile.cleanup ?? 'Not reported'),
      ]),
    );
    const resourcesCard = padcard(
      'Resource profile',
      h('div', {}, [
        row('Wall time', profile.wallTime ?? 'Not reported'),
        row('Attempts', profile.attempts ?? 'Not reported'),
        row('Credit cap', profile.creditCap ?? 'Not reported'),
        h('p', { class: 'help' }, ['CPU, memory, PIDs, disk, output, and reserve are set in the frozen execution manifest.']),
      ]),
    );
    body.replaceChildren(
      h('div', { class: 'split' }, [h('div', { class: 'stack' }, [serviceCard, dataCard]), h('aside', {}, [boundaryCard, resourcesCard])]),
    );
    currentProfile = profile;
  };
  editButton.addEventListener('click', () => { openEnvironmentDrawer(editButton, currentProfile); });
  await load();
}

/* Telemetry ---------------------------------------------------------- */

interface CorpusFile {
  readonly name: string;
  readonly kind: string;
  readonly sizeBytes: number | null;
  readonly addedAt: string;
}

interface CoverageGap {
  readonly area: string;
  readonly detail: string;
}

interface TelemetryCorpus {
  readonly files: readonly CorpusFile[];
  readonly gaps: readonly CoverageGap[];
}

function parseTelemetryCorpus(data: unknown): TelemetryCorpus | null {
  const record = asRecord(data);
  if (record === null) return null;
  const files: CorpusFile[] = [];
  const fileList = asArray(record['files']) ?? [];
  for (const entry of fileList) {
    const item = asRecord(entry);
    if (item === null) return null;
    const name = firstString(item, ['name', 'filename']);
    if (name === null) return null;
    files.push({
      name,
      kind: firstString(item, ['kind', 'type']) ?? 'Not reported',
      sizeBytes: firstNumber(item, ['sizeBytes', 'size']),
      addedAt: firstString(item, ['addedAt', 'createdAt']) ?? 'date unknown',
    });
  }
  const gaps: CoverageGap[] = [];
  const gapList = asArray(record['gaps']) ?? [];
  for (const entry of gapList) {
    const item = asRecord(entry);
    if (item === null) return null;
    const area = firstString(item, ['area', 'label']);
    if (area === null) return null;
    gaps.push({ area, detail: firstString(item, ['detail', 'description']) ?? 'Not reported' });
  }
  return { files, gaps };
}

function formatBytes(sizeBytes: number | null): string {
  if (sizeBytes === null) return 'Not reported';
  if (sizeBytes < 1024) return `${String(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${String(Math.round(sizeBytes / 1024))} KB`;
  return `${String(Math.round(sizeBytes / (1024 * 1024)))} MB`;
}

function openTelemetryDrawer(trigger: HTMLElement): void {
  const label = field({ id: 'telemetry-label', label: 'Source label' });
  const kindSelect = h('select', { id: 'telemetry-kind', name: 'telemetry-kind' }, [
    h('option', { value: 'log' }, ['Log']),
    h('option', { value: 'trace' }, ['Trace']),
    h('option', { value: 'metric' }, ['Metric']),
  ]);
  const kindWrap = h('div', { class: 'field' }, [h('label', { for: 'telemetry-kind' }, ['Kind']), kindSelect]);
  const fileInput = h('input', { type: 'file', id: 'telemetry-file', name: 'telemetry-file' });
  const fileWrap = h('div', { class: 'field' }, [h('label', { for: 'telemetry-file' }, ['Telemetry file']), fileInput]);
  const addNote = note();
  const form = h('form', { id: 'telemetryForm' }, [
    label.wrap,
    kindWrap,
    fileWrap,
    h('div', { class: 'drawer-note' }, ['Only file metadata is registered here. Never upload secrets or credentials.']),
    addNote,
  ]);
  const addFooter = h('div', {}, [
    h('button', { class: 'button primary full', type: 'submit', form: 'telemetryForm' }, ['Register file']),
  ]);
  drawer(trigger, 'Add telemetry', h('div', {}, [form]), addFooter);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const picked = fileInput.files?.[0] ?? null;
    if (picked === null) {
      addNote.replaceChildren('Choose a file first.');
      return;
    }
    addNote.replaceChildren('Registering…');
    void apiPost<unknown>('/api/telemetry/corpus', {
      name: picked.name,
      sizeBytes: picked.size,
      kind: kindSelect.value,
      label: label.input.value.trim(),
    })
      .then(() => {
        addNote.replaceChildren(`${picked.name} registered.`);
      })
      .catch((error: unknown) => {
        addNote.replaceChildren(asErrorMessage(error));
      });
  });
}

async function renderTelemetry(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the telemetry corpus.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Telemetry needs a login', 'Log in to see the telemetry corpus.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Telemetry unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderTelemetry(outlet, ctx),
      }),
    );
    return;
  }

  const projectId = projectIdOf(ctx);
  const addButton = h('button', { class: 'button primary', type: 'button' }, ['Add telemetry']);
  addButton.addEventListener('click', () => { openTelemetryDrawer(addButton); });
  const body = h('div', {}, []);
  outlet.replaceChildren(
    pageHead({
      title: 'Telemetry corpus',
      subtitle: 'Observed behavior the investigation can correlate. Gaps stay visible.',
      actions: [addButton],
    }),
    projectTabs('telemetry', projectId),
    body,
  );

  const load = async (): Promise<void> => {
    body.replaceChildren(emptyState('Loading…', 'Reading the telemetry corpus.'));
    let corpus: TelemetryCorpus;
    try {
      const parsed = parseTelemetryCorpus(await apiGet<unknown>('/api/telemetry/corpus'));
      if (parsed === null) throw new Error('The telemetry corpus was unreadable.');
      corpus = parsed;
    } catch (error) {
      body.replaceChildren(
        errorState('Telemetry unavailable', asErrorMessage(error), { label: 'Retry', onClick: () => void load() }),
      );
      return;
    }
    const corpusCard =
      corpus.files.length === 0
        ? card('Telemetry corpus', emptyState('No telemetry yet', 'Register logs, traces, or metrics to seed correlations.'))
        : card(
            'Telemetry corpus',
            table(
              ['File', 'Kind', 'Size', 'Added'],
              corpus.files.map((file) => [file.name, file.kind, formatBytes(file.sizeBytes), file.addedAt]),
            ),
          );
    const gapsCard = padcard(
      'Coverage gaps',
      corpus.gaps.length === 0
        ? h('p', {}, ['No gap analysis reported. Missing telemetry stays visible instead of assumed.'])
        : h('div', {}, corpus.gaps.map((gap) => row(gap.area, gap.detail))),
    );
    body.replaceChildren(h('div', { class: 'split' }, [corpusCard, h('aside', {}, [gapsCard])]));
  };
  await load();
}

/* Characterization --------------------------------------------------- */

async function renderCharacterization(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading characterization.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Characterization needs a login', 'Log in to see legacy characterization.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Characterization unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderCharacterization(outlet, ctx),
      }),
    );
    return;
  }

  const projectId = projectIdOf(ctx);
  outlet.replaceChildren(
    pageHead({
      title: 'Legacy characterization',
      subtitle: 'Understand system behavior before repair. Diagnosis only — no code changes.',
      actions: [h('a', { class: 'button primary', href: '#/runs/new' }, ['Start from a run draft'])],
    }),
    projectTabs('characterization', projectId),
    h('div', { class: 'split' }, [
      padcard(
        'Diagnosis only, by design',
        h('div', {}, [
          h('p', {}, ['Characterization ranks hypotheses about legacy behavior and records the evidence gaps for each one. It never modifies code, never declares a fix, and never invents an oracle from observed behavior.']),
          row('Produces', 'Ranked hypotheses with evidence gaps'),
          row('Requires', 'Domain validation before any repair'),
          row('Never', 'Changes code or weakens checks'),
          h('p', { class: 'help' }, ['Unknown behavior contracts stay labeled behavior_contract_unknown: diagnosis only.']),
        ]),
      ),
      h('aside', {}, [
        padcard(
          'What you receive',
          h('div', {}, [
            row('Hypothesis ledger', 'Ranked, with confidence gaps'),
            row('Evidence gaps', 'Listed per hypothesis'),
            row('Next safe step', 'Named explicitly'),
          ]),
        ),
        padcard(
          'Limits',
          h('div', {}, [
            row('No repairs', 'File a run to propose fixes'),
            row('No verdicts', 'Only the verifier proves outcomes'),
          ]),
        ),
      ]),
    ]),
  );
}

/* Project settings --------------------------------------------------- */

async function renderProjectSettings(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading project settings.'));
  try {
    const session = await readSession();
    if (!session.authenticated) {
      loginCard(outlet, 'Project settings need a login', 'Log in to edit this project.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Project settings unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderProjectSettings(outlet, ctx),
      }),
    );
    return;
  }

  const projectId = projectIdOf(ctx);
  if (projectId === null) {
    outlet.replaceChildren(
      pageHead({ title: 'Project settings', subtitle: 'Name, description, and danger zone.' }),
      projectTabs('project-settings', null),
      emptyState('No project selected', 'Choose a project to edit its settings.', h('a', { class: 'button', href: '#/projects' }, ['Open projects'])),
    );
    return;
  }

  const body = h('div', {}, [emptyState('Loading…', 'Reading project settings.')]);
  outlet.replaceChildren(
    pageHead({ title: 'Project settings', subtitle: 'Name, description, and danger zone.' }),
    projectTabs('project-settings', projectId),
    body,
  );

  let detail: ProjectDetail;
  try {
    const parsed = parseProjectDetail(await apiGet<unknown>(`/api/projects/${encodeURIComponent(projectId)}`));
    if (parsed === null) throw new Error('The project response was unreadable.');
    detail = parsed;
  } catch (error) {
    body.replaceChildren(
      errorState('Project settings unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderProjectSettings(outlet, ctx),
      }),
    );
    return;
  }

  const name = field({ id: 'project-settings-name', label: 'Project name' });
  name.input.value = detail.name;
  const descriptionInput = h('textarea', { id: 'project-settings-description', name: 'project-settings-description', rows: '3' }, []);
  descriptionInput.value = detail.description;
  const descriptionWrap = h('div', { class: 'field' }, [
    h('label', { for: 'project-settings-description' }, ['Description']),
    descriptionInput,
  ]);
  const saveNote = note();
  const form = h('form', { id: 'projectSettingsForm' }, [
    name.wrap,
    descriptionWrap,
    h('p', {}, [h('button', { class: 'button primary', type: 'submit' }, ['Save settings'])]),
    saveNote,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveNote.replaceChildren('Saving…');
    void apiPatch<unknown>(`/api/projects/${encodeURIComponent(projectId)}`, {
      name: name.input.value.trim(),
      description: descriptionInput.value.trim(),
    })
      .then(() => {
        saveNote.replaceChildren('Settings saved.');
      })
      .catch((error: unknown) => {
        saveNote.replaceChildren(asErrorMessage(error));
      });
  });
  body.replaceChildren(
    h('div', { class: 'split' }, [
      h('section', { class: 'card' }, [h('div', { class: 'form-section' }, [h('h2', {}, ['General']), form])]),
      h('aside', {}, [
        padcard(
          'Danger zone',
          h('div', {}, [h('p', {}, ['Project deletion is not available in this release. Nothing here deletes data.'])]),
        ),
      ]),
    ]),
  );
}

export function registerWorkspacePages(): void {
  registerRoute({ path: '/dashboard', title: 'Workspace overview', navLabel: 'Overview', navSection: 'workspace', render: renderDashboard });
  registerRoute({ path: '/projects', title: 'Projects', navLabel: 'Projects', navSection: 'workspace', render: renderProjects });
  registerRoute({ path: '/project-detail', title: 'Project overview', render: renderProjectDetail });
  registerRoute({ path: '/repositories', title: 'GitHub connections', render: renderRepositories });
  registerRoute({ path: '/capabilities', title: 'Capability matrix', render: renderCapabilities });
  registerRoute({ path: '/environments', title: 'Environment & topology', render: renderEnvironments });
  registerRoute({ path: '/telemetry', title: 'Telemetry corpus', render: renderTelemetry });
  registerRoute({ path: '/characterization', title: 'Legacy characterization', render: renderCharacterization });
  registerRoute({ path: '/project-settings', title: 'Project settings', render: renderProjectSettings });
}
