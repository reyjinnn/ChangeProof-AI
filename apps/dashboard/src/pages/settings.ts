/* Organization settings (T-44, FR3-29) plus the account, privacy,
 * audit, and team routes (mockup settingsTabs, line 1219). Sessions,
 * invitations, deletion, member listing, and audit entries run over the
 * real identity and queries stores. Invitation lists, audit export, and
 * organization-profile writes are absent: the backend exposes no
 * listInvitations/audit-export/org-update endpoint, so these pages say
 * so instead of faking rows. */

import { apiDelete, apiGet, apiPost, ApiRequestError } from '../api.js';
import {
  badge,
  emptyState,
  errorState,
  field,
  h,
  head,
  padcard,
  row,
  staticBadge,
  table,
  tabs,
} from '../components.js';
import { registerRoute, type RouteContext } from '../routes.js';
import { saveTheme } from '../store.js';
import { githubErrorMessage } from './auth.js';

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

interface TeamMember {
  readonly id: string;
  readonly role: string;
  readonly detail: string;
}

function expired(outlet: HTMLElement): void {
  window.location.hash = '#/session-expired';
  outlet.replaceChildren(emptyState('Session expired', 'Redirecting to login…'));
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

/** Mockup `settingsTabs`: the four organization screens share one tab bar. */
function settingsTabs(currentId: string): HTMLElement {
  return tabs(
    [
      { id: 'settings', label: 'Organization', href: '#/settings' },
      { id: 'account', label: 'Account & sessions', href: '#/account' },
      { id: 'privacy', label: 'Data & privacy', href: '#/privacy' },
      { id: 'audit', label: 'Audit log', href: '#/audit' },
    ],
    currentId,
  );
}

/** Authenticated session or null when the page already handled the outcome. */
async function requireSession(
  outlet: HTMLElement,
  title: string,
  retry: () => void,
  loginTitle = 'Settings need a login',
): Promise<SessionInfo | null> {
  let session: SessionInfo;
  try {
    session = await apiGet<SessionInfo>('/api/auth/session');
  } catch (error) {
    outlet.replaceChildren(errorState(title, asErrorMessage(error), { label: 'Retry', onClick: retry }));
    return null;
  }
  if (!session.authenticated || session.tenantId === undefined || session.role === undefined) {
    loginCard(outlet, loginTitle, 'Log in to manage your organization.');
    return null;
  }
  return session;
}

function renderSessions(host: HTMLElement, tenantId: string): Promise<void> {
  const section = h('section', { class: 'card' }, [h('h2', {}, ['Your sessions'])]);
  host.appendChild(section);
  return (async () => {
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
      const rowEl = h('article', { class: 'faq-item' }, [
        h('h3', {}, [item.current ? 'This session' : `Session ${item.sessionId.slice(0, 13)}…`]),
        h('p', {}, [
          item.revoked ? badge('bad', 'revoked') : badge('ok', 'active'),
          document.createTextNode(` Expires ${item.expiresAt}`),
        ]),
      ]);
      if (!item.revoked && !item.current) {
        rowEl.appendChild(h('p', {}, [revoke]));
        revoke.addEventListener('click', () => {
          revoke.disabled = true;
          void (async () => {
            try {
              await apiDelete(`/api/auth/sessions/${encodeURIComponent(item.sessionId)}`);
              rowEl.replaceChildren(h('p', {}, [badge('bad', 'revoked')]));
            } catch (error) {
              if (error instanceof ApiRequestError && error.failure.status === 401) {
                expired(host);
                return;
              }
              revoke.disabled = false;
              rowEl.appendChild(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
            }
          })();
        });
      }
      section.appendChild(rowEl);
    }
  })();
}

function inviteForm(tenantId: string, host: HTMLElement, formId: string): HTMLElement {
  // Owner invites stay out of the UI until the product owner decides the
  // path ([DERIVED]); the server remains the authority for every role.
  const select = h('select', { id: `${formId}-role`, name: `${formId}-role` }, [
    h('option', { value: 'member' }, ['Member']),
    h('option', { value: 'viewer' }, ['Viewer']),
    h('option', { value: 'admin' }, ['Administrator']),
  ]);
  const wrap = h('div', { class: 'field' }, [h('label', { for: `${formId}-role` }, ['Role for the invite']), select]);
  const alert = h('div', {}, []);
  const result = h('div', { 'aria-live': 'polite' }, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Create invitation']);
  const form = h('form', { id: formId, novalidate: 'novalidate' }, [wrap, alert, h('p', {}, [submit])]);
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
  const fragment = h('div', {}, [form, result]);
  return fragment;
}

function renderInvite(host: HTMLElement, tenantId: string): void {
  const section = h('section', { class: 'card' }, [h('h2', {}, ['Invite someone'])]);
  host.appendChild(section);
  section.appendChild(inviteForm(tenantId, host, 'inviteForm'));
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

function themeSettings(): HTMLElement {
  const current = document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
  const section = h('section', { class: 'card pad cp-theme-settings' }, []);
  const heading = h('h2', {}, ['Appearance']);
  const box = h('fieldset', {}, [h('legend', {}, ['Theme'])]);
  for (const value of ['light', 'dark'] as const) {
    const input = h('input', { type: 'radio', name: 'theme', value });
    input.checked = current === value;
    input.setAttribute('aria-label', value === 'light' ? 'Light theme' : 'Dark theme');
    input.addEventListener('change', () => {
      document.documentElement.dataset['theme'] = value;
      saveTheme(value);
    });
    const labelText = value === 'light' ? 'Light' : 'Dark';
    box.appendChild(h('label', {}, [input, document.createTextNode(labelText)]));
  }
  section.append(heading, box);
  section.appendChild(
    h('p', { class: 'help' }, ['Stored only in this browser. It changes no workspace data.']),
  );
  return section;
}

function workspaceProfileForm(tenantId: string, role: string): HTMLElement {
  const org = field({ id: 'settings-org', label: 'Organization name', required: true });
  org.input.value = tenantId;
  org.input.maxLength = 70;
  const slug = field({ id: 'settings-slug', label: 'Workspace slug', required: true });
  slug.input.value = tenantId;
  slug.input.pattern = '[a-z0-9-]+';
  const note = h('p', { 'aria-live': 'polite' }, []);
  const submit = h('button', { class: 'primary', type: 'submit' }, ['Save changes']);
  const form = h('form', { id: 'settingsForm', novalidate: 'novalidate' }, [
    org.wrap,
    slug.wrap,
    note,
    h('p', {}, [submit]),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Fail closed: no organization-profile endpoint exists, so nothing is
    // sent and nothing claims to be saved.
    note.replaceChildren(
      h('span', { class: 'error-text', role: 'alert' }, [
        'Not saved: the service exposes no organization-profile endpoint, so the name and slug stay as they are.',
      ]),
    );
  });
  const body = h('div', {}, [
    form,
    h('p', { class: 'help' }, [`Signed in to ${tenantId} as ${role}. Saving waits on a profile endpoint.`]),
  ]);
  return padcard('Workspace profile', body);
}

async function renderSettings(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading your account.'));
  const session = await requireSession(outlet, 'Settings unavailable', () => void renderSettings(outlet));
  if (session?.tenantId === undefined || session.role === undefined) return;
  const tenantId = session.tenantId;
  const role = session.role;

  const main = h('div', {}, [
    workspaceProfileForm(tenantId, role),
    themeSettings(),
  ]);
  const aside = h('aside', {}, [
    padcard(
      'Workspace identity',
      h('div', {}, [
        row('Organization', tenantId),
        row('Your role', staticBadge(role, 'blue')),
        row('Session ends', session.expiresAt ?? 'unknown'),
        h('p', { class: 'help' }, [
          'Plan details are not reported by the service; usage lives under Usage & credits.',
        ]),
      ]),
    ),
  ]);
  const ownership = h('details', { class: 'compact-detail' }, [
    h('summary', {}, ['Ownership & lifecycle']),
  ]);
  aside.appendChild(ownership);
  outlet.replaceChildren(
    head('Organization settings', 'Manage the workspace, appearance, sessions, invitations, and ownership.'),
    settingsTabs('settings'),
    h('div', { class: 'split' }, [main, aside]),
  );
  const sessions = renderSessions(main, tenantId);
  renderInvite(main, tenantId);
  renderDeletion(ownership, tenantId);
  await sessions;
}

interface GitHubLinkStatus {
  readonly configured: boolean;
  readonly linked: boolean;
  readonly links: readonly { login: string }[];
}

/** Live link state: connected logins, a link button, or the honest absence. */
function renderGitHubLink(host: HTMLElement): void {
  host.replaceChildren(h('p', { class: 'muted' }, ['Checking GitHub link status…']));
  void (async () => {
    let status: GitHubLinkStatus;
    try {
      status = await apiGet<GitHubLinkStatus>('/api/auth/github/status');
    } catch (error) {
      if (!host.isConnected) return;
      if (error instanceof ApiRequestError && error.failure.status === 401) {
        host.replaceChildren(h('p', { class: 'muted' }, ['Log in to see the link state.']));
        return;
      }
      host.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      return;
    }
    if (!host.isConnected) return;
    if (!status.configured) {
      host.replaceChildren(
        h('p', { class: 'help' }, ['GitHub login is not configured for this service.']),
      );
      return;
    }
    if (status.linked) {
      const names = status.links.map((entry) => entry.login).join(', ');
      host.replaceChildren(h('p', {}, [`Connected as ${names}. You can sign in with GitHub.`]));
      return;
    }
    const link = h('button', { class: 'button', type: 'button' }, ['Link GitHub account']);
    link.addEventListener('click', () => {
      window.location.assign('/api/auth/github/start?mode=link');
    });
    host.replaceChildren(
      h('p', {}, ['No GitHub account is linked. Linking lets you sign in with GitHub.']),
      h('p', {}, [link]),
    );
  })();
}

async function renderAccount(outlet: HTMLElement, ctx?: RouteContext): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading your account.'));
  const session = await requireSession(outlet, 'Account unavailable', () => void renderAccount(outlet, ctx), 'Account needs a login');
  if (session?.tenantId === undefined || session.role === undefined) return;
  const tenantId = session.tenantId;
  const role = session.role;
  const initials = (session.userId ?? '?').slice(0, 2).toUpperCase();
  // Link-mode OAuth round-trips land back here with a code, not JSON.
  const linkError = ctx?.params.get('githubError') ?? '';
  const linkNotice =
    linkError !== ''
      ? h('p', { class: 'error-text', role: 'alert' }, [githubErrorMessage(linkError)])
      : ctx?.params.get('githubLinked') === '1'
        ? h('p', { class: 'success-notice', role: 'status' }, ['GitHub account linked. You can sign in with GitHub.'])
        : undefined;

  const main = h('div', {}, [
    padcard(
      'Account profile',
      h('div', {}, [
        h('div', { class: 'support-card' }, [
          h('span', { class: 'avatar' }, [initials]),
          h('div', {}, [
            h('h2', {}, [session.userId ?? 'Unknown user']),
            h('p', { class: 'help' }, ['Workspace identity from the current session.']),
          ]),
        ]),
        row('Organization', tenantId),
        row('Role', staticBadge(role, 'blue')),
        row('Session ends', session.expiresAt ?? 'unknown'),
      ]),
    ),
  ]);
  const linkHost = h('div', {}, []);
  renderGitHubLink(linkHost);
  const aside = h('aside', {}, [
    padcard(
      'GitHub status',
      h('div', {}, [
        h('p', {}, ['Repository access is granted separately through the GitHub App installation.']),
        linkHost,
        h('p', {}, [h('a', { class: 'button', href: '#/repositories' }, ['Open GitHub connections'])]),
      ]),
    ),
    padcard(
      'Account security',
      h('div', {}, [
        h('p', { class: 'help' }, [
          'Sessions are validated by the server. Logout, expiry, and revocation stop access for later requests.',
        ]),
        h('p', {}, [h('a', { class: 'button', href: '#/session-expired' }, ['View the expired-session state'])]),
      ]),
    ),
  ]);
  outlet.replaceChildren(
    head('Account & sessions', 'Workspace identity, active sessions, and sign-in status.'),
    settingsTabs('account'),
    ...(linkNotice === undefined ? [] : [linkNotice]),
    h('div', { class: 'split' }, [main, aside]),
  );
  await renderSessions(main, tenantId);
}

async function renderPrivacy(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading data controls.'));
  const session = await requireSession(outlet, 'Privacy controls unavailable', () => void renderPrivacy(outlet), 'Data & privacy needs a login');
  if (session?.tenantId === undefined || session.role === undefined) return;
  const tenantId = session.tenantId;

  const lifecycle = table(
    ['Data', 'Handling', 'Your control'],
    [
      ['Workspace profile', 'Name and slug identify the tenant.', h('a', { href: '#/settings' }, ['Organization settings'])],
      ['Sessions', 'Server-validated; revoking ends access.', h('a', { href: '#/account' }, ['Account & sessions'])],
      ['Invitations', 'One-time links, valid 7 days.', h('a', { href: '#/team' }, ['Team & access'])],
      ['Support tickets', 'Visible inside the tenant; owners and admins triage.', h('a', { href: '#/support' }, ['Help & status'])],
      ['Organization', 'Deletion fences the tenant: nothing new is admitted.', 'Deletion form below'],
    ],
  );
  const exportNote = h('p', { 'aria-live': 'polite' }, []);
  const exportButton = h('button', { class: 'button', type: 'button' }, ['Request export']);
  exportButton.addEventListener('click', () => {
    exportNote.replaceChildren(
      h('span', { class: 'error-text', role: 'alert' }, [
        'Export is unavailable: the service exposes no self-service export endpoint. Contact support for a manual request.',
      ]),
    );
  });
  const holdNote = h('p', { 'aria-live': 'polite' }, []);
  const holdButton = h('button', { class: 'button', type: 'button' }, ['Request legal hold']);
  holdButton.addEventListener('click', () => {
    holdNote.replaceChildren(
      h('span', { class: 'error-text', role: 'alert' }, [
        'Legal hold is unavailable: the service exposes no hold endpoint. Contact support for a manual request.',
      ]),
    );
  });

  const main = h('div', {}, [
    padcard(
      'Data lifecycle',
      h('div', {}, [
        lifecycle,
        h('p', { class: 'help' }, [
          'Retention figures are not reported by the service, so none are shown here.',
        ]),
      ]),
    ),
  ]);
  const aside = h('aside', {}, [
    padcard('Export', h('div', {}, [exportNote, h('p', {}, [exportButton])])),
    padcard('Legal hold', h('div', {}, [holdNote, h('p', {}, [holdButton])])),
  ]);
  outlet.replaceChildren(
    head('Data & privacy', 'See what the workspace keeps and where each control lives.'),
    settingsTabs('privacy'),
    h('div', { class: 'split' }, [main, aside]),
  );
  renderDeletion(main, tenantId);
}

interface AuditEntry {
  readonly time: string;
  readonly actor: string;
  readonly event: string;
  readonly scope: string;
  readonly receipt: string;
}

function asAuditEntries(data: unknown): AuditEntry[] | null {
  const items = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as Record<string, unknown>)['items'])
      ? ((data as Record<string, unknown>)['items'] as unknown[])
      : null;
  if (items === null) return null;
  const entries: AuditEntry[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    const time = record['time'] ?? record['createdAt'];
    const actor = record['actor'];
    const event = record['event'];
    const scope = record['scope'];
    const receipt = record['receipt'] ?? record['receiptId'] ?? '';
    if (typeof time !== 'string' || typeof actor !== 'string' || typeof event !== 'string' || typeof scope !== 'string') {
      return null;
    }
    entries.push({
      time,
      actor,
      event,
      scope,
      receipt: typeof receipt === 'string' ? receipt : '',
    });
  }
  return entries;
}

