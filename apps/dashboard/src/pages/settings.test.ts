import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { renderRoute, registerRoute } from '../routes.js';
import { renderShell } from '../shell.js';
import { registerSettingsPage } from './settings.js';

const realFetch = globalThis.fetch;
const seen: string[] = [];

function stubFetch(routes: Record<string, { status: number; json: unknown }>): void {
  seen.length = 0;
  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    seen.push(url);
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const hit = routes[path];
    if (hit === undefined) return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(hit.status < 400 ? { ok: true, data: hit.json } : hit.json), { status: hit.status }),
    );
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
  window.location.hash = '';
});

function boot(): HTMLElement {
  registerSettingsPage();
  registerRoute({ path: '/', title: 'Home', render: () => undefined });
  const app = document.createElement('div');
  document.body.appendChild(app);
  return renderShell(app).outlet;
}

const SESSION = { authenticated: true, userId: 'u-1', tenantId: 'acme', role: 'owner', expiresAt: '2030-01-01T00:00:00.000Z' };
const SESSIONS = [
  { sessionId: 'sess-current', tenantId: 'acme', expiresAt: '2030-01-01T00:00:00.000Z', revoked: false, current: true },
  { sessionId: 'sess-other', tenantId: 'acme', expiresAt: '2030-01-01T00:00:00.000Z', revoked: false, current: false },
];

async function settle(outlet: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 30 && !outlet.textContent.includes(text); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected element to exist');
  return value;
}

test('guests see a login card, never settings', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'Settings need a login');
  expect(outlet.querySelector('a[href="#/login"]')).not.toBeNull();
  expect(seen.some((url) => url === '/api/auth/sessions')).toBe(false);
});

test('sessions list marks the current one and revokes others', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: SESSIONS },
    '/api/auth/sessions/sess-other': { status: 200, json: { revoked: true } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'This session');
  expect(outlet.textContent).toContain('This session');
  const revoke = [...outlet.querySelectorAll('.faq-item button')].find((b) => b.textContent === 'Revoke');
  expect(revoke).toBeDefined();
  (revoke as HTMLButtonElement).click();
  await settle(outlet, 'revoked');
  expect(seen.some((url) => url === '/api/auth/sessions/sess-other')).toBe(true);
});

test('dead sessions redirect to the expired page', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': {
      status: 401,
      json: { ok: false, error: { code: 'session_expired', message: 'Expired.' } },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  for (let i = 0; i < 30 && window.location.hash !== '#/session-expired'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(window.location.hash).toBe('#/session-expired');
});

test('invite creation shows the one-time link', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: [] },
    '/api/orgs/acme/invitations': { status: 201, json: { invitationId: 'inv-1', token: 'tok-abc' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'Invite someone');
  const form = [...outlet.querySelectorAll('form')].find((f) => f.textContent.includes('Create invitation'));
  form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await settle(outlet, 'tok-abc');
  expect(outlet.textContent).toContain('#/invite?token=tok-abc');
});

test('deletion demands a matching confirmation, no request otherwise', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'Delete organization');
  (document.getElementById('delete-reason') as HTMLInputElement).value = 'done';
  (document.getElementById('delete-confirm') as HTMLInputElement).value = 'wrong-slug';
  const form = [...outlet.querySelectorAll('form')].find((f) => f.textContent.includes('Delete this organization'));
  form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await settle(outlet, 'does not match');
  expect(seen.some((url) => url === '/api/orgs/acme')).toBe(false);
});

test('settings shows workspace tabs, a profile form, and a theme switch', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'Workspace profile');
  const tabLabels = [...outlet.querySelectorAll('.route-tabs a')].map((a) => a.textContent);
  expect(tabLabels).toEqual(['Organization', 'Account & sessions', 'Data & privacy', 'Audit log']);
  expect(outlet.querySelector('#settingsForm')).not.toBeNull();
  const dark = outlet.querySelector<HTMLInputElement>('.cp-theme-settings input[value="dark"]');
  if (dark === null) throw new Error('Missing dark theme radio.');
  dark.checked = true;
  dark.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.documentElement.dataset['theme']).toBe('dark');
  document.documentElement.dataset['theme'] = 'light';
});

test('settings profile save refuses to fake a write', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: [] },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/settings');
  await settle(outlet, 'Workspace profile');
  const form = outlet.querySelector('#settingsForm');
  if (form === null) throw new Error('Missing #settingsForm.');
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await settle(outlet, 'no organization-profile endpoint');
  expect(seen.some((url) => url !== '/api/auth/session' && url !== '/api/auth/sessions')).toBe(false);
});

test('account shows the profile, sessions, and GitHub status', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: SESSIONS },
    '/api/auth/github/status': { status: 200, json: { configured: false, linked: false, links: [] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/account');
  await settle(outlet, 'This session');
  expect(outlet.textContent).toContain('u-1');
  expect(outlet.textContent).toContain('acme');
  expect(outlet.textContent).toContain('owner');
  expect(outlet.textContent).toContain('GitHub status');
  expect(outlet.textContent).toContain('not configured for this service');
  expect(outlet.querySelector('a[href="#/repositories"]')).not.toBeNull();
  expect(outlet.querySelector('.route-tabs a.active')?.textContent).toBe('Account & sessions');
});

