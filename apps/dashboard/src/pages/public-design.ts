/* Direct DOM port of the trusted ROOT mockup. These strings are design assets,
 * never customer HTML. Live API data continues to use textContent in public.ts. */
import './public-reset.css';
import './public-design.css';
import './public-port.css';

import { h, svgEl, themeToggle } from '../components.js';
import { startLandingFibers } from './landing-fibers.js';
import { publicDesigns, type PublicDesignId } from './public-design-templates.js';
import { applyLandingPilot } from './landing-pilot.js';
import { refinePublicPage } from './public-refinement.js';

const publicNames = new Set<string>(Object.keys(publicDesigns));
const workspaceDestinations: Readonly<Record<string, string>> = {
  dashboard: '/', 'new-run': '/runs/new', runs: '/runs', projects: '/projects',
  usage: '/billing', team: '/settings', repositories: '/repositories',
  evidence: '/evidence', 'evidence-library': '/evidence', review: '/run',
};

export function designDestination(hash: string): string {
  const name = hash.replace(/^#/, '');
  if (name === 'landing' || name === 'top') return '#/p/';
  if (publicNames.has(name)) return `#/p/${name}`;
  if (name === 'documentation') return '#/p/guides';
  if (name === 'privacy') return '#/p/privacy-policy';
  if (['login', 'register', 'forgot-password', 'check-email', 'reset-password', 'verify-email', 'session-expired'].includes(name)) return `#/${name}`;
  const workspace = workspaceDestinations[name];
  return workspace === undefined ? `#/p/${name}` : `#${workspace}`;
}

export function renderPublicDesign(path: string, pilotLanding = false): HTMLElement | undefined {
  const name = path === '/' ? 'landing' : path.slice(1);
  if (!publicNames.has(name)) return undefined;
  const design = publicDesigns[name as PublicDesignId];
  const root = h('div', { id: 'public-site-page', class: `reyn-design ${design.body}`, 'data-design-page': name });
  const content = h('div', { class: 'reyn-content' });
  // Only this reviewed, bundled constant enters the template parser.
  const template = document.createElement('template');
  template.innerHTML = design.html;
  content.append(template.content.cloneNode(true));
  root.append(content);
  root.querySelector('.cp-identity-hero')?.classList.add('landing-hero');
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) {
    // Reveal transforms are transient mockup state, not the page's final layout.
    if (element.hasAttribute('data-hero') || element.classList.contains('modern-reveal')) element.removeAttribute('style');
  }
  root.querySelectorAll('.modern-reveal').forEach(e => { e.classList.add('cp-in-view', 'is-visible'); });
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) link.href = designDestination(link.getAttribute('href') ?? '#landing');
  root.querySelector('.public-nav')?.setAttribute('aria-label', 'Public navigation');
  const previewTitle = root.querySelector('.public-product-preview .product-browser > span');
  if (previewTitle !== null) previewTitle.textContent = 'Illustrative preview / not live repair evidence';
  const productFrame = root.querySelector('.public-product-preview .product-frame');
  if (productFrame !== null) productFrame.setAttribute('aria-label', `Illustrative design preview, not live repair evidence. ${productFrame.getAttribute('aria-label') ?? ''}`);
  const wordmark = root.querySelector('.footer-wordmark');
  if (wordmark !== null) {
    const text = svgEl('text', { x: '50%', y: '50%', 'dominant-baseline': 'central', 'text-anchor': 'middle', fill: 'currentColor' });
    text.textContent = wordmark.textContent;
    wordmark.replaceChildren(svgEl('svg', { 'aria-hidden': 'true', focusable: 'false' }, [text]));
    wordmark.setAttribute('aria-hidden', 'true');
  }
  const technologies = root.querySelector<HTMLElement>('.cp-tech-window');
  if (technologies !== null) { technologies.tabIndex = 0; technologies.setAttribute('role', 'region'); technologies.setAttribute('aria-label', 'Technology scope preview, not certified support'); }
  for (const link of root.querySelectorAll<HTMLAnchorElement>('.modern-footer a')) {
    if (link.textContent.trim() === 'Back to top') {
      link.href = name === 'landing' ? '#/p/' : `#/p/${name}`;
      link.addEventListener('click', event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'instant' }); root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }); });
    }
  }
  const columns = root.querySelectorAll('.footer-col');
  columns[1]?.append(h('a', { href: '#/p/how-it-works' }, ['How it works']));
  columns[2]?.append(h('a', { href: '#/p/terms' }, ['Terms (draft)']));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-go]')) {
    button.addEventListener('click', () => { window.location.hash = designDestination(`#${button.dataset['go'] ?? 'landing'}`); });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-evidence="theme"]')) {
    const replacement = themeToggle();
    replacement.className = button.className;
    button.replaceWith(replacement);
  }
  const pill = root.querySelector('.modern-release');
  if (pill !== null) {
    const badge = h('b', {}, ['New']);
    pill.replaceChildren(badge, 'Change intelligence. Independent proof.');
  }
  const caption = root.querySelector('.modern-hero-caption');
  if (caption !== null) caption.textContent = 'Start with one project · Evidence-led · Budget controlled';
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-proof-tab]')];
  const activate = (button: HTMLButtonElement): void => {
    for (const tab of tabs) {
      const selected = button === tab;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of root.querySelectorAll<HTMLElement>('[data-proof-panel]')) panel.hidden = panel.dataset['proofPanel'] !== button.dataset['proofTab'];
  };
  root.querySelector('[role="tablist"]')?.setAttribute('aria-orientation', 'vertical');
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => { activate(tab); });
    tab.addEventListener('keydown', event => {
      const next = ['ArrowDown', 'ArrowRight'].includes(event.key) ? tabs[(index + 1) % tabs.length]
        : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? tabs[(index - 1 + tabs.length) % tabs.length]
          : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
      if (next !== undefined) { event.preventDefault(); activate(next); next.focus(); }
    });
  });
  const folder = root.querySelector('.cp-workflow-folder');
  const front = root.querySelector<HTMLButtonElement>('[data-cp-folder-toggle]');
  root.querySelectorAll<HTMLButtonElement>('[data-cp-area]').forEach(sheet => { sheet.tabIndex = -1; sheet.inert = true; sheet.setAttribute('aria-hidden', 'true'); });
  const areas = root.querySelector<HTMLElement>('.cp-workflow-areas');
  front?.addEventListener('click', () => {
    const open = folder?.classList.toggle('is-open') ?? false;
    front.setAttribute('aria-expanded', String(open));
    front.setAttribute('aria-label', `${open ? 'Close' : 'Open'} ChangeProof folder`);
    root.querySelectorAll<HTMLButtonElement>('[data-cp-area]').forEach(sheet => { sheet.tabIndex = open ? 0 : -1; sheet.inert = !open; sheet.setAttribute('aria-hidden', String(!open)); });
    if (!open && areas !== null) areas.hidden = true;
  });
  root.querySelectorAll<HTMLButtonElement>('[data-cp-area]').forEach(button => { button.addEventListener('click', () => {
    folder?.classList.add('is-open'); front?.setAttribute('aria-expanded', 'true');
    if (areas !== null) areas.hidden = false;
    root.querySelectorAll<HTMLElement>('.cp-workflow-area').forEach(area => { area.hidden = area.id !== `cp-workflow-area-${button.dataset['cpArea'] ?? ''}`; });
    root.querySelectorAll<HTMLElement>('[data-cp-area]').forEach(sheet => {
      sheet.classList.toggle('is-active', sheet === button); sheet.setAttribute('aria-expanded', String(sheet === button));
    });
  }); });
  root.querySelector('[data-evidence="later"]')?.addEventListener('click', () => { root.querySelector('.modern-footer')?.scrollIntoView({ behavior: 'instant' }); });
  root.querySelectorAll<HTMLElement>('[data-evidence-scroll]').forEach(control => { control.addEventListener('click', event => {
    const id = control.dataset['evidenceScroll'];
    const destination = [...root.querySelectorAll<HTMLElement>('[id]')].find(e => e.id === id);
    if (destination !== undefined) { event.preventDefault(); destination.scrollIntoView({ block: 'start', behavior: 'instant' }); destination.tabIndex = -1; destination.focus({ preventScroll: true }); }
  }); });
  // Neither the folder nor the example graph represents an actual repair.
  if (name === 'landing' || name === 'product' || name === 'sample-report') {
    const note = h('p', { class: 'port-readiness-note' }, ['Muse and Modal are unavailable in this demo. Workflow previews are illustrative, not live AI repair evidence.']);
    (root.querySelector('.proof-story') ?? root.querySelector('.public-page-content') ?? content).append(note);
  }
  if (name === 'terms' || name === 'privacy-policy') {
    root.querySelector('.public-page-content')?.prepend(h('aside', { class: 'public-note legal-draft', role: 'note' }, ['Design draft — legal terms, retention and service commitments are not finalized. This page is not a new legal agreement.']));
  }
  if (name === 'landing' && pilotLanding) applyLandingPilot(root);
  else if (name !== 'landing') refinePublicPage(root, name);
  queueMicrotask(() => {
    if (!root.isConnected) return;
    const canvas = root.querySelector<HTMLCanvasElement>('.cp-ghost-fibers');
    const hero = root.querySelector<HTMLElement>('.cp-identity-hero');
    const renderer = canvas !== null && hero !== null ? startLandingFibers(canvas, hero) : null;
    const nav = root.querySelector('.public-nav');
    const onScroll = (): void => { nav?.classList.toggle('is-scrolled', window.scrollY > 35); };
    window.addEventListener('scroll', onScroll, { passive: true });
    const removal = new MutationObserver(() => {
      if (root.isConnected) return;
      renderer?.stop(); window.removeEventListener('scroll', onScroll); removal.disconnect();
    });
    removal.observe(root.parentElement ?? document.body, { childList: true });
  });
  return root;
}
