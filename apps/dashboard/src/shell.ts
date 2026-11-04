/* Responsive shell: skip link, sidebar, topbar, outlet (T-42). The
 * sidebar collapses to an overlay drawer below 760px; Escape closes it
 * and returns focus to the menu button. */

import { h, iconSvg, themeToggle, type IconName } from './components.js';
import { openSearchPalette } from './pages/search.js';
import { navRoutes, routePaths } from './routes.js';
import { loadSidebarCollapsed, saveSidebarCollapsed } from './store.js';

export interface Shell {
  readonly root: HTMLElement;
  readonly outlet: HTMLElement;
}

function routeIcon(path: string): IconName {
  if (path === '/') return 'status';
  if (path === '/runs') return 'runs';
  if (path === '/runs/new') return 'new-run';
  if (path.startsWith('/evidence')) return 'evidence';
  if (path === '/inbox') return 'inbox';
  if (path === '/support') return 'support';
  if (path === '/threads') return 'threads';
  if (path === '/operator') return 'operator';
  if (path === '/billing') return 'billing';
  if (path === '/enterprise') return 'enterprise';
  if (path === '/settings') return 'settings';
  if (path === '/templates') return 'templates';
  if (path === '/samples') return 'samples';
  if (path === '/faq') return 'faq';
  if (path === '/pricing') return 'pricing';
  if (path === '/roadmap') return 'roadmap';
  if (path === '/changelog') return 'changelog';
  return 'public';
}

