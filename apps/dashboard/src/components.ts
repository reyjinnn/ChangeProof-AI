/* Shared UI components (T-42). Server and user content is untrusted:
 * render it with textContent (never innerHTML with variables), and keep
 * every interactive control keyboard-reachable with a visible label. */

import { loadTheme, saveTheme } from './store.js';

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'info';

/** Shared across public/auth headers and the workspace; never a separate theme. */
export function themeToggle(): HTMLButtonElement {
  const button = h('button', { class: 'button theme-control', type: 'button', 'data-theme-toggle': '' });
  const update = (target: HTMLButtonElement, theme: 'light' | 'dark'): void => {
    const label = theme === 'dark' ? 'Light mode' : 'Dark mode';
    target.setAttribute('aria-label', label);
    target.title = label;
    target.replaceChildren(iconSvg('theme'), h('span', { class: 'sr-only' }, [label]));
  };
  update(button, loadTheme());
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) update(control, next);
  });
  return button;
}

export function siteHeader(): HTMLElement {
  return h('header', { class: 'site-header' }, [
    h('a', { class: 'site-brand', href: '#/p/', 'aria-label': 'ChangeProof AI home' }, [
      h('img', { src: '/assets/changeproof-mark.svg', width: '32', height: '32', alt: '' }),
      h('strong', {}, ['ChangeProof ', h('span', {}, ['AI'])]),
    ]),
    h('nav', { class: 'site-links', 'aria-label': 'Public' }, [
      h('a', { href: '#/p/product' }, ['Product']),
      h('a', { href: '#/p/templates' }, ['Templates']),
      h('a', { href: '#/p/sample-report' }, ['Sample reports']),
      h('a', { href: '#/p/help' }, ['Help']),
    ]),
    h('div', { class: 'site-actions' }, [
      themeToggle(),
      h('a', { class: 'button primary', href: '#/login' }, ['Get started']),
      h('a', { class: 'site-workspace', href: '#/' }, ['Workspace']),
    ]),
  ]);
}

export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Tiny element builder; children pass through textContent-safe paths. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: readonly (HTMLElement | SVGElement | Text | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value);
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag: string, attrs: Record<string, string> = {}, children: readonly SVGElement[] = []): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const child of children) el.appendChild(child);
  return el;
}

export type IconName =
  | 'status'
  | 'runs'
  | 'new-run'
  | 'evidence'
  | 'inbox'
  | 'support'
  | 'threads'
  | 'operator'
  | 'billing'
  | 'enterprise'
  | 'settings'
  | 'public'
  | 'templates'
  | 'samples'
  | 'faq'
  | 'pricing'
  | 'roadmap'
  | 'changelog'
  | 'search'
  | 'theme'
  | 'sidebar'
  | 'shield'
  | 'spark'
  | 'check'
  | 'alert';

