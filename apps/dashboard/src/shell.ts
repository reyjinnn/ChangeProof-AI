/* Responsive shell: skip link, sidebar, topbar, outlet (T-42). The
 * sidebar collapses to an overlay drawer below 760px; Escape closes it
 * and returns focus to the menu button. */

import { h } from './components.js';
import { openSearchPalette } from './pages/search.js';
import { navRoutes } from './routes.js';
import { loadSidebarCollapsed, loadTheme, saveSidebarCollapsed, saveTheme } from './store.js';

export interface Shell {
  readonly root: HTMLElement;
  readonly outlet: HTMLElement;
}

function themeIcon(theme: 'light' | 'dark'): string {
  return theme === 'light' ? 'Dark mode' : 'Light mode';
}

export function renderShell(app: HTMLElement): Shell {
  const skip = h('a', { class: 'skip-link', href: '#outlet' }, ['Skip to content']);

  const brand = h('div', { class: 'brand' }, []);
  const mark = document.createElement('img');
  mark.src = '/assets/changeproof-mark.svg';
  mark.alt = '';
  mark.width = 28;
  mark.height = 28;
  mark.setAttribute('aria-hidden', 'true');
  brand.append(mark, document.createTextNode(' ChangeProof AI'));

  const SECTION_ORDER = ['workspace', 'public', 'account'] as const;
  const SECTION_LABEL: Record<(typeof SECTION_ORDER)[number], string> = {
    workspace: 'Workspace',
    public: 'Public site',
    account: 'Account',
  };
  const nav = h('nav', { 'aria-label': 'Primary' }, []);
  for (const section of SECTION_ORDER) {
    const items = navRoutes().filter((route) => route.navSection === section && route.navLabel !== undefined);
    if (items.length === 0) continue;
    const list = h('ul', {}, []);
    for (const route of items) {
      if (route.navLabel === undefined) continue;
      list.appendChild(h('li', {}, [h('a', { href: `#${route.path}` }, [route.navLabel])]));
    }
    // Plain-text group labels: no heading-level games inside the sidebar.
    nav.append(h('p', { class: 'nav-group' }, [SECTION_LABEL[section]]), list);
  }
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' }, [brand, nav]);

  const menuButton = h(
    'button',
    { class: 'button menu-button', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sidebar' },
    ['Menu'],
  );
  menuButton.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('keydown', (event) => {
    // A replaced shell leaves its listener behind; only the live sidebar answers.
    if (!sidebar.isConnected) return;
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      document.body.classList.remove('nav-open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.focus();
    }
  });

  const themeButton = h('button', { class: 'button', type: 'button' }, [themeIcon(loadTheme())]);
  themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    themeButton.textContent = themeIcon(next);
  });

  const collapseButton = h('button', { class: 'button collapse-button', type: 'button' }, ['Collapse sidebar']);
  collapseButton.setAttribute('aria-label', 'Collapse sidebar');
  const applyCollapsed = (collapsed: boolean): void => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    collapseButton.textContent = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    collapseButton.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  };
  applyCollapsed(loadSidebarCollapsed());
  collapseButton.addEventListener('click', () => {
    const next = !document.body.classList.contains('sidebar-collapsed');
    saveSidebarCollapsed(next);
    applyCollapsed(next);
  });

  const searchButton = h('button', { id: 'palette-trigger', class: 'button', type: 'button' }, ['Search (Ctrl+K)']);
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

  const account = h('span', { id: 'account', class: 'account-slot' }, []);
  const topbar = h('header', { class: 'topbar' }, [
    menuButton,
    h('span', { class: 'spacer', 'aria-hidden': 'true' }, []),
    account,
    searchButton,
    collapseButton,
    themeButton,
  ]);
  const outlet = h('main', { id: 'outlet', tabindex: '-1' }, []);
  // Persistent live region: route changes announce by updating its text,
  // never by injecting a populated region (which screen readers ignore).
  const announcer = h('div', { id: 'announcer', class: 'sr-only', 'aria-live': 'polite' }, []);
  const root = h('div', { id: 'shell' }, [skip, sidebar, topbar, outlet, announcer]);
  app.replaceChildren(root);
  return { root, outlet };
}
