/* Usage & credits (T-49, WP3-24/31): the current usage period cap,
 * consumed and reserved totals, and open reservations. Invoices, the
 * credit ledger, spending limits, and checkout have no listing or write
 * endpoint — the backend only records provider webhook events — so the
 * page says so instead of faking tables or saved settings. */

import { apiGet, ApiRequestError } from '../api.js';
import { emptyState, errorState, field, h, head, padcard, pillIcon, row, staticBadge, table } from '../components.js';
import { registerRoute } from '../routes.js';

interface BillingSession {
  readonly authenticated: boolean;
}

interface Reservation {
  readonly reservationId: string;
  readonly runId: string;
  readonly state: string;
  readonly consumed: number;
  readonly reserved: number;
}

interface Balances {
  readonly periodId: string | null;
  readonly cap: number | null;
  readonly consumed: number;
  readonly reservedActive: number;
  readonly reservations: readonly Reservation[];
}

interface LedgerEntry {
  readonly entryId: string;
  readonly kind: string;
  readonly amount: string;
  readonly detail: string;
}

function loginCard(outlet: HTMLElement): void {
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, ['Billing needs a login']),
      h('p', {}, ['Log in to see this organization\u2019s usage and reservations.']),
      h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
    ]),
  );
}

function statCard(label: string, value: string, help: string, meterPercent: number | null): HTMLElement {
  const valueEl = h('div', { class: 'value' }, [value]);
  const card = h('section', { class: 'card stat' }, [
    h('div', { class: 'stat-top' }, [h('span', { class: 'label' }, [label]), pillIcon('usage')]),
    valueEl,
    h('div', { class: 'help' }, [help]),
  ]);
  if (meterPercent !== null) {
    const clamped = Math.min(100, Math.max(0, meterPercent));
    card.appendChild(h('div', { class: 'meter' }, [h('span', { style: `width:${String(clamped)}%` }, [])]));
  }
  return card;
}

function asLedgerEntries(data: unknown): LedgerEntry[] | null {
  const items = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as Record<string, unknown>)['items'])
      ? ((data as Record<string, unknown>)['items'] as unknown[])
      : null;
  if (items === null) return null;
  const entries: LedgerEntry[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    const entryId = record['entryId'] ?? record['id'];
    const kind = record['kind'] ?? record['type'];
    const amount = record['amount'];
    if (typeof entryId !== 'string' || typeof kind !== 'string') return null;
    const detail = record['detail'] ?? record['runId'] ?? '';
    entries.push({
      entryId,
      kind,
      amount: typeof amount === 'number' ? String(amount) : typeof amount === 'string' ? amount : '—',
      detail: typeof detail === 'string' ? detail : '',
    });
  }
  return entries;
}

function capsForm(cap: number): HTMLElement {
  const ceiling = field({ id: 'caps-ceiling', label: 'Credit ceiling per period', required: true, type: 'number' });
  ceiling.input.value = String(cap);
  ceiling.input.min = '1';
  const concurrency = field({ id: 'caps-concurrency', label: 'Max concurrent jobs', required: true, type: 'number' });
  concurrency.input.min = '1';
  concurrency.input.placeholder = 'Not reported by the service';
  const note = h('p', { 'aria-live': 'polite' }, []);
  const submit = h('button', { class: 'button', type: 'submit' }, ['Save limits']);
  const form = h('form', { id: 'capsForm', novalidate: 'novalidate' }, [
    h('div', { class: 'grid2' }, [ceiling.wrap, concurrency.wrap]),
    note,
    h('p', {}, [submit]),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Fail closed: no spending-limit endpoint exists, so nothing is sent
    // and nothing claims to be saved.
    note.replaceChildren(
      h('span', { class: 'error-text', role: 'alert' }, [
        'Not saved: the service exposes no spending-limit endpoint, so the period cap stays as it is.',
      ]),
    );
  });
  return padcard(
    'Budget & concurrency',
    h('div', {}, [
      form,
      h('p', { class: 'help' }, ['Only owners can raise the ceiling once the endpoint exists.']),
    ]),
  );
}

