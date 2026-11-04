/* Account layout from the ROOT mockup. Forms remain owned by auth.ts. */
import './auth-port.css';
import { h, svgEl } from '../components.js';
import { renderPublicDesign } from './public-design.js';

export function standaloneAuth(card: HTMLElement): HTMLElement {
  const source = renderPublicDesign('/product');
  const nav = source?.querySelector<HTMLElement>('.public-nav') ?? h('nav');
  const footer = source?.querySelector<HTMLElement>('.modern-footer') ?? h('footer');
  const story = h('section', { class: 'fresh-auth-story', 'aria-label': 'One connected workflow' }, [
    h('span', { class: 'mini-label' }, ['CHANGE WITH CONTEXT']),
    h('h2', {}, ['One workspace.', h('br'), 'From impact', h('br'), 'to evidence.']),
    h('p', {}, ['Understand what changed, review repair candidates, and trace the evidence behind each decision.']),
    h('div', { class: 'auth-proof' }, [
      h('span', { class: 'mini-label' }, ['ONE CONNECTED WORKFLOW']),
      ...[['Understand the impact', 'Clear repositories, dependencies, and scopes.'], ['Review the candidate', 'Focused diffs with controlled budgets.'], ['Inspect the evidence', 'Results and verification limits stay visible.']].map(([title, text], i) => h('div', { class: 'auth-proof-row' }, [h('span', { class: 'auth-step-icon' }, [`0${String(i + 1)}`]), h('div', {}, [h('strong', {}, [title ?? '']), h('p', {}, [text ?? ''])])])),
    ]),
    h('span', { class: 'auth-proof-note' }, ['Your team stays in control of repository access.']),
  ]);
  card.classList.remove('card'); card.classList.add('fresh-auth-form');
  return h('div', { class: 'reyn-design modern-design auth-page auth-port' }, [nav, h('div', { class: 'fresh-auth-shell' }, [story, card]), footer]);
}

export function recoveryModal(form: HTMLFormElement, done: HTMLElement): HTMLElement {
  const source = renderPublicDesign('/');
  const backdrop = h('div', { class: 'recovery-backdrop', 'aria-hidden': 'true' });
  if (source !== undefined) backdrop.append(source.cloneNode(true));
  backdrop.inert = true;
  const title = h('h1', { id: 'recovery-title' }, ['Forgot password?']);
  const close = h('button', { type: 'button', class: 'signin-close', 'aria-label': 'Close password reset' }, ['×']);
  const panel = h('section', { class: 'fresh-auth-form' }, [
    h('div', { class: 'auth-success-icon' }, [svgEl('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svgEl('circle', { cx: '8', cy: '8', r: '5' }), svgEl('path', { d: 'm11 12 10 10m-5-5 3-3m-7-1 3-3' })])]),
    h('span', { class: 'mini-label' }, ['LET’S GET YOU BACK IN']), title,
    h('p', {}, ['Enter your account email. If it is registered, we will send a password reset link.']), done, form,
    h('div', { class: 'auth-switch' }, [h('a', { href: '#/login' }, ['Back to sign in'])]),
  ]);
  const dialog = h('section', { class: 'signin-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id, tabindex: '-1' }, [close, panel]);
  title.addEventListener('focus', () => { dialog.focus({ preventScroll: true }); });
  const overlay = h('div', { class: 'signin-overlay' }, [dialog]);
  const root = h('div', { class: 'reyn-design modern-design auth-page recovery-modal' }, [overlay, backdrop]);
  const dismiss = (): void => { window.location.hash = '#/p/'; };
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
  const onKey = (event: KeyboardEvent): void => {
    if (!root.isConnected) return;
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  const removal = new MutationObserver(() => { if (!root.isConnected) { document.removeEventListener('keydown', onKey, true); removal.disconnect(); } });
  removal.observe(document.body, { childList: true, subtree: true });
  return root;
}
