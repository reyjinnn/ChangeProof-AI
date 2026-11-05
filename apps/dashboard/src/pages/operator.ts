/* Operator console (T-48, WP3-30): incident management, lease-fenced
 * target inspect/drain/quarantine, and the operator-action audit. The
 * route refuses non-operator roles before any data fetch; every write
 * below is refused again by the server for owners (NEG3-34, proven
 * natively). Epochs come from inspect, never from memory. Worker
 * lifecycle rows are absent: the backend exposes no worker endpoint,
 * so the table says so instead of faking workers. */

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, emptyState, errorState, h, head, padcard, pillIcon, staticBadge, table } from '../components.js';
import { registerRoute } from '../routes.js';

import { expired } from './support.js';

const PAGE_LIMIT = 20;

interface OperatorSession {
  readonly authenticated: boolean;
  readonly role?: string;
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

interface ActionReceipt {
  readonly actionId: string;
  readonly tenantId: string;
  readonly targetJobId: string;
  readonly kind: string;
  readonly leaseEpoch: number;
  readonly reason: string;
  readonly operatorId: string;
  readonly createdAt: string;
}

interface ActionPage {
  readonly items: readonly ActionReceipt[];
  readonly cursor: string;
}

function asErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
}

function statusOf(error: unknown): number {
  return error instanceof ApiRequestError ? error.failure.status : 0;
}

