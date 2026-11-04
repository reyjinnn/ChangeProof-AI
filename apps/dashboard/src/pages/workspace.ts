/* Workspace routes backed by the existing HTTP boundary. No mockup tenant,
 * balance, run, relationship or verdict is copied into live workspace data. */
import './workspace.css';
import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { emptyState, errorState, field, h, pageHead } from '../components.js';
import { currentRouteEpoch, isCurrentRouteEpoch, registerRoute, type RouteContext } from '../routes.js';

interface ProjectHit { readonly id: string; readonly title: string; readonly snippet: string; readonly createdAt: string }
interface Hits { readonly hits: readonly ProjectHit[]; readonly totalCount: number }
interface Session { readonly authenticated: boolean }
const gaps = {
  repositories: ['Repository connections', 'The current HTTP server does not expose GitHub installation or repository connection management. Provider credentials and installation authorization are required.'],
  environments: ['Environments', 'Environment revision management is not exposed by the current HTTP server. Existing run inputs can reference reviewed environment identities.'],
  capabilities: ['Capability qualification', 'No capability qualification HTTP contract is exposed. The public roadmap reports published status without promoting support levels.'],
  impact: ['Impact graph', 'No impact-graph HTTP contract is exposed. No inferred or proven relationships can be loaded into this view.'],
  investigation: ['Investigation', 'The hypothesis ledger and investigation APIs are not exposed. Muse is not configured for live diagnosis in this demo.'],
  campaigns: ['Verification campaigns', 'Campaign plans and all-trial receipts are not exposed by the HTTP server. A green example is not independent proof.'],
  publication: ['Publication review', 'No publication authorization HTTP endpoint is exposed. This screen cannot create a GitHub PR or grant publication authority.'],
  outcome: ['Outcome validation', 'Owner outcome validation is not exposed through the current HTTP server. No organic outcome is claimed.'],
  telemetry: ['Telemetry', 'Telemetry upload and reconciliation are not exposed through the HTTP server. Do not upload sensitive customer logs here.'],
  characterization: ['Characterization', 'Characterization campaign inputs and receipts are not exposed through the HTTP server.'],
  'project-settings': ['Project settings', 'Project updates, environment revisions and repository grants are not exposed through a project settings API.'],
  audit: ['Audit history', 'Audit-detail and audit-export HTTP endpoints are unavailable. Current-grant checks cannot be bypassed by a client-generated export.'],
  evaluations: ['Evaluations', 'Evaluation denominators and run evidence are not exposed through an evaluation API. No benchmark scores are invented.'],
  onboarding: ['Workspace onboarding', 'Repository onboarding requires an authorized GitHub App and provider installation services. You can create a project and prepare a draft with the available services.'],
  'access-denied': ['Access denied', 'This page does not grant access. Sign in with an authorized account or ask your workspace owner to review your current grants.'],
  'ui-states': ['Service states', 'These layouts show unavailable service boundaries, not successful execution or repair results.'],
} as const;

async function authorized(outlet: HTMLElement, epoch: number): Promise<boolean> {
  const state = await apiGet<Session>('/api/auth/session');
  // A completed request retains no authority over a later navigation.
  if (!isCurrentRouteEpoch(epoch)) return false;
  if (state.authenticated) return true;
  outlet.replaceChildren(h('section', { class: 'card access-state' }, [h('h1', {}, ['Log in to your workspace']), h('p', {}, ['Your projects, runs and evidence require a current authorized session.']), h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]));
  return false;
}

async function projects(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const epoch = currentRouteEpoch();
  outlet.replaceChildren(emptyState('Loading projects…', 'Reading your current workspace grants.'));
  try {
    if (!await authorized(outlet, epoch)) return;
    const result = await apiPost<Hits>('/api/search', { schemaVersion: '1', scope: 'projects', limit: 20 });
    if (!isCurrentRouteEpoch(epoch)) return;
    const id = ctx.params.get('id');
    const selected = id === undefined ? result.hits : result.hits.filter(hit => hit.id === id);
    const cards = h('div', { class: 'project-grid' }, selected.map(hit => h('article', { class: 'project-card' }, [
      h('div', { class: 'project-card-top' }, [h('span', { class: 'mini-label' }, ['PROJECT']), h('span', { class: 'badge' }, ['Current grant'])]),
      h('h2', {}, [h('a', { href: `#/project?id=${encodeURIComponent(hit.id)}` }, [hit.title])]),
      h('p', {}, [hit.snippet]), h('p', { class: 'mono' }, [hit.id]),
      h('div', { class: 'actions' }, [h('a', { class: 'button primary', href: `#/runs/new?project=${encodeURIComponent(hit.id)}` }, ['Prepare a run']), h('a', { href: '#/repositories' }, ['Repository readiness'])]),
    ])));
    outlet.replaceChildren(pageHead({ title: id === undefined ? 'Projects' : selected[0]?.title ?? 'Project unavailable', subtitle: 'Projects returned by the current-grant search service.', actions: [h('a', { class: 'button primary', href: '#/projects/new' }, ['Connect project'])] }), cards);
    if (selected.length === 0) cards.append(emptyState(id === undefined ? 'No projects yet' : 'Project not returned', id === undefined ? 'Create a project to prepare your first change.' : 'It may not exist or may not be in your current grants.', h('a', { class: 'button', href: '#/projects/new' }, ['Create a project'])));
  } catch (error) {
    if (!isCurrentRouteEpoch(epoch)) return;
    outlet.replaceChildren(errorState('Projects unavailable', message(error), { label: 'Retry', onClick: () => { void projects(outlet, ctx); } }));
  }
}

