/* Account pages (T-44, FR3-29/30/38, NEG3-29/30). Email register,
 * verify, login, recovery, organization claim, invitation accept, and
 * the session-expired landing. The browser holds no authority: every
 * decision comes from the API, and single-use tickets live in memory
 * only (never localStorage — see store.ts).
 *
 * Password length (10–128) and org-slug shape mirror the server
 * modules/identity policy; the server re-validates everything, so
 * drift here degrades help text, never security.
 */

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { emptyState, errorState, field, h } from '../components.js';
import { notifySessionChanged } from '../session.js';
import { validateReturnTarget } from './public.js';
import { currentRouteEpoch, isCurrentRouteEpoch, registerRoute, type Route, type RouteContext } from '../routes.js';
import { registerPassword, registerShell } from './register.js';
import { recoveryModal, standaloneAuth } from './auth-port.js';

let claimTicket: string | undefined;

export function takeClaimTicket(): string | undefined {
  const ticket = claimTicket;
  claimTicket = undefined;
  return ticket;
}

function showAlert(host: HTMLElement, message: string): void {
  host.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [message]));
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
  readonly github: boolean;
}

function authShell(formCard: HTMLElement): HTMLElement {
  return standaloneAuth(formCard);
}

function providersNote(host: HTMLElement): void {
  void apiGet<Providers>('/api/auth/providers')
    .then((providers) => {
      if (providers.github) return;
      host.appendChild(
        h('p', { class: 'muted' }, [
          'GitHub login is unavailable: no authorized GitHub App is configured. Email sign-in requires the account service to be available.',
        ]),
      );
    })
    .catch(() => {
      // Providers are advisory; the form submits regardless and the API rules.
    });
}

