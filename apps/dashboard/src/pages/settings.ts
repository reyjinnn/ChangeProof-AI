/* Organization settings (T-44, FR3-29). Sessions, invitations, and
 * deletion over the real identity store. Member and invitation lists
 * are absent: the backend exposes no listMembers/listInvitations, so
 * this page does not pretend to show them (backend-owned gap). */

import { apiDelete, apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, emptyState, errorState, field, h } from '../components.js';
import { registerRoute } from '../routes.js';

interface SessionInfo {
  readonly authenticated: boolean;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly role?: string;
  readonly expiresAt?: string;
}

interface SessionRow {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
  readonly current: boolean;
}

function expired(outlet: HTMLElement): void {
  window.location.hash = '#/session-expired';
  outlet.replaceChildren(emptyState('Session expired', 'Redirecting to login…'));
}

function asErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
}

async function renderSettings(outlet: HTMLElement, view: 'organization' | 'account' | 'team' | 'privacy' = 'organization'): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading your account.'));
  let session: SessionInfo;
  try {
    session = await apiGet<SessionInfo>('/api/auth/session');
  } catch (error) {
    outlet.replaceChildren(
      errorState('Settings unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderSettings(outlet),
      }),
    );
    return;
  }
  if (!session.authenticated || session.tenantId === undefined || session.role === undefined) {
    outlet.replaceChildren(
      h('section', { class: 'card' }, [
        h('h1', {}, ['Settings need a login']),
        h('p', {}, ['Log in to manage your organization.']),
        h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
      ]),
    );
    return;
  }
  const tenantId = session.tenantId;
  const role = session.role;
  const account = h('section', { class: 'card' }, [
    h('h1', {}, [view === 'organization' ? 'Organization settings' : view === 'account' ? 'Account settings' : view === 'team' ? 'Team & access' : 'Privacy & data']),
    h('dl', { class: 'detail-list' }, [
      h('dt', {}, ['Organization']),
      h('dd', {}, [tenantId]),
      h('dt', {}, ['Your role']),
      h('dd', {}, [role]),
      h('dt', {}, ['Session ends']),
      h('dd', {}, [session.expiresAt ?? 'unknown']),
    ]),
  ]);
  const tabs = h('nav', { class: 'route-tabs', 'aria-label': 'Settings sections' }, [
    ...([['/settings', 'Organization', 'organization'], ['/account', 'Account', 'account'], ['/team', 'Team & access', 'team'], ['/privacy', 'Privacy & data', 'privacy']] as const).map(([path, label, section]) => h('a', { href: `#${path}`, ...(view === section ? { 'aria-current': 'page' } : {}) }, [label])),
  ]);
  outlet.replaceChildren(tabs, account);
  const sessions = view === 'organization' || view === 'account' ? renderSessions(outlet, tenantId) : Promise.resolve();
  if (view === 'organization' || view === 'team') renderInvite(outlet, tenantId);
  if (view === 'organization' || view === 'privacy') renderDeletion(outlet, tenantId);
  await sessions;
}

