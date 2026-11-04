/* Public site chrome (Progress UI 3, mockup 1914/1930/2452-2458).
 * Fills the shell's empty #publicNav (.public-nav) and #publicFooter
 * (.modern-footer) containers on public/auth modes. All labels are English
 * (FR3-40); every link is static and resolves to a real in-app route. */

import { h, iconSvg, logoMarkSvg } from '../components.js';
import { onShellModeChange } from '../shell.js';
import { loadTheme, saveTheme } from '../store.js';

interface NavLink {
  readonly hash: string;
  readonly label: string;
  readonly className: string;
}

/** Mockup active publicNav (2452): exactly Product, Pricing, Documentation. */
const NAV_LINKS: readonly NavLink[] = [
  { hash: '#/product', label: 'Product', className: 'nav-product' },
  { hash: '#/pricing', label: 'Pricing', className: 'nav-price' },
  { hash: '#/guides', label: 'Documentation', className: 'nav-documentation' },
];

function smoothScroll(): ScrollBehavior {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'auto';
  }
}

function syncThemeButtons(): void {
  const dark = document.documentElement.dataset['theme'] === 'dark';
  for (const button of document.querySelectorAll('[data-evidence="theme"]')) {
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('title', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.replaceChildren(iconSvg(dark ? 'sun' : 'moon', 'icon'));
  }
}

function themeButton(): HTMLElement {
  const button = h(
    'button',
    { type: 'button', class: 'icon-btn theme-toggle', 'data-evidence': 'theme' },
    [],
  );
  button.addEventListener('click', () => {
    saveTheme(loadTheme() === 'dark' ? 'light' : 'dark');
    syncThemeButtons();
  });
  return button;
}

function brand(): HTMLElement {
  const mark = h('span', { class: 'brandmark', 'aria-hidden': 'true' }, []);
  mark.appendChild(logoMarkSvg());
  const link = h('a', { class: 'public-brand', href: '#/landing' }, []);
  link.append(mark, document.createTextNode('ChangeProof '), h('em', {}, ['AI']));
  return link;
}

export function renderPublicNav(): HTMLElement {
  const links = h('div', { class: 'public-links' }, []);
  for (const item of NAV_LINKS) {
    const anchor = h('a', { href: item.hash, class: item.className }, [item.label]);
    if (window.location.hash === item.hash) {
      anchor.setAttribute('aria-current', 'page');
    }
    links.appendChild(anchor);
  }
  links.appendChild(themeButton());
  links.appendChild(h('a', { class: 'public-login', href: '#/login' }, ['Sign in']));
  const cta = h('a', { class: 'primary', href: '#/register' }, ['Get started free']);
  cta.appendChild(iconSvg('arrow'));
  links.appendChild(cta);
  const nav = h('nav', { class: 'public-nav', 'aria-label': 'Public navigation' }, [brand(), links]);
  return nav;
}

interface FooterCol {
  readonly heading: string;
  readonly links: readonly (readonly [string, string])[];
}

/* Mockup footer (1930, 2454): follow block + link columns + legal + wordmark.
 * A fourth column (Company) reuses the real .footer-col class; the mockup's
 * three columns cannot hold the fixed public routes. */
const FOOTER_COLS: readonly FooterCol[] = [
  { heading: 'Product', links: [['Pricing', '#/pricing'], ['Changelog', '#/changelog'], ['Roadmap', '#/roadmap']] },
  {
    heading: 'Learn',
    links: [['Templates', '#/templates'], ['How it works', '#/how-it-works'], ['Sample report', '#/sample-report']],
  },
  { heading: 'Connect', links: [['Contact', '#/contact'], ['Status', '#/status'], ['Docs', '#/documentation']] },
  { heading: 'Company', links: [['About', '#/about'], ['Security', '#/security'], ['Terms', '#/terms']] },
];

export function renderPublicFooter(): HTMLElement {
  const followLink = h('a', { href: '#/changelog' }, ['Product notes']);
  followLink.appendChild(iconSvg('arrow'));
  const follow = h('div', { class: 'footer-follow' }, [
    'Follow our journey',
    h('br', {}, []),
    'and product updates.',
    h('br', {}, []),
    followLink,
  ]);
  const top = h('div', { class: 'footer-top' }, [follow]);
  for (const col of FOOTER_COLS) {
    const block = h('div', { class: 'footer-col' }, [h('h3', {}, [col.heading])]);
    for (const [label, hash] of col.links) block.appendChild(h('a', { href: hash }, [label]));
    top.appendChild(block);
  }
  const backToTop = h('a', { href: window.location.hash === '' ? '#/' : window.location.hash }, ['Back to top ↑']);
  backToTop.addEventListener('click', (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: smoothScroll() });
  });
  const legal = h('div', { class: 'footer-legal' }, [
    h('span', {}, ['© 2026 ChangeProof AI']),
    h('span', {}, ['Independent verification evidence']),
    backToTop,
  ]);
  return h('div', { class: 'modern-container' }, [top, legal]);
}

/** Fill the shell-owned #publicNav/#publicFooter containers (mockup 2452-2458). */
export function renderPublicChrome(): void {
  document.documentElement.dataset['theme'] = loadTheme();
  const navHost = document.getElementById('publicNav');
  if (navHost !== null) {
    // Move the built nodes in directly so their listeners survive.
    const nav = renderPublicNav();
    navHost.replaceChildren(...[...nav.childNodes]);
    navHost.setAttribute('aria-label', 'Public navigation');
    syncThemeButtons();
  }
  const footerHost = document.getElementById('publicFooter');
  if (footerHost !== null) {
    footerHost.replaceChildren(
      renderPublicFooter(),
      h('div', { class: 'footer-wordmark', 'aria-hidden': 'true' }, ['ChangeProof']),
    );
  }
}

let chromeInitDone = false;
let scrollWatcherDone = false;

function watchScroll(): void {
  if (scrollWatcherDone) return;
  scrollWatcherDone = true;
  let frame = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        document.querySelector('.public-nav')?.classList.toggle('is-scrolled', window.scrollY > 35);
      });
    },
    { passive: true },
  );
}

/** Subscribe once; the shell notifies after every route render. */
export function initPublicChrome(): void {
  watchScroll();
  if (chromeInitDone) return;
  chromeInitDone = true;
  onShellModeChange((mode) => {
    if (mode === 'public' || mode === 'auth') renderPublicChrome();
  });
}
