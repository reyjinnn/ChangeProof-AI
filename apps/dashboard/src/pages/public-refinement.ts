import './public-refinement.css';
import { h, iconSvg } from '../components.js';
import { workflowMap } from '../pilot-visuals.js';

/** Reviewed, static product explanations. Never receipts or service status. */
export function refinePublicPage(root: HTMLElement, name: string): void {
  root.classList.add('cp-pilot', 'public-refined');
  root.dataset['publicComposition'] = name;
  root.querySelector('.public-breadcrumb')?.append(h('a', { class: 'refined-workspace-link', href: '#/' }, ['Open workspace →']));
  const summary = h('summary', { 'aria-label': 'Public navigation menu' }, [iconSvg('sidebar')]);
  const menu = h('details', { class: 'refined-public-menu' }, [summary, h('nav', { 'aria-label': 'Mobile public navigation' }, [
    ...[['#/', 'Open workspace'], ['#/p/product', 'Product'], ['#/p/pricing', 'Pricing'], ['#/p/how-it-works', 'How it works'], ['#/p/guides', 'Documentation'], ['#/login', 'Sign in']].map(([href, label]) => h('a', { href: href ?? '#/p/' }, [label ?? ''])),
  ])]);
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; summary.focus(); } });
  root.querySelector('.public-links')?.append(menu);
  if (name === 'product') {
    root.querySelectorAll<HTMLElement>('.public-info-card').forEach((card, index) => {
      const number = String(index + 1).padStart(2, '0');
      card.dataset['featureIndex'] = number;
      card.prepend(h('span', { class: 'feature-number', 'aria-hidden': 'true' }, [number]));
    });
    const preview = root.querySelector('.public-product-preview');
    preview?.querySelector('.mini-label')?.replaceChildren('ILLUSTRATIVE PRODUCT WALKTHROUGH');
    preview?.querySelector('.preview-head p')?.replaceChildren('A contract sketch and its required proof scope.');
    preview?.querySelector('.preview-nav-label:last-child')?.replaceChildren('DESIGN EXAMPLE');
    preview?.querySelector('.product-frame')?.setAttribute('aria-label', 'Illustrative contract and evidence workflow. No live run or repaired target is shown.');
    const lines = [
      ['context', ' ', 'type Order = {'], ['removed', '−', '  id: string;'],
      ['added', '+', '  id: OrderId;'], ['context', ' ', '};'],
    ];
    preview?.querySelector('.preview-columns')?.replaceChildren(h('section', { class: 'contract-sketch', 'data-product-illustration': '', 'aria-label': 'Illustrative contract sketch, not executed' }, [
      h('header', { class: 'contract-diff-header' }, [h('span', {}, ['Illustrative contract sketch']), h('span', { class: 'contract-diff-status' }, ['Not executed'])]),
      h('div', { class: 'contract-diff-file' }, [iconSvg('templates'), h('span', {}, ['Order · type boundary']), h('span', {}, ['−1 / +1'])]),
      h('pre', { class: 'contract-diff-lines', 'aria-label': 'Illustrative change from a string identifier to an OrderId identifier' }, lines.map(([kind, sign, source], index) => h('span', { class: 'contract-diff-line', 'data-diff': kind ?? 'context' }, [
        h('span', { class: 'diff-line-number', 'aria-hidden': 'true' }, [String(index + 1)]),
        h('span', { class: 'diff-sign', 'aria-hidden': 'true' }, [sign ?? ' ']), h('code', {}, [source ?? '']),
      ]))),
      h('div', { class: 'contract-diff-context' }, [h('strong', {}, ['What depends on this boundary?']), h('p', {}, ['A candidate is a proposal. Independent checks must establish its result.'])]),
    ]), h('figure', { class: 'contract-evidence-map' }, [h('figcaption', {}, ['CHANGE → DEPENDENCIES → REQUIRED EVIDENCE']), workflowMap('overview')]));
    preview?.querySelector('.preview-bottom')?.replaceChildren(h('span', {}, ['Conceptual example · no execution receipt']), h('span', {}, ['Evidence before a positive claim']));
  }
  if (name === 'pricing') {
    root.querySelector('.public-price-feature')?.append(h('figure', { class: 'budget-concepts', 'data-budget-concepts': '', role: 'img', 'aria-label': 'Illustrative budget process, not an account balance' }, [
      h('figcaption', {}, ['Budget lifecycle · conceptual']), h('div', {}, ['Estimate', h('span', { 'aria-hidden': 'true' }, ['→']), 'Reserve', h('span', { 'aria-hidden': 'true' }, ['→']), 'Reconcile']),
      h('p', {}, ['Your actual allocation is shown in the workspace.']),
    ]));
  }
  if (name === 'verification') {
    root.querySelector('.public-page-content')?.prepend(h('figure', { class: 'verification-boundary', role: 'img', 'aria-label': 'Conceptual separation of proposal, independent checks and deterministic assessment. Not a live run.' }, [
      h('figcaption', {}, ['THE ASSURANCE BOUNDARY · CONCEPTUAL']),
      h('div', {}, [...[['01', 'Agent proposes', 'A candidate, not a verdict'], ['02', 'Verifier checks', 'Independent execution evidence'], ['03', 'Policy assesses', 'Deterministic evidence rules']].map(([number, title, note]) => h('section', {}, [h('span', {}, [number ?? '']), h('strong', {}, [title ?? '']), h('small', {}, [note ?? ''])]))]),
    ]));
  }
  if (name === 'sample-report') {
    root.querySelector('.public-report')?.prepend(h('p', { class: 'sample-design-label' }, ['ILLUSTRATIVE REPORT · STATIC DESIGN EXAMPLE · NOT CUSTOMER RESULTS']));
    const targets = root.querySelector('.public-report-targets');
    if (targets !== null) {
      const rows = [...targets.querySelectorAll('section')].map(section => h('tr', {}, [
        h('th', { scope: 'row' }, [section.querySelector('h3')?.textContent ?? 'Example target']),
        h('td', { 'data-label': 'Example outcome' }, [h('span', { class: section.querySelector('.badge')?.className ?? 'badge' }, [section.querySelector('.badge')?.textContent ?? 'Unknown'])]),
        h('td', { 'data-label': 'Scope note' }, [section.querySelector('p')?.textContent ?? 'Not assessed']),
      ]));
      targets.replaceWith(h('div', { class: 'report-matrix-wrap' }, [h('table', { class: 'report-matrix' }, [
        h('caption', {}, ['Illustrative target outcomes · not a live run']),
        h('thead', {}, [h('tr', {}, ['Target', 'Example outcome', 'Scope note'].map(label => h('th', { scope: 'col' }, [label])))]), h('tbody', {}, rows),
      ])]));
    }
  }
}
