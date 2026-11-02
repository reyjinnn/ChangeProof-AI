/* Service status page (T-42). The default route: reads live health
 * from the API so the shell always lands on real behavior, never a
 * decorative placeholder. */

import type { HealthData } from '../../../src/core/contracts/schemas/http.js';

import { apiGet, ApiRequestError } from './api.js';
import { badge, emptyState, errorState, h, pageHead } from './components.js';
import type { AccountState } from './session.js';

export async function renderStatus(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Checking service status…', 'Contacting the ChangeProof API.'));
  try {
    const [health, session] = await Promise.all([
      apiGet<HealthData>('/api/health'),
      apiGet<AccountState>('/api/auth/session').catch((): AccountState => ({ authenticated: false })),
    ]);

    const head = pageHead({
      eyebrow: 'Workspace Overview',
      title: 'Service status',
      subtitle: 'Live control-plane telemetry, tenant boundary status, and verification architecture.',
    });

    const stats = h('div', { class: 'stats' }, [
      h('div', { class: 'stat' }, [
        h('div', { class: 'label' }, ['API health']),
        h('div', { class: 'value' }, [health.status.toUpperCase()]),
        h('div', { class: 'sub' }, ['Live /api/health endpoint']),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'label' }, ['Content manifest']),
        h('div', { class: 'value' }, [`v${health.contentVersion}`]),
        h('div', { class: 'sub' }, ['Published contract version']),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'label' }, ['Session state']),
        h('div', { class: 'value' }, [session.authenticated ? 'Active' : 'Guest']),
        h('div', { class: 'sub' }, [
          session.authenticated ? 'Authenticated workspace session' : 'Sign in to access tenant runs',
        ]),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'label' }, ['Verdict authority']),
        h('div', { class: 'value' }, ['Policy']),
        h('div', { class: 'sub' }, ['Deterministic verifier only']),
      ]),
    ]);

    const welcomeCard = h('section', { class: 'card welcome-panel', 'aria-live': 'polite' }, [
      h('div', {}, [
        h('div', { class: 'eyebrow' }, ['Control Plane Telemetry']),
        h('h2', {}, ['Workspace & verification command center']),
        h('p', {}, [
          'API ',
          badge('ok', health.status),
          document.createTextNode(` · content ${health.contentVersion}`),
        ]),
        h('p', { class: 'muted' }, [
          'This status reflects the API behind this dashboard only. It says nothing about any repair verdict.',
        ]),
      ]),
      h('div', { class: 'workspace-live-summary' }, [
        h('div', { class: 'live-summary-caption' }, ['Boundary Checks']),
        h('div', { class: 'live-summary-row' }, [
          h('span', { class: 'live-dot', 'aria-hidden': 'true' }, []),
          h('span', {}, [`API (${health.status})`]),
        ]),
        h('div', { class: 'live-summary-row' }, [
          h('span', { class: 'live-dot', 'aria-hidden': 'true' }, []),
          h('span', {}, [
            session.authenticated ? 'Tenant scope active' : 'Guest scope',
          ]),
        ]),
        h('div', { class: 'live-summary-row' }, [
          h('span', { class: 'live-dot', 'aria-hidden': 'true' }, []),
          h('span', {}, ['SHA-256 evidence store']),
        ]),
      ]),
    ]);

    const quickStack = h('section', { class: 'card quick-card' }, [
      h('div', {}, [
        h('div', { class: 'eyebrow' }, ['Assurance Guarantees']),
        h('h2', {}, ['Verification boundaries']),
      ]),
      h('div', { class: 'quick-actions-list' }, [
        h('div', { class: 'faq-item' }, [
          h('strong', {}, ['1. Frozen protected oracle']),
          h('p', { class: 'muted' }, ['Mounted only inside the independent verifier outside the candidate workspace.']),
        ]),
        h('div', { class: 'faq-item' }, [
          h('strong', {}, ['2. Isolated guest execution']),
          h('p', { class: 'muted' }, ['Customer code never executes on the control plane or web host process.']),
        ]),
        h('div', { class: 'faq-item' }, [
          h('strong', {}, ['3. Pure deterministic policy']),
          h('p', { class: 'muted' }, ['Dimensions are assessed separately without averaging or model self-judgment.']),
        ]),
      ]),
    ]);

    const grid = h('div', { class: 'overview-grid' }, [welcomeCard, quickStack]);
    outlet.replaceChildren(head, stats, grid);
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
    outlet.replaceChildren(
      errorState('Service unreachable', message, {
        label: 'Retry',
        onClick: () => void renderStatus(outlet),
      }),
    );
  }
}
