/* Session UI (T-44). Account slot rendering plus in-place refresh:
 * login/logout re-render through the `cp:session-changed` event —
 * never a full reload, which races navigation and wipes in-memory
 * tickets. */

import { apiGet, apiPost } from './api.js';
import { h } from './components.js';

export const SESSION_CHANGED_EVENT = 'cp:session-changed';

export interface AccountState {
  readonly authenticated: boolean;
  readonly tenantId?: string;
  readonly role?: string;
}

/** Topbar account slot: login link out, tenant/role + logout in. */
export function renderAccount(state: AccountState): void {
  const sidebarSummary = document.getElementById('sidebar-session-summary');
  if (sidebarSummary !== null) {
    sidebarSummary.textContent =
      state.authenticated && state.tenantId !== undefined && state.role !== undefined
        ? 'Authenticated tenant workspace'
        : 'Guest session · sign in to access workspace';
  }
  const slot = document.getElementById('account');
  if (slot === null) return;
  if (!state.authenticated || state.tenantId === undefined || state.role === undefined) {
    slot.replaceChildren(h('a', { class: 'button', href: '#/login' }, ['Log in']));
    return;
  }
  const logout = h('button', { class: 'button', type: 'button' }, ['Log out']);
  logout.addEventListener('click', () => {
    logout.disabled = true;
    void apiPost('/api/auth/logout', {})
      .catch(() => undefined)
      .then(() => {
        window.location.hash = '#/';
        notifySessionChanged();
      });
  });
  slot.replaceChildren(
    h('span', { class: 'badge', 'data-tone': 'info' }, [`${state.tenantId} · ${state.role}`]),
    h('a', { class: 'button', href: '#/settings' }, ['Settings']),
    document.createTextNode(' '),
    logout,
  );
}

export async function refreshAccount(): Promise<void> {
  try {
    renderAccount(await apiGet<AccountState>('/api/auth/session'));
  } catch {
    renderAccount({ authenticated: false });
  }
}

export function notifySessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}
