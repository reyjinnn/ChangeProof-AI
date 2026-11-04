/* Workspace overview: measured HTTP health is separate from repair readiness. */
import type { HealthData } from '../../../src/core/contracts/schemas/http.js';

import { apiGet, ApiRequestError } from './api.js';
import { badge, emptyState, errorState, h, pageHead } from './components.js';
import { currentRouteEpoch, isCurrentRouteEpoch } from './routes.js';
import type { AccountState } from './session.js';

export async function renderStatus(outlet: HTMLElement): Promise<void> {
  const epoch = currentRouteEpoch();
  outlet.replaceChildren(emptyState('Checking service status…', 'Contacting the ChangeProof API.'));
  try {
    const [health, session] = await Promise.all([
      apiGet<HealthData>('/api/health'),
      apiGet<AccountState>('/api/auth/session').catch(() => undefined),
    ]);
    if (!isCurrentRouteEpoch(epoch)) return;
    const account = session === undefined ? 'Unavailable' : session.authenticated ? 'Active' : 'Guest';
    const head = pageHead({
      title: 'Workspace overview',
      subtitle: 'Start with the change. Keep the evidence in view.',
    });
    head.classList.add('overview-head');
    const stat = (label: string, value: string, note: string): HTMLElement => h('div', { class: 'stat' }, [
      h('div', { class: 'label' }, [label]), h('div', { class: 'value' }, [value]), h('div', { class: 'sub' }, [note]),
    ]);
    const stats = h('div', { class: 'stats overview-stats' }, [
      stat('API health', health.status.toUpperCase(), 'Live response from this service'),
      stat('Published content', health.contentVersion, 'Content manifest version'),
      stat('Account service', account, session === undefined ? 'Sign-in service could not be reached' : 'Current server-reported session'),
      stat('Repair readiness', 'Not assessed', 'API health is not execution proof'),
    ]);
    const welcome = h('section', { class: 'welcome-panel workspace-focus' }, [
      h('div', { class: 'workspace-focus-copy' }, [
        h('div', { class: 'mini-label' }, ['WORKSPACE SUMMARY']),
        h('h2', {}, ['Your next change.', h('br'), 'Evidence in view.']),
        h('p', {}, ['Explore a synthetic sample or sign in to work with your projects and runs.']),
        h('div', { class: 'cta-row' }, [
          h('a', { class: 'button', href: '#/p/sample-report' }, ['Explore a sample report']),
          h('a', { class: 'button secondary-light', href: '#/runs' }, ['View runs']),
        ]),
      ]),
      h('div', { class: 'workspace-live-summary' }, [
        h('div', { class: 'live-summary-caption' }, ['Service connection']),
        h('p', {}, ['API ', badge('ok', health.status)]),
        h('p', {}, [`Account: ${account}`]),
        h('small', {}, ['Live service facts, not a repair verdict.']),
      ]),
    ]);
    const actions = h('section', { class: 'card quick-card' }, [
      h('div', { class: 'mini-label' }, ['MAKE YOUR NEXT MOVE']), h('h2', {}, ['Quick actions']),
      h('a', { class: 'quick-link', href: '#/runs/new' }, [h('strong', {}, ['Submit a change']), h('span', {}, ['Issue, PR, or change intent'])]),
      h('a', { class: 'quick-link', href: '#/projects/new' }, [h('strong', {}, ['Connect project']), h('span', {}, ['Repositories and readiness'])]),
      h('a', { class: 'quick-link', href: '#/evidence' }, [h('strong', {}, ['Explore evidence']), h('span', {}, ['Manifests and verification results'])]),
    ]);
    const readiness = h('section', { class: 'card readiness-note' }, [
      h('h2', {}, ['Before a live repair']),
      h('p', {}, ['No live Muse model or Modal sandbox connection is confirmed by this overview. Live repair also requires a configured worker, approved intent, and the required verification inputs.']),
      h('p', { class: 'muted' }, ['Samples are illustrative. A queued run is not a completed repair, and missing execution evidence must remain unverified.']),
      h('a', { class: 'text-link', href: '#/p/verification' }, ['Read how verification works →']),
    ]);
    outlet.replaceChildren(head, h('div', { class: 'overview-grid' }, [welcome, actions]), stats, readiness);
  } catch (error) {
    if (!isCurrentRouteEpoch(epoch)) return;
    const message = error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
    const state = errorState('Service unreachable', message, {
      label: 'Retry', onClick: () => void renderStatus(outlet),
    });
    state.querySelector('h2')?.replaceWith(h('h1', {}, ['Service unreachable']));
    outlet.replaceChildren(state);
  }
}
