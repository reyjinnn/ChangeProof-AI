/* Workspace shell (mockup 1269, 1371-1512, 1585-1601, 1905-1909).
 * body.modern-design always; per-route modes add public-website (+
 * clarity-landing on the landing page), auth-page, or nothing (workspace).
 * is-collapsed narrows the sidebar rail; below 760px it is an off-canvas
 * drawer with .nav-scrim and a focus trap. All labels are English (FR3-40).
 * Dynamic data (org name, identity, notifications, usage) renders through
 * textContent-safe builders; API failures show honest fallback states. */

import { apiGet, apiPost } from './api.js';
import {
  changeproofMarkSvg,
  closeCustomSelect,
  drawer,
  enhanceCustomSelects,
  enhanceFilePickers,
  ensureEmptyStateArt,
  h,
  iconSvg,
  toast,
  type IconName,
} from './components.js';
import { openSearchPalette } from './pages/search.js';
import { loadSidebarCollapsed, loadTheme, saveSidebarCollapsed, saveTheme, SESSION_CHANGED_EVENT } from './store.js';

export interface Shell {
  readonly root: HTMLElement;
  readonly outlet: HTMLElement;
}

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  '/',
  '/landing',
  '/product',
  '/how-it-works',
  '/pricing',
  '/documentation',
  '/guides',
  '/tutorials',
  '/help',
  '/security',
  '/enterprise',
  '/self-hosted',
  '/templates',
  '/integrations',
  '/sample-report',
  '/status',
  '/changelog',
  '/roadmap',
  '/about',
  '/contact',
  '/privacy',
  '/privacy-policy',
  '/terms',
  '/impact-overview',
  '/verification',
  '/evidence-overview',
  '/collaboration',
]);

export const AUTH_ROUTES: ReadonlySet<string> = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/check-email',
  '/reset-password',
  '/verify-email',
  '/session-expired',
  '/recover',
  '/verify',
  '/create-org',
  '/onboarding',
  '/new-project',
  '/orgs/claim',
]);

export type ShellMode = 'public' | 'auth' | 'workspace';

export function shellModeFor(path: string): ShellMode {
  if (PUBLIC_ROUTES.has(path) || path.startsWith('/p/')) return 'public';
  if (AUTH_ROUTES.has(path)) return 'auth';
  return 'workspace';
}

const NAV_GROUPS: readonly {
  readonly label: string;
  readonly items: readonly { id: string; icon: IconName; label: string; href: string }[];
}[] = [
  {
    label: 'WORKSPACE',
    items: [
      { id: 'dashboard', icon: 'dashboard', label: 'Overview', href: '#/dashboard' },
      { id: 'projects', icon: 'projects', label: 'Projects', href: '#/projects' },
      { id: 'runs', icon: 'runs', label: 'Runs', href: '#/runs' },
      { id: 'new-run', icon: 'plus', label: 'New run', href: '#/new-run' },
      { id: 'evidence-library', icon: 'evidence', label: 'Evidence', href: '#/evidence-library' },
    ],
  },
  {
    label: 'ORGANIZATION',
    items: [
      { id: 'repositories', icon: 'git', label: 'Repositories', href: '#/repositories' },
      { id: 'capabilities', icon: 'shield', label: 'Capabilities', href: '#/capabilities' },
      { id: 'usage', icon: 'usage', label: 'Usage & credits', href: '#/usage' },
      { id: 'team', icon: 'team', label: 'Team & access', href: '#/team' },
      { id: 'settings', icon: 'settings', label: 'Settings', href: '#/settings' },
    ],
  },
  {
    label: 'RESOURCES',
    items: [
      { id: 'documentation', icon: 'book', label: 'Product guide', href: '#/documentation' },
      { id: 'support', icon: 'support', label: 'Help & status', href: '#/support' },
    ],
  },
];

/** Sub-routes highlight their parent nav entry (mockup 1269 mapping). */
const NAV_PARENT: ReadonlyMap<string, string> = new Map([
  ['project-detail', 'projects'],
  ['new-project', 'projects'],
  ['project-settings', 'projects'],
  ['telemetry', 'projects'],
  ['characterization', 'projects'],
  ['environments', 'projects'],
  ['impact', 'runs'],
  ['investigation', 'runs'],
  ['campaigns', 'runs'],
  ['publication', 'runs'],
  ['outcome', 'runs'],
  ['review', 'runs'],
  ['running', 'runs'],
  ['run-created', 'runs'],
  ['evidence', 'evidence-library'],
  ['account', 'settings'],
  ['privacy', 'settings'],
  ['audit', 'settings'],
  ['create-org', 'settings'],
  ['onboarding', 'repositories'],
  ['service-status', 'support'],
  ['ui-states', 'support'],
  ['operations', 'settings'],
  ['evaluations', 'runs'],
]);

