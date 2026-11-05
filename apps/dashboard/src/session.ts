/* Session UI (T-44). Account slot rendering plus in-place refresh:
 * login/logout re-render through the `cp:session-changed` event —
 * never a full reload, which races navigation and wipes in-memory
 * tickets. */

import { apiGet } from './api.js';
import { setAccountPopoverState } from './shell.js';
import { SESSION_CHANGED_EVENT } from './store.js';

export { SESSION_CHANGED_EVENT };

export interface AccountState {
  readonly authenticated: boolean;
  readonly tenantId?: string;
  readonly role?: string;
}

function initialsFor(tenantId: string): string {
  const letters = tenantId.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
  return letters === '' ? '–' : letters;
}

/** Topbar avatar + account popover identity. Logged out shows Guest and
 * the popover offers Sign in; logged in shows tenant initials, identity,
 * and Sign out (handled by the auth page module). */
export function renderAccount(state: AccountState): void {
  const authenticated = state.authenticated && state.tenantId !== undefined && state.role !== undefined;
  const name = authenticated ? (state.tenantId) : 'Guest';
  const detail = authenticated ? `${state.role} · workspace` : 'Not signed in';
  const initials = authenticated ? initialsFor(state.tenantId) : 'G';
  setAccountPopoverState({ authenticated, name, detail, initials });
  document.querySelector('.top-avatar .avatar-circle')?.replaceChildren(document.createTextNode(initials));
  document.querySelector('.top-avatar .avatar-label')?.replaceChildren(document.createTextNode(name));
  document.querySelector('.top-avatar')?.setAttribute('aria-label', authenticated ? `${name} account menu` : 'Guest account menu');
  const orgLabel = document.getElementById('orgLabel');
  if (orgLabel !== null) orgLabel.textContent = name;
  const orgDetail = document.getElementById('orgDetail');
  if (orgDetail !== null) {
    // `authenticated` already implies a defined role (same alias as name/detail above).
    orgDetail.textContent = authenticated
      ? state.role.slice(0, 1).toUpperCase() + state.role.slice(1)
      : 'Sign in to load';
  }
  const orgLogo = document.querySelector('.sidebar-foot .org-logo');
  if (orgLogo !== null) orgLogo.textContent = initials.slice(0, 1);
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