async function renderOperator(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Checking console authority.'));
  try {
    const session = await apiGet<OperatorSession>('/api/auth/session');
    if (!session.authenticated) {
      outlet.replaceChildren(
        h('section', { class: 'card' }, [
          h('h1', {}, ['Operator console needs a login']),
          h('p', {}, ['Log in as an operator to reach this console.']),
          h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
        ]),
      );
      return;
    }
    if (session.role !== 'operator') {
      outlet.replaceChildren(
        h('section', { class: 'card' }, [
          h('h1', {}, ['Operator console is unavailable']),
          h('p', {}, [
            'Owner accounts cannot reach operator actions. This denial is enforced by the server on every call; the console stays hidden.',
          ]),
          h('p', {}, [h('a', { class: 'button', href: '#/support' }, ['Back to support'])]),
        ]),
      );
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Console unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderOperator(outlet),
      }),
    );
    return;
  }

  const openCount = h('div', { class: 'value' }, ['…']);
  const totalCount = h('div', { class: 'value' }, ['…']);
  const actionCount = h('div', { class: 'value' }, ['…']);
  const epochValue = h('div', { class: 'value' }, ['—']);
  const stats = h('div', { class: 'stats' }, [
    h('section', { class: 'card stat' }, [
      h('div', { class: 'stat-top' }, [h('span', { class: 'label' }, ['Open incidents']), pillIcon('alert')]),
      openCount,
      h('div', { class: 'help' }, ['Awaiting mitigation']),
    ]),
    h('section', { class: 'card stat' }, [
      h('div', { class: 'stat-top' }, [h('span', { class: 'label' }, ['Incidents listed']), pillIcon('cloud')]),
      totalCount,
      h('div', { class: 'help' }, ['Current page from the service']),
    ]),
    h('section', { class: 'card stat' }, [
      h('div', { class: 'stat-top' }, [h('span', { class: 'label' }, ['Recorded actions']), pillIcon('shield')]),
      actionCount,
      h('div', { class: 'help' }, ['Audited drain / quarantine receipts']),
    ]),
    h('section', { class: 'card stat' }, [
      h('div', { class: 'stat-top' }, [h('span', { class: 'label' }, ['Inspected epoch']), pillIcon('key')]),
      epochValue,
      h('div', { class: 'help' }, ['From inspect, never from memory']),
    ]),
  ]);

  const incidentNote = h('p', { 'aria-live': 'polite' }, []);
  const incidentList = h('div', {}, []);
  const component = h('input', { type: 'text', id: 'incident-component', maxlength: '120' });
  component.setAttribute('aria-label', 'Component');
  const summary = h('input', { type: 'text', id: 'incident-summary', maxlength: '280' });
  summary.setAttribute('aria-label', 'Summary');
  const report = h('button', { id: 'incident-report', class: 'button primary', type: 'button' }, ['Report incident']);

  const tenant = h('input', { type: 'text', id: 'target-tenant', maxlength: '120' });
  tenant.setAttribute('aria-label', 'Tenant id');
  const job = h('input', { type: 'text', id: 'target-job', maxlength: '120' });
  job.setAttribute('aria-label', 'Job id');
  const reason = h('input', { type: 'text', id: 'target-reason', maxlength: '280' });
  reason.setAttribute('aria-label', 'Reason');
  const inspect = h('button', { id: 'target-inspect', class: 'button', type: 'button' }, ['Inspect target']);
  const drain = h('button', { id: 'target-drain', class: 'button', type: 'button' }, ['Drain at inspected epoch']);
  const quarantine = h('button', { id: 'target-quarantine', class: 'button', type: 'button' }, ['Quarantine at inspected epoch']);
  const targetNote = h('p', { 'aria-live': 'polite' }, []);
  const actionList = h('div', {}, []);

  outlet.replaceChildren(
    head(
      'Operator console',
      'Incidents, fenced targets, and the action audit. Drain and quarantine run at the epoch inspect just returned; a moved lease refuses instead of guessing.',
    ),
    stats,
    h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('div', {}, [
          h('h2', {}, ['Worker lifecycle']),
          h('div', { class: 'help' }, ['A stale fencing epoch cannot write checkpoints, results, or publications.']),
        ]),
      ]),
      h('div', { class: 'pad' }, [
        table(
          ['Worker', 'State', 'Lease', 'Cleanup', 'Action'],
          [['No workers listed', staticBadge('unavailable', ''), '—', '—', '—']],
        ),
        h('p', { class: 'help' }, [
          'The service exposes no worker-lifecycle endpoint, so this table stays empty. Drain and quarantine run through Fenced targets below.',
        ]),
      ]),
    ]),
    h('section', { class: 'card' }, [
      h('h2', {}, ['Incidents']),
      incidentNote,
      incidentList,
      h('h3', {}, ['Report']),
      h('p', {}, [h('label', { for: 'incident-component' }, ['Component']), document.createTextNode(' '), component]),
      h('p', {}, [h('label', { for: 'incident-summary' }, ['Summary']), document.createTextNode(' '), summary]),
      h('p', {}, [report]),
    ]),
    h('section', { class: 'card' }, [
      h('h2', {}, ['Fenced targets']),
      h('p', {}, [h('label', { for: 'target-tenant' }, ['Tenant']), document.createTextNode(' '), tenant]),
      h('p', {}, [h('label', { for: 'target-job' }, ['Job']), document.createTextNode(' '), job]),
      h('p', {}, [inspect]),
      h('p', {}, [h('label', { for: 'target-reason' }, ['Reason']), document.createTextNode(' '), reason]),
      h('p', {}, [drain, document.createTextNode(' '), quarantine]),
      targetNote,
    ]),
    h('section', { class: 'card' }, [h('h2', {}, ['Operator actions']), actionList]),
    h('div', { class: 'grid2' }, [
      padcard(
        'Release & recovery',
        h('div', {}, [
          h('div', { class: 'listrow' }, [h('span', {}, ['Hosted build / source']), h('span', {}, ['No release reported'])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['License / notices']), h('span', {}, ['Not reported by the service'])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['Capacity / SLO profile']), h('span', {}, ['Awaiting calibration'])]),
          h('div', { class: 'listrow' }, [h('span', {}, ['Deletion replay']), h('span', {}, ['Required before restore access'])]),
        ]),
      ),
      padcard(
        'Admission & fairness',
        h('div', {}, [
          h('p', { class: 'help' }, [
            'Per-tenant concurrency and finite caps limit enqueue. A lost lease withholds effects; unknown publications reconcile before retry.',
          ]),
          h('p', {}, [h('a', { class: 'button full', href: '#/service-status' }, ['View customer-facing status'])]),
        ]),
      ),
    ]),
  );

  const refreshIncidents = async (): Promise<void> => {
    try {
      const page = await apiGet<IncidentPage>(`/api/support/incidents?limit=${String(PAGE_LIMIT)}`);
      totalCount.replaceChildren(document.createTextNode(String(page.items.length)));
      openCount.replaceChildren(
        document.createTextNode(String(page.items.filter((item) => item.status !== 'resolved' && item.status !== 'closed').length)),
      );
      if (page.items.length === 0) {
        incidentList.replaceChildren(emptyState('No incidents', 'Report the first one below.'));
        return;
      }
      incidentList.replaceChildren(
        ...page.items.map((item) => {
          const ack = h('button', { class: 'button', type: 'button', 'data-ack': item.incidentId }, ['Acknowledge']);
          const resolve = h('button', { class: 'button', type: 'button', 'data-resolve-inc': item.incidentId }, ['Resolve']);
          const step = (path: 'acknowledge' | 'resolve', button: HTMLElement): void => {
            (button as HTMLButtonElement).disabled = true;
            void apiPost(`/api/operator/incidents/${encodeURIComponent(item.incidentId)}/${path}`, {})
              .then(() => refreshIncidents())
              .catch((error: unknown) => {
                (button as HTMLButtonElement).disabled = false;
                if (statusOf(error) === 401) {
                  expired(outlet);
                  return;
                }
                incidentNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
              });
          };
          ack.addEventListener('click', () => { step('acknowledge', ack); });
          resolve.addEventListener('click', () => { step('resolve', resolve); });
          return h('article', { class: 'faq-item' }, [
            h('h3', {}, [badge('info', item.status), document.createTextNode(` ${item.summary}`)]),
            h('p', { class: 'muted' }, [`${item.incidentId} · ${item.component} · ${item.createdAt}`]),
            h('p', {}, [ack, document.createTextNode(' '), resolve]),
          ]);
        }),
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

  report.addEventListener('click', () => {
    const componentText = component.value.trim();
    const summaryText = summary.value.trim();
    if (componentText === '' || summaryText === '') {
      incidentNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Component and summary are both required.']));
      return;
    }
    report.disabled = true;
    void apiPost<Incident>('/api/operator/incidents', { component: componentText, summary: summaryText })
      .then((filed) => {
        incidentNote.replaceChildren(document.createTextNode(`Incident ${filed.incidentId} reported as ${filed.status}.`));
        return refreshIncidents();
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        incidentNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      })
      .finally(() => {
        report.disabled = false;
      });
  });

  let inspectedEpoch = 0;
  inspect.addEventListener('click', () => {
    const tenantId = tenant.value.trim();
    const jobId = job.value.trim();
    if (tenantId === '' || jobId === '') {
      targetNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Tenant and job are both required.']));
      return;
    }
    void apiPost<{ tenantId: string; state: string; epoch: number }>('/api/operator/targets/inspect', { tenantId, jobId })
      .then((found) => {
        inspectedEpoch = found.epoch;
        epochValue.replaceChildren(document.createTextNode(String(found.epoch)));
        targetNote.replaceChildren(
          document.createTextNode(`${found.tenantId} / ${jobId}: ${found.state} at epoch ${String(found.epoch)}.`),
        );
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        targetNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      });
  });

  const fenced = (kind: 'drain' | 'quarantine'): void => {
    const tenantId = tenant.value.trim();
    const jobId = job.value.trim();
    const reasonText = reason.value.trim();
    if (tenantId === '' || jobId === '' || reasonText === '') {
      targetNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Tenant, job, and reason are all required.']));
      return;
    }
    if (inspectedEpoch <= 0) {
      targetNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Inspect the target first — the epoch comes from inspect, never from memory.']));
      return;
    }
    void apiPost<ActionReceipt>(`/api/operator/targets/${kind}`, {
      tenantId,
      jobId,
      expectedEpoch: inspectedEpoch,
      reason: reasonText,
    })
      .then((done) => {
        targetNote.replaceChildren(
          document.createTextNode(`${done.kind} ${done.actionId} recorded at epoch ${String(done.leaseEpoch)}.`),
        );
        inspectedEpoch = 0;
        epochValue.replaceChildren(document.createTextNode('—'));
        return refreshActions();
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        inspectedEpoch = 0;
        epochValue.replaceChildren(document.createTextNode('—'));
        targetNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      });
  };
  drain.addEventListener('click', () => { fenced('drain'); });
  quarantine.addEventListener('click', () => { fenced('quarantine'); });

  const refreshActions = async (): Promise<void> => {
    try {
      const page = await apiGet<ActionPage>(`/api/operator/actions?limit=${String(PAGE_LIMIT)}`);
      actionCount.replaceChildren(document.createTextNode(String(page.items.length)));
      if (page.items.length === 0) {
        actionList.replaceChildren(emptyState('No actions', 'Fenced actions will be audited here.'));
        return;
      }
      actionList.replaceChildren(
        ...page.items.map((item) =>
          h('article', { class: 'faq-item' }, [
            h('h3', {}, [badge('warn', item.kind), document.createTextNode(` ${item.actionId}`)]),
            h('p', { class: 'muted' }, [
              `${item.tenantId} / ${item.targetJobId} · epoch ${String(item.leaseEpoch)} · by ${item.operatorId} · ${item.createdAt}`,
            ]),
            h('p', {}, [item.reason]),
          ]),
        ),
      );
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      actionList.replaceChildren(
        errorState('Actions unavailable', asErrorMessage(error), {
          label: 'Retry',
          onClick: () => void refreshActions(),
        }),
      );
    }
  };

  await refreshIncidents();
  await refreshActions();
}

export function registerOperatorPages(): void {
  registerRoute({ path: '/operations', title: 'Operator console', render: renderOperator });
  registerRoute({ path: '/operator', title: 'Operator console', render: renderOperator });
}