const SCREEN_NAMES: ReadonlyMap<string, string> = new Map([
  ['dashboard', 'Overview'],
  ['projects', 'Projects'],
  ['project-detail', 'Project overview'],
  ['runs', 'Runs'],
  ['review', 'Review run'],
  ['running', 'Active run'],
  ['new-run', 'New run'],
  ['evidence', 'Run evidence'],
  ['evidence-library', 'Evidence library'],
  ['team', 'Team & access'],
  ['usage', 'Usage & credits'],
  ['billing', 'Usage & credits'],
  ['runs/new', 'New run'],
  ['run', 'Run details'],
  ['evidence/view', 'Run evidence'],
  ['inbox', 'Inbox'],
  ['operator', 'Operator console'],
  ['threads', 'Discussions'],
  ['orgs/claim', 'Create organization'],
  ['invitations/accept', 'Accept invitation'],
  ['enterprise', 'Enterprise'],
  ['onboarding', 'Connect GitHub'],
  ['create-org', 'Create organization'],
  ['new-project', 'Create project'],
  ['repositories', 'GitHub connections'],
  ['capabilities', 'Capabilities'],
  ['impact', 'Dependency graph'],
  ['investigation', 'Investigation'],
  ['campaigns', 'Verification campaign'],
  ['publication', 'Publication'],
  ['outcome', 'Owner validation'],
  ['telemetry', 'Telemetry'],
  ['project-settings', 'Project settings'],
  ['settings', 'Organization settings'],
  ['account', 'Account & sessions'],
  ['audit', 'Activity log'],
  ['support', 'Help & status'],
  ['documentation', 'Product guide'],
  ['invite', 'Accept invitation'],
  ['access-denied', 'Access denied'],
  ['session-expired', 'Session expired'],
  ['service-status', 'Service status'],
  ['privacy', 'Data & privacy'],
  ['characterization', 'Legacy characterization'],
  ['run-created', 'Run created'],
  ['ui-states', 'Status & errors'],
  ['environments', 'Environment & topology'],
  ['evaluations', 'Evaluation reports'],
  ['operations', 'Operator console'],
]);

function smallViewport(): boolean {
  try {
    return window.matchMedia('(max-width:760px)').matches;
  } catch {
    return false;
  }
}

function sidebarCollapsed(): boolean {
  return document.body.classList.contains('is-collapsed');
}

export function closeMenu(): void {
  const sidebar = document.getElementById('sidebar');
  const hadFocus = sidebar?.contains(document.activeElement) === true;
  const wasOpen = sidebar?.classList.contains('open') === true;
  sidebar?.classList.remove('open');
  document.getElementById('navScrim')?.remove();
  document.body.classList.remove('nav-open');
  document.querySelector('.menu-button')?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  updateSidebarState();
  if (wasOpen && hadFocus && smallViewport()) {
    document.querySelector<HTMLElement>('.topbar-menu')?.focus();
  }
}

export function updateSidebarState(): void {
  const collapsed = sidebarCollapsed();
  const expanded = !collapsed;
  const collapse = document.querySelector('.sidebar-collapse');
  collapse?.setAttribute('aria-expanded', String(expanded));
  collapse?.setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
  const menu = document.querySelector('.topbar-menu');
  const sidebarOpen = document.getElementById('sidebar')?.classList.contains('open') === true;
  menu?.setAttribute('aria-expanded', String(smallViewport() ? sidebarOpen : expanded));
  menu?.setAttribute('aria-label', smallViewport() ? 'Open navigation' : expanded ? 'Collapse sidebar' : 'Expand sidebar');
  const sidebar = document.getElementById('sidebar');
  if (sidebar !== null) {
    const hidden = smallViewport() && !sidebarOpen;
    try {
      (sidebar as HTMLElement & { inert?: boolean }).inert = hidden;
    } catch {
      // Older engines ignore inert; aria-hidden still communicates state.
    }
    sidebar.setAttribute('aria-hidden', String(hidden));
  }
  document.getElementById('sidebarTooltipRoot')?.replaceChildren();
}

export function toggleSidebar(): void {
  closeFloatingPanels();
  if (smallViewport()) {
    if (document.getElementById('sidebar')?.classList.contains('open') === true) {
      closeMenu();
      return;
    }
    document.getElementById('sidebar')?.classList.add('open');
    const sidebar = document.getElementById('sidebar');
    if (sidebar !== null) {
      try {
        (sidebar as HTMLElement & { inert?: boolean }).inert = false;
      } catch {
        // Ignore: aria-hidden below still communicates state.
      }
      sidebar.setAttribute('aria-hidden', 'false');
    }
    document.querySelector('.topbar-menu')?.setAttribute('aria-expanded', 'true');
    document.getElementById('navScrim')?.remove();
    const scrim = h('div', { id: 'navScrim', class: 'nav-scrim' }, []);
    scrim.addEventListener('click', closeMenu);
    document.body.appendChild(scrim);
    document.body.style.overflow = 'hidden';
    document.getElementById('menuClose')?.focus();
    return;
  }
  const next = !sidebarCollapsed();
  saveSidebarCollapsed(next);
  document.body.classList.toggle('is-collapsed', next);
  updateSidebarState();
}

function showSidebarTip(target: HTMLElement): void {
  if (!sidebarCollapsed() || smallViewport()) return;
  const host = document.getElementById('sidebarTooltipRoot');
  if (host === null) return;
  const rect = target.getBoundingClientRect();
  const graphic = target.querySelector('svg');
  const label = target.dataset['label'] ?? target.getAttribute('aria-label') ?? '';
  const tip = h('div', { class: 'sidebar-tooltip', role: 'tooltip' }, [label]);
  tip.setAttribute('style', `left:${String(rect.right + 20)}px;top:${String(Math.max(16, Math.min(window.innerHeight - 62, rect.top)))}px`);
  if (graphic !== null) tip.prepend(graphic.cloneNode(true));
  host.replaceChildren(tip);
}

