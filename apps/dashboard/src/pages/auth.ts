/* Account, onboarding, and access pages (T-44 + Progress UI 4, FR3-29/30/38, NEG3-21/29/30).
 * Login, register, forgot-password, and check-email float over the last
 * public page as a labelled signin dialog (mockup
 * modalAuthRoutes/signin-overlay plus check-email per product request,
 * Escape and backdrop-press close, focus trapped); the remaining screens
 * keep the fresh-auth-shell split. All runtime copy is English (FR3-40). The browser
 * holds no authority: every decision comes from the API, single-use tickets
 * live in memory only (never localStorage — see store.ts), and every
 * dynamic string renders through textContent-safe builders. Request bodies
 * match the strict server schemas in src/http/routes-*: display-only fields
 * (full name, org name, description) are echoed locally and never sent.
 *
 * Password length (10–128) mirrors the server modules/identity policy; the
 * server re-validates everything, so drift here degrades help text, never
 * security. Deviations from the mockup are deliberate and honest: the
 * mockup says 8 characters and shows Indonesian copy plus demo fixtures;
 * the GitHub control is providers-gated and fails closed (see
 * githubSection): without an authorized OAuth App the server reports
 * `github: false` and the dialog says so instead of faking a handshake.
 * The login dialog keeps its hidden organization field for multi-org
 * accounts; terms links point at the real #/terms and #/privacy routes.
 */

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import {
  card,
  field,
  h,
  head,
  iconSvg,
  logoMarkSvg,
  padcard,
  pillIcon,
  row,
  staticBadge,
  table,
  type IconName,
} from '../components.js';
import { notifySessionChanged } from '../session.js';
import { shellModeFor } from '../shell.js';
import { validateReturnTarget } from './public.js';
import { parseHash, registerRoute, renderStandalone, type RouteContext } from '../routes.js';

let claimTicket: string | undefined;

export function takeClaimTicket(): string | undefined {
  const ticket = claimTicket;
  claimTicket = undefined;
  return ticket;
}

/** Backend OAuth entrypoint. Navigation lets the server answer honestly
 * instead of the client faking a handshake: unconfigured servers 503,
 * configured ones 302 to GitHub. Query params are hints the server
 * re-validates (tenant, remember-me, return target, dialog origin). */
const GITHUB_OAUTH_START = '/api/auth/github/start';

function startGitHubOAuth(params?: Record<string, string>): void {
  if (params === undefined) {
    window.location.assign(GITHUB_OAUTH_START);
    return;
  }
  const query = new URLSearchParams(params).toString();
  window.location.assign(`${GITHUB_OAUTH_START}?${query}`);
}

/**
 * Server callback outcomes (`githubError` codes from routes-auth.ts).
 * Unknown codes render the generic entry — the server never sends
 * free-form text here, so there is nothing to inject.
 */
const GITHUB_ERRORS: Readonly<Record<string, string>> = {
  github_unavailable: 'GitHub login is not configured for this service. Email login above works.',
  access_denied: 'GitHub sign-in was cancelled. Retry, or use email login.',
  state_invalid: 'The GitHub sign-in request expired or was interrupted. Start again from this page.',
  provider_error: 'GitHub could not be reached or refused the request. Retry, or use email login.',
  email_missing: 'Your GitHub account exposes no verified email address. Add and verify one on GitHub, then retry.',
  email_taken: 'This email already has a password account. Log in with email, then link GitHub from Account settings.',
  choose_tenant: 'You belong to several organizations; name the one to log in to, then continue with GitHub again.',
  github_taken: 'This GitHub account is already linked to a different user.',
  tenant_deleted: 'This organization was deleted; nothing here is available.',
  login_failed: 'GitHub sign-in could not be completed. Retry, or use email login.',
};

/** Surface a callback failure on the dialog that started the flow. */
function showGithubError(alert: HTMLElement, params: ReadonlyMap<string, string>): string | undefined {
  const code = params.get('githubError') ?? '';
  if (code === '') return undefined;
  showAuthError(alert, githubErrorMessage(code));
  return code;
}

/** Shared with the Account page, which owns link-mode failures. */
export function githubErrorMessage(code: string): string {
  return GITHUB_ERRORS[code] ?? GITHUB_ERRORS['login_failed'] ?? 'GitHub sign-in failed.';
}

function setFieldProblem(input: HTMLInputElement, wrap: HTMLElement, message: string): void {
  clearFieldProblem(input, wrap);
  input.setAttribute('aria-invalid', 'true');
  const errorId = `${input.id}-error`;
  input.setAttribute('aria-describedby', errorId);
  wrap.appendChild(h('p', { class: 'error-text', id: errorId }, [message]));
}

function clearFieldProblem(input: HTMLInputElement, wrap: HTMLElement): void {
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
  wrap.querySelector('.error-text')?.remove();
}

function submitting(button: HTMLButtonElement, busy: boolean, label: string, busyLabel: string): void {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : label;
}

interface Providers {
  readonly email: boolean;
  /** Sign-in. Independent from repository authority below. */
  readonly github: boolean;
  /** GitHub App installation authority; false until an install flow exists. */
  readonly githubApp?: boolean | undefined;
}

/** Mockup `authError`: one alert box per form, hidden until needed. */
function authErrorBox(): HTMLElement {
  const box = h('div', { class: 'form-error', id: 'authError', role: 'alert' }, []);
  box.hidden = true;
  return box;
}

function showAuthError(box: HTMLElement, message: string): void {
  box.hidden = false;
  box.replaceChildren(document.createTextNode(message));
}

function hideAuthError(box: HTMLElement): void {
  box.hidden = true;
  box.replaceChildren();
}

/** Mockup `freshPassword`: labeled input with a show/hide toggle. */
function passwordField(options: {
  readonly id: string;
  readonly label: string;
  readonly autocomplete: string;
  readonly placeholder?: string;
  readonly hint?: string;
}): { wrap: HTMLElement; input: HTMLInputElement } {
  const base = {
    id: options.id,
    label: options.label,
    type: 'password',
    required: true,
    autocomplete: options.autocomplete,
    ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
  };
  const built = options.hint === undefined ? field(base) : field({ ...base, hint: options.hint });
  const wrap = h('span', { class: 'password-wrap' }, []);
  built.input.replaceWith(wrap);
  wrap.appendChild(built.input);
  const toggle = h('button', { class: 'password-toggle', type: 'button', 'aria-label': 'Show password' }, []);
  toggle.appendChild(iconSvg('eye'));
  toggle.addEventListener('click', () => {
    const showing = built.input.type === 'text';
    built.input.type = showing ? 'password' : 'text';
    toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    toggle.replaceChildren(iconSvg(showing ? 'eye' : 'eye-off'));
  });
  wrap.appendChild(toggle);
  return built;
}