export function renderShell(app: HTMLElement): Shell {
  const skip = h('a', { class: 'skip-link', href: '#outlet' }, ['Skip to content']);

  const brand = h('a', { class: 'brand', href: '#/', 'aria-label': 'ChangeProof AI workspace' }, []);
  brand.append(
    h('img', { src: '/assets/changeproof-mark.svg', class: 'brand-mark', width: '32', height: '32', alt: '' }),
    h('div', { class: 'brand-copy' }, [
      h('strong', {}, ['ChangeProof AI']),
      h('span', {}, ['Change intelligence']),
    ]),
  );

  const published = new Set(routePaths());
  const groups: readonly { label: string; links: readonly (readonly [string, string])[] }[] = [
    { label: 'Workspace', links: [['/', 'Overview'], ['/projects', 'Projects'], ['/runs', 'Runs'], ['/evidence', 'Evidence'], ['/capabilities', 'Capabilities']] },
    { label: 'Organization', links: [['/team', 'Team & access'], ['/repositories', 'GitHub connections'], ['/billing', 'Usage & credits'], ['/audit', 'Activity log'], ['/settings', 'Settings']] },
    { label: 'Resources', links: [['/support', 'Help & status'], ['/p/guides', 'Product guide'], ['/inbox', 'Inbox'], ['/enterprise', 'Enterprise'], ['/login', 'Account sign in']] },
  ];
  const nav = h('nav', { 'aria-label': 'Primary' }, []);
  const covered = new Set(groups.flatMap(group => group.links.map(([path]) => path)));
  const more = navRoutes().filter(route => route.navSection !== 'public' && !covered.has(route.path));
  const allGroups = [...groups, { label: 'More', links: more.map(route => [route.path, route.navLabel ?? route.title] as const) }];
  for (const group of allGroups) {
    const items = group.links.filter(([path]) => published.has(path));
    if (items.length === 0) continue;
    const list = h('ul', {}, []);
    for (const [path, label] of items) {
      const link = h('a', { href: `#${path}` }, []);
      link.append(iconSvg(routeIcon(path)), h('span', {}, [label]));
      list.appendChild(h('li', {}, [link]));
    }
    nav.append(h('p', { class: 'nav-group' }, [group.label]), list);
  }
  const publicLinks = navRoutes().filter(route => route.navSection === 'public' && !covered.has(route.path));
  if (publicLinks.length > 0) nav.append(h('details', { class: 'nav-resources' }, [h('summary', {}, ['Public site']), h('ul', {}, publicLinks.map(route => h('li', {}, [h('a', { href: `#${route.path}` }, [route.navLabel ?? route.title])])))]));
  const sidebarFoot = h('div', { class: 'sidebar-foot', id: 'sidebar-foot' }, [
    h('div', { class: 'eyebrow' }, ['Your workspace']),
    h('p', { class: 'muted', id: 'sidebar-session-summary' }, ['Guest session · sign in to access workspace']),
  ]);
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' }, [brand, nav, sidebarFoot]);

  const menuButton = h(
    'button',
    { class: 'button menu-button', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sidebar' },
    ['Menu'],
  );
  const backdrop = h('button', { class: 'nav-backdrop', type: 'button', 'aria-label': 'Close navigation', tabindex: '-1' });
  backdrop.hidden = true;
  const setOpen = (open: boolean): void => {
    document.body.classList.toggle('nav-open', open);
    menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    backdrop.hidden = !open;
    if (open) sidebar.querySelector<HTMLElement>('a[href]')?.focus();
    else menuButton.focus();
  };
  menuButton.addEventListener('click', () => { setOpen(!document.body.classList.contains('nav-open')); });
  backdrop.addEventListener('click', () => { setOpen(false); });
  document.addEventListener('keydown', (event) => {
    // A replaced shell leaves its listener behind; only the live sidebar answers.
    if (!sidebar.isConnected) return;
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      setOpen(false);
    } else if (event.key === 'Tab' && document.body.classList.contains('nav-open')) {
      const links = [...sidebar.querySelectorAll<HTMLElement>('a[href], summary, button:not([disabled])')].filter(control => {
        const closed = control.closest('details:not([open])');
        return closed === null || closed.firstElementChild === control;
      });
      const first = links[0];
      const last = links.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });

  const themeButton = themeToggle();

  const collapseButton = h('button', { class: 'button collapse-button', type: 'button' }, ['Collapse sidebar']);
  collapseButton.setAttribute('aria-label', 'Collapse sidebar');
  const applyCollapsed = (collapsed: boolean): void => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    collapseButton.replaceChildren(iconSvg('sidebar'), h('span', { class: 'sr-only' }, [collapsed ? 'Expand sidebar' : 'Collapse sidebar']));
    collapseButton.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  };
  applyCollapsed(loadSidebarCollapsed());
  collapseButton.addEventListener('click', () => {
    const next = !document.body.classList.contains('sidebar-collapsed');
    saveSidebarCollapsed(next);
    applyCollapsed(next);
  });

  const searchButton = h('button', { id: 'palette-trigger', class: 'button search-control', type: 'button' }, [
    iconSvg('search'), h('span', { class: 'search-label' }, ['Search workspace']), h('kbd', {}, ['Ctrl+K']),
  ]);
  searchButton.setAttribute('aria-label', 'Search (Ctrl+K)');
  searchButton.setAttribute('aria-keyshortcuts', 'Control+k Meta+k');
  searchButton.addEventListener('click', () => {
    openSearchPalette(searchButton);
  });
  document.addEventListener('keydown', (event) => {
    // A replaced shell leaves its listener behind; only the live trigger answers.
    if (!searchButton.isConnected) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      openSearchPalette(searchButton);
    }
  });

  const topContext = h('div', { class: 'top-context', 'aria-hidden': 'true' }, [
    h('span', { class: 'context-parent' }, ['Workspace']),
    h('span', { class: 'context-divider' }, ['/']),
    h('strong', { id: 'page-context' }, ['Overview']),
  ]);
  const account = h('span', { id: 'account', class: 'account-slot' }, []);
  const topbar = h('header', { class: 'topbar' }, [
    h('div', { class: 'header-search-group' }, [menuButton, topContext, searchButton]),
    h('div', { class: 'header-profile-group toolbar-actions' }, [
      h('a', { class: 'button inbox-trigger', href: '#/inbox', 'aria-label': 'Inbox' }, [iconSvg('inbox')]),
      themeButton, collapseButton, account,
    ]),
  ]);
  const outlet = h('main', { id: 'outlet', tabindex: '-1' }, []);
  // Persistent live region: route changes announce by updating its text,
  // never by injecting a populated region (which screen readers ignore).
  const announcer = h('div', { id: 'announcer', class: 'sr-only', 'aria-live': 'polite' }, []);
  const root = h('div', { id: 'shell' }, [skip, backdrop, sidebar, h('div', { class: 'workspace-main' }, [topbar, outlet]), announcer]);
  skip.addEventListener('click', event => { event.preventDefault(); outlet.focus(); outlet.scrollIntoView({ block: 'start', behavior: 'instant' }); });
  app.replaceChildren(root);
  return { root, outlet };
}