function hideSidebarTip(): void {
  document.getElementById('sidebarTooltipRoot')?.replaceChildren();
}

/* Floating panels: notifications + account (mockup 1463-1502). */

let notificationOpen = false;
let accountOpen = false;

export function closeNotifications(): void {
  notificationOpen = false;
  document.getElementById('notificationRoot')?.replaceChildren();
  document.querySelector('[data-modern="notifications"]')?.setAttribute('aria-expanded', 'false');
}

export function closeAccount(): void {
  accountOpen = false;
  document.getElementById('accountRoot')?.replaceChildren();
  document.querySelector('[data-modern="account"]')?.setAttribute('aria-expanded', 'false');
}

export function closeFloatingPanels(): void {
  closeCustomSelect();
  closeNotifications();
  closeAccount();
  hideSidebarTip();
}

interface NotificationItem {
  readonly id: string;
  readonly kind: 'info' | 'success' | 'error';
  readonly symbol: IconName;
  readonly title: string;
  readonly text: string;
  readonly time: string;
  readonly href: string;
  read: boolean;
}

function asNotificationItems(data: unknown): NotificationItem[] | null {
  if (!Array.isArray(data)) return null;
  const items: NotificationItem[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record['id'] !== 'string' || typeof record['title'] !== 'string') return null;
    const kind = record['kind'];
    items.push({
      id: record['id'],
      kind: kind === 'success' || kind === 'error' ? kind : 'info',
      symbol: 'bell',
      title: record['title'],
      text: typeof record['text'] === 'string' ? (record['text']) : '',
      time: typeof record['time'] === 'string' ? (record['time']) : '',
      href: typeof record['href'] === 'string' ? (record['href']) : '#/runs',
      read: record['read'] === true,
    });
  }
  return items;
}

let cachedNotifications: NotificationItem[] | null = null;
let notificationsFailed = false;

function syncNotificationDot(): void {
  const dot = document.getElementById('notificationDot');
  if (dot === null) return;
  const unread = cachedNotifications?.some((item) => !item.read) === true;
  dot.hidden = !unread;
}

function notificationArticle(item: NotificationItem, index: number): HTMLElement {
  const article = h(
    'article',
    { class: `notification-toast ${item.kind}${item.read ? ' is-read' : ''}`, style: `--i:${String(index)}` },
    [],
  );
  const iconSlot = h('span', { class: 'event-icon', 'aria-hidden': 'true' }, []);
  iconSlot.appendChild(iconSvg(item.symbol));
  const heading = h('h3', {}, [item.title]);
  if (!item.read) heading.prepend(h('i', { class: 'read-dot', 'aria-hidden': 'true' }, []));
  const meta = h('div', { class: 'notification-meta' }, [
    h('span', {}, [`${item.read ? 'Read · ' : ''}${item.time}`]),
    h('a', { href: item.href }, ['View details →']),
  ]);
  const dismiss = h('button', { type: 'button', 'aria-label': `Dismiss notification: ${item.title}` }, []);
  dismiss.appendChild(iconSvg('close'));
  dismiss.addEventListener('click', () => {
    cachedNotifications = (cachedNotifications ?? []).filter((entry) => entry.id !== item.id);
    renderNotifications();
  });
  const actions = h('div', { class: 'notification-actions' }, [dismiss]);
  if (!item.read) {
    const mark = h('button', { type: 'button', 'aria-label': `Mark as read: ${item.title}`, title: 'Mark as read' }, []);
    mark.appendChild(iconSvg('check'));
    mark.addEventListener('click', () => {
      item.read = true;
      renderNotifications();
    });
    actions.appendChild(mark);
  }
  article.append(iconSlot, h('div', { class: 'notification-body' }, [heading, h('p', {}, [item.text]), meta]), actions);
  return article;
}

function renderNotifications(): void {
  const host = document.getElementById('notificationRoot');
  if (host === null) return;
  const unread = cachedNotifications?.filter((item) => !item.read).length ?? 0;
  const heading = h('strong', {}, ['Notifications']);
  if (unread > 0) heading.appendChild(h('span', {}, [` (${String(unread)})`]));
  const markAll = h('button', { class: 'mark-all', type: 'button' }, ['Mark all as read']);
  markAll.addEventListener('click', () => {
    cachedNotifications?.forEach((item) => (item.read = true));
    renderNotifications();
    toast('All notifications marked as read.', 'success');
  });
  const close = h('button', { class: 'close-notifications', type: 'button', 'aria-label': 'Close notifications' }, ['×']);
  close.addEventListener('click', closeNotifications);
  const stack = h('section', { class: 'notification-stack', 'aria-label': 'Workspace notifications' }, [
    h('div', { class: 'notification-stack-head' }, [heading, markAll, close]),
  ]);
  if (cachedNotifications === null) {
    const empty = h('div', { class: 'notification-empty' }, []);
    empty.appendChild(iconSvg('bell'));
    empty.appendChild(
      document.createTextNode(notificationsFailed ? 'Notifications are unavailable right now.' : 'Loading notifications…'),
    );
    stack.appendChild(empty);
  } else if (cachedNotifications.length === 0) {
    const empty = h('div', { class: 'notification-empty' }, []);
    empty.appendChild(iconSvg('bell'));
    empty.appendChild(document.createTextNode('All clear. No notifications.'));
    stack.appendChild(empty);
  } else {
    for (const [index, item] of cachedNotifications.entries()) stack.appendChild(notificationArticle(item, index));
  }
  host.replaceChildren(stack);
  syncNotificationDot();
  positionNotificationMenu();
}