function signinBrand(label: string): HTMLElement {
  const mark = h('span', { class: 'signin-brand-mark', 'aria-hidden': 'true' }, []);
  mark.appendChild(logoMarkSvg());
  return h('div', { class: 'signin-brand' }, [mark, h('span', { class: 'signin-brand-label' }, [label])]);
}

/** Mockup `modernAuthVisual`, translated to English (FR3-40). */
function authStory(): HTMLElement {
  const steps: readonly (readonly [IconName, string, string, string])[] = [
    ['check', 'Change mapped', '3 repositories in scope', '00:04'],
    ['check', 'Regression reproduced', 'Old baseline → new contract', '00:18'],
    ['check', 'Candidate prepared', 'Focused diff, boundaries intact', '00:46'],
    ['clock', 'Evidence reviewed', '1 target still needs verification', '01:11'],
  ];
  const visualCard = h('div', { class: 'auth-visual-card', 'aria-label': 'Verification flow preview' }, [
    h('header', {}, [h('strong', {}, ['Order Platform']), staticBadge('Sample', 'blue')]),
    ...steps.map(([symbol, title, sub, time]) => {
      const iconSlot = h('i', {}, []);
      iconSlot.appendChild(iconSvg(symbol));
      return h('div', { class: 'mini-step' }, [
        iconSlot,
        h('div', {}, [h('strong', {}, [title]), h('small', {}, [sub])]),
        h('time', {}, [time]),
      ]);
    }),
  ]);
  const note = h('div', { class: 'auth-visual-note' }, ["Repository access stays in your team's control."]);
  note.prepend(iconSvg('lock'));
  return h('section', { class: 'fresh-auth-story' }, [
    h('span', { class: 'auth-visual-eyebrow' }, ['FROM CHANGE TO EVIDENCE']),
    h('h2', {}, [
      'Less',
      h('br', {}, []),
      'guessing.',
      h('br', {}, []),
      'More ',
      h('mark', {}, ['evidence.']),
    ]),
    h('p', {}, ['Understand the impact. Review the candidates. Decide with clear evidence.']),
    visualCard,
    note,
  ]);
}

function freshShell(form: HTMLElement): HTMLElement {
  return h('div', { class: 'fresh-auth-shell' }, [authStory(), form]);
}

function freshForm(children: readonly HTMLElement[]): HTMLElement {
  return h('section', { class: 'fresh-auth-form' }, children);
}

function githubButton(start: () => void = (): void => { startGitHubOAuth(); }): HTMLButtonElement {
  const button = h('button', { class: 'github-auth', type: 'button', 'data-modern': 'sign-in' }, ['Continue with GitHub']);
  button.prepend(iconSvg('github'));
  button.addEventListener('click', start);
  return button;
}

/** Providers-gated GitHub control. The button appears only when the server
 * advertises GitHub sign-in; otherwise an honest note names the missing
 * OAuth App. A failed providers lookup leaves the host empty and the
 * email form rules. */
function githubSection(host: HTMLElement, start?: () => void): void {
  void apiGet<Providers>('/api/auth/providers')
    .then((providers) => {
      if (!host.isConnected) return;
      if (providers.github) {
        host.replaceChildren(start === undefined ? githubButton() : githubButton(start));
        return;
      }
      host.replaceChildren(
        h('p', { class: 'muted' }, [
          'GitHub login is unavailable: no authorized GitHub OAuth App is configured for this service. Email login above works.',
        ]),
      );
    })
    .catch(() => {
      // Providers are advisory; the form submits regardless and the API rules.
    });
}

function authDivider(): HTMLElement {
  return h('div', { class: 'auth-divider' }, ['OR']);
}

function authBack(href: string, label: string): HTMLElement {
  const link = h('a', { class: 'auth-back', href }, [label]);
  link.prepend(iconSvg('arrow'));
  return link;
}

/** Modal entry forms (mockup modalAuthRoutes): the dialog floats over the
 * last public page instead of replacing it. Values are close-button labels. */
const MODAL_AUTH_ROUTES: ReadonlyMap<string, string> = new Map([
  ['/login', 'Close sign in'],
  ['/register', 'Close registration'],
  ['/forgot-password', 'Close password reset'],
  ['/check-email', 'Close email verification'],
]);

/** Public page behind the dialog (mockup signInBackdropRoute). */
let authBackdrop = '/landing';
let authModalWired = false;

function modalRoot(): HTMLElement | null {
  return document.getElementById('modalRoot');
}

/** Tear down the overlay; navigation is separate so successful submits
 * (which navigate elsewhere) reuse the teardown through the hash listener. */
function clearAuthModal(): void {
  modalRoot()?.replaceChildren();
  document.body.classList.remove('signin-modal-route');
  document.getElementById('content')?.removeAttribute('inert');
}

function closeAuthModal(): void {
  clearAuthModal();
  if (parseHash(window.location.hash).path !== authBackdrop) {
    window.location.hash = `#${authBackdrop}`;
  }
}

function onAuthHashChange(): void {
  const { path } = parseHash(window.location.hash);
  // Modal-to-modal (auth-switch links): the next render replaces the dialog
  // and the backdrop stays.
  if (MODAL_AUTH_ROUTES.has(path)) return;
  clearAuthModal();
  if (shellModeFor(path) === 'public') authBackdrop = path;
}

function trapAuthTab(event: KeyboardEvent, dialog: HTMLElement): void {
  const controls = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !el.hidden && el.style.display !== 'none' && el.getAttribute('aria-hidden') !== 'true',
  );
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function wireAuthModal(): void {
  if (authModalWired) return;
  authModalWired = true;
  window.addEventListener('hashchange', onAuthHashChange);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains('signin-overlay')) closeAuthModal();
  });
  document.addEventListener('keydown', (event) => {
    const dialog = modalRoot()?.querySelector('.signin-dialog');
    if (!(dialog instanceof HTMLElement)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAuthModal();
      return;
    }
    if (event.key === 'Tab') trapAuthTab(event, dialog);
  });
}

/** Paint the remembered public backdrop into the outlet, then float the
 * entry form over it as a labelled dialog (mockup refreshShell signin flow).
 * The outlet goes inert so keyboard and screen-reader users stay in the
 * dialog; the router's own focus pass runs first and cannot land inside an
 * inert subtree, so the dialog takes focus on a microtask after it. */
