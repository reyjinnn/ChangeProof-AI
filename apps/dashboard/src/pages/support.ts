/* Support desk (T-48, WP3-30): tickets the tenant files and follows,
 * access requests with explicit decide/revoke steps, and the
 * tenant-visible incident list. Transitions follow the ticket's own
 * status; the decide/revoke forms take pasted ids because the backend
 * owns no request/grant listing (recorded gap, shown, not faked). */

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, emptyState, errorState, h } from '../components.js';
import { registerRoute } from '../routes.js';

const PAGE_LIMIT = 20;

interface TeamworkSession {
  readonly authenticated: boolean;
  readonly role?: string;
}

interface Ticket {
  readonly ticketId: string;
  readonly category: string;
  readonly summary: string;
  readonly context: string;
  readonly runId?: string;
  readonly status: 'open' | 'triaged' | 'resolved' | 'closed';
  readonly reporterId: string;
  readonly createdAt: string;
}

interface TicketPage {
  readonly items: readonly Ticket[];
  readonly cursor: string;
}

interface Incident {
  readonly incidentId: string;
  readonly component: string;
  readonly status: string;
  readonly summary: string;
  readonly createdAt: string;
}

interface IncidentPage {
  readonly items: readonly Incident[];
  readonly cursor: string;
}

function asErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
}

