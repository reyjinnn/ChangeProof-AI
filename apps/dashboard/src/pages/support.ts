/* Support desk (T-48, WP3-30): tickets the tenant files and follows,
 * access requests with explicit decide/revoke steps, the tenant-visible
 * incident list, plus service status, UI state samples, and evaluation
 * reports. Transitions follow the ticket's own status; the decide/revoke
 * forms take pasted ids because the backend owns no request/grant
 * listing (recorded gap, shown, not faked). */

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import {
  badge,
  drawer,
  emptyState,
  errorState,
  h,
  head,
  padcard,
  pillIcon,
  staticBadge,
  table,
} from '../components.js';
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

interface Health {
  readonly status: string;
  readonly contentVersion: string;
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

const FAQS: readonly (readonly [string, string])[] = [
  ['Do I need a model API key?', 'Not for the hosted service. Model credentials are managed by the operator.'],
  [
    'Why do all targets pass but the bundle is incomplete?',
    'Required edge, mixed-version, or dimension proof may still be missing. The bundle never averages dimensions.',
  ],
  [
    'Does ChangeProof merge or deploy?',
    'Publication prepares pull requests inside the approved scope. Merge and deploy stay with a maintainer.',
  ],
  [
    'What happens when repository access is revoked?',
    'Queued runs are cancelled, active runs stop at a safe boundary, and new effects are withheld. Evidence and pull requests are not deleted automatically.',
  ],
];

function supportForm(
  outlet: HTMLElement,
  category: string,
  summaryText: string,
  contextText: string,
  note: HTMLElement,
  onFiled: () => void,
  onSettled: () => void,
): void {
  if (summaryText === '' || contextText === '') {
    note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Summary and context are both required.']));
    onSettled();
    return;
  }
  void apiPost<Ticket>('/api/support/tickets', { category, summary: summaryText, context: contextText })
    .then((filed) => {
      note.replaceChildren(document.createTextNode(`Ticket ${filed.ticketId} filed as ${filed.status}.`));
      onFiled();
    })
    .catch((error: unknown) => {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
    })
    .finally(onSettled);
}

function openSupportDrawer(trigger: HTMLElement, outlet: HTMLElement, presetCategory: string, onFiled: () => void): void {
  const category = h('select', { id: 'support-category' });
  for (const value of ['bug', 'question', 'access', 'billing', 'incident']) {
    const option = h('option', { value }, [value]);
    if (value === presetCategory) option.selected = true;
    category.appendChild(option);
  }
  const summary = h('input', { type: 'text', id: 'support-summary', maxlength: '200' });
  summary.setAttribute('aria-label', 'Summary');
  const context = h('textarea', { id: 'support-context', rows: '4', maxlength: '2000' });
  context.setAttribute('aria-label', 'Context');
  const note = h('p', { 'aria-live': 'polite' }, []);
  const form = h('form', { id: 'supportForm', novalidate: 'novalidate' }, [
    h('p', {}, [h('label', { for: 'support-category' }, ['Category']), document.createTextNode(' '), category]),
    h('p', {}, [h('label', { for: 'support-summary' }, ['Summary']), document.createTextNode(' '), summary]),
    h('p', {}, [h('label', { for: 'support-context' }, ['Context']), document.createTextNode(' '), context]),
    note,
    h('p', {}, [h('button', { class: 'button primary', type: 'submit' }, ['Send request'])]),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    supportForm(outlet, category.value, summary.value.trim(), context.value.trim(), note, onFiled, () => undefined);
  });
  const body = h('div', {}, [
    h('p', {}, ['Include the run ID and problem context. Avoid sensitive source, secrets, or production credentials.']),
    form,
    h('div', { class: 'drawer-note' }, ['Requests reach the support queue; nothing here sends email or chat messages.']),
  ]);
  drawer(trigger, 'Contact support', body);
}

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

  const contactButton = h('button', { class: 'button primary full', type: 'button' }, ['Create support request']);
  const accessTicketButton = h('button', { class: 'button full', type: 'button' }, ['Request access via ticket']);

  const guideCards = h('div', { class: 'grid3' }, [
    padcard(
      'Product guide',
      h('div', {}, [
        h('div', { class: 'support-card' }, [
          pillIcon('book'),
          h('p', { class: 'help' }, ['Understand the run flow and evidence limits.']),
        ]),
        h('p', {}, [h('a', { class: 'button full', href: '#/documentation' }, ['Open guide'])]),
      ]),
    ),
    padcard(
      'Capability registry',
      h('div', {}, [
        h('div', { class: 'support-card' }, [
          pillIcon('shield'),
          h('p', { class: 'help' }, ['Check framework and capability scope.']),
        ]),
        h('p', {}, [h('a', { class: 'button full', href: '#/capabilities' }, ['Open registry'])]),
      ]),
    ),
    padcard(
      'Service status',
      h('div', {}, [
        h('div', { class: 'support-card' }, [
          pillIcon('cloud'),
          h('p', { class: 'help' }, ['View dependencies and incidents.']),
        ]),
        h('p', {}, [h('a', { class: 'button full', href: '#/service-status' }, ['Open status'])]),
      ]),
    ),
  ]);