async function mountAuthModal(outlet: HTMLElement, path: string, form: HTMLElement): Promise<void> {
  const painted = await renderStandalone(outlet, authBackdrop);
  if (!painted && authBackdrop !== '/landing') {
    authBackdrop = '/landing';
    await renderStandalone(outlet, authBackdrop);
  }
  form.querySelector('.signin-brand, h1')?.setAttribute('id', 'signinTitle');
  const close = h('button', { type: 'button', class: 'signin-close', 'aria-label': MODAL_AUTH_ROUTES.get(path) ?? 'Close' }, []);
  close.appendChild(iconSvg('close'));
  close.addEventListener('click', () => {
    closeAuthModal();
  });
  const dialog = h(
    'section',
    { class: 'signin-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'signinTitle', tabindex: '-1' },
    [close, form],
  );
  modalRoot()?.replaceChildren(h('div', { class: 'signin-overlay', 'data-route': path }, [dialog]));
  document.body.classList.add('signin-modal-route');
  outlet.toggleAttribute('inert', true);
  queueMicrotask(() => {
    dialog.focus({ preventScroll: true });
  });
}

type SetupStep = 'login' | 'create-org' | 'onboarding' | 'new-project';

const SETUP_STEPS: readonly (readonly [SetupStep, string])[] = [
  ['login', 'Sign in'],
  ['create-org', 'Organization'],
  ['onboarding', 'GitHub App'],
  ['new-project', 'Project'],
];

/** Mockup `setupSteps`: the onboarding stepper, active step varies. */
function setupSteps(current: SetupStep): HTMLElement {
  const nav = h('nav', { class: 'stepper', 'aria-label': 'Onboarding steps' }, []);
  SETUP_STEPS.forEach(([id, label], index) => {
    if (index > 0) nav.appendChild(h('span', { class: 'step-line', 'aria-hidden': 'true' }, []));
    const active = id === current;
    nav.appendChild(
      h(
        'a',
        { href: `#${id}`, class: active ? 'active' : '', ...(active ? { 'aria-current': 'step' } : {}) },
        [h('i', {}, [String(index + 1)]), label],
      ),
    );
  });
  return nav;
}

function tick(): HTMLElement {
  const slot = h('span', { 'aria-hidden': 'true' }, []);
  slot.appendChild(iconSvg('check'));
  return slot;
}

/** Mockup permission block: centered card for invite/denied/expired states. */
function permissionCard(icon: IconName, title: string, children: readonly HTMLElement[]): HTMLElement {
  return h('section', { class: 'card permission-block' }, [pillIcon(icon), h('h1', {}, [title]), ...children]);
}

/** Fresh liveness probe for async continuations: a function call so no
 * earlier guard narrows later ones away. */
function isLive(node: HTMLElement): boolean {
  return node.isConnected;
}

function successIcon(icon: IconName): HTMLElement {
  const slot = h('div', { class: 'auth-success-icon' }, []);
  slot.appendChild(iconSvg(icon));
  return slot;
}

async function loginForm(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const params = ctx.params;
  const ret = validateReturnTarget(params.get('return') ?? undefined);
  const email = field({
    id: 'login-email',
    label: 'Email',
    type: 'email',
    required: true,
    autocomplete: 'email',
    placeholder: 'name@company.com',
  });
  const password = passwordField({
    id: 'login-password',
    label: 'Password',
    autocomplete: 'current-password',
    placeholder: 'Enter your password',
  });
  for (const part of [email, password]) {
    const label = part.wrap.querySelector('label')?.textContent ?? '';
    part.wrap = h('label', { class: 'field', for: part.input.id }, [label, part.input]);
  }
  email.input.placeholder = 'name@company.com';
  password.input.placeholder = 'Enter your password';
  registerPassword(password.input, password.wrap);
  const tenant = field({ id: 'login-tenant', label: 'Organization (only if you belong to several)', autocomplete: 'organization' });
  const prefillTenant = params.get('tenant');
  if (prefillTenant !== undefined && prefillTenant !== '') tenant.input.value = prefillTenant;
  const tenantRow = tenant.wrap;
  if (prefillTenant === undefined || prefillTenant === '') tenantRow.style.display = 'none';
  const remember = h('input', { id: 'login-remember', name: 'login-remember', type: 'checkbox' });
  const options = h('div', { class: 'auth-form-options' }, [
    h('label', {}, [remember, 'Remember me']),
    h('a', { href: '#/forgot-password' }, ['Forgot password?']),
  ]);
  const alert = authErrorBox();
  const submit = h('button', { class: 'primary', type: 'submit' }, ['Sign in →']);
  const form = h('form', { id: 'freshLoginForm', novalidate: 'novalidate' }, [
    email.wrap,
    password.wrap,
    tenantRow,
    options,
    alert,
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideAuthError(alert);
    clearFieldProblem(email.input, email.wrap);
    clearFieldProblem(password.input, password.wrap);
    let bad: HTMLInputElement | undefined;
    if (email.input.value.trim() === '') {
      setFieldProblem(email.input, email.wrap, 'Enter your email address.');
      bad ??= email.input;
    }
    if (password.input.value === '') {
      setFieldProblem(password.input, password.wrap, 'Enter your password.');
      bad ??= password.input;
    }
    if (bad !== undefined) {
      bad.focus();
      return;
    }
    submitting(submit, true, 'Sign in →', 'Signing in…');
    void (async () => {
      try {
        await apiPost<{ tenantId: string; expiresAt: string }>('/api/auth/login', {
          email: email.input.value.trim(),
          password: password.input.value,
          rememberMe: remember.checked,
          ...(tenant.input.value.trim() === '' ? {} : { tenantId: tenant.input.value.trim() }),
          ...(ret.valid ? { returnTarget: ret.target } : {}),
        });
        // The return target was validated server-side; deep /app links
        // land on the start page until the run journey owns them.
        window.location.hash = '#/';
        notifySessionChanged();
      } catch (error) {
        const message = error instanceof ApiRequestError ? error.failure.message : 'Login failed.';
        if (message.includes('Several organizations')) {
          tenantRow.style.display = '';
          showAuthError(alert, 'You belong to several organizations; name the one to log in to.');
          tenant.input.focus();
        } else if (message.includes('Tenant lookup came back empty')) {
          alert.hidden = false;
          alert.replaceChildren(
            h('p', {}, [
              'This account has no organization yet. ',
              h('a', { href: '#/check-email' }, ['Verify your email']),
              ' to create one.',
            ]),
          );
        } else {
          showAuthError(alert, message);
        }
        submitting(submit, false, 'Sign in →', 'Signing in…');
      }
    })();
  });
  const githubHost = h('div', {}, []);
  const startWithLoginHints = (): void => {
    const startParams: Record<string, string> = { origin: 'login' };
    const tenantName = tenant.input.value.trim();
    if (tenantName !== '') startParams['tenant'] = tenantName;
    if (remember.checked) startParams['remember'] = '1';
    if (ret.valid) startParams['return'] = ret.target;
    startGitHubOAuth(startParams);
  };
  const formCard = freshForm([
    signinBrand('ChangeProof AI sign in'),
    ...(ret.valid
      ? [h('div', { class: 'signin-return-note', role: 'status' }, ['Sign in to continue to your workspace.'])]
      : []),
    form,
    authDivider(),
    githubHost,
    h('div', { class: 'auth-switch' }, ["Don't have an account? ", h('a', { href: '#/register' }, ['Sign up now'])]),
  ]);
  await mountAuthModal(outlet, '/login', formCard);
  // After the mount: the providers lookup resolves against a connected
  // host instead of racing the backdrop render (real-browser race).
  githubSection(githubHost, startWithLoginHints);
  // A failed OAuth round-trip lands back here with a code, not JSON.
  if (showGithubError(alert, params) === 'choose_tenant') {
    tenantRow.style.display = '';
  }
}

async function registerForm(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const params = ctx.params;
  const name = field({ id: 'reg-name', label: 'Full name', required: true, autocomplete: 'name', placeholder: 'Your name' });
  name.input.maxLength = 70;
  const email = field({
    id: 'reg-email',
    label: 'Work email',
    type: 'email',
    required: true,
    autocomplete: 'email',
    placeholder: 'name@company.com',
  });
  const password = passwordField({
    id: 'reg-password',
    label: 'Password',
    autocomplete: 'new-password',
    placeholder: 'At least 10 characters',
    hint: 'Use between 10 and 128 characters.',
  });
  const confirm = passwordField({
    id: 'reg-confirm',
    label: 'Confirm password',
    autocomplete: 'new-password',
    placeholder: 'Re-enter your password',
  });
  const terms = h('input', { id: 'reg-terms', name: 'reg-terms', type: 'checkbox' });
  const termsRow = h('label', { class: 'terms-check' }, [
    terms,
    h('span', {}, [
      'I agree to the ',
      h('a', { href: '#/terms' }, ['Terms of Use']),
      ' and ',
      h('a', { href: '#/privacy' }, ['Privacy Policy']),
      '.',
    ]),
  ]);
  const alert = authErrorBox();
  const submit = h('button', { class: 'primary', type: 'submit' }, ['Create account →']);
  const form = h('form', { id: 'freshRegisterForm', novalidate: 'novalidate' }, [
    name.wrap,
    email.wrap,
    password.wrap,
    confirm.wrap,
    termsRow,
    alert,
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideAuthError(alert);
    for (const part of [name, email, password, confirm]) clearFieldProblem(part.input, part.wrap);
    // Every problem is reported at once; focus lands on the first one.
    let bad: HTMLInputElement | undefined;
    if (name.input.value.trim() === '') {
      setFieldProblem(name.input, name.wrap, 'Enter your full name.');
      bad ??= name.input;
    }
    if (email.input.value.trim() === '') {
      setFieldProblem(email.input, email.wrap, 'Enter your email address.');
      bad ??= email.input;
    }
    if (password.input.value.length < 10 || password.input.value.length > 128) {
      setFieldProblem(password.input, password.wrap, 'Use between 10 and 128 characters.');
      bad ??= password.input;
    }
    if (confirm.input.value !== password.input.value) {
      setFieldProblem(confirm.input, confirm.wrap, 'Passwords do not match.');
      bad ??= confirm.input;
    }
    if (!terms.checked) {
      showAuthError(alert, 'Please accept the Terms of Use and Privacy Policy to continue.');
      bad ??= terms;
    }
    if (bad !== undefined) {
      bad.focus();
      return;
    }
    submitting(submit, true, 'Create account →', 'Creating…');
    void (async () => {
      try {
        // Strict server body: email + password only. The name is echoed
        // on the check-email greeting; nothing is silently dropped.
        await apiPost<{ userId: string }>('/api/auth/register', {
          email: email.input.value.trim(),
          password: password.input.value,
        });
        const next = `#/check-email?email=${encodeURIComponent(email.input.value.trim())}&name=${encodeURIComponent(
          name.input.value.trim(),
        )}`;
        window.location.hash = next;
      } catch (error) {
        showAuthError(alert, error instanceof ApiRequestError ? error.failure.message : 'Registration failed.');
        submitting(submit, false, 'Create account →', 'Creating…');
      }
    })();
  });
  const githubHost = h('div', {}, []);
  await mountAuthModal(
    outlet,
    '/register',
    freshForm([
      signinBrand('ChangeProof AI register'),
      form,
      authDivider(),
      githubHost,
      h('div', { class: 'auth-switch' }, ['Already have an account? ', h('a', { href: '#/login' }, ['Sign in'])]),
    ]),
  );
  // After the mount: the providers lookup resolves against a connected
  // host instead of racing the backdrop render (real-browser race).
  githubSection(githubHost, (): void => { startGitHubOAuth({ origin: 'register' }); });
  // A failed OAuth round-trip lands back here with a code, not JSON.
  showGithubError(alert, params);
}

async function forgotPasswordPage(outlet: HTMLElement): Promise<void> {
  const email = field({
    id: 'forgot-email',
    label: 'Account email',
    type: 'email',
    required: true,
    autocomplete: 'email',
    placeholder: 'name@company.com',
  });
  const alert = authErrorBox();
  const done = h('div', { 'aria-live': 'polite' }, []);
  const submit = h('button', { class: 'primary', type: 'submit' }, ['Send reset link →']);
  const form = h('form', { id: 'freshForgotForm', novalidate: 'novalidate' }, [email.wrap, alert, submit]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideAuthError(alert);
    clearFieldProblem(email.input, email.wrap);
    if (email.input.value.trim() === '') {
      setFieldProblem(email.input, email.wrap, 'Enter your email address.');
      email.input.focus();
      return;
    }
    submitting(submit, true, 'Send reset link →', 'Sending…');
    void (async () => {
      try {
        await apiPost('/api/auth/password/forgot', { email: email.input.value.trim() });
        done.replaceChildren(
          h('p', { class: 'success-notice' }, ['If the address is registered, a reset mail is on its way.']),
        );
      } catch (error) {
        showAuthError(alert, error instanceof ApiRequestError ? error.failure.message : 'Request failed.');
      } finally {
        submitting(submit, false, 'Send reset link →', 'Sending…');
      }
    })();
  });
  await mountAuthModal(
    outlet,
    '/forgot-password',
    freshForm([
      successIcon('key'),
      h('span', { class: 'mini-label' }, ["LET'S GET YOU BACK IN"]),
      h('h1', {}, ['Forgot password?']),
      h('p', {}, ['Enter your account email. We will send a reset link if the address is registered.']),
      done,
      form,
      authBack('#/login', 'Back to sign in'),
    ]),
  );
}

