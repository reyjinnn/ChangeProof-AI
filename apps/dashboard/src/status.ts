/* Service status page (T-42). The default route: reads live health
 * from the API so the shell always lands on real behavior, never a
 * decorative placeholder. */

import type { HealthData } from '../../../src/core/contracts/schemas/http.js';

import { apiGet, ApiRequestError } from './api.js';
import { badge, emptyState, errorState, h } from './components.js';

export async function renderStatus(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Checking service status…', 'Contacting the ChangeProof API.'));
  try {
    const health = await apiGet<HealthData>('/api/health');
    const card = h('section', { class: 'card', 'aria-live': 'polite' }, [
      h('h1', {}, ['Service status']),
      h('p', {}, [
        'API ',
        badge('ok', health.status),
        document.createTextNode(` · content ${health.contentVersion}`),
      ]),
      h('p', { class: 'muted' }, [
        'This status reflects the API behind this dashboard only. It says nothing about any repair verdict.',
      ]),
    ]);
    outlet.replaceChildren(card);
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