  const faqCard = padcard(
    'Frequently asked questions',
    h('div', {}, FAQS.map(([question, answer]) =>
      h('details', { class: 'accordion' }, [h('summary', {}, [question]), h('p', {}, [answer])]),
    )),
  );
  const helpSplit = h('div', { class: 'split' }, [
    faqCard,
    h('aside', {}, [
      padcard(
        'Contact support',
        h('div', {}, [
          h('p', { class: 'help' }, [
            'Include the run ID and problem context. Avoid sensitive source, secrets, or production credentials.',
          ]),
          h('p', {}, [contactButton]),
        ]),
      ),
      padcard(
        'Support access',
        h('div', {}, [
          h('p', { class: 'help' }, ['If access is needed, the owner sets the scope and expiry first.']),
          h('p', {}, [accessTicketButton]),
        ]),
      ),
    ]),
  ]);

  outlet.replaceChildren(
    head(
      'How can we help?',
      'Guides, service status, and help for your team\u2019s workflow.',
      [h('a', { class: 'button', href: '#/service-status' }, ['Service status'])],
    ),
    ...(session.role === 'operator'
      ? [h('p', {}, [h('a', { href: '#/operator' }, ['Open the operator console'])])]
      : []),
    guideCards,
    h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('div', {}, [
          h('h2', {}, ['Tickets']),
          h('div', { class: 'help' }, ['Tickets you file. Owners and admins triage; members see their own tickets.']),
        ]),
      ]),
      h('div', { class: 'pad' }, [
        ticketNote,
        ticketList,
        h('h3', {}, ['File a ticket']),
        h('p', {}, [h('label', { for: 'ticket-category' }, ['Category']), document.createTextNode(' '), category]),
        h('p', {}, [h('label', { for: 'ticket-summary' }, ['Summary']), document.createTextNode(' '), summary]),
        h('p', {}, [h('label', { for: 'ticket-context' }, ['Context']), document.createTextNode(' '), context]),
        h('p', {}, [file]),
      ]),
    ]),
    helpSplit,
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
        table(
          ['Ticket', 'Summary', 'Status', 'Reporter', 'Action'],
          page.items.map((item) => {
            const next = NEXT_TRANSITION[item.status];
            const move = next === null
              ? null
              : h('button', { class: 'button', type: 'button', [`data-${next}`]: item.ticketId }, [`Mark ${next}d`]);
            if (move !== null) {
              move.addEventListener('click', () => {
                move.disabled = true;
                void apiPost(`/api/support/tickets/${encodeURIComponent(item.ticketId)}/${next}`, {})
                  .then(() => refreshTickets())
                  .catch((error: unknown) => {
                    move.disabled = false;
                    if (statusOf(error) === 401) {
                      expired(outlet);
                      return;
                    }
                    ticketNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
                  });
              });
            }
            const summaryCell = h('div', {}, [
              h('strong', {}, [item.summary]),
              h('div', { class: 'help' }, [item.context]),
              ...(item.runId === undefined
                ? []
                : [h('p', {}, [h('a', { href: `#/run?id=${encodeURIComponent(item.runId)}` }, ['Open run'])])]),
            ]);
            return [
              h('code', { class: 'inline' }, [item.ticketId]),
              summaryCell,
              ticketBadge(item.status),
              `${item.reporterId} · ${item.createdAt}`,
              move ?? '—',
            ];
          }),
        ),
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

  const onFiled = (): void => {
    summary.value = '';
    context.value = '';
    void refreshTickets();
  };
  contactButton.addEventListener('click', () => { openSupportDrawer(contactButton, outlet, 'question', () => void refreshTickets()); });
  accessTicketButton.addEventListener('click', () => { openSupportDrawer(accessTicketButton, outlet, 'access', () => void refreshTickets()); });

  file.addEventListener('click', () => {
    file.disabled = true;
    supportForm(outlet, category.value, summary.value.trim(), context.value.trim(), ticketNote, onFiled, () => {
      file.disabled = false;
    });
  });

  accessFile.addEventListener('click', () => {
    const resourceId = resource.value.trim();
    const reasonText = reason.value.trim();
    if (resourceId === '' || reasonText === '') {
      accessNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Resource id and reason are both required.']));
      return;
    }
    accessFile.disabled = true;
    void apiPost<{ requestId: string; status: string }>('/api/support/access-requests', {
      resourceType: resourceType.value,
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
        accessFile.disabled = false;
      });
  });

  const decide = (decision: 'approve' | 'deny'): void => {
    const requestId = decideField.value.trim();
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
    const grantId = revokeField.value.trim();
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

function asHealth(data: unknown): Health | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const status = record['status'];
  const contentVersion = record['contentVersion'];
  if (typeof status !== 'string' || (typeof contentVersion !== 'string' && typeof contentVersion !== 'number')) {
    return null;
  }
  return { status, contentVersion: String(contentVersion) };
}