/** Fixed-position panel anchored to the bell control and profile capsule. */
export function positionNotificationMenu(): void {
  const stack = document.querySelector('.notification-stack');
  if (!(stack instanceof HTMLElement)) return;
  const trigger = document.querySelector('.topbar [data-modern="notifications"]');
  if (trigger instanceof HTMLElement) {
    const anchor = trigger.getBoundingClientRect();
    if (anchor.width > 0 || anchor.height > 0) {
      const capsule = trigger.closest('.header-profile-group')?.getBoundingClientRect();
      const edge = 12;
      const width = Math.min(420, window.innerWidth - edge * 2);
      const left = Math.max(edge, Math.min(anchor.right - width, window.innerWidth - width - edge));
      const top = (capsule?.bottom ?? anchor.bottom) + 8;
      Object.assign(stack.style, {
        left: `${String(left)}px`,
        right: 'auto',
        top: `${String(top)}px`,
        width: `${String(width)}px`,
        maxWidth: `${String(width)}px`,
        maxHeight: `${String(Math.max(80, window.innerHeight - top - edge))}px`,
        overflowY: 'auto',
      });
      return;
    }
  }
  if (window.innerWidth < 480) {
    stack.style.left = '12px';
    stack.style.right = '12px';
  }
}

export function toggleNotifications(): void {
  closeAccount();
  if (notificationOpen) {
    closeNotifications();
    return;
  }
  notificationOpen = true;
  document.querySelector('[data-modern="notifications"]')?.setAttribute('aria-expanded', 'true');
  renderNotifications();
  positionNotificationMenu();
  if (cachedNotifications === null && !notificationsFailed) {
    void apiGet<unknown>('/api/notifications')
      .then((data) => {
        cachedNotifications = asNotificationItems(data) ?? [];
        if (notificationOpen) renderNotifications();
        syncNotificationDot();
      })
      .catch(() => {
        notificationsFailed = true;
        if (notificationOpen) renderNotifications();
      });
  }
}

export interface AccountPopoverState {
  readonly authenticated: boolean;
  readonly name: string;
  readonly detail: string;
  readonly initials: string;
}

let accountState: AccountPopoverState = { authenticated: false, name: 'Guest', detail: 'Not signed in', initials: 'G' };

export function setAccountPopoverState(state: AccountPopoverState): void {
  accountState = state;
}

/** Fixed-position panel anchored to the avatar control and profile capsule. */
export function positionAccountMenu(): void {
  const popover = document.querySelector('.account-popover');
  if (!(popover instanceof HTMLElement)) return;
  const trigger = document.querySelector('.topbar [data-modern="account"]');
  if (trigger instanceof HTMLElement) {
    const anchor = trigger.getBoundingClientRect();
    if (anchor.width > 0 || anchor.height > 0) {
      const capsule = trigger.closest('.header-profile-group')?.getBoundingClientRect();
      const edge = 12;
      const gap = 8;
      const width = Math.min(280, window.innerWidth - edge * 2);
      const left = Math.max(edge, Math.min(anchor.right - width, window.innerWidth - width - edge));
      const top = Math.max(edge, Math.min((capsule?.bottom ?? anchor.bottom) + gap, window.innerHeight - popover.offsetHeight - edge));
      Object.assign(popover.style, {
        left: `${String(left)}px`,
        right: 'auto',
        top: `${String(top)}px`,
        width: `${String(width)}px`,
        maxHeight: `${String(Math.max(100, window.innerHeight - top - edge))}px`,
        overflowY: 'auto',
      });
      return;
    }
  }
  if (window.innerWidth < 480) {
    popover.style.left = '12px';
    popover.style.right = '12px';
  }
}

export function toggleAccount(): void {
  closeNotifications();
  if (accountOpen) {
    closeAccount();
    return;
  }
  const host = document.getElementById('accountRoot');
  if (host === null) return;
  accountOpen = true;
  document.querySelector('[data-modern="account"]')?.setAttribute('aria-expanded', 'true');
  const link = (href: string, icon: IconName, label: string): HTMLElement => {
    const anchor = h('a', { href }, [label]);
    anchor.prepend(iconSvg(icon));
    return anchor;
  };
  const identity = h('div', { class: 'account-identity' }, [
    h('span', { class: 'avatar-circle' }, [accountState.initials]),
    h('div', {}, [h('strong', {}, [accountState.name]), h('small', {}, [accountState.detail])]),
  ]);
  const popover = h('section', { class: 'account-popover', 'aria-label': 'Account menu' }, [
    identity,
    link('#/account', 'user', 'Profile & sessions'),
    link('#/settings', 'settings', 'Settings'),
    link('#/privacy', 'lock', 'Data & privacy'),
  ]);
  if (accountState.authenticated) {
    const signout = h('button', { class: 'signout', type: 'button' }, ['Sign out']);
    signout.prepend(iconSvg('logout'));
    signout.addEventListener('click', () => {
      signout.disabled = true;
      void apiPost('/api/auth/logout', {})
        .catch(() => undefined)
        .then(() => {
          closeAccount();
          window.location.hash = '#/';
          window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
        });
    });
    popover.appendChild(signout);
  } else {
    popover.appendChild(link('#/login', 'arrow', 'Sign in'));
  }
  host.replaceChildren(popover);
  positionAccountMenu();
}

