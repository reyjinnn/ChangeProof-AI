/* Billing (T-49, WP3-24/31): the current usage period cap, consumed
 * and reserved totals, and open reservations. Invoices and payment
 * methods have no listing endpoint — the backend only records provider
 * webhook events — so the page says so instead of faking a table. */

import { apiGet, ApiRequestError } from '../api.js';
import { emptyState, errorState, h, pageHead } from '../components.js';
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

function loginCard(outlet: HTMLElement): void {
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, ['Billing needs a login']),
      h('p', {}, ['Log in to see this organization\u2019s usage and reservations.']),
      h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
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
      pageHead({ title: 'Usage & data', subtitle: 'Your current billing period and data controls.' }),
      emptyState('Usage period not configured', 'This organization has no active usage entitlement. Ask your operator to configure the period and cap before submitting a run.'),
      h('section', { class: 'card' }, [h('h2', {}, ['Data and privacy']), h('p', {}, ['Account and organization data controls remain available.']), h('a', { href: '#/privacy' }, ['Open privacy & data controls'])]),
    );
    return;
  }

  const cap = balances.cap;
  const rows = balances.reservations.map((reservation) =>
    h('tr', {}, [
      h('td', {}, [reservation.reservationId]),
      h('td', {}, [h('a', { href: `#/run?id=${encodeURIComponent(reservation.runId)}` }, [reservation.runId])]),
      h('td', {}, [reservation.state]),
      h('td', {}, [String(reservation.reserved)]),
      h('td', {}, [String(reservation.consumed)]),
    ]),
  );

  const remaining = balances.cap - balances.consumed - balances.reservedActive;
  const stats = h('div', { class: 'stats' }, [
    h('div', { class: 'stat' }, [
      h('div', { class: 'label' }, ['Period cap']),
      h('div', { class: 'value' }, [String(balances.cap)]),
      h('div', { class: 'sub' }, ['Active billing cycle cap']),
    ]),
    h('div', { class: 'stat' }, [
      h('div', { class: 'label' }, ['Consumed']),
      h('div', { class: 'value' }, [String(balances.consumed)]),
      h('div', { class: 'sub' }, ['Settled run usage']),
    ]),
    h('div', { class: 'stat' }, [
      h('div', { class: 'label' }, ['Active reserved']),
      h('div', { class: 'value' }, [String(balances.reservedActive)]),
      h('div', { class: 'sub' }, [`${String(balances.reservations.length)} open reservation(s)`]),
    ]),
    h('div', { class: 'stat' }, [
      h('div', { class: 'label' }, ['Remaining']),
      h('div', { class: 'value' }, [String(remaining)]),
      h('div', { class: 'sub' }, ['Available for new runs']),
    ]),
  ]);

  const percent = (value: number): string => `${Math.min(100, Math.max(0, cap > 0 ? value / cap * 100 : 0))}%`;
  const entitlement = h('section', { class: 'card usage-entitlement' }, [
    h('div', { class: 'card-head' }, [h('h2', {}, ['Current period entitlement']), h('span', { class: 'badge' }, [balances.periodId])]),
    h('div', { class: 'pad' }, [
      h('p', {}, [h('strong', {}, [String(balances.consumed + balances.reservedActive)]), ` of ${balances.cap} · ${remaining} remaining`]),
      h('div', { class: 'usage-bar', role: 'img', 'aria-label': `${balances.consumed} used, ${balances.reservedActive} reserved, ${remaining} remaining` }, [
        h('span', { class: 'settled', style: `width:${percent(balances.consumed)}` }),
        h('span', { class: 'reserved', style: `width:${percent(balances.reservedActive)}` }),
      ]),
      h('div', { class: 'legend' }, [h('span', {}, [`Used (settled) ${balances.consumed}`]), h('span', {}, [`Reserved ${balances.reservedActive}`])]),
      h('p', { class: 'help' }, ['Usage and reservation status are separate from run status and verification verdicts.']),
    ]),
  ]);
  const reservations = h('section', { class: 'card' }, [
      h('h2', {}, ['Usage & reservations']),
      h('p', {}, [`Period ${balances.periodId}: cap ${balances.cap}, consumed ${balances.consumed}, reserved ${balances.reservedActive}, remaining ${remaining}.`]),
      balances.reservations.length === 0
        ? h('p', {}, ['No open reservations in this period.'])
        : h('div', { class: 'table-wrap' }, [h('table', {}, [
            h('thead', {}, [
              h('tr', {}, [
                h('th', {}, ['Reservation']),
                h('th', {}, ['Run']),
                h('th', {}, ['State']),
                h('th', {}, ['Reserved']),
                h('th', {}, ['Consumed']),
              ]),
            ]),
            h('tbody', {}, rows),
          ])]),
    ]);
  const invoices = h('section', { class: 'card' }, [
      h('div', { class: 'eyebrow' }, ['Provider Settlement']),
      h('h2', {}, ['Invoices']),
      h('p', {}, [
        'There is no invoice listing: the service records provider payment webhooks but exposes no invoice or payment-method endpoint, so charges live with the payment provider.',
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
}

export function registerBillingPages(): void {
  registerRoute({ path: '/billing', title: 'Billing', navLabel: 'Billing', navSection: 'workspace', render: renderBilling });
}
