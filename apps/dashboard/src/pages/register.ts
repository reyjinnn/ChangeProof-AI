/* Register-only port of the ROOT mockup.html's signin-overlay / signin-dialog.
 * API submission remains in auth.ts. No mockup demo-auth handler is imported. */
import './register.css';

import { h, svgEl } from '../components.js';
import { renderLanding } from './landing.js';

export function registerPassword(input: HTMLInputElement, label: HTMLElement): void {
  const eye = svgEl('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
    svgEl('path', { d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z' }),
    svgEl('circle', { cx: '12', cy: '12', r: '3' }),
  ]);
  const toggle = h('button', { class: 'password-toggle', type: 'button', 'aria-label': 'Show password', 'aria-controls': input.id, 'aria-pressed': 'false' }, [eye]);
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.setAttribute('aria-pressed', String(show));
  });
  const wrap = h('span', { class: 'password-wrap' });
  input.replaceWith(wrap);
  wrap.append(input, toggle);
  label.classList.add('register-password-field');
}

export function registerShell(form: HTMLFormElement, mode: 'register' | 'login' = 'register'): HTMLElement {
  // Reuse the current landing solely as the inert, blurred modal backdrop.
  // This does not change the landing route or port unrelated public pages.
  // A detached clone is intentional: the original Register backdrop has no
  // initialized fiber canvas or active landing controls. Do not start a GPU
  // renderer or install landing listeners behind this modal.
  const landing = renderLanding(h('div'), h('footer')).cloneNode(true);
  const backdrop = h('div', { class: 'register-backdrop', 'aria-hidden': 'true' });
  backdrop.appendChild(landing);
  backdrop.inert = true;
  const title = h('h1', { id: `${mode}-title`, class: 'signin-brand-label' }, [mode === 'register' ? 'Create an account' : 'Log in']);
  const brand = h('div', { class: 'signin-brand' }, [
    h('span', { class: 'signin-brand-mark' }, [svgEl('svg', { viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true', focusable: 'false' }, [
      svgEl('path', { d: 'M23 6.5h-7.5C10 6.5 6 10.5 6 16s4 9.5 9.5 9.5H23', stroke: 'currentColor', 'stroke-width': '3.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svgEl('rect', { x: '20.2', y: '13.2', width: '5.6', height: '5.6', rx: '1.1', fill: 'currentColor' }),
    ])]), title,
  ]);
  const github = h('button', { class: 'github-auth', type: 'button', disabled: '', title: 'No authorized GitHub App is configured. Use email registration.' }, [
    svgEl('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svgEl('path', { d: 'M9 19c-4 1-4-2-6-2m12 4v-3.5c.1-1-.3-1.7-.7-2.2 2.8-.3 5.7-1.4 5.7-6.3a5 5 0 00-1.3-3.5A4.6 4.6 0 0018.6 2S17.5 1.7 15 3.3a12 12 0 00-6 0C6.5 1.7 5.4 2 5.4 2a4.6 4.6 0 00-.1 3.5A5 5 0 004 9c0 4.9 2.9 6 5.7 6.3-.4.4-.8 1.2-.7 2.2V21' })]),
    mode === 'register' ? 'GitHub sign-up unavailable' : 'GitHub sign-in unavailable',
  ]);
  const close = h('button', { class: 'signin-close', type: 'button', 'aria-label': mode === 'register' ? 'Close registration' : 'Close sign in' }, ['×']);
  const panel = h('section', { class: 'fresh-auth-form' }, [brand, form,
    h('div', { class: 'auth-divider' }, ['OR']), github,
    h('div', { class: 'auth-switch' }, [mode === 'register' ? 'Already have an account? ' : 'New to ChangeProof? ', h('a', { href: mode === 'register' ? '#/login' : '#/register' }, [mode === 'register' ? 'Sign in' : 'Create an account'])]),
  ]);
  const dialog = h('section', { class: 'signin-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id, tabindex: '-1' }, [close, panel]);
  const overlay = h('div', { class: 'signin-overlay' }, [dialog]);
  const root = h('div', { class: mode === 'register' ? 'register-page' : 'register-page login-port' }, [overlay, backdrop]);
  const dismiss = (): void => { window.location.hash = '#/p/'; };
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
  // The shared router focuses h1. Redirect that focus to the labelled dialog,
  // retaining the original opening focus ring without changing other routes.
  title.addEventListener('focus', () => { dialog.focus({ preventScroll: true }); });
  const onKey = (event: KeyboardEvent): void => {
    if (!root.isConnected) return;
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled])')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement) || document.activeElement === dialog)) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement) || document.activeElement === dialog)) {
      event.preventDefault(); first?.focus();
    }
  };
  // Disabling the submit button can move focus to body. Escape and the focus
  // trap must still work after a service error, as in the original modal.
  document.addEventListener('keydown', onKey, true);
  const removal = new MutationObserver(() => {
    if (root.isConnected) return;
    document.removeEventListener('keydown', onKey, true);
    removal.disconnect();
  });
  removal.observe(document.body, { childList: true, subtree: true });
  return root;
}
