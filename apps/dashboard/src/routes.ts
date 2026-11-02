/* Hash route registry (T-42). Pages register here; T-43/44/45 add the
 * public, auth, and run-journey routes. Unknown hashes render the
 * not-found page — never a blank outlet, never a guess. */

import { emptyState, h } from './components.js';

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
  const [rawPath, rawQuery] = withoutMark.split('?');
  const path = rawPath === undefined || rawPath === '' ? '/' : rawPath;
  const params = new Map<string, string>();
  if (rawQuery !== undefined) {
    for (const pair of rawQuery.split('&')) {
      const [key, value] = pair.split('=');
      if (key !== undefined && key !== '') params.set(decodeURIComponent(key), decodeURIComponent(value ?? ''));
    }
  }
  return { path, params };
}

function renderNotFound(outlet: HTMLElement, path: string): void {
  outlet.replaceChildren(
    emptyState(
      'Page not found',
      `No screen exists at "${path}". Use the navigation to continue.`,
      h('a', { class: 'button', href: '#/' }, ['Back to start']),
    ),
  );
  document.title = 'Not found — ChangeProof AI';
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
  const { path, params } = parseHash(hash);
  const route = registry.get(path);
  document.body.classList.remove('nav-open');
  if (route === undefined) {
    renderNotFound(outlet, path);
    return;
  }
  document.title = `${route.title} — ChangeProof AI`;
  outlet.replaceChildren();
  await route.render(outlet, { hash, params });
  // A superseded render must not mark nav, announce, or steal focus for
  // a page the user already left.
  if (mine !== epoch) return;
  markCurrentNav(path);
  announce(route.title);
  // Route change moves focus to the page heading (or the main landmark)
  // so keyboard and screen-reader users land on the new content.
  const heading = outlet.querySelector('h1');
  if (heading instanceof HTMLElement) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  } else {
    outlet.focus({ preventScroll: true });
  }
}

function announce(title: string): void {
  const announcer = document.getElementById('announcer');
  if (announcer !== null) announcer.textContent = `Loaded: ${title}.`;
}

function markCurrentNav(path: string): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.sidebar nav a[href^="#"]')) {
    if (link.getAttribute('href') === `#${path}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
