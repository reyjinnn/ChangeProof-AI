/* Inbox + notification preferences (T-47, WP3-29). Cursor-paged
 * list over the real notifications store; every action re-lists so the
 * count is always fresh from the server, never locally guessed. Run
 * links navigate; deep links render as plain text because the /app
 * surface they name is not this dashboard — never as hrefs. */

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, emptyState, errorState, h } from '../components.js';
import { registerRoute } from '../routes.js';

const PAGE_LIMIT = 20;
const CATEGORIES = ['results', 'blockers', 'access', 'quota', 'cleanup'] as const;

interface InboxSession {
  readonly authenticated: boolean;
}

interface InboxItem {
  readonly notificationId: string;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly deepLink?: string;
  readonly runId?: string;
  readonly readAt?: string;
  readonly createdAt: string;
}

interface InboxPage {
  readonly items: readonly InboxItem[];
  readonly unreadCount: number;
  readonly cursor: string;
}

interface InboxPreferences {
  readonly muted: readonly string[];
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

function expired(host: HTMLElement): void {
  window.location.hash = '#/session-expired';
  host.replaceChildren(emptyState('Session expired', 'Redirecting to login…'));
}

function categoryBadge(category: string): HTMLElement {
  if (category === 'blockers') return badge('bad', category);
  if (category === 'quota' || category === 'cleanup') return badge('warn', category);
  return badge('info', category);
}

async function renderInbox(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading your inbox.'));
  try {
    const session = await apiGet<InboxSession>('/api/auth/session');
    if (!session.authenticated) {
      loginCard(outlet, 'Inbox needs a login', 'Log in to see your notifications.');
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Inbox unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderInbox(outlet),
      }),
    );
    return;
  }

  const countLine = h('p', { id: 'inbox-count', 'aria-live': 'polite' }, []);
  const filterWrap = h('p', {}, []);
  const filterBox = h('input', { type: 'checkbox', id: 'inbox-unread-only' });
  const filterLabel = h('label', { for: 'inbox-unread-only' }, ['Unread only']);
  filterWrap.append(filterBox, document.createTextNode(' '), filterLabel);
  const readAll = h('button', { id: 'inbox-read-all', class: 'button', type: 'button' }, ['Mark all read']);
  const actionNote = h('p', { 'aria-live': 'polite' }, []);
  const list = h('div', { id: 'inbox-list' }, []);
  const moreWrap = h('p', {}, []);
  const prefsSection = h('section', { class: 'card' }, [
    h('h2', {}, ['Preferences']),
    h('p', { class: 'muted' }, ['Loading preferences…']),
  ]);
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, ['Inbox']),
      countLine,
      filterWrap,
      h('p', {}, [readAll]),
      actionNote,
    ]),
    h('section', { class: 'card' }, [h('h2', {}, ['Notifications']), list, moreWrap]),
    prefsSection,
  );

  let unreadOnly = false;
  let cursor = '';
  let failed = false;

  const fail = (error: unknown): void => {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    failed = true;
    list.replaceChildren(
      errorState('Inbox unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => {
          failed = false;
          void refresh();
        },
      }),
    );
  };

  const renderItem = (item: InboxItem): HTMLElement => {
    const read = item.readAt !== undefined;
    const readButton = read
      ? null
      : (() => {
          const button = h(
            'button',
            { class: 'button', type: 'button', 'data-mark-read': item.notificationId },
            ['Mark read'],
          );
          button.addEventListener('click', () => {
            button.disabled = true;
            void apiPost(`/api/notifications/${encodeURIComponent(item.notificationId)}/read`, {})
              .then(() => refresh())
              .catch((error: unknown) => {
                button.disabled = false;
                actionNote.replaceChildren(
                  h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]),
                );
              });
          });
          return button;
        })();
    const dismissButton = h(
      'button',
      { class: 'button', type: 'button', 'data-dismiss': item.notificationId },
      ['Dismiss'],
    );
    dismissButton.addEventListener('click', () => {
      dismissButton.disabled = true;
      void apiPost(`/api/notifications/${encodeURIComponent(item.notificationId)}/dismiss`, {})
        .then(() => refresh())
        .catch((error: unknown) => {
          dismissButton.disabled = false;
          actionNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        });
    });
    return h('article', { class: 'faq-item' }, [
      h('h3', {}, [categoryBadge(item.category), document.createTextNode(` ${item.title}`)]),
      h('p', { class: 'muted' }, [`${read ? 'Read' : 'Unread'} · ${item.createdAt}`]),
      h('p', {}, [item.body]),
      ...(item.runId === undefined
        ? []
        : [
            h('p', {}, [
              h('a', { href: `#/run?id=${encodeURIComponent(item.runId)}` }, ['Open run']),
            ]),
          ]),
      ...(item.deepLink === undefined
        ? []
        : [h('p', { class: 'muted' }, ['Deep link ', h('code', { class: 'inline' }, [item.deepLink])])]),
      h('p', {}, [
        ...(readButton === null ? [] : [readButton, document.createTextNode(' ')]),
        dismissButton,
      ]),
    ]);
  };

  const paint = (items: readonly InboxItem[], unreadCount: number, nextCursor: string, append: boolean): void => {
    countLine.replaceChildren(
      document.createTextNode(`${String(unreadCount)} unread · showing ${String(items.length)}`),
    );
    if (!append) list.replaceChildren();
    if (items.length === 0 && list.childElementCount === 0) {
      list.replaceChildren(
        emptyState('No notifications', 'Nothing here yet — runs you file will report here.'),
      );
    } else {
      for (const item of items) list.appendChild(renderItem(item));
    }
    cursor = nextCursor;
    moreWrap.replaceChildren();
    if (nextCursor !== '') {
      const more = h('button', { id: 'inbox-more', class: 'button', type: 'button' }, ['Load more']);
      more.addEventListener('click', () => {
        more.disabled = true;
        void loadPage(true).finally(() => {
          more.disabled = false;
        });
      });
      moreWrap.appendChild(more);
    }
  };

  const loadPage = async (append: boolean): Promise<void> => {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (append && cursor !== '') params.set('cursor', cursor);
    if (unreadOnly) params.set('unreadOnly', 'true');
    try {
      const page = await apiGet<InboxPage>(`/api/notifications?${params.toString()}`);
      if (failed) return;
      actionNote.replaceChildren();
      paint(page.items, page.unreadCount, page.cursor, append);
    } catch (error) {
      if (append) {
        actionNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        return;
      }
      fail(error);
    }
  };

  const refresh = async (): Promise<void> => {
    cursor = '';
    await loadPage(false);
  };

  filterBox.addEventListener('change', () => {
    unreadOnly = filterBox.checked;
    void refresh();
  });
  readAll.addEventListener('click', () => {
    readAll.disabled = true;
    void apiPost<{ marked: number }>('/api/notifications/read-all', {})
      .then((result) => {
        actionNote.replaceChildren(document.createTextNode(`Marked ${String(result.marked)} as read.`));
        return refresh().then(() => {
          // Refresh clears the note; restore the confirmation after it.
          actionNote.replaceChildren(document.createTextNode(`Marked ${String(result.marked)} as read.`));
        });
      })
      .catch((error: unknown) => {
        actionNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      })
      .finally(() => {
        readAll.disabled = false;
      });
  });

  const paintPreferences = (muted: readonly string[]): void => {
    const boxes = new Map<string, HTMLInputElement>();
    const note = h('p', { 'aria-live': 'polite' }, []);
    const save = h('button', { id: 'pref-save', class: 'button', type: 'button' }, ['Save preferences']);
    save.addEventListener('click', () => {
      const next = CATEGORIES.filter((category) => boxes.get(category)?.checked === true);
      save.disabled = true;
      void apiPost<InboxPreferences>('/api/notification-preferences', { muted: next })
        .then((saved) => {
          for (const category of CATEGORIES) {
            const box = boxes.get(category);
            if (box !== undefined) box.checked = saved.muted.includes(category);
          }
          note.replaceChildren(document.createTextNode('Preferences saved. Muted categories suppress future notifications at publish.'));
        })
        .catch((error: unknown) => {
          if (statusOf(error) === 401) {
            expired(outlet);
            return;
          }
          note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        })
        .finally(() => {
          save.disabled = false;
        });
    });
    prefsSection.replaceChildren(
      h('h2', {}, ['Preferences']),
      h('p', { class: 'muted' }, ['Muted categories never reach your inbox.']),
      h(
        'fieldset',
        {},
        [
          h('legend', {}, ['Muted categories']),
          ...CATEGORIES.map((category) => {
            const box = h('input', { type: 'checkbox', id: `pref-${category}` });
            box.checked = muted.includes(category);
            boxes.set(category, box);
            return h('p', {}, [box, document.createTextNode(' '), h('label', { for: `pref-${category}` }, [category])]);
          }),
        ],
      ),
      h('p', {}, [save]),
      note,
    );
  };

  const loadPreferences = async (): Promise<void> => {
    try {
      const preferences = await apiGet<InboxPreferences>('/api/notification-preferences');
      paintPreferences(preferences.muted);
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      prefsSection.replaceChildren(
        h('h2', {}, ['Preferences']),
        errorState('Preferences unavailable', asErrorMessage(error), {
          label: 'Retry',
          onClick: () => void loadPreferences(),
        }),
      );
    }
  };

  await refresh();
  await loadPreferences();
}

export function registerNotificationPages(): void {
  registerRoute({ path: '/inbox', title: 'Inbox', navLabel: 'Inbox', navSection: 'workspace', render: renderInbox });
}