async function checkEmailPage(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const address = ctx.params.get('email') ?? '';
  const guestName = ctx.params.get('name') ?? '';
  const heading: HTMLElement[] = [
    successIcon('mail'),
    h('span', { class: 'mini-label' }, ['CHECK YOUR INBOX']),
    h('h1', {}, ['Check your email']),
  ];
  if (guestName !== '') heading.push(h('p', {}, [`Thanks, ${guestName}.`]));
  heading.push(
    address === ''
      ? h('p', {}, ['We sent a verification mail with a single-use link. Open the link from the mail to continue.'])
      : h('p', {}, [
          'We sent a verification mail to ',
          h('span', { class: 'auth-email-tag' }, [address]),
          '. Open the link from the mail to continue.',
        ]),
  );
  heading.push(
    h('p', { class: 'success-notice' }, ['The link is single-use and expires. Check spam if you cannot find it.']),
  );
  const alert = authErrorBox();
  const done = h('div', { 'aria-live': 'polite' }, []);
  const resend = (target: string, busyLabel: (busy: boolean) => void): void => {
    hideAuthError(alert);
    busyLabel(true);
    void (async () => {
      try {
        await apiPost('/api/auth/verify/resend', { email: target });
        done.replaceChildren(
          h('p', { class: 'success-notice' }, ['If the address is registered, a fresh verification mail is on its way.']),
        );
      } catch (error) {
        showAuthError(alert, error instanceof ApiRequestError ? error.failure.message : 'Resend failed.');
      } finally {
        busyLabel(false);
      }
    })();
  };
  if (address === '') {
    const email = field({ id: 'resend-email', label: 'Email address', type: 'email', required: true, autocomplete: 'email' });
    const submit = h('button', { class: 'primary', type: 'submit' }, ['Resend verification mail']);
    const form = h('form', { novalidate: 'novalidate' }, [email.wrap, alert, submit]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFieldProblem(email.input, email.wrap);
      if (email.input.value.trim() === '') {
        setFieldProblem(email.input, email.wrap, 'Enter your email address.');
        email.input.focus();
        return;
      }
      resend(email.input.value.trim(), (busy) => {
        submitting(submit, busy, 'Resend verification mail', 'Sending…');
      });
    });
    heading.push(h('h2', {}, ['Mail did not arrive?']), done, form);
  } else {
    const button = h('button', { class: 'resend-email', type: 'button' }, ['Resend']);
    button.addEventListener('click', () => {
      resend(address, (busy) => {
        button.disabled = busy;
      });
    });
    heading.push(done, alert, h('div', { class: 'auth-switch' }, ['Did not get it? ', button]));
  }
  heading.push(authBack('#/login', 'Back to sign in'));
  await mountAuthModal(outlet, '/check-email', freshForm(heading));
}