async function renderServiceStatus(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading service status.'));
  try {
    const session = await apiGet<TeamworkSession>('/api/auth/session');
    if (!session.authenticated) {
      loginCard(outlet, 'Service status needs a login', 'Log in to see incidents for your workspace.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Service status unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderServiceStatus(outlet),
      }),
    );
    return;
  }

  let health: Health | null;
  try {
    health = asHealth(await apiGet<unknown>('/api/health'));
  } catch {
    health = null;
  }
  if (health === null) {
    outlet.replaceChildren(
      errorState('Service status unavailable', 'The health endpoint did not answer with usable data.', {
        label: 'Retry',
        onClick: () => void renderServiceStatus(outlet),
      }),
    );
    return;
  }
  const live = health;

  const components = h('div', {}, [
    table(
      ['Component', 'Status', 'Impact'],
      [
        ['Web & API', staticBadge(live.status, 'green'), 'Dashboard data source'],
        [`Content manifest v${live.contentVersion}`, staticBadge('reported', 'blue'), 'Published contract version'],
        ['Durable queue', staticBadge('not reported', ''), 'Not covered by /api/health'],
        ['Worker fleet', staticBadge('not reported', ''), 'Not covered by /api/health'],
        ['Private object storage', staticBadge('not reported', ''), 'Not covered by /api/health'],
      ],
    ),
  ]);

  const timelineHost = h('div', {}, [h('p', { class: 'muted' }, ['Reading incidents…'])]);

  outlet.replaceChildren(
    head('Service status', 'Live API reachability plus tenant-visible incidents. No SLO figures are claimed here.'),
    h('div', { class: 'notice' }, [
      h('div', {}, [
        h('strong', {}, ['Live reachability, not a full operations report.']),
        document.createTextNode(
          ' An outage here is never translated into no-impact or fixed; verification outcomes stay with the verifier.',
        ),
      ]),
    ]),
    h('div', { class: 'grid2' }, [
      h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, [h('div', {}, [h('h2', {}, ['Service components'])])]),
        h('div', { class: 'pad' }, [components]),
      ]),
      padcard(
        'Recovery & operations',
        h('div', {}, [
          h('div', { class: 'listrow' }, [h('span', {}, ['Service profile']), h('span', {}, ['Not yet calibrated'])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['SLO / RPO / RTO']), h('span', {}, ['Awaiting qualification'])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['Open-source license']), h('span', {}, ['Not reported by the service'])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['Hosted build']), h('span', {}, ['No release reported'])]),
          h('p', { class: 'help' }, ['No uptime or capacity figures are claimed from this page.']),
        ]),
      ),
    ]),
    padcard('Incident timeline', timelineHost),
  );

  try {
    const page = await apiGet<IncidentPage>(`/api/support/incidents?limit=${String(PAGE_LIMIT)}`);
    if (page.items.length === 0) {
      timelineHost.replaceChildren(
        h('div', { class: 'empty-state' }, [
          h('h2', {}, ['No incidents']),
          h('p', {}, ['The service reports nothing right now.']),
        ]),
      );
      return;
    }
    timelineHost.replaceChildren(
      h('ol', { class: 'timeline' }, page.items.map((item) =>
        h('li', {}, [
          h('span', { class: 'stepmark', 'aria-hidden': 'true' }, [item.status === 'resolved' ? '✓' : '●']),
          h('strong', {}, [item.summary]),
          h('p', {}, [`${item.incidentId} · ${item.component} · ${item.status}`]),
          h('time', {}, [item.createdAt]),
        ]),
      )),
    );
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    timelineHost.replaceChildren(
      errorState('Incidents unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderServiceStatus(outlet),
      }),
    );
  }
}