async function renderBilling(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the billing period.'));
  try {
    const session = await apiGet<BillingSession>('/api/auth/session');
    if (!session.authenticated) {
      loginCard(outlet);
      return;
    }
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
    outlet.replaceChildren(
      errorState('Billing unavailable', message, {
        label: 'Retry',
        onClick: () => void renderBilling(outlet),
      }),
    );
    return;
  }

  let balances: Balances;
  try {
    balances = await apiGet<Balances>('/api/billing/balances');
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
    outlet.replaceChildren(
      errorState('Billing unavailable', message, {
        label: 'Retry',
        onClick: () => void renderBilling(outlet),
      }),
    );
    return;
  }

  if (balances.periodId === null || balances.cap === null) {
    outlet.replaceChildren(
      h('section', { class: 'card' }, [
        emptyState(
          'No active billing period',
          'This organization has no spending cap yet, so new runs cannot be admitted. Ask your operator to set the initial entitlement; usage appears here afterwards.',
        ),
      ]),
    );
    return;
  }

  const remaining = balances.cap - balances.consumed - balances.reservedActive;
  const usedPercent = balances.cap > 0 ? ((balances.consumed + balances.reservedActive) / balances.cap) * 100 : 0;
  const stats = h('div', { class: 'stats' }, [
    statCard('Period cap', String(balances.cap), 'Active billing cycle cap', null),
    statCard('Consumed', String(balances.consumed), 'Settled run usage', usedPercent),
    statCard('Active reserved', String(balances.reservedActive), `${String(balances.reservations.length)} open reservation(s)`, null),
    statCard('Remaining', String(remaining), 'Available for new runs', null),
  ]);

  const reservations = balances.reservations.length === 0
    ? h('p', {}, ['No open reservations in this period.'])
    : table(
        ['Reservation', 'Run', 'State', 'Reserved', 'Consumed'],
        balances.reservations.map((reservation) => [
          reservation.reservationId,
          h('a', { href: `#/runs/${reservation.runId}` }, [reservation.runId]),
          reservation.state,
          String(reservation.reserved),
          String(reservation.consumed),
        ]),
      );

  const ledgerHost = h('div', {}, [
    h('p', { class: 'muted' }, ['Reading the credit ledger…']),
  ]);

  const checkoutNote = h('p', { 'aria-live': 'polite' }, []);
  const checkout = h('button', { class: 'button primary', type: 'button' }, ['Start checkout']);
  checkout.addEventListener('click', () => {
    checkoutNote.replaceChildren(
      h('span', { class: 'error-text', role: 'alert' }, [
        'Checkout is not configured: the service exposes no payment endpoint.',
      ]),
    );
  });

  outlet.replaceChildren(
    head('Usage & credits', 'Period cap, settled usage, reservations, and plan settlement.'),
    stats,
    h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('div', {}, [
          h('h2', {}, ['Usage & reservations']),
          h('div', { class: 'help' }, [
            `Period ${balances.periodId}: cap ${balances.cap}, consumed ${balances.consumed}, reserved ${balances.reservedActive}, remaining ${remaining}.`,
          ]),
        ]),
      ]),
      h('div', { class: 'pad' }, [reservations]),
    ]),
    h('div', { class: 'split' }, [
      h('div', {}, [
        h('section', { class: 'card' }, [
          h('div', { class: 'card-head' }, [
            h('div', {}, [
              h('h2', {}, ['Immutable credit ledger']),
              h('div', { class: 'help' }, ['Append-only entries; nothing here is edited or averaged.']),
            ]),
          ]),
          h('div', { class: 'pad' }, [ledgerHost]),
        ]),
        capsForm(balances.cap),
      ]),
      h('aside', {}, [
        padcard(
          'Current plan',
          h('div', {}, [
            row('Plan', staticBadge('not reported', '')),
            row('Period cap', `${String(balances.cap)} credits`),
            row('Settlement', 'Provider webhooks only'),
            h('p', { class: 'help' }, [
              'There is no invoice listing: the service records provider payment webhooks but exposes no invoice or payment-method endpoint, so charges live with the payment provider.',
            ]),
            checkoutNote,
            h('p', {}, [checkout]),
          ]),
        ),
      ]),
    ]);
  outlet.replaceChildren(
    pageHead({ title: 'Usage & data', subtitle: 'Your current billing period, reservations, and data controls.' }),
    entitlement,
    stats,
    h('div', { class: 'split' }, [reservations, invoices]),
    h('div', { class: 'grid2' }, [
      h('section', { class: 'card' }, [h('h2', {}, ['Data and privacy']), h('p', {}, ['Provider terms, region, and retention must be confirmed by the operator. This preview does not promise a retention period.']), h('a', { href: '#/p/privacy-policy' }, ['Read the draft privacy policy'])]),
      h('section', { class: 'card' }, [h('h2', {}, ['Data deletion']), h('p', {}, ['Organization owners can review the real deletion controls and pending status in privacy settings.']), h('a', { href: '#/privacy' }, ['Open privacy & data controls'])]),
    ]),
  );

  try {
    const entries = asLedgerEntries(await apiGet<unknown>('/api/billing/ledger?limit=50'));
    if (entries === null || entries.length === 0) {
      ledgerHost.replaceChildren(
        h('div', { class: 'empty-state' }, [
          h('h2', {}, ['No ledger entries']),
          h('p', {}, [
            'No usage has settled in this period yet. Entries appear here as runs consume reserved credits.',
          ]),
        ]),
      );
    } else {
      ledgerHost.replaceChildren(
        table(
          ['Entry', 'Kind', 'Amount', 'Details'],
          entries.map((entry) => [entry.entryId, entry.kind, entry.amount, entry.detail]),
        ),
      );
    }
  } catch {
    ledgerHost.replaceChildren(
      h('div', { class: 'empty-state' }, [
        h('h2', {}, ['Ledger unavailable']),
        h('p', {}, [
          'The credit ledger could not be loaded. Settled usage stays visible in the period totals above.',
        ]),
      ]),
    );
  }
}

export function registerBillingPages(): void {
  registerRoute({
    path: '/usage',
    title: 'Usage & credits',
    navLabel: 'Usage & credits',
    navSection: 'workspace',
    render: renderBilling,
  });
  registerRoute({ path: '/billing', title: 'Billing', render: renderBilling });
}