function verifyEmailPage(outlet: HTMLElement, ctx: RouteContext): void {
  const token = ctx.params.get('token');
  if (token === undefined || token === '') {
    outlet.replaceChildren(
      freshShell(
        freshForm([
          successIcon('mail'),
          h('span', { class: 'mini-label' }, ['ONE LAST STEP']),
          h('h1', {}, ['Verification link is incomplete']),
          h('p', {}, ['The link carries no token. Request a fresh mail and try again.']),
          h('p', {}, [h('a', { class: 'primary', href: '#/check-email' }, ['Resend mail'])]),
          authBack('#/register', 'Use another email'),
        ]),
      ),
    );
    return;
  }
  outlet.replaceChildren(
    freshShell(freshForm([h('span', { class: 'mini-label' }, ['ONE LAST STEP']), h('h1', {}, ['Verify your email']), h('p', {}, ['Checking the single-use token.'])])),
  );
  void (async () => {
    try {
      const { claimTicket: ticket } = await apiPost<{ claimTicket: string }>('/api/auth/verify', { token });
      claimTicket = ticket;
      outlet.replaceChildren(
        freshShell(
          freshForm([
            successIcon('mail'),
            h('span', { class: 'mini-label' }, ['ONE LAST STEP']),
            h('h1', {}, ['Email verified']),
            h('p', {}, ['Your address is confirmed. Create your organization to continue.']),
            h('p', { class: 'success-notice' }, ['Verification keeps workspace access clear and safe.']),
            h('p', {}, [h('a', { class: 'primary', href: '#/create-org' }, ['Create organization'])]),
          ]),
        ),
      );
    } catch (error) {
      outlet.replaceChildren(
        freshShell(
          freshForm([
            successIcon('mail'),
            h('span', { class: 'mini-label' }, ['ONE LAST STEP']),
            h('h1', {}, ['Verification failed']),
            h('p', {}, [error instanceof ApiRequestError ? error.failure.message : 'Token rejected.']),
            h('p', {}, [h('a', { class: 'primary', href: '#/check-email' }, ['Resend mail'])]),
          ]),
        ),
      );
    }
  })();
}