async function renderAudit(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the activity log.'));
  const session = await requireSession(outlet, 'Activity log unavailable', () => void renderAudit(outlet), 'Activity log needs a login');
  if (session?.tenantId === undefined) return;

  const search = h('input', { type: 'search', id: 'auditSearch', placeholder: 'Search actor, event, or scope' });
  search.setAttribute('aria-label', 'Search audit log');
  const exportNote = h('p', { 'aria-live': 'polite' }, []);
  const exportButton = h('button', { class: 'button', type: 'button' }, ['Export audit']);
  exportButton.addEventListener('click', () => {
    exportNote.replaceChildren(
      h('span', { class: 'error-text', role: 'alert' }, [
        'Export is unavailable: the service exposes no audit-export endpoint, so there is nothing to download.',
      ]),
    );
  });
  const tools = h('div', { class: 'table-tools' }, [
    h('label', { class: 'table-search' }, [search]),
    h('div', { class: 'actions' }, [staticBadge('tenant-scoped', 'blue')]),
  ]);
  const tableHost = h('div', { id: 'auditTable' }, []);
  const footer = h('div', { class: 'table-footer' }, [h('span', {}, ['No entries loaded.'])]);

  const paint = (entries: readonly AuditEntry[]): void => {
    const query = search.value.trim().toLowerCase();
    const visible = query === ''
      ? entries
      : entries.filter((entry) =>
          `${entry.time} ${entry.actor} ${entry.event} ${entry.scope} ${entry.receipt}`.toLowerCase().includes(query),
        );
    if (visible.length === 0 && entries.length === 0) {
      tableHost.replaceChildren(
        h('div', { class: 'empty-state' }, [
          h('h2', {}, ['No activity entries']),
          h('p', {}, [
            'No activity has been recorded for this organization yet. Run events appear here as work progresses.',
          ]),
        ]),
      );
    } else {
      tableHost.replaceChildren(
        table(
          ['Time', 'Actor', 'Event', 'Scope', 'Receipt'],
          visible.map((entry) => [entry.time, entry.actor, entry.event, entry.scope, entry.receipt]),
        ),
      );
    }
    footer.replaceChildren(h('span', {}, [`Showing ${String(visible.length)} of ${String(entries.length)} entries.`]));
  };

  outlet.replaceChildren(
    head('Activity log', 'Trail of access, run, publication, and organization changes.'),
    settingsTabs('audit'),
    h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('div', {}, [h('h2', {}, ['Activity log'])]), exportButton]),
      tools,
      tableHost,
      footer,
      h('div', { class: 'pad' }, [exportNote]),
    ]),
  );

  let entries: readonly AuditEntry[] = [];
  try {
    const data = await apiGet<unknown>('/api/audit/entries?limit=50');
    entries = asAuditEntries(data) ?? [];
  } catch {
    entries = [];
  }
  paint(entries);
  search.addEventListener('input', () => { paint(entries); });
}

