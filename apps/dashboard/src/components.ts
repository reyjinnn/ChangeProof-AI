/* Shared UI components (T-42). Server and user content is untrusted:
 * render it with textContent (never innerHTML with variables), and keep
 * every interactive control keyboard-reachable with a visible label. */

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'info';

export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Tiny element builder; children pass through textContent-safe paths. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: readonly (HTMLElement | Text | string)[] = [],
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

const TONE_LABEL: Record<BadgeTone, string> = { ok: 'ok', warn: 'attention', bad: 'blocked', info: 'info' };

/** Status badge: text label plus tone, never color alone. */
export function badge(tone: BadgeTone, label: string): HTMLElement {
  return h('span', { class: 'badge', 'data-tone': tone }, [`${TONE_LABEL[tone]}: ${label}`]);
}

export function emptyState(title: string, body: string, action?: HTMLElement): HTMLElement {
  const block = h('section', { class: 'card state-block', 'aria-live': 'polite' }, [
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