async function renderSessions(host: HTMLElement, tenantId: string): Promise<void> {
  const section = h('section', { class: 'card' }, [h('h2', {}, ['Your sessions'])]);
  host.appendChild(section);
  let sessions: readonly SessionRow[];
  try {
    sessions = await apiGet<readonly SessionRow[]>('/api/auth/sessions');
  } catch (error) {
    if (error instanceof ApiRequestError && error.failure.status === 401) {
      expired(host);
      return;
    }
    section.appendChild(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
    return;
  }
  if (sessions.length === 0) {
    section.appendChild(h('p', { class: 'muted' }, ['No sessions found.']));
    return;
  }
  for (const item of sessions) {
    if (item.tenantId !== tenantId) continue;
    const revoke = h('button', { class: 'button', type: 'button' }, ['Revoke']);
    const row = h('article', { class: 'faq-item' }, [
      h('h3', {}, [item.current ? 'This session' : `Session ${item.sessionId.slice(0, 13)}…`]),
      h('p', {}, [
        item.revoked ? badge('bad', 'revoked') : badge('ok', 'active'),
        document.createTextNode(` Expires ${item.expiresAt}`),
      ]),
    ]);
    if (!item.revoked && !item.current) {
      row.appendChild(h('p', {}, [revoke]));
      revoke.addEventListener('click', () => {
        revoke.disabled = true;
        void (async () => {
          try {
            await apiDelete(`/api/auth/sessions/${encodeURIComponent(item.sessionId)}`);
            row.replaceChildren(h('p', {}, [badge('bad', 'revoked')]));
          } catch (error) {
            if (error instanceof ApiRequestError && error.failure.status === 401) {
              expired(host);
              return;
            }
            revoke.disabled = false;
            row.appendChild(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
          }
        })();
      });
    }
    section.appendChild(row);
  }
}

function renderInvite(host: HTMLElement, tenantId: string): void {
  const section = h('section', { class: 'card' }, [h('h2', {}, ['Invite someone'])]);
  host.appendChild(section);
  // Owner invites stay out of the UI until the product owner decides the
  // path ([DERIVED]); the server remains the authority for every role.
  const select = h('select', { id: 'invite-role', name: 'invite-role' }, [
    h('option', { value: 'member' }, ['Member']),
    h('option', { value: 'viewer' }, ['Viewer']),
    h('option', { value: 'admin' }, ['Administrator']),
  ]);
  const wrap = h('div', { class: 'field' }, [h('label', { for: 'invite-role' }, ['Role for the invite']), select]);
  const alert = h('div', {}, []);
  const result = h('div', { 'aria-live': 'polite' }, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Create invitation']);
  const form = h('form', { novalidate: 'novalidate' }, [wrap, alert, h('p', {}, [submit])]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Creating…';
    void (async () => {
      try {
        const invitation = await apiPost<{ invitationId: string; token: string }>(
          `/api/orgs/${encodeURIComponent(tenantId)}/invitations`,
          { role: select.value },
        );
        const link = `#/invite?token=${encodeURIComponent(invitation.token)}`;
        result.replaceChildren(
          h('div', {}, [
            h('p', {}, ['Share this one-time link (valid 7 days):']),
            h('p', {}, [h('code', { class: 'inline' }, [link])]),
            h('p', {}, [h('a', { class: 'button', href: link }, ['Open invitation'])]),
          ]),
        );
      } catch (error) {
        if (error instanceof ApiRequestError && error.failure.status === 401) {
          expired(host);
          return;
        }
        result.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      } finally {
        submit.disabled = false;
        submit.textContent = 'Create invitation';
      }
    })();
  });
  section.appendChild(form);
  section.appendChild(result);
}

function renderDeletion(host: HTMLElement, tenantId: string): void {
  const section = h('section', { class: 'card' }, [h('h2', {}, ['Delete organization'])]);
  host.appendChild(section);
  const reason = field({ id: 'delete-reason', label: 'Reason (required)', required: true });
  const confirm = field({
    id: 'delete-confirm',
    label: `Type ${tenantId} to confirm`,
    required: true,
    autocomplete: 'off',
  });
  const alert = h('div', {}, []);
  const submit = h('button', { class: 'button danger', type: 'submit' }, ['Delete this organization']);
  const form = h('form', { novalidate: 'novalidate' }, [reason.wrap, confirm.wrap, alert, h('p', {}, [submit])]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (confirm.input.value !== tenantId) {
      alert.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, ['The confirmation does not match.']));
      confirm.input.focus();
      return;
    }
    if (reason.input.value.trim() === '') {
      alert.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, ['Give a reason for the audit trail.']));
      reason.input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Deleting…';
    void (async () => {
      try {
        await apiDelete(`/api/orgs/${encodeURIComponent(tenantId)}`, { reason: reason.input.value.trim() });
        host.replaceChildren(
          h('section', { class: 'card' }, [
            h('h1', {}, ['Organization deleted']),
            h('p', {}, [`${tenantId} is gone. Your session ended with it.`]),
            h('p', {}, [h('a', { class: 'button', href: '#/p/' }, ['Back to the public site'])]),
          ]),
        );
      } catch (error) {
        if (error instanceof ApiRequestError && error.failure.status === 401) {
          expired(host);
          return;
        }
        alert.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        submit.disabled = false;
        submit.textContent = 'Delete this organization';
      }
    })();
  });
  section.appendChild(h('p', { class: 'muted' }, ['Deletion fences the organization: nothing new is admitted.']));
  section.appendChild(form);
}

export function registerSettingsPage(): void {
  for (const view of ['account', 'team', 'privacy'] as const) registerRoute({ path: `/${view}`, title: `${view} settings`, render: outlet => renderSettings(outlet, view) });
  registerRoute({
    path: '/settings',
    title: 'Organization settings',
    navLabel: 'Settings',
    navSection: 'account',
    render: (outlet) => renderSettings(outlet),
  });
}