function resetPasswordPage(outlet: HTMLElement, ctx: RouteContext): void {
  const token = ctx.params.get('token');
  if (token === undefined || token === '') {
    outlet.replaceChildren(
      freshShell(
        freshForm([
          successIcon('lock'),
          h('span', { class: 'mini-label' }, ['A FRESH START']),
          h('h1', {}, ['Reset link is incomplete']),
          h('p', {}, ['The link carries no token. Request a fresh reset mail.']),
          h('p', {}, [h('a', { class: 'primary', href: '#/forgot-password' }, ['Request reset'])]),
          authBack('#/login', 'Back to sign in'),
        ]),
      ),
    );
    return;
  }
  const password = passwordField({
    id: 'reset-password',
    label: 'New password',
    autocomplete: 'new-password',
    hint: 'Between 10 and 128 characters.',
  });
  const confirm = passwordField({ id: 'reset-confirm', label: 'Confirm new password', autocomplete: 'new-password' });
  const alert = authErrorBox();
  const submit = h('button', { class: 'primary', type: 'submit' }, ['Save password']);
  const form = h('form', { id: 'freshResetForm', novalidate: 'novalidate' }, [password.wrap, confirm.wrap, alert, submit]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideAuthError(alert);
    clearFieldProblem(password.input, password.wrap);
    clearFieldProblem(confirm.input, confirm.wrap);
    if (password.input.value.length < 10 || password.input.value.length > 128) {
      setFieldProblem(password.input, password.wrap, 'Use between 10 and 128 characters.');
      password.input.focus();
      return;
    }
    if (confirm.input.value !== password.input.value) {
      showAuthError(alert, 'The two passwords do not match yet. Check them again.');
      confirm.input.setAttribute('aria-invalid', 'true');
      confirm.input.focus();
      return;
    }
    submitting(submit, true, 'Save password', 'Saving…');
    void (async () => {
      try {
        await apiPost('/api/auth/password/reset', { token, newPassword: password.input.value });
        outlet.replaceChildren(
          freshShell(
            freshForm([
              successIcon('lock'),
              h('span', { class: 'mini-label' }, ['A FRESH START']),
              h('h1', {}, ['Password changed']),
              h('p', {}, ['Log in with the new password.']),
              h('p', {}, [h('a', { class: 'primary', href: '#/login' }, ['Log in'])]),
            ]),
          ),
        );
      } catch (error) {
        showAuthError(alert, error instanceof ApiRequestError ? error.failure.message : 'Reset failed.');
        submitting(submit, false, 'Save password', 'Saving…');
      }
    })();
  });
  outlet.replaceChildren(
    freshShell(
      freshForm([
        successIcon('lock'),
        h('span', { class: 'mini-label' }, ['A FRESH START']),
        h('h1', {}, ['Choose a new password']),
        h('p', {}, ['Set a new password for your account.']),
        form,
        authBack('#/login', 'Back to sign in'),
      ]),
    ),
  );
}

function createOrgPage(outlet: HTMLElement): void {
  const ticket = takeClaimTicket();
  if (ticket === undefined) {
    outlet.replaceChildren(
      h('div', {}, [
        setupSteps('create-org'),
        head('Room for your team.', 'Create an organization to manage shared projects, access, and budget.'),
        padcard(
          'Verification ticket is gone',
          h('div', {}, [
            h(
              'p',
              {},
              [
                'The single-use ticket lives in this tab only and is already spent or was lost to a reload. Verify again to mint a fresh one.',
              ],
            ),
            h('p', {}, [h('a', { class: 'primary', href: '#/check-email' }, ['Verify email'])]),
          ]),
        ),
      ]),
    );
    return;
  }
  const orgName = field({ id: 'org-name', label: 'Organization name', required: true, autocomplete: 'organization' });
  orgName.input.maxLength = 70;
  const slug = field({
    id: 'org-slug',
    label: 'Workspace slug',
    required: true,
    hint: 'Start with a letter or digit; then letters, digits, and . _ ~ : @ + -',
    autocomplete: 'organization',
  });
  const alert = authErrorBox();
  const submit = h('button', { class: 'primary', type: 'submit' }, ['Create organization & continue']);
  const form = h('form', { id: 'orgForm', novalidate: 'novalidate' }, [
    orgName.wrap,
    slug.wrap,
    alert,
    h('p', { class: 'demo-note' }, ['You will be the Owner of this organization. Other members are invited through Team & access.']),
    h('div', { class: 'bottom-actions' }, [h('a', { href: '#/login' }, ['Back']), submit]),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideAuthError(alert);
    clearFieldProblem(orgName.input, orgName.wrap);
    clearFieldProblem(slug.input, slug.wrap);
    if (orgName.input.value.trim() === '') {
      setFieldProblem(orgName.input, orgName.wrap, 'Name your organization.');
      orgName.input.focus();
      return;
    }
    if (slug.input.value.trim() === '') {
      setFieldProblem(slug.input, slug.wrap, 'Name your organization id.');
      slug.input.focus();
      return;
    }
    submitting(submit, true, 'Create organization & continue', 'Creating…');
    void (async () => {
      try {
        // Strict server body: slug + ticket only. The display name is
        // echoed in the confirmation; nothing is silently dropped.
        const created = await apiPost<{ tenantId: string }>('/api/orgs', { tenantId: slug.input.value.trim(), ticket });
        outlet.replaceChildren(
          setupSteps('create-org'),
          padcard(
            'Organization created',
            h('div', {}, [
              h('p', {}, [`${orgName.input.value.trim()} (${created.tenantId}) is yours. Log in to enter it.`]),
              h('p', {}, [
                h('a', { class: 'primary', href: `#/login?tenant=${encodeURIComponent(created.tenantId)}` }, ['Log in']),
              ]),
            ]),
          ),
        );
      } catch (error) {
        showAuthError(alert, error instanceof ApiRequestError ? error.failure.message : 'Creation failed.');
        submitting(submit, false, 'Create organization & continue', 'Creating…');
      }
    })();
  });
  const tenantCard = padcard(
    'Tenant boundary',
    h('div', {}, [
      row('Organization data', 'Isolated per tenant'),
      row('Private repositories', 'Never auto-granted'),
      row('Membership changes', 'Owner approval'),
      h('p', { class: 'help' }, ['Creating an organization does not automatically grant access to private repositories.']),
    ]),
  );
  const limitsCard = padcard(
    'Usage & limits',
    h('div', {}, [
      h('p', { class: 'help' }, ['Usage caps apply per organization. The service profile states the current allowance.']),
    ]),
  );
  outlet.replaceChildren(
    setupSteps('create-org'),
    head('Room for your team.', 'Create an organization to manage shared projects, access, and budget.'),
    h('div', { class: 'split' }, [h('div', {}, [padcard('Organization details', form)]), h('aside', {}, [tenantCard, limitsCard])]),
  );
}

/** GitHub App onboarding. The permission table documents the requested set;
 * repository selection renders only after a real connection exists — never
 * demo checkboxes. */
