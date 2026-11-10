/* Shared UI components. Server and user content is untrusted: render it
 * with textContent (never innerHTML with variables), and keep every
 * interactive control keyboard-reachable with a visible label. DOM shapes
 * follow .template-ui/mockup.html (badge/head/card/padcard/row/table/tabs,
 * drawer/modal/toast roots, .cp-select combobox, .cp-file-picker). */

import { ICON_PATHS, type IconName } from './icons.js';
import { loadTheme, saveTheme } from './store.js';

export type { IconName };
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
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/** Mockup `icon(k)`: static trusted artwork from a closed key union. */
export function iconSvg(name: IconName, className = 'icon'): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  // Static artwork only: ICON_PATHS values ship with the bundle and the
  // key union is closed, so no dynamic data can reach innerHTML here.
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}

/** Mockup `pillIcon`: icon inside a `.stat-icon` tile. */
export function pillIcon(name: IconName): HTMLElement {
  const pill = h('span', { class: 'stat-icon', 'aria-hidden': 'true' }, []);
  pill.appendChild(iconSvg(name));
  return pill;
}

/** Product mark inlined from `apps/dashboard/public/assets/changeproof-mark.svg`
 * (also the favicon): rounded tile + C glyph + dot. Static trusted artwork
 * with fixed brand colors that hold in both themes; sizes come from CSS.
 * Decorative: the brand wordmark next to it carries the accessible name. */
