/* Billing (T-49, WP3-24/31): the current usage period cap, consumed
 * and reserved totals, and open reservations. Invoices and payment
 * methods have no listing endpoint — the backend only records provider
 * webhook events — so the page says so instead of faking a table. */

import { apiGet, ApiRequestError } from '../api.js';
import { emptyState, errorState, h } from '../components.js';
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
  readonly periodId: string;
  readonly cap: number;
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

  const rows = balances.reservations.map((reservation) =>
    h('tr', {}, [
      h('td', {}, [reservation.reservationId]),
      h('td', {}, [h('a', { href: `#/runs/${reservation.runId}` }, [reservation.runId])]),
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

  outlet.replaceChildren(
    stats,
    h('section', { class: 'card' }, [
      h('div', { class: 'eyebrow' }, ['Usage & Reservations']),
      h('h1', {}, ['Billing']),
      h('p', {}, [`Period ${balances.periodId}: cap ${balances.cap}, consumed ${balances.consumed}, reserved ${balances.reservedActive}, remaining ${remaining}.`]),
      balances.reservations.length === 0
        ? h('p', {}, ['No open reservations in this period.'])
        : h('table', {}, [
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
          ]),
    ]),
    h('section', { class: 'card' }, [
      h('div', { class: 'eyebrow' }, ['Provider Settlement']),
      h('h2', {}, ['Invoices']),
      h('p', {}, [
        'There is no invoice listing: the service records provider payment webhooks but exposes no invoice or payment-method endpoint, so charges live with the payment provider.',
      ]),
    ]),
  );
}

export function registerBillingPages(): void {
  registerRoute({ path: '/billing', title: 'Billing', navLabel: 'Billing', navSection: 'workspace', render: renderBilling });
}