function onboardingPage(outlet: HTMLElement): void {
  const permissionRows: readonly (readonly [string, string, string])[] = [
    ['Metadata', 'Read', 'Shows the list of repositories you can choose'],
    ['Contents', 'Read', 'Snapshot of the exact commit analyzed. Tokens are not given to the browser, model, or sandbox'],
    ['Issues', 'Read', 'Uses issues as change intent'],
    ['Pull requests', 'Read & write', 'Triggers from PRs, and publishes candidate PRs when a maintainer approves'],
    ['Contents', 'Write', 'Only used to push the candidate branch during publication. Not used during analysis'],
  ];
  const permissions = card(
    'Permissions requested',
    h('div', {}, [
      h('p', {}, [staticBadge('No merge, admin, or deploy permission')]),
      table(
        ['Permission', 'Level', 'Used for'],
        permissionRows.map(([scope, level, use]) => [h('code', {}, [scope]), level, use]),
      ),
    ]),
  );
  const host = h('div', {}, []);
  const refresh = (): void => {
    host.replaceChildren(h('p', { class: 'muted' }, ['Checking the GitHub App connection…']));
    void apiGet<Providers>('/api/auth/providers')
      .then((providers) => {
        if (!host.isConnected) return;
        // Repository authority is separate from sign-in: `github` (login)
        // never unlocks this step, only `githubApp` (installation) does.
        if (providers.githubApp === true) {
          host.replaceChildren(
            h('p', {}, [
              'A GitHub App is configured, but repository selection is not exposed by the API yet. ' +
                'Nothing is shown rather than guessed.',
            ]),
          );
          return;
        }
        const recheck = h('button', { type: 'button' }, ['Check again']);
        recheck.addEventListener('click', refresh);
        host.replaceChildren(
          h(
            'p',
            { class: 'muted' },
            [
              'The GitHub App is not connected yet: no authorized GitHub App is configured for this service. Repository selection stays closed until installation.',
            ],
          ),
          h('p', {}, [recheck]),
        );
      })
      .catch((error: unknown) => {
        if (!host.isConnected) return;
        const recheck = h('button', { type: 'button' }, ['Check again']);
        recheck.addEventListener('click', refresh);
        host.replaceChildren(
          h('p', {}, [error instanceof ApiRequestError ? error.failure.message : 'Connection check failed.']),
          h('p', {}, [recheck]),
        );
      });
  };
  refresh();
  const connection = padcard('Connect GitHub', host);
  const security = padcard(
    'Security note',
    h('div', {}, [
      h(
        'p',
        { class: 'help' },
        [
          'Sign-in proves identity only. The App installation scopes repository access; revoke it any time from GitHub settings or Team & access.',
        ],
      ),
    ]),
  );
  const control = padcard(
    'What you control',
    h('div', {}, [
      row('Selected repositories only', tick()),
      row('Revoke access any time', tick()),
      row('Publication per run', tick()),
    ]),
  );
  outlet.replaceChildren(
    setupSteps('onboarding'),
    head(
      'Install GitHub App on selected repositories',
      'Signing in with GitHub only proves your identity. Repository access is granted separately through this App installation, only on the repositories you check.',
      [],
      'Step 3 of 4 · Organization workspace',
    ),
    h('div', { class: 'split' }, [h('div', {}, [permissions, connection]), h('aside', {}, [security, control])]),
  );
}

interface ProjectSession {
  readonly authenticated: boolean;
}

/** Project creation (step 4). Requires a session: the server resolves the
 * tenant from it, so unauthenticated visitors get a login prompt instead
 * of a form that cannot succeed. */
function newProjectPage(outlet: HTMLElement): void {
  outlet.replaceChildren(
    setupSteps('new-project'),
    head('Connect a project.', 'Choose repositories, map components, and define the environment for verification.'),
    h('p', { class: 'muted' }, ['Checking your session…']),
  );
  void (async () => {
    let session: ProjectSession;
    try {
      session = await apiGet<ProjectSession>('/api/auth/session');
    } catch {
      session = { authenticated: false };
    }
    if (!outlet.isConnected) return;
    if (!session.authenticated) {
      outlet.replaceChildren(
        setupSteps('new-project'),
        permissionCard('projects', 'Login is required', [
          h('p', {}, ['Project creation belongs to an organization. Log in first, then return here.']),
          h('p', {}, [h('a', { class: 'primary', href: '#/login' }, ['Log in'])]),
        ]),
      );
      return;
    }
    const projectName = field({ id: 'project-name', label: 'Project name', required: true });
    projectName.input.maxLength = 80;
    const description = field({ id: 'project-description', label: 'Short description' });
    description.input.maxLength = 160;
    const consent = h('input', { id: 'project-consent', name: 'project-consent', type: 'checkbox' });
    const alert = authErrorBox();
    const submit = h('button', { class: 'primary full', type: 'submit' }, ['Create project & view readiness']);
    const form = h('form', { id: 'projectForm', novalidate: 'novalidate' }, [
      h('div', { class: 'split' }, [
        h('div', {}, [
          padcard('Project identity', h('div', {}, [projectName.wrap, description.wrap, alert])),
          padcard(
            'Data permission',
            h('div', {}, [
              h('label', { class: 'checkrow' }, [
                consent,
                h('span', {}, ['Allow snapshots of the selected repositories’ source for analysis and verification.']),
              ]),
              h('p', { class: 'help' }, ['Telemetry uses sanitized uploads. Production credentials are not required.']),
            ]),
          ),
        ]),
        h('aside', {}, [
          padcard(
            'Initial readiness',
            h('div', {}, [
              h('p', { class: 'help' }, ['Inventory, baseline, model, and capacity are checked before a candidate can run.']),
              row('Repository scope', staticBadge('selected by owner', 'blue')),
              row('Publication', staticBadge('manual per run')),
              row('Proven level', staticBadge('none')),
              h('p', {}, [submit]),
            ]),
          ),
          padcard(
            'Evidence follows scope',
            h('div', {}, [
              h(
                'p',
                { class: 'help' },
                ['Detected frameworks are not automatically certified. Version conflicts and missing baselines are shown as findings.'],
              ),
            ]),
          ),
        ]),
      ]),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      hideAuthError(alert);
      clearFieldProblem(projectName.input, projectName.wrap);
      if (projectName.input.value.trim() === '') {
        setFieldProblem(projectName.input, projectName.wrap, 'Name your project.');
        projectName.input.focus();
        return;
      }
      if (!consent.checked) {
        showAuthError(alert, 'Confirm the data permission to create the project.');
        consent.focus();
        return;
      }
      submitting(submit, true, 'Create project & view readiness', 'Creating…');
      void (async () => {
        try {
          // Strict server body: name only. The description is echoed in
          // the confirmation; nothing is silently dropped.
          const created = await apiPost<{ projectId: string; name: string }>('/api/projects', {
            name: projectName.input.value.trim(),
          });
          const detail = description.input.value.trim();
          outlet.replaceChildren(
            setupSteps('new-project'),
            padcard(
              'Project created',
              h('div', {}, [
                h('p', {}, [`${created.name}${detail === '' ? '' : ` — ${detail}`}. Readiness is next.`]),
                h('p', {}, [h('a', { class: 'primary', href: '#/runs/new' }, ['Create a run'])]),
              ]),
            ),
          );
        } catch (error) {
          showAuthError(alert, error instanceof ApiRequestError ? error.failure.message : 'Creation failed.');
          submitting(submit, false, 'Create project & view readiness', 'Creating…');
        }
      })();
    });
    outlet.replaceChildren(
      setupSteps('new-project'),
      head('Connect a project.', 'Choose repositories, map components, and define the environment for verification.'),
      form,
    );
  })();
}

