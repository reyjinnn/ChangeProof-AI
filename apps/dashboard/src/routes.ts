/* Hash route registry (T-42). Pages register here; T-43/44/45 add the
 * public, auth, and run-journey routes. Unknown hashes render the
 * not-found page — never a blank outlet, never a guess. */

import { closeDrawer, emptyState, h } from './components.js';
import { closeFloatingPanels, refreshShell } from './shell.js';

export interface RouteContext {
  readonly hash: string;
  readonly params: ReadonlyMap<string, string>;
}

export interface Route {
  readonly path: string;
  readonly title: string;
  readonly navLabel?: string;
  readonly navSection?: 'public' | 'workspace' | 'account';
  render(outlet: HTMLElement, ctx: RouteContext): void | Promise<void>;
}

const registry = new Map<string, Route>();

export function registerRoute(route: Route): void {
  registry.set(route.path, route);
}

export function routePaths(): readonly string[] {
  return [...registry.keys()];
}

export function navRoutes(): readonly Route[] {
  return [...registry.values()].filter((route) => route.navLabel !== undefined);
}

/** `#/runs/abc?cursor=3` -> { path: '/runs/abc', params: { cursor: '3' } }. */
export function parseHash(hash: string): { path: string; params: ReadonlyMap<string, string> } {
  const withoutMark = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryAt = withoutMark.indexOf('?');
  const rawPath = queryAt < 0 ? withoutMark : withoutMark.slice(0, queryAt);
  const rawQuery = queryAt < 0 ? '' : withoutMark.slice(queryAt + 1);
  const path = rawPath === '' ? '/' : rawPath;
  const params = new Map<string, string>();
  // A pasted deep link must not crash the app on malformed percent encoding.
  new URLSearchParams(rawQuery).forEach((value, key) => { if (key !== '') params.set(key, value); });
  return { path, params };
}

function renderNotFound(outlet: HTMLElement, path: string): void {
  outlet.replaceChildren(
    emptyState(
      'Page not found',
      `No screen exists at "${path}". Use the navigation to continue.`,
      h('a', { class: 'button', href: path.startsWith('/p/') ? '#/p/' : '#/' }, ['Back to start']),
    ),
  );
  const title = outlet.querySelector('h2');
  title?.replaceWith(h('h1', {}, ['Page not found']));
  document.title = 'Not found — ChangeProof AI';
}

/** Render a registered route with no nav/focus/announce side effects.
 * Modal pages (auth) use it to paint the public backdrop behind the dialog;
 * returns false when no route is registered for the path. */
export async function renderStandalone(outlet: HTMLElement, path: string): Promise<boolean> {
  const route = registry.get(path);
  if (route === undefined) return false;
  const { params } = parseHash(`#${path}`);
  await route.render(outlet, { hash: `#${path}`, params });
  return true;
}

let epoch = 0;

/** Current render generation; pages with async continuations compare against it. */
export function currentRouteEpoch(): number {
  return epoch;
}

export function isCurrentRouteEpoch(value: number): boolean {
  return value === epoch;
}

export async function renderRoute(outlet: HTMLElement, hash: string): Promise<void> {
  epoch += 1;
  const mine = epoch;
  const initial = (hash === '' || hash === '#') && registry.has('/p/') ? '#/p/' : hash;
  const parsed = parseHash(initial);
  let path = parsed.path;
  const params = new Map(parsed.params);
  if (path === '/app') path = '/';
  else if (path.startsWith('/app/')) path = path.slice(4);
  const run = /^\/runs\/([^/]+)$/.exec(path);
  if (run?.[1] !== undefined && run[1] !== 'new') {
    try { params.set('id', decodeURIComponent(run[1])); path = '/run'; }
    catch { /* Preserve malformed resource paths as not-found. */ }
  }
  const route = registry.get(path);
  closeDrawer();
  closeFloatingPanels();
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('navScrim')?.remove();
  document.body.style.overflow = '';
  if (route === undefined) {
    refreshShell(path);
    renderNotFound(outlet, path);
    return;
  }
  document.title = `${route.title} — ChangeProof AI`;
  outlet.replaceChildren();
  const context = document.getElementById('page-context');
  if (context !== null) context.textContent = route.title;
  await route.render(outlet, { hash, params });
  // A superseded render must not mark nav, announce, or steal focus for
  // a page the user already left.
  if (mine !== epoch) return;
  refreshShell(path);
  markCurrentNav(path);
  announce(route.title);
  // Route change moves focus to the page heading (or the main landmark)
  // so keyboard and screen-reader users land on the new content.
  let heading = outlet.querySelector('h1');
  if (heading === null) {
    const fallback = outlet.querySelector('h2');
    if (fallback !== null) { heading = h('h1', {}, [fallback.textContent]); fallback.replaceWith(heading); }
  }
  if (heading instanceof HTMLElement) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  } else {
    outlet.focus({ preventScroll: true });
  }
  const section = params.get('section');
  const destination = section === undefined ? undefined : [...outlet.querySelectorAll<HTMLElement>('[id]')].find(node => node.id === section);
  if (destination !== undefined) {
    destination.scrollIntoView({ block: 'start', behavior: 'instant' });
    destination.tabIndex = -1;
    destination.focus({ preventScroll: true });
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

function announce(title: string): void {
  const announcer = document.getElementById('announcer');
  if (announcer !== null) announcer.textContent = `Loaded: ${title}.`;
}

function markCurrentNav(path: string): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('#nav a[href^="#"]')) {
    if (link.getAttribute('href') === `#${path}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