function openHelpDrawer(trigger: HTMLElement): void {
  drawer(
    trigger,
    'Quick help',
    h('div', {}, [
      h('p', {}, ['Press Ctrl+K to search runs and projects. Contact support from Help & status.']),
      h('div', { class: 'drawer-note' }, ['Verification outcomes always come from the service, never from this page.']),
    ]),
  );
}

function openWorkspaceDrawer(trigger: HTMLElement): void {
  const org = document.getElementById('orgLabel')?.textContent ?? 'Workspace';
  drawer(
    trigger,
    'Switch workspace',
    h('div', {}, [
      h('p', {}, [`Current workspace: ${org}. Workspace switching opens organization settings.`]),
      h('div', { class: 'drawer-note' }, ['Creating an organization does not grant repository access by itself.']),
    ]),
  );
}

async function refreshPlanMeter(host: HTMLElement): Promise<void> {
  try {
    const data = (await apiGet<unknown>('/api/billing/summary')) as Record<string, unknown> | null;
    const used = typeof data?.['used'] === 'number' ? (data['used']) : null;
    const limit = typeof data?.['limit'] === 'number' ? (data['limit']) : null;
    const tier = typeof data?.['tier'] === 'string' ? (data['tier']) : 'Plan';
    if (used === null || limit === null || limit <= 0) throw new Error('unusable summary');
    const percent = Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
    const bar = h('div', { class: 'meter' }, [h('span', { style: `width:${String(percent)}%` }, [])]);
    host.replaceChildren(
      h('div', {}, [
        h('strong', {}, [tier]),
        h('span', {}, [` ${String(used)} / ${String(limit)} cr`]),
      ]),
      bar,
      h('a', { href: '#/usage' }, ['Manage usage →']),
    );
  } catch {
    host.replaceChildren(
      h('div', {}, [h('strong', {}, ['Usage']), h('span', {}, ['Unavailable'])]),
      h('div', { class: 'meter' }, []),
      h('a', { href: '#/usage' }, ['Manage usage →']),
    );
  }
}

