import './landing-pilot.css';
import { h, iconSvg } from '../components.js';
import { workflowMap } from '../pilot-visuals.js';

/** Enhance only the public Landing. Auth backdrops retain the original port. */
export function applyLandingPilot(root: HTMLElement): void {
  root.classList.add('cp-pilot', 'landing-pilot');
  const eyebrow = root.querySelector('.proof-story-copy > .section-eyebrow');
  if (eyebrow !== null) eyebrow.textContent = 'ONE CHANGE. THREE PERSPECTIVES.';
  const frame = root.querySelector('.proof-stage-top');
  if (frame !== null) {
    const title = frame.querySelector('strong');
    if (title !== null) title.textContent = 'ChangeProof / change explorer';
    frame.append(h('span', { class: 'pilot-example-badge' }, ['Illustrative preview']));
  }
  root.querySelector('#proof-panel-impact .proof-flow')?.replaceWith(workflowMap('landing'));
  const evidence = root.querySelector('.proof-checks');
  if (evidence !== null) evidence.replaceChildren(h('ol', { class: 'pilot-evidence-checks', 'aria-label': 'Illustrative required verification checks' },
    ([['01', 'Candidate identity', 'Must match the checked source'], ['02', 'Target checks', 'Required independently'], ['03', 'Cross-system proof', 'Incomplete in this example']] as const).map(([number, title, note]) => h('li', { class: 'pilot-evidence-row', 'data-proof-state': number === '03' ? 'incomplete' : 'required' }, [
      h('span', { class: 'pilot-evidence-step', 'aria-hidden': 'true' }, [number]),
      h('div', { class: 'pilot-evidence-body' }, [
        h('div', { class: 'pilot-evidence-label' }, [h('strong', {}, [title]), ...(number === '03' ? [h('span', { class: 'pilot-evidence-state' }, [h('span', { 'aria-hidden': 'true' }, ['!']), 'Incomplete'])] : [])]),
        h('small', {}, [note]),
      ]),
    ])),
  ));
  const workspace = h('a', { class: 'pilot-workspace-entry', href: '#/', 'data-open-workspace': '' }, ['Open workspace', h('span', { 'aria-hidden': 'true' }, ['→'])]);
  root.querySelector('.cp-identity-hero .modern-cta-pair')?.after(workspace);
  const summary = h('summary', { 'aria-label': 'Public navigation menu' }, [iconSvg('sidebar')]);
  const menu = h('details', { class: 'pilot-public-menu' }, [summary, h('nav', { 'aria-label': 'Mobile public navigation' }, [
    ...[['/', 'Open workspace'], ['/p/product', 'Product'], ['/p/how-it-works', 'How it works'], ['/p/pricing', 'Pricing'], ['/p/guides', 'Documentation'], ['/login', 'Sign in']].map(([path, label]) => h('a', { href: `#${path ?? '/p/'}` }, [label ?? ''])),
  ])]);
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; summary.focus(); } });
  root.querySelector('.public-links')?.append(menu);
}