test('account offers the link button when no GitHub account is linked', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: SESSIONS },
    '/api/auth/github/status': { status: 200, json: { configured: true, linked: false, links: [] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/account');
  await settle(outlet, 'Link GitHub account');
  const button = required(
    [...outlet.querySelectorAll('button')].find((entry) => entry.textContent === 'Link GitHub account'),
  );
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  button.click();
  expect(assign).toHaveBeenCalledWith('/api/auth/github/start?mode=link');
});

test('account names the connected login and confirms a fresh link', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: SESSIONS },
    '/api/auth/github/status': { status: 200, json: { configured: true, linked: true, links: [{ login: 'octocat' }] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/account?githubLinked=1');
  await settle(outlet, 'Connected as octocat');
  expect(outlet.textContent).toContain('GitHub account linked');
});

test('account maps a link-mode callback failure to copy', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/auth/sessions': { status: 200, json: SESSIONS },
    '/api/auth/github/status': { status: 200, json: { configured: true, linked: false, links: [] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/account?githubError=github_taken');
  await settle(outlet, 'already linked to a different user');
  expect(outlet.textContent).toContain('already linked to a different user');
});

test('team invites through the real endpoint and reports when members cannot load', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/orgs/acme/invitations': { status: 201, json: { invitationId: 'inv-1', token: 'tok-abc' } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/team');
  await settle(outlet, 'Invite someone');
  expect(outlet.querySelector('#memberTable')?.textContent).toContain('could not be loaded');
  expect(outlet.textContent).toContain('Role summary');
  expect(outlet.textContent).toContain('Administrator');
  const form = outlet.querySelector('#inviteForm');
  if (form === null) throw new Error('Missing #inviteForm.');
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await settle(outlet, 'tok-abc');
  expect(outlet.textContent).toContain('#/invite?token=tok-abc');
});

test('team lists members when the endpoint answers', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/team/members': { status: 200, json: { items: [{ userId: 'u-9', role: 'member', email: 'u-9@example.test' }] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/team');
  await settle(outlet, 'u-9');
  expect(outlet.querySelector('#memberTable')?.textContent).toContain('member');
});

test('team stays empty when no members are listed', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/team/members': { status: 200, json: { items: [] } },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/team');
  await settle(outlet, 'No members found');
  expect(outlet.querySelector('#memberTable')?.textContent).toContain('invitation form below');
});

test('guests see a login card on team, never members', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: { authenticated: false } } });
  const outlet = boot();
  await renderRoute(outlet, '#/team');
  await settle(outlet, 'Team needs a login');
  expect(seen.some((url) => url === '/api/team/members')).toBe(false);
});

test('privacy shows the lifecycle table and honest export', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: SESSION } });
  const outlet = boot();
  await renderRoute(outlet, '#/privacy');
  await settle(outlet, 'Data lifecycle');
  expect(outlet.textContent).toContain('Sessions');
  expect(outlet.textContent).toContain('Invitations');
  expect(outlet.textContent).toContain('Delete organization');
  const exportButton = [...outlet.querySelectorAll('button')].find((b) => b.textContent === 'Request export');
  if (exportButton === undefined) throw new Error('Missing export button.');
  exportButton.click();
  await settle(outlet, 'no self-service export endpoint');
});

test('audit stays empty when nothing is recorded and export refuses to fake a file', async () => {
  stubFetch({ '/api/auth/session': { status: 200, json: SESSION } });
  const outlet = boot();
  await renderRoute(outlet, '#/audit');
  await settle(outlet, 'No activity entries');
  expect(outlet.querySelector('#auditTable')).not.toBeNull();
  expect(outlet.querySelector('#auditSearch')).not.toBeNull();
  expect(outlet.querySelector('.table-tools')).not.toBeNull();
  const exportButton = [...outlet.querySelectorAll('button')].find((b) => b.textContent === 'Export audit');
  if (exportButton === undefined) throw new Error('Missing export button.');
  exportButton.click();
  await settle(outlet, 'nothing to download');
});

test('audit lists entries when the endpoint answers', async () => {
  stubFetch({
    '/api/auth/session': { status: 200, json: SESSION },
    '/api/audit/entries?limit=50': {
      status: 200,
      json: {
        items: [{ time: '10:48:02', actor: 'Reyjin', event: 'run.accepted', scope: 'RUN-0144', receipt: 'reserved 45 cr' }],
      },
    },
  });
  const outlet = boot();
  await renderRoute(outlet, '#/audit');
  await settle(outlet, 'run.accepted');
  expect(outlet.textContent).toContain('Showing 1 of 1 entries.');
});