export function changeproofMarkSvg(): SVGElement {
  return svgEl(
    'svg',
    { viewBox: '0 0 64 64', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
    [
      svgEl('rect', { x: '0', y: '0', width: '64', height: '64', rx: '16', fill: '#365E96' }),
      svgEl(
        'g',
        {
          transform: 'translate(8 8) scale(1.5)',
          fill: 'none',
          stroke: '#FFFFFF',
          'stroke-width': '3.4',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
        [svgEl('path', { d: 'M23 6.5h-7.5C10 6.5 6 10.5 6 16s4 9.5 9.5 9.5H23' })],
      ),
      svgEl('rect', { x: '38.3', y: '27.8', width: '8.4', height: '8.4', rx: '1.65', fill: '#FFFFFF' }),
    ],
  );
}

/** The ChangeProof C-mark from the mockup signin/public brand (32px static
 * artwork, currentColor). Sizes come from CSS (.brandmark, .signin-brand-mark). */
export function logoMarkSvg(): SVGElement {
  return svgEl(
    'svg',
    { viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
    [
      svgEl('path', {
        d: 'M23 6.5h-7.5C10 6.5 6 10.5 6 16s4 9.5 9.5 9.5H23',
        stroke: 'currentColor',
        'stroke-width': '3.4',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
      svgEl('rect', { x: '20.2', y: '13.2', width: '5.6', height: '5.6', rx: '1.1', fill: 'currentColor' }),
    ],
  );
}

const TONE_LABEL: Record<BadgeTone, string> = { ok: 'ok', warn: 'attention', bad: 'blocked', info: 'info' };

/** Status badge: text label plus tone, never color alone. */
export function badge(tone: BadgeTone, label: string): HTMLElement {
  return h('span', { class: 'badge', 'data-tone': tone }, [`${TONE_LABEL[tone]}: ${label}`]);
}

/** Mockup `badge(s, c)`: plain modifier-class badge for static labels. */
export function staticBadge(label: string, modifier = ''): HTMLElement {
  return h('span', { class: modifier === '' ? 'badge' : `badge ${modifier}` }, [label]);
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
    head.appendChild(h('div', { class: 'actions' }, options.actions));
  }
  return head;
}

/** Mockup `head(title, sub, actions, crumb)` shape. */
export function head(title: string, subtitle: string, actions: readonly HTMLElement[] = [], crumb?: string): HTMLElement {
  const fragment = h('div', {}, []);
  if (crumb !== undefined) fragment.appendChild(h('div', { class: 'breadcrumb' }, [crumb]));
  fragment.appendChild(
    h('header', { class: 'pagehead' }, [
      h('div', {}, [h('h1', {}, [title]), h('p', {}, [subtitle])]),
      ...(actions.length > 0 ? [h('div', { class: 'actions' }, actions)] : []),
    ]),
  );
  return fragment;
}

export function helpText(text: string): HTMLElement {
  return h('p', { class: 'help' }, [text]);
}

/** Mockup `card(title, body, sub, extra)`: headed card section. */
export function card(title: string, body: HTMLElement, sub?: string, extra?: HTMLElement): HTMLElement {
  const headLeft = h('div', {}, [h('h2', {}, [title])]);
  if (sub !== undefined) headLeft.appendChild(h('div', { class: 'help' }, [sub]));
  const headRowChildren: HTMLElement[] = [headLeft];
  if (extra !== undefined) headRowChildren.push(extra);
  return h('section', { class: 'card' }, [h('div', { class: 'card-head' }, headRowChildren), body]);
}

/** Mockup `padcard(title, body)`: padded card section. */
export function padcard(title: string, body: HTMLElement): HTMLElement {
  return h('section', { class: 'card pad' }, [h('h2', {}, [title]), body]);
}

/** Mockup `row(a, b)`: two-column list row. Strings stay text-safe. */
export function row(left: HTMLElement | string, right: HTMLElement | string): HTMLElement {
  const toNode = (value: HTMLElement | string): HTMLElement | Text =>
    typeof value === 'string' ? document.createTextNode(value) : value;
  return h('div', { class: 'listrow' }, [
    h('span', {}, [toNode(left)]),
    h('span', {}, [toNode(right)]),
  ]);
}

export interface TableOptions {
  readonly className?: string;
}

/** Mockup `table(heads, rows, cls)`: wrapped table with scoped headers. */
export function table(
  heads: readonly (HTMLElement | string)[],
  rows: readonly (readonly (HTMLElement | string)[])[],
  options: TableOptions = {},
): HTMLElement {
  const cell = (value: HTMLElement | string, header: boolean): HTMLElement =>
    header
      ? h('th', { scope: 'col' }, [typeof value === 'string' ? document.createTextNode(value) : value])
      : h('td', {}, [typeof value === 'string' ? document.createTextNode(value) : value]);
  const thead = h('thead', {}, [h('tr', {}, heads.map((value) => cell(value, true)))]);
  const tbody = h('tbody', {}, rows.map((columns) => h('tr', {}, columns.map((value) => cell(value, false)))));
  const tableEl = h('table', options.className === undefined ? {} : { class: options.className }, [thead, tbody]);
  return h('div', { class: 'table-wrap' }, [tableEl]);
}

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

/** Mockup `tabs(items, current)`: `.route-tabs` page navigation. */
export function tabs(items: readonly TabItem[], currentId: string): HTMLElement {
  const nav = h('nav', { class: 'route-tabs', 'aria-label': 'Page navigation' }, []);
  for (const item of items) {
    const active = item.id === currentId;
    nav.appendChild(
      h(
        'a',
        {
          href: item.href,
          class: active ? 'active' : '',
          ...(active ? { 'aria-current': 'page' } : {}),
        },
        [item.label],
      ),
    );
  }
  return nav;
}

export function emptyStateArt(): SVGElement {
  return svgEl('svg', { class: 'modern-empty-art', viewBox: '0 0 120 90', fill: 'none', 'aria-hidden': 'true' }, [
    svgEl('rect', { x: '22', y: '25', width: '74', height: '52', rx: '12', fill: 'var(--surface)', stroke: 'var(--line)' }),
    svgEl('rect', { x: '34', y: '14', width: '53', height: '54', rx: '9', fill: 'var(--paper)', stroke: 'var(--line)' }),
    svgEl('path', { d: 'M47 30h26M47 38h19M47 46h13', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' }),
    svgEl('circle', { cx: '85', cy: '63', r: '14', fill: 'var(--accent)' }),
    svgEl('path', { d: 'm79 63 4 4 8-9', stroke: 'var(--accent-ink)', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    svgEl('path', { d: 'm15 12 2 4 4 2-4 2-2 4-2-4-4-2 4-2zM105 33v6m-3-3h6', stroke: 'var(--line)', 'stroke-linecap': 'round' }),
  ]);
}

export function ensureEmptyStateArt(root: ParentNode = document): void {
  root.querySelectorAll('.empty-state').forEach((state) => {
    if (state.querySelector('.modern-empty-art') !== null) return;
    state.prepend(emptyStateArt());
  });
}

export function emptyState(title: string, body: string, action?: HTMLElement): HTMLElement {
  const block = h('section', { class: 'card state-block', 'aria-live': 'polite' }, [
    h('div', { class: 'empty-state' }, [
      emptyStateArt(),
      pillIcon('shield'),
      h('h2', {}, [title]),
      h('p', {}, [body]),
      ...(action === undefined ? [] : [action]),
    ]),
  ]);
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
  readonly placeholder?: string;
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
    ...(options.placeholder !== undefined ? { placeholder: options.placeholder } : {}),
  });
  if (options.hint !== undefined) {
    const hintId = `${options.id}-hint`;
    input.setAttribute('aria-describedby', hintId);
    wrap.appendChild(input);
    wrap.appendChild(h('p', { class: 'field-note', id: hintId }, [options.hint]));
  } else {
    wrap.appendChild(input);
  }
  if (options.error !== undefined) {
    input.setAttribute('aria-invalid', 'true');
    const errorId = `${options.id}-error`;
    const described = input.getAttribute('aria-describedby');
    input.setAttribute('aria-describedby', described === null ? errorId : `${described} ${errorId}`);
    wrap.appendChild(h('p', { class: 'form-error', id: errorId }, [options.error]));
  }
  return { wrap, input };
}

export interface ModalHandle {
  readonly root: HTMLElement;
  close(): void;
}

function modalContainer(): HTMLElement {
  return document.getElementById('modalRoot') ?? document.body;
}

function trapFocus(container: HTMLElement, onEscape: () => void): () => void {
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = container.querySelectorAll<HTMLElement>(
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
  document.addEventListener('keydown', onKey, true);
  return () => { document.removeEventListener('keydown', onKey, true); };
}

/**
 * Modal dialog: labelled, Escape closes, focus returns to the trigger.
 * Renders into #modalRoot (mockup parity), falling back to body.
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
      release();
      trigger.focus();
    },
  };
  const release = trapFocus(dialog, () => { handle.close(); });

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) handle.close();
  });
  modalContainer().appendChild(backdrop);
  const firstInput = dialog.querySelector<HTMLElement>('input, select, textarea, button');
  if (firstInput !== null) firstInput.focus();
  return handle;
}

export interface DrawerHandle {
  readonly root: HTMLElement;
  close(): void;
}

function drawerContainer(): HTMLElement {
  let root = document.getElementById('drawerRoot');
  if (root === null) {
    root = h('div', { id: 'drawerRoot' }, []);
    document.body.appendChild(root);
  }
  return root;
}

/**
 * Mockup `drawer(title, body, footer)`: right-side panel in #drawerRoot.
 * Escape and backdrop press close it; focus returns to the trigger.
 */
export function drawer(trigger: HTMLElement, title: string, body: HTMLElement, footer?: HTMLElement): DrawerHandle {
  closeDrawer();
  const closeButton = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close panel' }, []);
  closeButton.appendChild(iconSvg('close'));
  const panel = h(
    'section',
    { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawerTitle', tabindex: '-1' },
    [
      h('header', { class: 'drawer-head' }, [h('h2', { id: 'drawerTitle' }, [title]), closeButton]),
      h('div', { class: 'drawer-body' }, [body]),
      ...(footer === undefined ? [] : [h('footer', { class: 'drawer-foot' }, [footer])]),
    ],
  );
  const backdrop = h('div', { class: 'drawer-backdrop', 'data-drawer-backdrop': '' }, [panel]);
  const handle: DrawerHandle = {
    root: backdrop,
    close() {
      backdrop.remove();
      release();
      document.body.style.overflow = '';
      if (trigger.isConnected) trigger.focus();
    },
  };
  const release = trapFocus(panel, () => { handle.close(); });
  closeButton.addEventListener('click', () => { handle.close(); });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) handle.close();
  });
  drawerContainer().appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  panel.focus();
  enhanceCustomSelects(panel, false);
  enhanceFilePickers(panel);
  return handle;
}

/** Close any open drawer without touching focus (route changes). */
export function closeDrawer(): void {
  document.getElementById('drawerRoot')?.replaceChildren();
  document.body.style.overflow = '';
}

export type ToastTone = 'info' | 'success' | 'error';

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Mockup `toast(message)`: status toast in the persistent #toast live
 * region (created by the shell, so announcements are never silent).
 */
export function toast(message: string, tone: ToastTone = 'info'): void {
  const region = document.getElementById('toast');
  if (region === null) return;
  if (toastTimer !== null) clearTimeout(toastTimer);
  region.className = `toast show ${tone}`;
  const symbol = h('span', { class: 'toast-symbol', 'aria-hidden': 'true' }, []);
  symbol.appendChild(iconSvg(tone === 'success' ? 'check' : tone === 'error' ? 'alert' : 'info'));
  const dismiss = h('button', { class: 'toast-dismiss', type: 'button', 'aria-label': 'Dismiss notification' }, ['×']);
  dismiss.addEventListener('click', () => { region.classList.remove('show'); });
  region.replaceChildren(
    symbol,
    h('span', { class: 'toast-copy' }, [h('span', { class: 'toast-title' }, ['ChangeProof AI']), message]),
    dismiss,
  );
  toastTimer = setTimeout(() => { region.classList.remove('show'); }, 5500);
}

/* Accessible combobox enhancement (mockup 1603-1737). The native select
 * stays the form's source of truth; the trigger only presents it. All
 * user-visible strings are English (FR3-40). */

interface CustomSelectState {
  readonly select: HTMLSelectElement;
  readonly trigger: HTMLButtonElement;
  readonly id: string;
  readonly label: string;
  readonly rich: boolean;
  active: number;
  /** Signature of the last trigger render; skips redundant rebuilds. */
  rendered: string;
}

const enhancedSelects = new WeakMap<HTMLSelectElement, CustomSelectState>();
let customSelectCount = 0;
let openSelect: CustomSelectState | null = null;
let selectTypeahead = '';
let selectTypeaheadTimer: ReturnType<typeof setTimeout> | null = null;
let selectWired = false;

const CHANGE_OPTION_META: ReadonlyMap<string, { icon: IconName; description: string }> = new Map([
  ['contract', { icon: 'git', description: 'Endpoint, schema, or API contract changes.' }],
  ['dependency', { icon: 'projects', description: 'Library, framework, or runtime upgrades.' }],
  ['migration', { icon: 'usage', description: 'Schema changes and data migrations.' }],
  ['incident', { icon: 'runs', description: 'Investigate errors from the running system.' }],
  ['coordinated', { icon: 'graph', description: 'Coordinated changes across repositories.' }],
  ['legacy', { icon: 'book', description: 'Understand system behavior before repair.' }],
]);

function selectOptionContent(select: HTMLSelectElement, option: HTMLOptionElement | null): HTMLElement {
  const meta = select.id === 'changeTemplate' && option !== null ? CHANGE_OPTION_META.get(option.value) : undefined;
  const copy = h('span', { class: 'cp-select-copy' }, [
    h('span', { class: 'cp-select-name' }, [option?.textContent ?? 'Select an option']),
  ]);
  if (meta !== undefined) copy.appendChild(h('span', { class: 'cp-select-description' }, [meta.description]));
  const fragment = h('span', { style: 'display:contents' }, []);
  if (meta !== undefined) {
    const glyph = h('span', { class: 'cp-select-glyph', 'aria-hidden': 'true' }, []);
    glyph.appendChild(iconSvg(meta.icon));
    fragment.appendChild(glyph);
  }
  fragment.appendChild(copy);
  return fragment;
}

function selectSignature(select: HTMLSelectElement): string {
  const options = [...select.options].map((option) => `${option.value}=${option.textContent}`).join(',');
  return `${String(select.selectedIndex)}|${select.disabled ? '1' : '0'}|${options}`;
}

function syncCustomSelect(select: HTMLSelectElement): void {
  const state = enhancedSelects.get(select);
  if (state === undefined) return;
  // Idempotent by signature: the shell re-runs enhancement on every
  // outlet mutation, and an unconditional rebuild would refire the
  // observer forever on any page with an inline select. The option list
  // refresh is safe unconditionally: the portal lives outside the
  // observed outlet.
  const signature = selectSignature(select);
  if (signature !== state.rendered) {
    state.rendered = signature;
    const option = select.selectedOptions[0] ?? select.options[0] ?? null;
    state.trigger.replaceChildren(
      selectOptionContent(select, option),
      iconSvg('chevron-down', 'icon cp-select-chevron'),
    );
    state.trigger.disabled = select.disabled;
    state.trigger.setAttribute('aria-label', `${state.label}: ${option?.textContent ?? 'Select an option'}`);
  }
  if (openSelect?.select === select) renderSelectOptions();
}

function labelTextFor(control: HTMLElement): string {
  const label = control.closest('label');
  if (label !== null) {
    const text = [...label.childNodes]
      .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ')
      .trim();
    if (text !== '') return text;
  }
  const fallback = control instanceof HTMLSelectElement ? control.name : '';
  return control.getAttribute('aria-label') ?? (fallback === '' ? 'Options' : fallback);
}

export function enhanceCustomSelects(root: ParentNode = document, refreshExisting = true): void {
  wireSelectGlobal();
  for (const select of root.querySelectorAll('select:not([multiple])')) {
    if (!(select instanceof HTMLSelectElement)) continue;
    if (enhancedSelects.has(select)) {
      if (refreshExisting) syncCustomSelect(select);
      continue;
    }
    const label = labelTextFor(select);
    const id = `cp-select-${(customSelectCount += 1)}`;
    const wrap = h('span', { class: 'cp-select' }, []);
    const trigger = h(
      'button',
      {
        type: 'button',
        class: `cp-select-trigger${select.id === 'changeTemplate' ? ' is-rich' : ''}`,
        id,
        role: 'combobox',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
        'aria-controls': `${id}-list`,
        'aria-autocomplete': 'none',
      },
      [],
    );
    if (!(trigger instanceof HTMLButtonElement)) continue;
    const selectParent = select.parentNode;
    if (selectParent === null) continue;
    selectParent.replaceChild(wrap, select);
    wrap.append(select, trigger);
    select.classList.add('cp-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const state: CustomSelectState = {
      select,
      trigger,
      id,
      label,
      rich: select.id === 'changeTemplate',
      active: 0,
      rendered: '',
    };
    enhancedSelects.set(select, state);
    syncCustomSelect(select);
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (openSelect === state) closeCustomSelect();
      else openCustomSelect(state);
    });
    trigger.addEventListener('keydown', (event) => { handleSelectKey(event, state); });
    select.addEventListener('change', () => { syncCustomSelect(select); });
    select.addEventListener('invalid', (event) => {
      event.preventDefault();
      trigger.focus();
      trigger.setAttribute('aria-invalid', 'true');
      openCustomSelect(state);
    });
  }
}

export function closeCustomSelect(restoreFocus = false): void {
  if (openSelect === null) return;
  const previous = openSelect;
  openSelect = null;
  previous.trigger.setAttribute('aria-expanded', 'false');
  previous.trigger.removeAttribute('aria-activedescendant');
  document.getElementById('customSelectPortal')?.remove();
  if (selectTypeaheadTimer !== null) clearTimeout(selectTypeaheadTimer);
  selectTypeahead = '';
  if (restoreFocus && previous.trigger.isConnected) previous.trigger.focus({ preventScroll: true });
}

function openCustomSelect(state: CustomSelectState): void {
  if (state.select.disabled) return;
  closeCustomSelect();
  closeFloatingPanels();
  openSelect = state;
  state.active = state.select.selectedIndex >= 0 ? state.select.selectedIndex : 0;
  state.trigger.setAttribute('aria-expanded', 'true');
  state.trigger.focus({ preventScroll: true });
  const portal = h('section', { id: 'customSelectPortal', class: 'cp-select-menu', 'aria-label': state.label }, [
    h('div', { class: 'cp-select-menu-head' }, [
      h('span', {}, [state.label]),
      h('span', {}, [`${String(state.select.options.length)} options`]),
    ]),
    h('div', { class: 'cp-select-options', role: 'listbox', id: `${state.id}-list`, 'aria-label': state.label }, []),
    h('div', { class: 'cp-select-menu-foot' }, [
      h('span', {}, [h('kbd', {}, ['↑']), h('kbd', {}, ['↓']), 'Navigate   ', h('kbd', {}, ['↵']), 'Select']),
      h('span', {}, [h('kbd', {}, ['Esc']), 'Close']),
    ]),
  ]);
  document.body.append(portal);
  renderSelectOptions();
  positionCustomSelect();
  const list = portal.querySelector('.cp-select-options');
  if (list === null) return;
  list.addEventListener('pointermove', (event) => {
    const option = (event.target as HTMLElement).closest('[data-select-index]');
    if (option !== null && option.getAttribute('aria-disabled') !== 'true') {
      setSelectActive(Number(option.getAttribute('data-select-index')), false);
    }
  });
  list.addEventListener('mousedown', (event) => { event.preventDefault(); });
  list.addEventListener('click', (event) => {
    const option = (event.target as HTMLElement).closest('[data-select-index]');
    if (option !== null && option.getAttribute('aria-disabled') !== 'true') {
      chooseCustomSelect(Number(option.getAttribute('data-select-index')));
    }
  });
  portal.querySelector('.is-focused')?.scrollIntoView({ block: 'nearest' });
}

function renderSelectOptions(): void {
  if (openSelect === null) return;
  const { select, id } = openSelect;
  const list = document.getElementById(`${id}-list`);
  if (list === null) return;
  list.replaceChildren(
    ...[...select.options].map((option, index) => {
      const focused = index === (openSelect?.active ?? -1);
      const selected = index === select.selectedIndex;
      const node = h(
        'div',
        {
          class: `cp-select-option${select.id === 'changeTemplate' ? ' is-rich' : ''}${focused ? ' is-focused' : ''}`,
          role: 'option',
          id: `${id}-option-${String(index)}`,
          'data-select-index': String(index),
          'aria-selected': String(selected),
          'aria-disabled': String(option.disabled),
        },
        [selectOptionContent(select, option)],
      );
      if (selected) {
        const check = h('span', { class: 'cp-select-check', 'aria-hidden': 'true' }, []);
        check.appendChild(iconSvg('check'));
        node.appendChild(check);
      } else {
        node.appendChild(h('span', { class: 'cp-select-spacer', 'aria-hidden': 'true' }, []));
      }
      return node;
    }),
  );
  openSelect.trigger.setAttribute('aria-activedescendant', `${id}-option-${String(openSelect.active)}`);
}

function positionCustomSelect(): void {
  if (openSelect === null) return;
  const portal = document.getElementById('customSelectPortal');
  if (portal === null) return;
  if (!openSelect.trigger.isConnected) {
    closeCustomSelect();
    return;
  }
  const rect = openSelect.trigger.getBoundingClientRect();
  const gap = 8;
  const edge = 12;
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    closeCustomSelect();
    return;
  }
  const below = window.innerHeight - rect.bottom - gap - edge;
  const above = rect.top - gap - edge;
  const ideal = Math.min(openSelect.select.options.length * (openSelect.rich ? 65 : 43) + 77, 490);
  const flip = below < Math.min(ideal, 240) && above > below;
  const height = Math.max(70, Math.min(ideal, flip ? above : below));
  portal.style.width = `${String(Math.min(rect.width, window.innerWidth - edge * 2))}px`;
  portal.style.maxHeight = `${String(height)}px`;
  portal.style.left = `${String(Math.max(edge, Math.min(rect.left, window.innerWidth - rect.width - edge)))}px`;
  portal.dataset['side'] = flip ? 'above' : 'below';
  portal.style.top = flip
    ? `${String(Math.max(edge, rect.top - gap - Math.min(portal.scrollHeight, height)))}px`
    : `${String(rect.bottom + gap)}px`;
}

function setSelectActive(index: number, scroll = true): void {
  if (openSelect === null) return;
  const { select, id } = openSelect;
  const option = select.options[index];
  if (option === undefined || option.disabled) return;
  openSelect.active = index;
  document
    .getElementById('customSelectPortal')
    ?.querySelectorAll('.cp-select-option')
    .forEach((node, nodeIndex) => node.classList.toggle('is-focused', nodeIndex === index));
  openSelect.trigger.setAttribute('aria-activedescendant', `${id}-option-${String(index)}`);
  if (scroll) document.getElementById(`${id}-option-${String(index)}`)?.scrollIntoView({ block: 'nearest' });
}

function chooseCustomSelect(index: number): void {
  if (openSelect === null) return;
  const state = openSelect;
  if (state.select.options[index]?.disabled !== false) return;
  state.select.selectedIndex = index;
  state.trigger.removeAttribute('aria-invalid');
  closeCustomSelect(true);
  syncCustomSelect(state.select);
  state.select.dispatchEvent(new Event('input', { bubbles: true }));
  state.select.dispatchEvent(new Event('change', { bubbles: true }));
}

function handleSelectKey(event: KeyboardEvent, state: CustomSelectState): void {
  const active = openSelect === state;
  if (event.key === 'Escape' && active) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeCustomSelect(true);
    return;
  }
  if (event.key === 'Tab') {
    closeCustomSelect();
    return;
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    if (!active) {
      openCustomSelect(state);
      if (event.key === 'Home') setSelectActive(0);
      if (event.key === 'End') setSelectActive(state.select.options.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      chooseCustomSelect(state.active);
      return;
    }
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    let next =
      event.key === 'Home' ? 0 : event.key === 'End' ? state.select.options.length - 1 : state.active + direction;
    while (next >= 0 && next < state.select.options.length && state.select.options[next]?.disabled === true) {
      next += direction;
    }
    setSelectActive(next);
    return;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!active) openCustomSelect(state);
    if (selectTypeaheadTimer !== null) clearTimeout(selectTypeaheadTimer);
    selectTypeahead += event.key.toLowerCase();
    const index = [...state.select.options].findIndex(
      (option) => !option.disabled && option.textContent.toLowerCase().startsWith(selectTypeahead),
    );
    if (index >= 0) setSelectActive(index);
    selectTypeaheadTimer = setTimeout(() => (selectTypeahead = ''), 700);
  }
}

/** Shell-owned floating panels close together with the select portal. */
function closeFloatingPanels(): void {
  document.getElementById('notificationRoot')?.replaceChildren();
  document.getElementById('accountRoot')?.replaceChildren();
}

function wireSelectGlobal(): void {
  if (selectWired) return;
  selectWired = true;
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        openSelect !== null &&
        (event.target as HTMLElement).closest('#customSelectPortal') === null &&
        !openSelect.trigger.contains(event.target as Node)
      ) {
        closeCustomSelect();
      }
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && openSelect !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeCustomSelect(true);
      }
    },
    true,
  );
  let frame = 0;
  document.addEventListener(
    'scroll',
    (event) => {
      if (openSelect === null) return;
      // Scroll targets any scroller, including the document itself, which
      // has no closest(): only skips repositioning for scrolls inside the
      // portal, repositions for every other scroller.
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('#customSelectPortal') !== null) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(positionCustomSelect);
    },
    true,
  );
  window.addEventListener('resize', () => {
    if (openSelect !== null) positionCustomSelect();
  });
}