function invitePage(outlet: HTMLElement, ctx: RouteContext): void {
  const token = ctx.params.get('token');
  if (token === undefined || token === '') {
    outlet.replaceChildren(
      permissionCard('team', 'Invitation link is incomplete', [
        h('p', {}, ['The link carries no token. Ask the inviter for a fresh one.']),
      ]),
    );
    return;
  }
  outlet.replaceChildren(
    permissionCard('team', 'Checking invitation…', [h('p', {}, ['Reading your session first.'])]),
  );
  void (async () => {
    let session: { authenticated: boolean };
    try {
      session = await apiGet<{ authenticated: boolean }>('/api/auth/session');
    } catch {
      session = { authenticated: false };
    }
    if (!isLive(outlet)) return;
    if (!session.authenticated) {
      outlet.replaceChildren(
        permissionCard('team', 'Log in to accept', [
          h('p', {}, ['Invitations attach to an account. Log in (or register first), then reopen this invitation link.']),
          h('p', {}, [h('a', { class: 'primary', href: '#/login' }, ['Log in'])]),
        ]),
      );
      return;
    }
    outlet.replaceChildren(permissionCard('team', 'Accepting…', [h('p', {}, ['Joining the organization.'])]));
    try {
      const accepted = await apiPost<{ tenantId: string; role: string }>('/api/invitations/accept', { token });
      if (!isLive(outlet)) return;
      outlet.replaceChildren(
        permissionCard('team', 'Invitation accepted', [
          h('p', {}, [`You joined ${accepted.tenantId} as ${accepted.role}. Log in again to enter it.`]),
          h('div', { class: 'inset' }, [row('Organization', accepted.tenantId), row('Role', accepted.role)]),
          h('p', {}, [
            h('a', { class: 'primary', href: `#/login?tenant=${encodeURIComponent(accepted.tenantId)}` }, ['Log in']),
          ]),
        ]),
      );
    } catch (error) {
      if (!isLive(outlet)) return;
      outlet.replaceChildren(
        permissionCard('team', 'Invitation failed', [
          h('p', {}, [error instanceof ApiRequestError ? error.failure.message : 'Token rejected.']),
        ]),
      );
    }
  })();
}

function accessDeniedPage(outlet: HTMLElement): void {
  outlet.replaceChildren(
    permissionCard('key', 'Access not available yet.', [
      h('p', {}, ['This account does not yet have the permissions needed to open that resource.']),
      h('div', { class: 'actions' }, [
        h('a', { class: 'primary', href: '#/runs' }, ['Back to workspace']),
        h('a', { href: '#/team' }, ['Open Team & access']),
      ]),
      h(
        'p',
        { class: 'help' },
        ['Ask your organization owner for access; access is granted in Team & access.'],
      ),
    ]),
  );
}

function sessionExpiredPage(outlet: HTMLElement): void {
  outlet.replaceChildren(
    permissionCard('clock', 'Session expired', [
      h('p', {}, ['Your session ended or was revoked on another device. Log in again to continue.']),
      h('p', {}, [h('a', { class: 'primary', href: '#/login' }, ['Log in again'])]),
    ]),
  );
}

export function registerAuthPages(): void {
  wireAuthModal();
  // /login overwrites the T-43 notice: same route, now the real form.
  registerRoute({ path: '/login', title: 'Sign in', navLabel: 'Sign in', navSection: 'account', render: loginForm });
  registerRoute({
    path: '/register',
    title: 'Create an account',
    render: (outlet, ctx) => registerForm(outlet, ctx),
  });
  registerAccountRoute({
    path: '/check-email',
    title: 'Check your email',
    render: (outlet, ctx) => checkEmailPage(outlet, ctx),
  });
  registerRoute({
    path: '/verify-email',
    title: 'Verify email',
    render: (outlet, ctx) => {
      verifyEmailPage(outlet, ctx);
    },
  });
  registerRoute({
    path: '/verify',
    title: 'Verify email',
    render: (outlet, ctx) => {
      verifyEmailPage(outlet, ctx);
    },
  });
  registerAccountRoute({
    path: '/forgot-password',
    title: 'Reset your password',
    render: (outlet) => forgotPasswordPage(outlet),
  });
  registerAccountRoute({
    path: '/reset-password',
    title: 'Choose a new password',
    render: (outlet, ctx) => {
      resetPasswordPage(outlet, ctx);
    },
  });
  registerRoute({
    path: '/recover',
    title: 'Choose a new password',
    render: (outlet, ctx) => {
      resetPasswordPage(outlet, ctx);
    },
  });
  registerRoute({
    path: '/create-org',
    title: 'Create your organization',
    render: (outlet) => {
      createOrgPage(outlet);
    },
  });
  registerRoute({
    path: '/orgs/claim',
    title: 'Create your organization',
    render: (outlet) => {
      createOrgPage(outlet);
    },
  });
  registerRoute({
    path: '/onboarding',
    title: 'Connect GitHub',
    render: (outlet) => {
      onboardingPage(outlet);
    },
  });
  registerRoute({
    path: '/new-project',
    title: 'Create project',
    render: (outlet) => {
      newProjectPage(outlet);
    },
  });
  registerRoute({
    path: '/invite',
    title: 'Accept invitation',
    render: (outlet, ctx) => {
      invitePage(outlet, ctx);
    },
  });
  registerRoute({
    path: '/invitations/accept',
    title: 'Accept invitation',
    render: (outlet, ctx) => {
      invitePage(outlet, ctx);
    },
  });
  registerRoute({
    path: '/access-denied',
    title: 'Access denied',
    render: (outlet) => {
      accessDeniedPage(outlet);
    },
  });
  registerRoute({
    path: '/session-expired',
    title: 'Session expired',
    render: (outlet) => {
      sessionExpiredPage(outlet);
    },
  });
}
