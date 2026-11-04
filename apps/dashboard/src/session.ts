/* Session UI (T-44). Account slot rendering plus in-place refresh:
 * login/logout re-render through the `cp:session-changed` event —
 * never a full reload, which races navigation and wipes in-memory
 * tickets. */

import { apiGet, apiPost } from './api.js';
import { h, svgEl } from './components.js';

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
  const summary = h('summary', { id: 'account-summary', 'aria-label': 'Account menu', title: `${state.tenantId} · ${state.role}` }, [
    svgEl('svg', { viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'aria-hidden': 'true' }, [svgEl('circle', { cx: '12', cy: '8', r: '3.5' }), svgEl('path', { d: 'M5 21v-2a7 7 0 0 1 14 0v2' })]),
  ]);
  const menu = h('details', { id: 'account-menu', class: 'account-menu' }, [summary,
    h('div', { class: 'account-popover' }, [
      h('strong', {}, [state.tenantId]), h('span', { class: 'badge', 'data-tone': 'info' }, [`${state.tenantId} · ${state.role}`]),
      h('a', { href: '#/account' }, ['Account settings']), h('a', { href: '#/team' }, ['Team & access']), h('a', { href: '#/privacy' }, ['Privacy & data']),
      h('a', { class: 'button', href: '#/settings' }, ['Settings']), logout,
    ]),
  ]);
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); menu.open = false; summary.focus(); } });
  slot.replaceChildren(menu);
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