/* Native file input with a custom presentation (mockup 1740-1767).
 * File names are untrusted: textContent only, never HTML. */

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`;
  return `${String(bytes)} B`;
}

function updateFilePicker(input: HTMLInputElement): void {
  const wrap = input.closest('.cp-file-picker');
  if (wrap === null) return;
  const files = [...(input.files ?? [])];
  const file = files[0];
  wrap.classList.toggle('has-file', file !== undefined);
  const title = wrap.querySelector('.cp-file-name');
  if (title !== null) {
    title.textContent = file !== undefined ? (files.length > 1 ? `${String(files.length)} files selected` : file.name) : 'No file selected';
    title.setAttribute('title', file !== undefined ? files.map((entry) => entry.name).join(', ') : '');
  }
  const accepted = (input.accept || '')
    .split(',')
    .map((token) => token.replace(/^\./, '').toUpperCase())
    .join(', ');
  const bytes = files.reduce((total, entry) => total + entry.size, 0);
  const meta = wrap.querySelector('.cp-file-meta');
  if (meta !== null) {
    meta.textContent = file !== undefined ? `${formatBytes(bytes)} · Ready to use` : accepted || 'Choose a file from this device';
  }
  const action = wrap.querySelector('.cp-file-action');
  if (action !== null) {
    action.replaceChildren(iconSvg('upload'), document.createTextNode(file !== undefined ? 'Replace file' : 'Choose file'));
  }
}

export function enhanceFilePickers(root: ParentNode = document): void {
  for (const input of root.querySelectorAll('input[type="file"]:not(.cp-file-input)')) {
    if (!(input instanceof HTMLInputElement)) continue;
    const label = input.closest('label');
    const accessibleName =
      (label !== null
        ? [...label.childNodes]
            .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(' ')
            .trim()
        : '') || 'Choose file';
    const wrap = h('span', { class: 'cp-file-picker' }, []);
    const inputParent = input.parentNode;
    if (inputParent === null) continue;
    inputParent.replaceChild(wrap, input);
    wrap.append(input);
    input.classList.add('cp-file-input');
    input.setAttribute('aria-label', accessibleName);
    const iconSlot = h('span', { class: 'cp-file-icon', 'aria-hidden': 'true' }, []);
    iconSlot.appendChild(iconSvg('upload'));
    wrap.append(
      iconSlot,
      h('span', { class: 'cp-file-copy', 'aria-hidden': 'true' }, [
        h('span', { class: 'cp-file-name' }, []),
        h('span', { class: 'cp-file-meta' }, []),
      ]),
      h('span', { class: 'cp-file-action', 'aria-hidden': 'true' }, []),
    );
    updateFilePicker(input);
    input.addEventListener('change', () => { updateFilePicker(input); });
  }
}
