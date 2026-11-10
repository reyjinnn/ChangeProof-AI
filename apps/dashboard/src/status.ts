/* Overview facts are real HTTP data; its workflow diagram is explicitly static. */
import type { HealthData } from '../../../src/core/contracts/schemas/http.js';
import { apiGet, ApiRequestError } from './api.js';
import { badge, emptyState, errorState, h, iconSvg, pageHead } from './components.js';
import { workflowMap } from './pilot-visuals.js';
import { currentRouteEpoch, isCurrentRouteEpoch } from './routes.js';
import type { AccountState } from './session.js';

export async function renderStatus(outlet: HTMLElement): Promise<void> {
  const epoch = currentRouteEpoch();
  const view = h('div', { class: 'cp-pilot pilot-overview', 'aria-busy': 'true' }, [emptyState('Checking service status…', 'Contacting the ChangeProof API.')]);
  outlet.replaceChildren(view);
  try {
    const [health, session] = await Promise.all([
      apiGet<HealthData>('/api/health'), apiGet<AccountState>('/api/auth/session').catch(() => undefined),
    ]);
    if (!isCurrentRouteEpoch(epoch)) return;
    const authenticated = session?.authenticated === true;
    const account = session === undefined ? 'Unavailable' : authenticated ? 'Active' : 'Guest';
    const fact = (label: string, value: string | HTMLElement, note: string): HTMLElement => h('div', {}, [h('dt', {}, [label]), h('dd', {}, [value, h('small', {}, [note])])]);
    const facts = h('dl', { class: 'overview-facts', 'aria-label': 'Current service facts' }, [
      fact('API health', badge('ok', health.status), 'Live HTTP response'), fact('Account service', account, 'Server-reported session'),
      fact('Published content', health.contentVersion, 'Manifest identity'), fact('Repair readiness', 'Not assessed', 'Not an execution result'),
    ]);
    const head = pageHead({ title: 'Workspace overview', subtitle: 'Start with the change. Keep the evidence in view.' });
    head.classList.add('overview-head');
    const welcome = h('section', { class: 'overview-start', 'aria-labelledby': 'overview-start-title' }, [
      h('div', { class: 'overview-start-copy' }, [
        h('span', { class: 'pilot-eyebrow' }, [authenticated ? 'YOUR WORKSPACE' : 'YOUR NEXT STEP']),
        h('h2', { id: 'overview-start-title' }, ['Your next change.', h('br'), 'Evidence in view.']),
        h('p', {}, [authenticated ? 'Define what should change, bring the right context, and keep every unknown visible.' : 'Sign in to prepare your change, or explore a clearly labeled sample before you begin.']),
        h('div', { class: 'overview-start-actions' }, [
          h('a', { class: 'pilot-primary', href: authenticated ? '#/runs/new' : '#/login', 'data-overview-primary': '' }, [authenticated ? 'Prepare a change' : 'Sign in to your workspace', iconSvg('new-run')]),
          h('a', { class: 'pilot-secondary', href: '#/p/sample-report' }, ['Explore a sample report']),
        ]),
        h('p', { class: 'overview-start-note' }, ['You define the intent. Independent evidence determines the outcome.']),
      ]), workflowMap('overview'),
    ]);
    const actions = h('section', { class: 'overview-actions', 'aria-labelledby': 'overview-actions-title' }, [
      h('div', { class: 'overview-section-title' }, [h('span', { class: 'pilot-eyebrow' }, ['GET YOUR BEARINGS']), h('h2', { id: 'overview-actions-title' }, ['A useful next step.'])]),
      h('div', { class: 'overview-action-list' }, [
        ...([
          ['01', 'Connect project', 'Give the change a home. Repository access is a separate authorization.', '#/projects/new', 'public'],
          ['02', 'Submit a change', 'Capture intent and scope in a versioned draft before submission.', '#/runs/new', 'new-run'],
          ['03', 'Explore evidence', 'Review artifacts and their verification boundaries.', '#/evidence', 'evidence'],
        ] as const).map(([number, title, description, href, icon]) => h('a', { class: 'overview-action-link', href }, [h('span', { class: 'overview-action-number' }, [number]), iconSvg(icon), h('span', {}, [h('strong', {}, [title]), h('small', {}, [description])]), h('span', { class: 'overview-action-arrow', 'aria-hidden': 'true' }, ['→'])])),
      ]),
    ]);
    const readiness = h('section', { class: 'overview-readiness', 'aria-labelledby': 'overview-readiness-title' }, [
      h('div', {}, [h('span', { class: 'pilot-eyebrow' }, ['BEFORE A LIVE REPAIR']), h('h2', { id: 'overview-readiness-title' }, ['Clarity includes the limits.']), h('p', {}, ['No live Muse model or Modal sandbox connection is confirmed by this overview.']), h('a', { href: '#/p/verification' }, ['Read the verification requirements →'])]),
      h('ul', {}, [
        ...[['Intent & scope', 'Defined before submission'], ['Repository access', 'Requires current grants'], ['Execution & verification', 'Required; not assessed here']].map(([title, detail]) => h('li', {}, [h('strong', {}, [title ?? '']), h('span', {}, [detail ?? ''])])),
      ]),
      h('p', { class: 'overview-readiness-note' }, ['Prerequisites, not a readiness assessment. Samples are illustrative. A queued run is not a completed repair.']),
    ]);
    view.replaceChildren(head, facts, welcome, actions, readiness);
    view.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (!isCurrentRouteEpoch(epoch)) return;
    const message = error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
    const state = errorState('Service unreachable', message, { label: 'Retry', onClick: () => void renderStatus(outlet) });
    state.querySelector('h2')?.replaceWith(h('h1', {}, ['Service unreachable']));
    view.replaceChildren(state); view.setAttribute('aria-busy', 'false');
  }
}