function statusOf(error: unknown): number {
  return error instanceof ApiRequestError ? error.failure.status : 0;
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

export function expired(host: HTMLElement): void {
  window.location.hash = '#/session-expired';
  host.replaceChildren(emptyState('Session expired', 'Redirecting to login…'));
}

function ticketBadge(status: Ticket['status']): HTMLElement {
  if (status === 'open') return badge('warn', status);
  if (status === 'closed') return badge('ok', status);
  return badge('info', status);
}

const NEXT_TRANSITION: Record<Ticket['status'], 'triage' | 'resolve' | 'close' | null> = {
  open: 'triage',
  triaged: 'resolve',
  resolved: 'close',
  closed: null,
};

async function renderSupport(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the support desk.'));
  let session: TeamworkSession;
  try {
    session = await apiGet<TeamworkSession>('/api/auth/session');
    if (!session.authenticated) {
      loginCard(outlet, 'Support needs a login', 'Log in to file and follow support tickets.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Support unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderSupport(outlet),
      }),
    );
    return;
  }

  const ticketNote = h('p', { 'aria-live': 'polite' }, []);
  const ticketList = h('div', {}, []);
  const incidentList = h('div', {}, []);
  const category = h('select', { id: 'ticket-category' });
  for (const value of ['bug', 'question', 'access', 'billing', 'incident']) {
    category.appendChild(h('option', { value }, [value]));
  }
  const summary = h('input', { type: 'text', id: 'ticket-summary', maxlength: '200' });
  summary.setAttribute('aria-label', 'Summary');
  const context = h('textarea', { id: 'ticket-context', rows: '3', maxlength: '2000' });
  context.setAttribute('aria-label', 'Context');
  const file = h('button', { id: 'ticket-file', class: 'button primary', type: 'button' }, ['File ticket']);

  const resourceType = h('select', { id: 'access-type' });
  for (const value of ['run', 'project', 'repository', 'artifact']) {
    resourceType.appendChild(h('option', { value }, [value]));
  }
  const resource = h('input', { type: 'text', id: 'access-resource', maxlength: '120' });
  resource.setAttribute('aria-label', 'Resource id');
  resource.setAttribute('placeholder', 'run-1');
  const reason = h('input', { type: 'text', id: 'access-reason', maxlength: '280' });
  reason.setAttribute('aria-label', 'Reason');
  const accessFile = h('button', { id: 'access-file', class: 'button', type: 'button' }, ['Request access']);
  const accessNote = h('p', { 'aria-live': 'polite' }, []);
  const decideField = h('input', { type: 'text', id: 'decide-request', maxlength: '120' });
  decideField.setAttribute('aria-label', 'Request id');
  decideField.setAttribute('placeholder', 'accreq-…');
  const approve = h('button', { id: 'decide-approve', class: 'button', type: 'button' }, ['Approve']);
  const deny = h('button', { id: 'decide-deny', class: 'button', type: 'button' }, ['Deny']);
  const decideNote = h('p', { 'aria-live': 'polite' }, []);
  const revokeField = h('input', { type: 'text', id: 'revoke-grant', maxlength: '120' });
  revokeField.setAttribute('aria-label', 'Grant id');
  revokeField.setAttribute('placeholder', 'grant-…');
  const revokeRun = h('button', { id: 'revoke-run', class: 'button', type: 'button' }, ['Revoke grant']);
  const revokeNote = h('p', { 'aria-live': 'polite' }, []);

  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, ['Support']),
      h('p', { class: 'muted' }, [
        'Tickets you file, access requests you follow, and service incidents as reported. Owners and admins triage; members see their own tickets.',
      ]),
      ...(session.role === 'operator'
        ? [h('p', {}, [h('a', { href: '#/operator' }, ['Open the operator console'])])]
        : []),
    ]),
    h('section', { class: 'card' }, [
      h('h2', {}, ['Tickets']),
      ticketNote,
      ticketList,
      h('h3', {}, ['File a ticket']),
      h('p', {}, [h('label', { for: 'ticket-category' }, ['Category']), document.createTextNode(' '), category]),
      h('p', {}, [h('label', { for: 'ticket-summary' }, ['Summary']), document.createTextNode(' '), summary]),
      h('p', {}, [h('label', { for: 'ticket-context' }, ['Context']), document.createTextNode(' '), context]),
      h('p', {}, [file]),
    ]),
    h('section', { class: 'card' }, [
      h('h2', {}, ['Access requests']),
      h('p', { class: 'muted' }, [
        'A request is never a grant: owners and admins approve or deny by request id, and grants revoke by grant id. No request or grant listing exists yet — keep the ids from the receipts below.',
      ]),
      h('p', {}, [h('label', { for: 'access-type' }, ['Resource']), document.createTextNode(' '), resourceType, document.createTextNode(' '), resource]),
      h('p', {}, [h('label', { for: 'access-reason' }, ['Reason']), document.createTextNode(' '), reason]),
      h('p', {}, [accessFile]),
      accessNote,
      h('h3', {}, ['Decide']),
      h('p', {}, [h('label', { for: 'decide-request' }, ['Request id']), document.createTextNode(' '), decideField]),
      h('p', {}, [approve, document.createTextNode(' '), deny]),
      decideNote,
      h('h3', {}, ['Revoke']),
      h('p', {}, [h('label', { for: 'revoke-grant' }, ['Grant id']), document.createTextNode(' '), revokeField]),
      h('p', {}, [revokeRun]),
      revokeNote,
    ]),
    h('section', { class: 'card' }, [h('h2', {}, ['Service incidents']), incidentList]),
  );

  const refreshTickets = async (): Promise<void> => {
    try {
      const page = await apiGet<TicketPage>(`/api/support/tickets?limit=${String(PAGE_LIMIT)}`);
      if (page.items.length === 0) {
        ticketList.replaceChildren(emptyState('No tickets', 'File the first one below.'));
        return;
      }
      ticketList.replaceChildren(
        ...page.items.map((item) => {
          const next = NEXT_TRANSITION[item.status];
          const move = next === null ? null : h('button', { class: 'button', type: 'button', [`data-${next}`]: item.ticketId }, [`Mark ${next}d`]);
          if (move !== null) {
            move.addEventListener('click', () => {
              (move).disabled = true;
              void apiPost(`/api/support/tickets/${encodeURIComponent(item.ticketId)}/${next}`, {})
                .then(() => refreshTickets())
                .catch((error: unknown) => {
                  (move).disabled = false;
                  if (statusOf(error) === 401) {
                    expired(outlet);
                    return;
                  }
                  ticketNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
                });
            });
          }
          return h('article', { class: 'faq-item' }, [
            h('h3', {}, [ticketBadge(item.status), document.createTextNode(` ${item.summary}`)]),
            h('p', { class: 'muted' }, [`${item.ticketId} · ${item.category} · by ${item.reporterId} · ${item.createdAt}`]),
            h('p', {}, [item.context]),
            ...(item.runId === undefined
              ? []
              : [h('p', {}, [h('a', { href: `#/run?id=${encodeURIComponent(item.runId)}` }, ['Open run'])])]),
            ...(move === null ? [] : [h('p', {}, [move])]),
          ]);
        }),
      );
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      ticketList.replaceChildren(
        errorState('Tickets unavailable', asErrorMessage(error), {
          label: 'Retry',
          onClick: () => void refreshTickets(),
        }),
      );
    }
  };

  file.addEventListener('click', () => {
    const summaryText = (summary).value.trim();
    const contextText = (context).value.trim();
    if (summaryText === '' || contextText === '') {
      ticketNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Summary and context are both required.']));
      return;
    }
    (file).disabled = true;
    void apiPost<Ticket>('/api/support/tickets', {
      category: (category).value,
      summary: summaryText,
      context: contextText,
    })
      .then((filed) => {
        ticketNote.replaceChildren(document.createTextNode(`Ticket ${filed.ticketId} filed as ${filed.status}.`));
        (summary).value = '';
        (context).value = '';
        return refreshTickets();
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        ticketNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      })
      .finally(() => {
        (file).disabled = false;
      });
  });

  accessFile.addEventListener('click', () => {
    const resourceId = (resource).value.trim();
    const reasonText = (reason).value.trim();
    if (resourceId === '' || reasonText === '') {
      accessNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Resource id and reason are both required.']));
      return;
    }
    (accessFile).disabled = true;
    void apiPost<{ requestId: string; status: string }>('/api/support/access-requests', {
      resourceType: (resourceType).value,
      resourceId,
      reason: reasonText,
      ttlMs: 3_600_000,
    })
      .then((filed) => {
        accessNote.replaceChildren(
          document.createTextNode(`Request ${filed.requestId} is ${filed.status}. Keep the id — approval arrives separately.`),
        );
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        accessNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      })
      .finally(() => {
        (accessFile).disabled = false;
      });
  });

  const decide = (decision: 'approve' | 'deny'): void => {
    const requestId = (decideField).value.trim();
    if (requestId === '') {
      decideNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Paste the request id first.']));
      return;
    }
    void apiPost<{ requestId: string; status: string; grantId: string | null }>(
      `/api/support/access-requests/${encodeURIComponent(requestId)}/decide`,
      { decision },
    )
      .then((done) => {
        decideNote.replaceChildren(
          document.createTextNode(
            done.grantId === null
              ? `Request ${done.requestId} ${done.status}.`
              : `Request ${done.requestId} ${done.status}; grant ${done.grantId}.`,
          ),
        );
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        decideNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      });
  };
  approve.addEventListener('click', () => { decide('approve'); });
  deny.addEventListener('click', () => { decide('deny'); });

  revokeRun.addEventListener('click', () => {
    const grantId = (revokeField).value.trim();
    if (grantId === '') {
      revokeNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Paste the grant id first.']));
      return;
    }
    void apiPost(`/api/support/grants/${encodeURIComponent(grantId)}/revoke`, {})
      .then(() => {
        revokeNote.replaceChildren(document.createTextNode(`Grant ${grantId} revoked.`));
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        revokeNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      });
  });

  const refreshIncidents = async (): Promise<void> => {
    try {
      const page = await apiGet<IncidentPage>(`/api/support/incidents?limit=${String(PAGE_LIMIT)}`);
      if (page.items.length === 0) {
        incidentList.replaceChildren(emptyState('No incidents', 'The service reports nothing right now.'));
        return;
      }
      incidentList.replaceChildren(
        ...page.items.map((item) =>
          h('article', { class: 'faq-item' }, [
            h('h3', {}, [badge('info', item.status), document.createTextNode(` ${item.summary}`)]),
            h('p', { class: 'muted' }, [`${item.incidentId} · ${item.component} · ${item.createdAt}`]),
          ]),
        ),
      );
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      incidentList.replaceChildren(
        errorState('Incidents unavailable', asErrorMessage(error), {
          label: 'Retry',
          onClick: () => void refreshIncidents(),
        }),
      );
    }
  };

  await refreshTickets();
  await refreshIncidents();
}

export function registerSupportPages(): void {
  registerRoute({ path: '/support', title: 'Support', navLabel: 'Support', navSection: 'workspace', render: renderSupport });
}