const UI_STATE_SAMPLES: readonly (readonly [string, string, string, string, 'runs' | 'shield'])[] = [
  ['Empty queue', 'No runs in the workspace yet.', 'Create run', '#/new-run', 'runs'],
  ['Quota exhausted', 'The reservation does not fit the remaining credits. No new job starts.', 'Review usage', '#/usage', 'shield'],
  ['Provider unavailable', 'Proposals are held until the provider is available again.', 'Service status', '#/service-status', 'shield'],
  ['Cleanup failure', 'Worker quarantined. The environment cannot be reused until cleanup is proven.', 'Contact support', '#/support', 'shield'],
  ['Unsupported capability', 'The adapter does not yet have the required proof scope.', 'View capabilities', '#/capabilities', 'shield'],
  ['Proof inconclusive', 'Valid trials do not meet the plan. Positive claims are withheld.', 'Open campaign', '#/campaigns', 'shield'],
];

function renderUiStates(outlet: HTMLElement): void {
  outlet.replaceChildren(
    head('Actionable states', 'Sample empty, admission-blocker, failure, and cleanup states. Each links to its next step.'),
    h('div', { class: 'grid2' }, UI_STATE_SAMPLES.map(([title, body, action, href, icon]) =>
      padcard(
        title,
        h('div', { class: 'empty-state' }, [
          pillIcon(icon),
          h('p', {}, [body]),
          h('p', {}, [h('a', { class: 'button small', href }, [action])]),
        ]),
      ),
    )),
    h('section', { class: 'card pad' }, [
      h('h2', {}, ['Loading preview']),
      h('p', { class: 'help' }, ['Skeleton states maintain stable layout while data loads.']),
      h('div', { class: 'modern-skeletons' }, [
        h('div', { class: 'skeleton', style: 'width:42%' }, []),
        h('div', { class: 'skeleton' }, []),
        h('div', { class: 'skeleton', style: 'width:78%' }, []),
      ]),
    ]),
  );
}

function renderEvaluations(outlet: HTMLElement): void {
  outlet.replaceChildren(
    head('Evaluation reports', 'Compare strategies on a frozen dataset and resource envelope.'),
    h('div', { class: 'notice' }, [
      h('div', {}, [
        h('strong', {}, ['Evaluation preview.']),
        document.createTextNode(
          ' This page shows the report structure only; no benchmark runs exist yet, so every figure below is unmeasured.',
        ),
      ]),
    ]),
    h('div', { class: 'grid3' }, [
      padcard('Dataset', h('div', {}, [staticBadge('Not run', 'blue')])),
      padcard('Holdout', h('div', {}, [staticBadge('Not run', 'blue')])),
      padcard('Proof origin', h('div', {}, [staticBadge('None yet', '')])),
    ]),
    h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('div', {}, [
          h('h2', {}, ['Arm comparison']),
          h('div', { class: 'help' }, ['No numerator, denominator, or success figure is shown without actual runs.']),
        ]),
      ]),
      h('div', { class: 'pad' }, [
        table(
          ['Arm', 'Approach', 'Actual runs', 'Repair success', 'Unsafe assurance', 'Actual cost'],
          [
            ['B0', 'One-shot · basic discovery', '0', 'Not measured', 'Not measured', 'Not measured'],
            ['B1', 'Structured graph · single proposal', '0', 'Not measured', 'Not measured', 'Not measured'],
            ['Full', 'Adaptive reasoning · bounded retries', '0', 'Not measured', 'Not measured', 'Not measured'],
          ],
        ),
      ]),
    ]),
    h('div', { class: 'grid2' }, [
      padcard(
        'Required breakdown',
        h('ul', { class: 'claim-list' }, [
          h('li', {}, ['Ecosystem, category, complexity, scenario, and target.']),
          h('li', {}, ['Scheduled / completed / error / incomplete counts.']),
          h('li', {}, ['Replay, live model, controlled, and organic runs stay separated.']),
          h('li', {}, ['Trial count differs from unique incident count.']),
          h('li', {}, ['Actual consumed model / compute / storage resources.']),
        ]),
      ),
      padcard(
        'Qualification gates',
        h('div', {}, [
          h('div', { class: 'listrow' }, [h('span', {}, ['Independent evaluator']), h('span', {}, [staticBadge('required', 'blue')])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['Equal resource ceilings']), h('span', {}, [staticBadge('required', 'blue')])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['Frozen dev / holdout split']), h('span', {}, [staticBadge('required', 'blue')])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['Native execution']), h('span', {}, [staticBadge('required', 'blue')])]),
          h('p', {}, [h('a', { class: 'button full', href: '#/capabilities' }, ['View capability registry'])]),
        ]),
      ),
    ]),
  );
}

export function registerSupportPages(): void {
  registerRoute({ path: '/support', title: 'Support', navLabel: 'Support', navSection: 'workspace', render: renderSupport });
  registerRoute({ path: '/service-status', title: 'Service status', render: renderServiceStatus });
  registerRoute({ path: '/ui-states', title: 'Status & errors', render: renderUiStates });
  registerRoute({ path: '/evaluations', title: 'Evaluation reports', render: renderEvaluations });
}