function message(error: unknown): string { return error instanceof ApiRequestError ? error.failure.message : 'The service could not be reached.'; }

async function newProject(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const epoch = currentRouteEpoch();
  try { if (!await authorized(outlet, epoch)) return; }
  catch (error) {
    if (!isCurrentRouteEpoch(epoch)) return;
    outlet.replaceChildren(errorState('Project creation unavailable', message(error), { label: 'Retry', onClick: () => { void newProject(outlet, ctx); } }));
    return;
  }
  const name = field({ id: 'project-name', label: 'Project name', required: true, autocomplete: 'off' });
  name.input.maxLength = 200;
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Create project']);
  const notice = h('div', { 'aria-live': 'polite' });
  const form = h('form', { novalidate: '' }, [name.wrap, notice, submit]);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (submit.disabled) return;
    const value = name.input.value.trim();
    if (value === '') { name.input.setAttribute('aria-invalid', 'true'); notice.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, ['Enter a project name.'])); name.input.focus(); return; }
    submit.disabled = true; submit.textContent = 'Creating…';
    void apiPost<{ projectId: string }>('/api/projects', { name: value }).then(result => {
      const template = ctx.params.get('template');
      if (form.isConnected) window.location.hash = template === undefined ? `#/project?id=${encodeURIComponent(result.projectId)}` : `#/runs/new?project=${encodeURIComponent(result.projectId)}&template=${encodeURIComponent(template)}`;
    }).catch((error: unknown) => { notice.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [message(error)])); submit.disabled = false; submit.textContent = 'Create project'; });
  });
  outlet.replaceChildren(pageHead({ title: 'Connect project', subtitle: 'Start with a named project. Repository access is a separate authorization.' }), h('div', { class: 'split project-onboarding' }, [
    h('section', { class: 'card' }, [h('span', { class: 'mini-label' }, ['01 · WORKSPACE PROJECT']), h('h2', {}, ['Give your project a home.']), h('p', {}, ['Create a project in your current organization.']), form]),
    h('aside', { class: 'card readiness-panel' }, [h('span', { class: 'mini-label' }, ['02 · REPOSITORY READINESS']), h('h2', {}, ['Access stays in your control.']), h('p', {}, [gaps.repositories[1]]), h('a', { href: '#/p/integrations' }, ['Read integration requirements'])]),
  ]));
}

async function blocked(outlet: HTMLElement, name: keyof typeof gaps): Promise<void> {
  const epoch = currentRouteEpoch();
  try {
    if (!await authorized(outlet, epoch)) return;
    const { workspaceLayouts } = await import('./workspace-layouts.js');
    if (!isCurrentRouteEpoch(epoch)) return;
    const [title, reason] = gaps[name];
    const layout = h('div', { class: 'workspace-unavailable', 'data-layout': name });
    const template = document.createElement('template'); template.innerHTML = workspaceLayouts[name];
    layout.append(template.content.cloneNode(true));
    layout.querySelectorAll<HTMLElement>('h2,h3,label,legend').forEach(element => {
      if (/northwind|orders-service|inventory-service|reyjin|RUN-\d|\d+\s*(fixed|verified|cr)/i.test(element.textContent)) element.textContent = 'Data unavailable';
    });
    layout.querySelectorAll<HTMLElement>('[disabled]').forEach(control => { control.title = reason; });
    layout.querySelectorAll<HTMLAnchorElement>('a').forEach(link => { link.removeAttribute('href'); link.textContent = 'Service integration unavailable'; link.setAttribute('aria-disabled', 'true'); });
    outlet.replaceChildren(pageHead({ title, subtitle: 'Original screen composition · service integration unavailable' }), h('aside', { class: 'notice service-blocker', role: 'status' }, [h('strong', {}, ['Unavailable — no workspace result is being shown.']), h('p', {}, [reason]), h('a', { href: '#/runs' }, ['Review available runs']), document.createTextNode(' · '), h('a', { href: '#/p/help' }, ['Read the help guide'])]), layout);
  } catch (error) {
    if (!isCurrentRouteEpoch(epoch)) return;
    outlet.replaceChildren(errorState('Workspace service unavailable', message(error), { label: 'Retry', onClick: () => { void blocked(outlet, name); } }));
  }
}

export function registerWorkspacePages(): void {
  registerRoute({ path: '/projects', title: 'Projects', navLabel: 'Projects', navSection: 'workspace', render: projects });
  registerRoute({ path: '/project', title: 'Project', render: projects });
  registerRoute({ path: '/projects/new', title: 'Connect project', render: newProject });
  for (const name of Object.keys(gaps) as (keyof typeof gaps)[]) registerRoute({ path: `/${name}`, title: gaps[name][0], render: outlet => blocked(outlet, name) });
}