function loginForm(outlet: HTMLElement, ctx: RouteContext): void {
  const params = ctx.params;
  const ret = validateReturnTarget(params.get('return') ?? undefined);
  const email = field({ id: 'login-email', label: 'Email address', type: 'email', required: true, autocomplete: 'email' });
  const password = field({
    id: 'login-password',
    label: 'Password',
    type: 'password',
    required: true,
    autocomplete: 'current-password',
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
  const rememberRow = h('div', { class: 'auth-form-options' }, [h('label', { for: 'login-remember' }, [remember, 'Remember me']), h('a', { href: '#/forgot-password' }, ['Forgot password?'])]);
  const alert = h('div', {}, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Log in']);
  const form = h('form', { novalidate: 'novalidate' }, [
    email.wrap,
    password.wrap,
    tenantRow,
    rememberRow,
    alert,
    h('p', {}, [submit]),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
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
    submitting(submit, true, 'Log in', 'Logging in…');
    void (async () => {
      try {
        await apiPost<{ tenantId: string; expiresAt: string }>('/api/auth/login', {
          email: email.input.value.trim(),
          password: password.input.value,
          rememberMe: remember.checked,
          ...(tenant.input.value.trim() === '' ? {} : { tenantId: tenant.input.value.trim() }),
          ...(ret.valid ? { returnTarget: ret.target } : {}),
        });
        // The API has accepted the return target; the hash router maps
        // documented /app paths to the corresponding real workspace view.
        window.location.hash = ret.valid ? `#${ret.target}` : '#/';
        notifySessionChanged();
      } catch (error) {
        const message = error instanceof ApiRequestError ? error.failure.message : 'Login failed.';
        if (message.includes('Several organizations')) {
          tenantRow.style.display = '';
          showAlert(alert, 'You belong to several organizations; name the one to log in to.');
          tenant.input.focus();
        } else if (message.includes('Tenant lookup came back empty')) {
          alert.replaceChildren(
            h('p', { role: 'alert' }, [
              'This account has no organization yet. ',
              h('a', { href: '#/check-email' }, ['Verify your email']),
              document.createTextNode(' to create one.'),
            ]),
          );
        } else {
          showAlert(alert, message);
        }
        submitting(submit, false, 'Log in', 'Logging in…');
      }
    })();
  });
  const modal = registerShell(form, 'login');
  if (ret.valid) form.parentElement?.insertBefore(h('p', { class: 'return-note' }, [`After login you continue inside the app (${ret.target}).`]), form);
  outlet.replaceChildren(modal);
  const panel = modal.querySelector<HTMLElement>('.fresh-auth-form');
  if (panel !== null) providersNote(panel);
}

function registerForm(outlet: HTMLElement): void {
  const email = field({ id: 'reg-email', label: 'Email address', type: 'email', required: true, autocomplete: 'email' });
  const password = field({
    id: 'reg-password',
    label: 'Password',
    type: 'password',
    required: true,
    autocomplete: 'new-password',
  });
  const confirm = field({
    id: 'reg-confirm',
    label: 'Confirm password',
    type: 'password',
    required: true,
    autocomplete: 'new-password',
  });
  for (const part of [email, password, confirm]) {
    const label = part.wrap.querySelector('label')?.textContent ?? '';
    part.wrap = h('label', { class: 'field', for: part.input.id }, [label, part.input]);
  }
  email.input.placeholder = 'name@company.com';
  password.input.placeholder = 'Between 10 and 128 characters';
  confirm.input.placeholder = 'Enter your password again';
  password.input.minLength = 10;
  password.input.maxLength = 128;
  registerPassword(password.input, password.wrap);
  registerPassword(confirm.input, confirm.wrap);
  const alert = h('div', {}, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Create account']);
  const form = h('form', { id: 'freshRegisterForm', novalidate: 'novalidate' }, [
    email.wrap, password.wrap, confirm.wrap,
    h('p', { class: 'field-note', id: 'reg-password-hint' }, ['Use between 10 and 128 characters.']),
    h('p', { class: 'auth-policy' }, ['We verify your email. Read our ', h('a', { href: '#/p/privacy-policy' }, ['privacy policy']), '.']),
    alert, submit,
  ]);
  password.input.setAttribute('aria-describedby', 'reg-password-hint');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const part of [email, password, confirm]) clearFieldProblem(part.input, part.wrap);
    password.input.setAttribute('aria-describedby', 'reg-password-hint');
    if (email.input.value.trim() === '') {
      setFieldProblem(email.input, email.wrap, 'Enter your email address.');
      email.input.focus();
      return;
    }
    if (password.input.value.length < 10 || password.input.value.length > 128) {
      setFieldProblem(password.input, password.wrap, 'Use between 10 and 128 characters.');
      password.input.setAttribute('aria-describedby', 'reg-password-hint reg-password-error');
      password.input.focus();
      return;
    }
    if (confirm.input.value !== password.input.value) {
      setFieldProblem(confirm.input, confirm.wrap, 'Passwords do not match.');
      confirm.input.focus();
      return;
    }
    submitting(submit, true, 'Create account', 'Creating…');
    void (async () => {
      try {
        await apiPost<{ userId: string }>('/api/auth/register', {
          email: email.input.value.trim(),
          password: password.input.value,
        });
        window.location.hash = `#/check-email?email=${encodeURIComponent(email.input.value.trim())}`;
      } catch (error) {
        showAlert(alert, error instanceof ApiRequestError ? error.failure.message : 'Registration failed.');
        submitting(submit, false, 'Create account', 'Creating…');
      }
    })();
  });
  outlet.replaceChildren(registerShell(form));
}

function checkEmailPage(outlet: HTMLElement, ctx: RouteContext): void {
  const address = ctx.params.get('email') ?? '';
  const email = field({ id: 'resend-email', label: 'Email address', type: 'email', required: true, autocomplete: 'email' });
  if (address !== '') email.input.value = address;
  const alert = h('div', {}, []);
  const done = h('div', { 'aria-live': 'polite' }, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Resend verification mail']);
  const form = h('form', { novalidate: 'novalidate' }, [email.wrap, alert, h('p', {}, [submit])]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldProblem(email.input, email.wrap);
    if (email.input.value.trim() === '') {
      setFieldProblem(email.input, email.wrap, 'Enter your email address.');
      email.input.focus();
      return;
    }
    submitting(submit, true, 'Resend verification mail', 'Sending…');
    void (async () => {
      try {
        await apiPost('/api/auth/verify/resend', { email: email.input.value.trim() });
        done.replaceChildren(h('p', {}, ['If the address is registered, a fresh verification mail is on its way.']));
      } catch (error) {
        showAlert(alert, error instanceof ApiRequestError ? error.failure.message : 'Resend failed.');
      } finally {
        submitting(submit, false, 'Resend verification mail', 'Sending…');
      }
    })();
  });
  outlet.replaceChildren(
    authShell(
      h('section', { class: 'card' }, [
        h('div', { class: 'eyebrow' }, ['Email Verification']),
        h('h1', {}, ['Check your email']),
        address === ''
          ? h('p', {}, ['We sent a verification mail with a single-use token. Open the link from the mail to continue.'])
          : h('p', {}, [`We sent a verification mail to ${address}. Open the link from the mail to continue.`]),
        done,
        h('h2', {}, ['Mail did not arrive?']),
        form,
      ]),
    ),
  );
}

function verifyEmailPage(outlet: HTMLElement, ctx: RouteContext): void {
  const token = ctx.params.get('token');
  if (token === undefined || token === '') {
    outlet.replaceChildren(
      errorState('Verification link is incomplete', 'The link carries no token. Request a fresh mail and try again.', {
        label: 'Resend mail',
        onClick: () => {
          window.location.hash = '#/check-email';
        },
      }),
    );
    return;
  }
  outlet.replaceChildren(emptyState('Verifying…', 'Checking the single-use token.'));
  void (async () => {
    try {
      const { claimTicket: ticket } = await apiPost<{ claimTicket: string }>('/api/auth/verify', { token });
      claimTicket = ticket;
      outlet.replaceChildren(
        h('section', { class: 'card' }, [
          h('h1', {}, ['Email verified']),
          h('p', {}, ['Your address is confirmed. Create your organization to continue.']),
          h('p', {}, [h('a', { class: 'button primary', href: '#/create-org' }, ['Create organization'])]),
        ]),
      );
    } catch (error) {
      outlet.replaceChildren(
        errorState('Verification failed', error instanceof ApiRequestError ? error.failure.message : 'Token rejected.', {
          label: 'Resend mail',
          onClick: () => {
            window.location.hash = '#/check-email';
          },
        }),
      );
    }
  })();
}

function forgotPasswordPage(outlet: HTMLElement): void {
  const email = field({ id: 'forgot-email', label: 'Email address', type: 'email', required: true, autocomplete: 'email' });
  const alert = h('div', {}, []);
  const done = h('div', { 'aria-live': 'polite' }, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Send reset mail']);
  const form = h('form', { novalidate: 'novalidate' }, [email.wrap, alert, h('p', {}, [submit])]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldProblem(email.input, email.wrap);
    if (email.input.value.trim() === '') {
      setFieldProblem(email.input, email.wrap, 'Enter your email address.');
      email.input.focus();
      return;
    }
    submitting(submit, true, 'Send reset mail', 'Sending…');
    void (async () => {
      try {
        await apiPost('/api/auth/password/forgot', { email: email.input.value.trim() });
        done.replaceChildren(h('p', {}, ['If the address is registered, a reset mail is on its way.']));
      } catch (error) {
        showAlert(alert, error instanceof ApiRequestError ? error.failure.message : 'Request failed.');
      } finally {
        submitting(submit, false, 'Send reset mail', 'Sending…');
      }
    })();
  });
  outlet.replaceChildren(recoveryModal(form, done));
}

function resetPasswordPage(outlet: HTMLElement, ctx: RouteContext): void {
  const token = ctx.params.get('token');
  if (token === undefined || token === '') {
    outlet.replaceChildren(
      errorState('Reset link is incomplete', 'The link carries no token. Request a fresh reset mail.', {
        label: 'Request reset',
        onClick: () => {
          window.location.hash = '#/forgot-password';
        },
      }),
    );
    return;
  }
  const password = field({
    id: 'reset-password',
    label: 'New password',
    type: 'password',
    required: true,
    autocomplete: 'new-password',
    hint: 'Between 10 and 128 characters.',
  });
  const confirm = field({
    id: 'reset-confirm',
    label: 'Confirm new password',
    type: 'password',
    required: true,
    autocomplete: 'new-password',
  });
  const alert = h('div', {}, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Set new password']);
  const form = h('form', { novalidate: 'novalidate' }, [password.wrap, confirm.wrap, alert, h('p', {}, [submit])]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldProblem(password.input, password.wrap);
    clearFieldProblem(confirm.input, confirm.wrap);
    if (password.input.value.length < 10 || password.input.value.length > 128) {
      setFieldProblem(password.input, password.wrap, 'Use between 10 and 128 characters.');
      password.input.focus();
      return;
    }
    if (confirm.input.value !== password.input.value) {
      setFieldProblem(confirm.input, confirm.wrap, 'Passwords do not match.');
      confirm.input.focus();
      return;
    }
    submitting(submit, true, 'Set new password', 'Saving…');
    void (async () => {
      try {
        await apiPost('/api/auth/password/reset', { token, newPassword: password.input.value });
        outlet.replaceChildren(
          h('section', { class: 'card' }, [
            h('h1', {}, ['Password changed']),
            h('p', {}, ['Log in with the new password.']),
            h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
          ]),
        );
      } catch (error) {
        showAlert(alert, error instanceof ApiRequestError ? error.failure.message : 'Reset failed.');
        submitting(submit, false, 'Set new password', 'Saving…');
      }
    })();
  });
  outlet.replaceChildren(h('section', { class: 'card' }, [h('h1', {}, ['Choose a new password']), form]));
}

function createOrgPage(outlet: HTMLElement): void {
  const ticket = takeClaimTicket();
  if (ticket === undefined) {
    outlet.replaceChildren(
      errorState(
        'Verification ticket is gone',
        'The single-use ticket lives in this tab only and is already spent or was lost to a reload. Verify again to mint a fresh one.',
        {
          label: 'Verify email',
          onClick: () => {
            window.location.hash = '#/check-email';
          },
        },
      ),
    );
    return;
  }
  const slug = field({
    id: 'org-slug',
    label: 'Organization id',
    required: true,
    hint: 'Start with a letter or digit; then letters, digits, and . _ ~ : @ + -',
    autocomplete: 'organization',
  });
  const alert = h('div', {}, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Create organization']);
  const form = h('form', { novalidate: 'novalidate' }, [slug.wrap, alert, h('p', {}, [submit])]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldProblem(slug.input, slug.wrap);
    if (slug.input.value.trim() === '') {
      setFieldProblem(slug.input, slug.wrap, 'Name your organization id.');
      slug.input.focus();
      return;
    }
    submitting(submit, true, 'Create organization', 'Creating…');
    void (async () => {
      try {
        const created = await apiPost<{ tenantId: string }>('/api/orgs', { tenantId: slug.input.value.trim(), ticket });
        outlet.replaceChildren(
          h('section', { class: 'card' }, [
            h('h1', {}, ['Organization created']),
            h('p', {}, [`${created.tenantId} is yours. Log in to enter it.`]),
            h('p', {}, [
              h('a', { class: 'button primary', href: `#/login?tenant=${encodeURIComponent(created.tenantId)}` }, ['Log in']),
            ]),
          ]),
        );
      } catch (error) {
        showAlert(alert, error instanceof ApiRequestError ? error.failure.message : 'Creation failed.');
        submitting(submit, false, 'Create organization', 'Creating…');
      }
    })();
  });
  outlet.replaceChildren(
    authShell(
      h('section', { class: 'card' }, [
        h('div', { class: 'eyebrow' }, ['Organization Provisioning']),
        h('h1', {}, ['Create your organization']),
        h('p', { class: 'muted' }, ['You become its owner.']),
        form,
      ]),
    ),
  );
}

function invitePage(outlet: HTMLElement, ctx: RouteContext): void {
  const token = ctx.params.get('token');
  if (token === undefined || token === '') {
    outlet.replaceChildren(errorState('Invitation link is incomplete', 'The link carries no token. Ask the inviter for a fresh one.'));
    return;
  }
  outlet.replaceChildren(emptyState('Checking invitation…', 'Reading your session first.'));
  void (async () => {
    let session: { authenticated: boolean };
    try {
      session = await apiGet<{ authenticated: boolean }>('/api/auth/session');
    } catch {
      session = { authenticated: false };
    }
    if (!session.authenticated) {
      outlet.replaceChildren(
        h('section', { class: 'card' }, [
          h('h1', {}, ['Log in to accept']),
          h('p', {}, ['Invitations attach to an account. Log in (or register first), then reopen this invitation link.']),
          h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
        ]),
      );
      return;
    }
    outlet.replaceChildren(emptyState('Accepting…', 'Joining the organization.'));
    try {
      const accepted = await apiPost<{ tenantId: string; role: string }>('/api/invitations/accept', { token });
      outlet.replaceChildren(
        h('section', { class: 'card' }, [
          h('h1', {}, ['Invitation accepted']),
          h('p', {}, [`You joined ${accepted.tenantId} as ${accepted.role}. Log in again to enter it.`]),
          h('p', {}, [h('a', { class: 'button primary', href: `#/login?tenant=${encodeURIComponent(accepted.tenantId)}` }, ['Log in'])]),
        ]),
      );
    } catch (error) {
      outlet.replaceChildren(
        errorState('Invitation failed', error instanceof ApiRequestError ? error.failure.message : 'Token rejected.'),
      );
    }
  })();
}

function registerAccountRoute(route: Route): void {
  registerRoute({ ...route, render: async (outlet, ctx) => {
    const epoch = currentRouteEpoch();
    const frame = (): void => {
      if (!isCurrentRouteEpoch(epoch)) { observer.disconnect(); return; }
      if (outlet.childNodes.length === 0 || [...outlet.children].some(e => e.classList.contains('reyn-design') || e.classList.contains('register-page'))) return;
      const card = h('section');
      card.append(...outlet.childNodes);
      const heading = card.querySelector('h2');
      if (card.querySelector('h1') === null && heading !== null) heading.replaceWith(h('h1', {}, [heading.textContent]));
      outlet.replaceChildren(authShell(card));
    };
    // Async verification/reset responses keep their real handlers and state;
    // this observer only supplies the original account presentation.
    const observer = new MutationObserver(frame);
    observer.observe(outlet, { childList: true });
    await route.render(outlet, ctx);
    frame();
  } });
}

export function registerAuthPages(): void {
  // /login overwrites the T-43 notice: same route, now the real form.
  registerAccountRoute({ path: '/login', title: 'Log in', navLabel: 'Login', navSection: 'account', render: loginForm });
  registerAccountRoute({
    path: '/register',
    title: 'Create an account',
    render: (outlet) => {
      registerForm(outlet);
    },
  });
  registerAccountRoute({
    path: '/check-email',
    title: 'Check your email',
    render: (outlet, ctx) => {
      checkEmailPage(outlet, ctx);
    },
  });
  registerAccountRoute({
    path: '/verify-email',
    title: 'Verify email',
    render: (outlet, ctx) => {
      verifyEmailPage(outlet, ctx);
    },
  });
  registerAccountRoute({
    path: '/forgot-password',
    title: 'Reset your password',
    render: (outlet) => {
      forgotPasswordPage(outlet);
    },
  });
  registerAccountRoute({
    path: '/reset-password',
    title: 'Choose a new password',
    render: (outlet, ctx) => {
      resetPasswordPage(outlet, ctx);
    },
  });
  registerAccountRoute({
    path: '/create-org',
    title: 'Create your organization',
    render: (outlet) => {
      createOrgPage(outlet);
    },
  });
  registerAccountRoute({
    path: '/invite',
    title: 'Accept invitation',
    render: (outlet, ctx) => {
      invitePage(outlet, ctx);
    },
  });
  registerAccountRoute({
    path: '/session-expired',
    title: 'Session expired',
    render: (outlet) => {
      outlet.replaceChildren(
        h('section', { class: 'card' }, [
          h('h1', {}, ['Session expired']),
          h('p', {}, ['Your session ended or was revoked on another device. Log in again to continue.']),
          h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
        ]),
      );
    },
  });
}