function asTeamMembers(data: unknown): TeamMember[] | null {
  const items = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as Record<string, unknown>)['items'])
      ? ((data as Record<string, unknown>)['items'] as unknown[])
      : null;
  if (items === null) return null;
  const members: TeamMember[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    const id = record['userId'] ?? record['memberId'] ?? record['id'];
    const role = record['role'];
    if (typeof id !== 'string' || typeof role !== 'string') return null;
    const detail = record['email'] ?? record['detail'] ?? '';
    members.push({ id, role, detail: typeof detail === 'string' ? detail : '' });
  }
  return members;
}

async function renderTeam(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the team.'));
  let session: SessionInfo;
  try {
    session = await apiGet<SessionInfo>('/api/auth/session');
  } catch (error) {
    outlet.replaceChildren(
      errorState('Team unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderTeam(outlet),
      }),
    );
    return;
  }
  if (!session.authenticated || session.tenantId === undefined || session.role === undefined) {
    loginCard(outlet, 'Team needs a login', 'Log in to see this organization\u2019s team and invitations.');
    return;
  }
  const tenantId = session.tenantId;

  const memberHost = h('div', { id: 'memberTable' }, []);
  const main = h('div', {}, [
    h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('div', {}, [h('h2', {}, ['Members'])])]),
      h('div', { class: 'pad' }, [memberHost]),
    ]),
    h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('div', {}, [h('h2', {}, ['Invite someone'])])]),
      h('div', { class: 'pad' }, [inviteForm(tenantId, outlet, 'inviteForm')]),
    ]),
  ]);
  const aside = h('aside', {}, [
    padcard(
      'Role summary',
      h('div', {}, [
        row('Owner', 'Full organization control'),
        row('Administrator', 'Manages members and settings'),
        row('Member', 'Works on granted projects'),
        row('Viewer', 'Read-only access'),
        h('p', { class: 'help' }, [
          'The server enforces every permission; these summaries describe intent, not grants.',
        ]),
      ]),
    ),
  ]);
  outlet.replaceChildren(
    head('Team & access', 'Members, invitations, and what each role may do.'),
    h('div', { class: 'split' }, [main, aside]),
  );

  try {
    const members = asTeamMembers(await apiGet<unknown>('/api/team/members'));
    if (members === null || members.length === 0) {
      memberHost.replaceChildren(
        h('div', { class: 'empty-state' }, [
          h('h2', {}, ['No members found']),
          h('p', {}, [
            'No members are listed for this organization. Use the invitation form below to add someone.',
          ]),
        ]),
      );
      return;
    }
    memberHost.replaceChildren(
      table(
        ['Member', 'Role', 'Details'],
        members.map((member) => [member.id, staticBadge(member.role, 'blue'), member.detail]),
      ),
    );
  } catch {
    memberHost.replaceChildren(
      h('div', { class: 'empty-state' }, [
        h('h2', {}, ['Member listing unavailable']),
        h('p', {}, ['The member list could not be loaded. Check your connection and retry.']),
      ]),
    );
  }
}

export function registerSettingsPage(): void {
  registerRoute({
    path: '/settings',
    title: 'Organization settings',
    navLabel: 'Settings',
    navSection: 'account',
    render: (outlet) => renderSettings(outlet),
  });
  registerRoute({ path: '/account', title: 'Account & sessions', render: (outlet, ctx) => renderAccount(outlet, ctx) });
  registerRoute({ path: '/privacy', title: 'Data & privacy', render: (outlet) => renderPrivacy(outlet) });
  registerRoute({ path: '/audit', title: 'Activity log', render: (outlet) => renderAudit(outlet) });
  registerRoute({
    path: '/team',
    title: 'Team & access',
    navLabel: 'Team & access',
    navSection: 'workspace',
    render: (outlet) => renderTeam(outlet),
  });
}