export function iconSvg(name: IconName, className = 'nav-icon'): SVGElement {
  const base = {
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    focusable: 'false',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.85',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: className,
  };
  switch (name) {
    case 'status':
      return svgEl('svg', base, [
        svgEl('rect', { x: '3', y: '3', width: '7', height: '7', rx: '1.5' }),
        svgEl('rect', { x: '14', y: '3', width: '7', height: '7', rx: '1.5' }),
        svgEl('rect', { x: '14', y: '14', width: '7', height: '7', rx: '1.5' }),
        svgEl('rect', { x: '3', y: '14', width: '7', height: '7', rx: '1.5' }),
      ]);
    case 'runs':
      return svgEl('svg', base, [
        svgEl('polygon', { points: '5 3 19 12 5 21 5 3' }),
      ]);
    case 'new-run':
      return svgEl('svg', base, [
        svgEl('circle', { cx: '12', cy: '12', r: '9' }),
        svgEl('line', { x1: '12', y1: '8', x2: '12', y2: '16' }),
        svgEl('line', { x1: '8', y1: '12', x2: '16', y2: '12' }),
      ]);
    case 'evidence':
      return svgEl('svg', base, [
        svgEl('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
        svgEl('path', { d: 'M9 12l2 2 4-4' }),
      ]);
    case 'inbox':
      return svgEl('svg', base, [
        svgEl('path', { d: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z' }),
        svgEl('polyline', { points: '22,6 12,13 2,6' }),
      ]);
    case 'support':
      return svgEl('svg', base, [
        svgEl('circle', { cx: '12', cy: '12', r: '10' }),
        svgEl('path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }),
        svgEl('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }),
      ]);
    case 'threads':
      return svgEl('svg', base, [
        svgEl('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }),
      ]);
    case 'operator':
      return svgEl('svg', base, [
        svgEl('polyline', { points: '4 17 10 11 4 5' }),
        svgEl('line', { x1: '12', y1: '19', x2: '20', y2: '19' }),
      ]);
    case 'billing':
      return svgEl('svg', base, [
        svgEl('rect', { x: '2', y: '5', width: '20', height: '14', rx: '2' }),
        svgEl('line', { x1: '2', y1: '10', x2: '22', y2: '10' }),
      ]);
    case 'enterprise':
      return svgEl('svg', base, [
        svgEl('rect', { x: '3', y: '11', width: '18', height: '11', rx: '2' }),
        svgEl('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }),
      ]);
    case 'settings':
      return svgEl('svg', base, [
        svgEl('circle', { cx: '12', cy: '12', r: '3' }),
        svgEl('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }),
      ]);
    case 'templates':
      return svgEl('svg', base, [
        svgEl('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }),
        svgEl('line', { x1: '3', y1: '9', x2: '21', y2: '9' }),
        svgEl('line', { x1: '9', y1: '21', x2: '9', y2: '9' }),
      ]);
    case 'samples':
      return svgEl('svg', base, [
        svgEl('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        svgEl('polyline', { points: '14 2 14 8 20 8' }),
        svgEl('line', { x1: '16', y1: '13', x2: '8', y2: '13' }),
        svgEl('line', { x1: '16', y1: '17', x2: '8', y2: '17' }),
      ]);
    case 'faq':
      return svgEl('svg', base, [
        svgEl('circle', { cx: '12', cy: '12', r: '9' }),
        svgEl('path', { d: 'M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5' }),
        svgEl('line', { x1: '12', y1: '16.5', x2: '12.01', y2: '16.5' }),
      ]);
    case 'pricing':
      return svgEl('svg', base, [
        svgEl('line', { x1: '12', y1: '2', x2: '12', y2: '22' }),
        svgEl('path', { d: 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }),
      ]);
    case 'roadmap':
      return svgEl('svg', base, [
        svgEl('polygon', { points: '3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21' }),
        svgEl('line', { x1: '9', y1: '3', x2: '9', y2: '18' }),
        svgEl('line', { x1: '15', y1: '6', x2: '15', y2: '21' }),
      ]);
    case 'changelog':
      return svgEl('svg', base, [
        svgEl('circle', { cx: '12', cy: '12', r: '9' }),
        svgEl('polyline', { points: '12 7 12 12 15 15' }),
      ]);
    case 'search':
      return svgEl('svg', base, [
        svgEl('circle', { cx: '11', cy: '11', r: '7' }),
        svgEl('line', { x1: '20', y1: '20', x2: '16.2', y2: '16.2' }),
      ]);
    case 'theme':
      return svgEl('svg', base, [
        svgEl('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }),
      ]);
    case 'sidebar':
      return svgEl('svg', base, [
        svgEl('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }),
        svgEl('line', { x1: '9', y1: '3', x2: '9', y2: '21' }),
      ]);
    case 'shield':
      return svgEl('svg', base, [
        svgEl('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
      ]);
    case 'spark':
      return svgEl('svg', base, [
        svgEl('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }),
      ]);
    case 'check':
      return svgEl('svg', base, [
        svgEl('polyline', { points: '20 6 9 17 4 12' }),
      ]);
    case 'alert':
      return svgEl('svg', base, [
        svgEl('path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }),
        svgEl('line', { x1: '12', y1: '9', x2: '12', y2: '13' }),
        svgEl('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }),
      ]);
    default:
      return svgEl('svg', base, [
        svgEl('circle', { cx: '12', cy: '12', r: '9' }),
        svgEl('line', { x1: '2', y1: '12', x2: '22', y2: '12' }),
        svgEl('path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }),
      ]);
  }
}

export function brandMarkSvg(): SVGElement {
  return svgEl(
    'svg',
    {
      viewBox: '0 0 36 36',
      fill: 'none',
      class: 'brand-mark',
      'aria-hidden': 'true',
      width: '32',
      height: '32',
    },
    [
      svgEl('defs', {}, [
        svgEl('linearGradient', { id: 'cp-brand-grad', x1: '2', y1: '2', x2: '34', y2: '34', gradientUnits: 'userSpaceOnUse' }, [
          svgEl('stop', { offset: '0', 'stop-color': '#365e96' }),
          svgEl('stop', { offset: '0.52', 'stop-color': '#3e659a' }),
          svgEl('stop', { offset: '1', 'stop-color': '#466c9e' }),
        ]),
      ]),
      svgEl('rect', { x: '2', y: '2', width: '32', height: '32', rx: '9', fill: 'url(#cp-brand-grad)' }),
      svgEl('path', {
        d: 'M18 7L27 11V18.2C27 23.8 23.2 27.9 18 29.5C12.8 27.9 9 23.8 9 18.2V11L18 7Z',
        stroke: '#ffffff',
        'stroke-opacity': '0.88',
        'stroke-width': '1.6',
      }),
      svgEl('path', {
        d: 'M12.5 18.2L16.3 22L23.8 14.3',
        stroke: '#ffffff',
        'stroke-width': '2.4',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ],
  );
}

const TONE_LABEL: Record<BadgeTone, string> = { ok: 'ok', warn: 'attention', bad: 'blocked', info: 'info' };

/** Status badge: text label plus tone, never color alone. */
export function badge(tone: BadgeTone, label: string): HTMLElement {
  return h('span', { class: 'badge', 'data-tone': tone }, [`${TONE_LABEL[tone]}: ${label}`]);
}

export function pageHead(options: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: readonly HTMLElement[];
}): HTMLElement {
  const leftChildren: HTMLElement[] = [];
  if (options.eyebrow !== undefined) {
    leftChildren.push(h('div', { class: 'eyebrow' }, [options.eyebrow]));
  }
  leftChildren.push(h('h1', {}, [options.title]));
  if (options.subtitle !== undefined) {
    leftChildren.push(h('p', { class: 'sub' }, [options.subtitle]));
  }
  const head = h('div', { class: 'pagehead page-head' }, [h('div', {}, leftChildren)]);
  if (options.actions !== undefined && options.actions.length > 0) {
    head.appendChild(h('div', { class: 'btn-row' }, options.actions));
  }
  return head;
}

export function emptyState(title: string, body: string, action?: HTMLElement): HTMLElement {
  const art = h('div', { class: 'modern-empty-art', 'aria-hidden': 'true' }, []);
  art.appendChild(iconSvg('shield', 'empty-icon'));
  const block = h('section', { class: 'card state-block', 'aria-live': 'polite' }, [
    art,
    h('h2', {}, [title]),
    h('p', { class: 'muted' }, [body]),
  ]);
  if (action !== undefined) block.appendChild(action);
  return block;
}

export function errorState(title: string, body: string, retry?: { label: string; onClick: () => void }): HTMLElement {
  const block = h('section', { class: 'card state-block', role: 'alert' }, [
    h('h2', {}, [title]),
    h('p', {}, [body]),
  ]);
  if (retry !== undefined) {
    const button = h('button', { class: 'button', type: 'button' }, [retry.label]);
    button.addEventListener('click', retry.onClick);
    block.appendChild(button);
  }
  return block;
}

export interface FieldOptions {
  readonly id: string;
  readonly label: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly autocomplete?: string;
  readonly error?: string;
  readonly hint?: string;
}

/** Labeled input with an actionable error slot. */
export function field(options: FieldOptions): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = h('div', { class: 'field' }, []);
  const label = h('label', { for: options.id }, [options.label]);
  wrap.appendChild(label);
  const input = h('input', {
    id: options.id,
    name: options.id,
    type: options.type ?? 'text',
    ...(options.required === true ? { required: 'required' } : {}),
    ...(options.autocomplete !== undefined ? { autocomplete: options.autocomplete } : {}),
  });
  if (options.hint !== undefined) {
    const hintId = `${options.id}-hint`;
    input.setAttribute('aria-describedby', hintId);
    wrap.appendChild(input);
    wrap.appendChild(h('p', { class: 'muted', id: hintId }, [options.hint]));
  } else {
    wrap.appendChild(input);
  }
  if (options.error !== undefined) {
    input.setAttribute('aria-invalid', 'true');
    const errorId = `${options.id}-error`;
    const described = input.getAttribute('aria-describedby');
    input.setAttribute('aria-describedby', described === null ? errorId : `${described} ${errorId}`);
    wrap.appendChild(h('p', { class: 'error-text', id: errorId }, [options.error]));
  }
  return { wrap, input };
}

export interface ModalHandle {
  readonly root: HTMLElement;
  close(): void;
}

/**
 * Modal dialog: labelled, Escape closes, focus returns to the trigger.
 * Keep one open at a time; the caller owns the content.
 */
export function modal(trigger: HTMLElement, title: string, content: HTMLElement): ModalHandle {
  const heading = h('h2', { id: 'modal-title' }, [title]);
  const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' }, [
    heading,
    content,
  ]);
  const backdrop = h('div', { class: 'modal-backdrop' }, [dialog]);

  const handle: ModalHandle = {
    root: backdrop,
    close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      trigger.focus();
    },
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handle.close();
    }
    // Minimal focus trap: wrap Tab around the dialog's focusable controls.
    if (event.key === 'Tab') {
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
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
  }

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) handle.close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  const firstInput = dialog.querySelector<HTMLElement>('input, select, textarea, button');
  if (firstInput !== null) firstInput.focus();
  return handle;
}
