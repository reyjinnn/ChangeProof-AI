/* Landing composition from the user-designated root mockup.html.
 * Marketing copy stays separate from execution evidence and live API state. */
import './landing.css';

import { h, themeToggle } from '../components.js';
import { startLandingFibers } from './landing-fibers.js';

function brandMark(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  const path = document.createElementNS(ns, 'path');
  for (const [name, value] of Object.entries({ d: 'M23 6.5h-7.5C10 6.5 6 10.5 6 16s4 9.5 9.5 9.5H23', stroke: 'currentColor', 'stroke-width': '3.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(name, value);
  const rect = document.createElementNS(ns, 'rect');
  for (const [name, value] of Object.entries({ x: '20.2', y: '13.2', width: '5.6', height: '5.6', rx: '1.1', fill: 'currentColor' })) rect.setAttribute(name, value);
  svg.append(path, rect);
  return svg;
}

function navigation(): HTMLElement {
  const theme = themeToggle();
  theme.classList.add('theme-toggle');
  return h('nav', { class: 'public-nav', 'aria-label': 'Public navigation' }, [
    h('a', { class: 'public-brand', href: '#/p/', 'aria-label': 'ChangeProof AI home' }, [
      h('span', { class: 'brandmark' }, [brandMark()]), h('span', {}, ['ChangeProof']), h('em', {}, ['AI']),
    ]),
    h('div', { class: 'public-links' }, [
      h('a', { class: 'nav-product', href: '#/p/product' }, ['Product']),
      h('a', { class: 'nav-price', href: '#/p/pricing' }, ['Pricing']),
      h('a', { class: 'nav-documentation', href: '#/p/guides' }, ['Documentation']),
      theme, h('a', { class: 'public-login', href: '#/login' }, ['Sign in']),
      h('a', { class: 'landing-primary', href: '#/register' }, ['Get started free']),
    ]),
  ]);
}

function technologyStrip(): HTMLElement {
  const technologies = [
    ['GitHub', 'github'], ['OpenAPI', 'openapi'], ['JavaScript', 'javascript'], ['Java', 'java'],
    ['Python', 'python'], ['Go', 'go'], ['TypeScript', 'typescript'], ['.NET', 'dotnet'], ['PHP', 'php'],
  ] as const;
  const group = (hidden: boolean): HTMLElement => h('div', hidden ? { class: 'cp-tech-group', 'aria-hidden': 'true' } : { class: 'cp-tech-group' },
    technologies.map(([name, kind]) => h('span', { class: 'cp-tech-logo' }, [
      h('span', { class: `cp-tech-mark cp-tech-${kind}`, 'aria-hidden': 'true' }, [
        h('img', { src: `/assets/technology/${kind}.svg`, alt: '', width: '31', height: '31' }),
      ]), name,
    ])));
  return h('section', { class: 'cp-tech-strip', 'aria-label': 'Technology scope preview' }, [
    h('p', {}, ['Technology scope']),
    h('div', { class: 'cp-tech-window', tabindex: '0', role: 'region', 'aria-label': 'Technology logos; scope preview, not certified support' }, [
      h('div', { class: 'cp-tech-track' }, [group(false), group(true)]),
    ]),
  ]);
}

export function renderLanding(story: HTMLElement, footer: HTMLElement): HTMLElement {
  const walkthrough = story.querySelector<HTMLElement>('section.proof-story') ?? story;
  const canvas = h('canvas', { class: 'cp-ghost-fibers', 'aria-hidden': 'true' });
  const hero = h('section', { class: 'landing-hero cp-identity-hero', 'aria-label': 'ChangeProof AI' }, [
    canvas, h('div', { class: 'cp-ghost-shade', 'aria-hidden': 'true' }),
    h('a', { class: 'modern-release', href: '#/p/integrations' }, [h('b', {}, ['New']), 'Change intelligence. Independent proof.']),
    h('h1', {}, [h('span', {}, ['Every change.']), h('span', {}, ['One ', h('mark', {}, ['proof.'])])]),
    h('p', { class: 'modern-hero-sub' }, [
      h('span', {}, ['Every impact mapped.']), h('span', {}, ['Every fix checked.']),
      h('span', {}, [h('strong', {}, ['One place to be sure.'])]),
    ]),
    h('div', { class: 'landing-hero-actions' }, [
      h('div', { class: 'modern-cta-pair' }, [
        h('a', { href: '#/p/pricing' }, ['View pricing']), h('a', { class: 'landing-primary', href: '#/register' }, ['Get started free']),
      ]),
      h('p', { class: 'modern-hero-caption' }, ['Start with one project · Evidence-led · Budget controlled']),
    ]),
  ]);
  // Existing interactive walkthrough and its tests are retained below the hero.
  walkthrough.classList.add('landing-proof-story');
  const eyebrow = walkthrough.querySelector('.eyebrow');
  if (eyebrow !== null) eyebrow.textContent = 'Interactive preview · illustrative data';
  const heading = walkthrough.querySelector('h2');
  if (heading !== null) heading.replaceChildren('Follow the change.', h('br'), h('em', {}, ['See the proof.']));
  const availability = h('aside', { class: 'landing-availability' }, [
    h('p', {}, ['Muse and Modal are unavailable in this demo. The workflow preview is illustrative; no live AI repair is shown.']),
    h('a', { href: '#/' }, ['View service status']),
  ]);
  const root = h('div', { class: 'landing-page' }, [navigation(), hero, technologyStrip(), walkthrough, availability, footer]);
  queueMicrotask(() => {
    if (!root.isConnected) return;
    let stop: (() => void) | undefined;
    try {
      const fibers = startLandingFibers(canvas, hero);
      stop = fibers === null ? undefined : () => { fibers.stop(); };
    } catch {
      // A decorative canvas cannot disable navigation or error handling.
      hero.dataset['fiberRenderer'] = 'unavailable';
    }
    const owner = root.parentElement;
    const removal = new MutationObserver(() => {
      if (root.isConnected) return;
      stop?.(); removal.disconnect();
    });
    if (owner !== null) removal.observe(owner, { childList: true });
  });
  return root;
}