function themeButton(): HTMLElement {
  const button = h(
    'button',
    { type: 'button', class: 'icon-btn theme-toggle', 'data-evidence': 'theme', 'aria-label': 'Toggle theme', 'aria-pressed': 'false' },
    [],
  );
  const sync = (): void => {
    const theme = document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
    button.replaceChildren(iconSvg(theme === 'dark' ? 'sun' : 'moon', 'icon'));
    button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  };
  button.addEventListener('click', () => {
    saveTheme(document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark');
    sync();
  });
  sync();
  return button;
}

let currentSlug = '';
let isPostProcessing = false;

function decorateGetStartedCtas(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('a.primary, button.primary, a.modern-button').forEach((control) => {
    const text = control.textContent.trim();
    if (/^(get started|start workspace|start free)\b/i.test(text)) {
      control.classList.add('cp-get-started-cta');
    }
  });
}

const FOLD_TITLES: Readonly<Record<string, readonly string[]>> = {
  review: ['Evidence labels', 'Claim limits', 'Actual usage', 'Required checks', 'Observed run events'],
  evidence: ['Identity bound to the manifest', 'Identity bound to the run', 'Retention'],
  'evidence-library': ['Identity bound to the manifest', 'Identity bound to the run', 'Retention'],
  repositories: ['Webhook receipts', 'When access is revoked'],
  impact: ['Scope & unknowns'],
  campaigns: ['Experiment plan', 'Mixed-version rollout'],
  settings: ['Ownership transfer', 'Delete organization'],
  operations: ['Release & recovery', 'Admission & fairness'],
  operator: ['Release & recovery', 'Admission & fairness'],
  evaluations: ['Required breakdown', 'Qualification gates'],
};

function refineWorkspaceContent(content: HTMLElement, slug: string): void {
  const titles = FOLD_TITLES[slug];
  if (titles !== undefined) {
    content.querySelectorAll<HTMLElement>('.card').forEach((cardEl) => {
      if (cardEl.closest('details.compact-detail') !== null || cardEl.querySelector('form') !== null) return;
      const title = cardEl.querySelector('h2')?.textContent.trim() ?? '';
      if (!titles.includes(title)) return;
      const details = h('details', { class: 'compact-detail' }, [h('summary', {}, [title])]);
      cardEl.before(details);
      details.appendChild(cardEl);
    });
  }
  content.querySelectorAll<HTMLButtonElement>('button[data-action], button[data-modern], button[data-go]').forEach((button) => {
    if (
      button.matches('.primary, .danger, .chip, .icon-btn, .tab, .link-button, [disabled]') ||
      button.closest('.filterbar, .tabs, .project-card, .welcome-panel, .quick-card') !== null
    ) {
      return;
    }
    button.classList.add('tonal-action');
    const action = button.dataset['action'] ?? button.dataset['modern'] ?? '';
    if (/^(validate|reconnect|approve|confirm|save)/.test(action)) button.classList.add('tonal-success');
    if (/^(disconnect|delete|revoke|cancel-run)/.test(action)) button.classList.add('tonal-danger');
  });
  if (['project-detail', 'capabilities', 'evidence-library', 'repositories', 'projects'].includes(slug)) {
    content.querySelector('.pagehead')?.classList.add('project-heading');
  }
}

function postProcessContent(content: HTMLElement, slug: string): void {
  if (isPostProcessing) return;
  isPostProcessing = true;
  try {
    ensureEmptyStateArt(content);
    enhanceCustomSelects(content);
    enhanceFilePickers(content);
    refineWorkspaceContent(content, slug);
    decorateGetStartedCtas(document);
  } finally {
    isPostProcessing = false;
  }
}

export function renderShell(app: HTMLElement): Shell {
  document.body.classList.add('modern-design');
  document.documentElement.dataset['theme'] = loadTheme();
  document.body.classList.toggle('is-collapsed', loadSidebarCollapsed());

  const skip = h('a', { class: 'skip-link', href: '#outlet' }, ['Skip to content']);

  const brandmark = h('span', { class: 'cp-brandmark', 'aria-hidden': 'true' }, []);
  brandmark.appendChild(changeproofMarkSvg());
  const brand = h('a', { href: '#/dashboard', class: 'brand' }, []);
  brand.append(brandmark, h('span', { class: 'brand-word' }, ['ChangeProof ', h('em', {}, ['AI'])]));
  const menuClose = h('button', { class: 'mobile-close', type: 'button', 'aria-label': 'Close navigation', id: 'menuClose' }, ['×']);
  menuClose.addEventListener('click', closeMenu);
  const collapse = h(
    'button',
    {
      class: 'sidebar-collapse',
      type: 'button',
      'data-modern': 'sidebar-toggle',
      'aria-label': 'Collapse sidebar',
      'aria-expanded': 'true',
      'aria-controls': 'nav',
    },
    [],
  );
  collapse.appendChild(iconSvg('collapse'));
  collapse.addEventListener('click', toggleSidebar);
  const sideBrandRow = h('div', { class: 'side-brand-row' }, [brand, menuClose, collapse]);

  const nav = h('nav', { class: 'nav', id: 'nav', 'aria-label': 'Primary' }, []);
  for (const group of NAV_GROUPS) {
    nav.appendChild(h('div', { class: 'nav-section' }, [group.label]));
    for (const item of group.items) {
      const anchor = h('a', { href: item.href, 'data-nav': item.id, 'aria-label': item.label }, []);
      anchor.dataset['label'] = item.label;
      anchor.append(iconSvg(item.icon), h('span', {}, [item.label]));
      nav.appendChild(anchor);
    }
  }

  const planMeter = h('div', { class: 'plan-mini', id: 'planMeter' }, []);
  planMeter.replaceChildren(
    h('div', {}, [h('strong', {}, ['Usage']), h('span', {}, [' Loading…'])]),
    h('div', { class: 'meter' }, []),
  );
  const orgButton = h('button', { class: 'organization', type: 'button', 'data-modern': 'workspace', 'aria-label': 'Select workspace' }, [
    h('span', { class: 'org-logo' }, ['–']),
    h('span', { class: 'workspace-copy' }, [
      h('strong', { id: 'orgLabel' }, ['Workspace']),
      h('small', { id: 'orgDetail' }, ['Sign in to load']),
    ]),
    h('span', { class: 'org-arrow', 'aria-hidden': 'true' }, ['⌄']),
  ]);
  orgButton.dataset['label'] = 'Select workspace';
  orgButton.addEventListener('click', () => { openWorkspaceDrawer(orgButton); });
  const sidebarFoot = h('div', { class: 'sidebar-foot' }, [
    planMeter,
    orgButton,
    h('div', { class: 'sidebar-note' }, ['Tenant-isolated workspace']),
  ]);
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Main navigation' }, [
    sideBrandRow,
    nav,
    sidebarFoot,
  ]);
  sidebar.addEventListener('pointerover', (event) => {
    const target = (event.target as HTMLElement).closest('#nav a, .organization');
    if (target instanceof HTMLElement && !target.contains(event.relatedTarget as Node | null)) showSidebarTip(target);
  });
  sidebar.addEventListener('pointerout', (event) => {
    const target = (event.target as HTMLElement).closest('#nav a, .organization');
    if (target instanceof HTMLElement && !target.contains(event.relatedTarget as Node | null)) hideSidebarTip();
  });
  sidebar.addEventListener('focusin', (event) => {
    const target = (event.target as HTMLElement).closest('#nav a, .organization');
    if (target instanceof HTMLElement) showSidebarTip(target);
  });
  sidebar.addEventListener('focusout', hideSidebarTip);

  const menuButton = h(
    'button',
    { class: 'icon-btn topbar-menu', type: 'button', 'data-modern': 'menu', 'aria-label': 'Collapse sidebar', 'aria-expanded': 'true', 'aria-controls': 'sidebar' },
    [],
  );
  menuButton.appendChild(iconSvg('collapse'));
  menuButton.addEventListener('click', toggleSidebar);
  // Mobile drawer trigger: the collapse control above is desktop-oriented.
  // CSS shows this button only below 760px; it owns body.nav-open while
  // closeMenu/renderRoute clear it so both triggers agree on one state.
  const navMenuButton = h(
    'button',
    { class: 'button menu-button', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sidebar', 'aria-label': 'Open navigation' },
    [],
  );
  navMenuButton.appendChild(iconSvg('menu'));
  navMenuButton.addEventListener('click', () => {
    const open = !document.body.classList.contains('nav-open');
    document.body.classList.toggle('nav-open', open);
    navMenuButton.setAttribute('aria-expanded', String(open));
    navMenuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  const topContext = h('div', { class: 'top-context' }, [
    h('span', { class: 'context-orb', 'aria-hidden': 'true' }, []),
    h('span', { class: 'context-parent' }, ['Workspace /']),
    h('strong', { id: 'topSection' }, ['Overview']),
  ]);
  const searchTrigger = h('button', { class: 'search-trigger', type: 'button', id: 'palette-trigger', 'data-modern': 'search', 'aria-label': 'Search pages and runs' }, []);
  searchTrigger.append(iconSvg('search'), h('span', { class: 'search-label' }, ['Search anything...']), h('kbd', {}, ['ctrl+K']));
  searchTrigger.setAttribute('aria-keyshortcuts', 'Control+k Meta+k');
  searchTrigger.addEventListener('click', () => { openSearchPalette(searchTrigger); });
  const searchGroup = h('div', { class: 'header-search-group' }, [navMenuButton, menuButton, topContext, searchTrigger]);

  const helpButton = h('button', { class: 'icon-btn header-help', type: 'button', 'data-modern': 'help', 'aria-label': 'Quick help' }, []);
  helpButton.appendChild(iconSvg('support'));
  helpButton.addEventListener('click', () => { openHelpDrawer(helpButton); });
  const bellButton = h(
    'button',
    {
      class: 'icon-btn',
      type: 'button',
      'data-modern': 'notifications',
      'aria-label': 'Open notifications',
      'aria-expanded': 'false',
      'aria-controls': 'notificationRoot',
    },
    [],
  );
  const dot = h('i', { class: 'notification-dot', id: 'notificationDot', 'aria-hidden': 'true' }, []);
  dot.hidden = true;
  bellButton.append(iconSvg('bell'), dot);
  bellButton.addEventListener('click', toggleNotifications);
  const avatarButton = h(
    'button',
    {
      class: 'top-avatar',
      type: 'button',
      'data-modern': 'account',
      'aria-label': 'Account menu',
      'aria-expanded': 'false',
      'aria-controls': 'accountRoot',
    },
    [],
  );
  const avatarCircle = h('span', { class: 'avatar-circle' }, ['G']);
  const avatarLabel = h('span', { class: 'avatar-label' }, ['Guest']);
  avatarButton.append(avatarCircle, avatarLabel, iconSvg('chevron-down'));
  avatarButton.addEventListener('click', toggleAccount);
  const accountSlot = h('span', { id: 'account', class: 'account-slot' }, [avatarButton]);
  const topRight = h('div', { class: 'top-right header-profile-group' }, [
    themeButton(),
    helpButton,
    bellButton,
    h('span', { class: 'top-divider', 'aria-hidden': 'true' }, []),
    accountSlot,
  ]);
  const topbar = h('header', { class: 'topbar' }, [searchGroup, topRight]);

  const publicNav = h('nav', { class: 'public-nav', id: 'publicNav', 'aria-label': 'Public' }, []);
  // The mockup nests the outlet inside the landmark (main > #content):
  // the `main` margin clears the fixed sidebar while the `#content` rules
  // shape the page. Merging both onto one element lets `#content` margin
  // rules cancel the sidebar offset and slide content underneath it.
  const outlet = h('div', { id: 'content', tabindex: '-1' }, []);
  const mainLandmark = h('main', { id: 'outlet' }, [outlet]);
  const publicFooter = h('footer', { class: 'modern-footer', id: 'publicFooter' }, []);
  const main = h('div', { class: 'main' }, [topbar, publicNav, mainLandmark, publicFooter]);
  const root = h('div', { class: 'app', id: 'shell' }, [skip, sidebar, main]);
  const announcer = h('div', { id: 'announcer', class: 'sr-only', 'aria-live': 'polite' }, []);
  app.replaceChildren(
    root,
    h('div', { id: 'drawerRoot' }, []),
    h('div', { id: 'modalRoot' }, []),
    h('div', { id: 'notificationRoot' }, []),
    h('div', { id: 'accountRoot' }, []),
    h('div', { id: 'sidebarTooltipRoot' }, []),
    h('div', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite' }, []),
    announcer,
  );

  // Every postProcessContent helper must be idempotent: any unconditional
  // childList mutation inside the outlet refires this observer forever.
  const contentObserver = new MutationObserver(() => {
    if (!outlet.isConnected) {
      contentObserver.disconnect();
      return;
    }
    postProcessContent(outlet, currentSlug);
  });
  contentObserver.observe(outlet, { childList: true, subtree: true });

  document.addEventListener('keydown', (event) => {
    if (!sidebar.isConnected) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      openSearchPalette(searchTrigger);
      return;
    }
    if (event.key === 'Escape') {
      closeFloatingPanels();
      if (smallViewport() && sidebar.classList.contains('open')) {
        closeMenu();
        menuButton.focus();
      }
      return;
    }
    if (event.key === 'Tab' && smallViewport() && sidebar.classList.contains('open')) {
      const focusable = [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
        (el) => el.offsetWidth > 0 && el.offsetHeight > 0,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener('click', (event) => {
    if (!sidebar.isConnected) return;
    const target = event.target as HTMLElement;
    if (notificationOpen && target.closest('.notification-stack, [data-modern="notifications"]') === null) {
      closeNotifications();
    }
    if (accountOpen && target.closest('#accountRoot, [data-modern="account"]') === null) {
      closeAccount();
    }
    if (target.closest('#accountRoot a, .notification-stack a') !== null) closeFloatingPanels();
  });
  window.addEventListener('resize', () => {
    if (!sidebar.isConnected) return;
    if (!smallViewport()) closeMenu();
    updateSidebarState();
    closeFloatingPanels();
    positionAccountMenu();
    positionNotificationMenu();
  });
  window.addEventListener(
    'scroll',
    () => {
      if (!sidebar.isConnected) return;
      positionAccountMenu();
      positionNotificationMenu();
    },
    { passive: true },
  );

  updateSidebarState();
  syncNotificationDot();
  return { root, outlet };
}

/**
 * Background shell services (plan meter). Called by main.ts after boot;
 * renderShell stays fetch-free so page data-fetch contracts stay exact.
 */
export function refreshShellServices(): void {
  const planMeter = document.getElementById('planMeter');
  if (planMeter !== null) void refreshPlanMeter(planMeter);
}

/**
 * Mode switch + chrome sync after every route render (mockup refreshShell).
 * Public/auth chrome containers are filled by the public page module.
 */
export type ShellModeListener = (mode: ShellMode, path: string) => void;

const modeListeners = new Set<ShellModeListener>();

/** Public/auth chrome modules subscribe without creating import cycles. */
export function onShellModeChange(listener: ShellModeListener): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

export function refreshShell(path: string): void {
  const mode = shellModeFor(path);
  for (const listener of modeListeners) listener(mode, path);
  const slug = path.startsWith('/') ? path.slice(1) : path;
  currentSlug = slug;
  const isOnboarding = mode === 'auth' && ['create-org', 'onboarding', 'new-project', 'orgs/claim'].includes(slug);
  document.body.classList.toggle('public-website', mode === 'public');
  document.body.classList.toggle('clarity-landing', mode === 'public' && (slug === '' || slug === 'landing'));
  document.body.classList.toggle('auth-page', mode === 'auth');
  document.body.classList.toggle('modern-onboarding', isOnboarding);
  document.body.classList.remove('onboarding');

  const sidebar = document.getElementById('sidebar');
  const topbar = document.querySelector('.topbar');
  const publicNav = document.getElementById('publicNav');
  const publicFooter = document.getElementById('publicFooter');
  const workspace = mode === 'workspace';
  sidebar?.toggleAttribute('hidden', !workspace);
  if (topbar instanceof HTMLElement) topbar.toggleAttribute('hidden', !workspace);
  publicNav?.toggleAttribute('hidden', mode === 'workspace');
  publicFooter?.toggleAttribute('hidden', mode === 'workspace');

  const topSection = document.getElementById('topSection');
  if (topSection !== null) {
    // Dynamic segments (runs/<id>) and future aliases resolve to their
    // section; the final fallback stays a plain English word (FR3-40:
    // the dictionary maps standalone Detail to Details).
    const section = slug.includes('/') ? slug.slice(0, slug.indexOf('/')) : slug;
    topSection.textContent = SCREEN_NAMES.get(slug) ?? SCREEN_NAMES.get(section) ?? 'Workspace';
  }

  const activeId = NAV_PARENT.get(slug) ?? slug;
  for (const anchor of document.querySelectorAll('#nav a[data-nav]')) {
    const current = anchor.getAttribute('data-nav') === activeId;
    anchor.classList.toggle('active', current);
    if (current) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  }

  const activeIcon = document.querySelector('.sidebar .nav a.active .icon') ?? document.querySelector(`.sidebar .nav a[href="#/${slug}"] .icon`);
  if (topSection !== null && activeIcon instanceof SVGElement) {
    let slot = document.querySelector('.top-section-icon');
    if (!(slot instanceof HTMLElement)) {
      slot = h('span', { class: 'top-section-icon' }, []);
      topSection.before(slot);
    }
    slot.replaceChildren(activeIcon.cloneNode(true));
    slot.setAttribute('aria-label', topSection.textContent.trim());
  }

  const content = document.getElementById('content');
  if (content !== null) {
    content.querySelectorAll('.app-footnote').forEach((node) => { node.remove(); });
    if (workspace && document.getElementById('shell') !== null) {
      const footnote = h('footer', { class: 'app-footnote' }, [
        h('span', {}, ['ChangeProof AI · Independent verification']),
        h('span', {}, [
          h('a', { href: '#/documentation' }, ['Page map']),
          '   ·   ',
          h('a', { href: '#/privacy' }, ['Privacy']),
          '   ·   ',
          h('a', { href: '#/support' }, ['Help']),
        ]),
      ]);
      content.appendChild(footnote);
    }
    content.classList.remove('page-enter', 'modern-onboarding-enter');
    // Force a reflow so the enter animation restarts on every navigation.
    content.getBoundingClientRect();
    content.classList.add('page-enter');
    if (isOnboarding) content.classList.add('modern-onboarding-enter');
    postProcessContent(content, slug);
  }
  updateSidebarState();
  syncNotificationDot();
}
