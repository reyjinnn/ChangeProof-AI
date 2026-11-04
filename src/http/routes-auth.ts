import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { ChangeProofError } from '../core/index.js';
import type {
  EmailIdentityComposition,
  GitHubAuthComposition,
  IdentityComposition,
} from '../orchestrator/index.js';
import {
  actingContext,
  cookieValue,
  parseBody,
  pathSegment,
  SESSION_COOKIE,
  sessionCookieId,
} from './context.js';
import { sendCreated, sendFail, sendOk, sendRedirect } from './respond.js';

/**
 * Auth/organization routes (T-44, WP3-21/22/28).
 *
 * Thin JSON over the composed identity + email stores: strict bodies,
 * HttpOnly session cookies, server-derived contexts. Adds no grant or
 * verdict behavior; unknown/expired/revoked sessions map to 401 and the
 * deletion fence to 403.
 *
 * GitHub OAuth (FR3-29) rides the same table: start/callback are
 * top-level navigations (302s, no JSON), so outcomes land on hash routes
 * with a `githubError` code the dashboard maps to copy. The codes below
 * are the contract with `apps/dashboard/src/pages/auth.ts`.
 */

export interface AuthDeps {
  readonly identity: IdentityComposition;
  readonly email: EmailIdentityComposition;
  /** Absent without an authorized OAuth App: providers report `github: false`. */
  readonly github?: GitHubAuthComposition | undefined;
}

type GitHubErrorCode =
  | 'github_unavailable'
  | 'access_denied'
  | 'state_invalid'
  | 'provider_error'
  | 'email_missing'
  | 'email_taken'
  | 'choose_tenant'
  | 'github_taken'
  | 'tenant_deleted'
  | 'login_failed';

const SESSION_MAX_AGE = 12 * 3600;
const REMEMBER_MAX_AGE = 30 * 24 * 3600;
/** [DERIVED] Invitation lifetime: 7 days (the module leaves TTL to the caller). */
const INVITATION_TTL_MS = 7 * 24 * 3_600_000;

const EmailSchema = z.string().trim().min(3).max(254);
const PasswordSchema = z.string().min(10).max(128);
const TokenSchema = z.string().min(1).max(2000);
const TenantIdSchema = z.string().min(1).max(200);
const RoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);

const RegisterBody = z.strictObject({ email: EmailSchema, password: PasswordSchema });
const LoginBody = z.strictObject({
  email: EmailSchema,
  password: z.string().min(1).max(128),
  rememberMe: z.boolean(),
  tenantId: TenantIdSchema.optional(),
  returnTarget: z.string().max(500).optional(),
});
const VerifyBody = z.strictObject({ token: TokenSchema });
const EmailOnlyBody = z.strictObject({ email: EmailSchema });
const ResetBody = z.strictObject({ token: TokenSchema, newPassword: PasswordSchema });
const ClaimBody = z.strictObject({ tenantId: TenantIdSchema, ticket: TokenSchema });
const InviteBody = z.strictObject({ role: RoleSchema });
const AcceptBody = z.strictObject({ token: TokenSchema });
const MemberBody = z.strictObject({ userId: z.string().min(1).max(200), role: RoleSchema });
const DeleteBody = z.strictObject({ reason: z.string().min(1).max(500) });

function setSessionCookie(response: ServerResponse, sessionId: string, maxAge: number): void {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${String(maxAge)}`,
  );
}

function clearSessionCookie(response: ServerResponse): void {
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
}

/**
 * OAuth nonce cookie: binds the returning browser to the flow that
 * started it (login-CSRF layer). Lax so the top-level return navigation
 * carries it; the session cookie stays Strict. Short-lived, single use.
 */
const OAUTH_NONCE_COOKIE = 'cp_oauth';
const OAUTH_NONCE_MAX_AGE = 600;

function setOAuthNonceCookie(response: ServerResponse, nonce: string): void {
  response.setHeader(
    'Set-Cookie',
    `${OAUTH_NONCE_COOKIE}=${encodeURIComponent(nonce)}; HttpOnly; Path=/api/auth/github; SameSite=Lax; Max-Age=${String(OAUTH_NONCE_MAX_AGE)}`,
  );
}

function clearOAuthNonceCookie(response: ServerResponse): void {
  response.setHeader(
    'Set-Cookie',
    `${OAUTH_NONCE_COOKIE}=; HttpOnly; Path=/api/auth/github; SameSite=Lax; Max-Age=0`,
  );
}

function githubFailure(response: ServerResponse, code: GitHubErrorCode, page: 'login' | 'register' | 'account'): void {
  clearOAuthNonceCookie(response);
  sendRedirect(response, `/#/${page}?githubError=${code}`);
}

export function isAuthPath(pathname: string): boolean {
  return (
    pathname === '/api/auth/providers' ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/orgs' ||
    pathname.startsWith('/api/orgs/') ||
    pathname.startsWith('/api/invitations/') ||
    pathname === '/api/team/members'
  );
}

export async function handleAuthApi(
  auth: AuthDeps | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  url: URL,
  rawBody: string,
): Promise<void> {
  if (auth === undefined) {
    sendFail(response, 503, 'auth_unavailable', 'Account services need a database; the server was started without one.');
    return;
  }
  const { pathname } = url;
  const nowIso = new Date().toISOString();

  if (method === 'GET' && pathname === '/api/auth/providers') {
    // Real capability flags. `github` is sign-in (true once an authorized
    // OAuth App is wired); `githubApp` is repository authority, which stays
    // false until an installation flow exists — login never implies it.
    sendOk(response, { email: true, github: auth.github !== undefined, githubApp: false });
    return;
  }
  if (method === 'GET' && pathname === '/api/auth/github/start') {
    if (auth.github === undefined) {
      sendFail(
        response,
        503,
        'github_unavailable',
        'GitHub login is not configured for this service; email login still works.',
      );
      return;
    }
    const mode = url.searchParams.get('mode') ?? 'login';
    if (mode !== 'login' && mode !== 'link') {
      sendFail(response, 400, 'bad_request', 'OAuth mode is unknown; use login or link.');
      return;
    }
    const origin = url.searchParams.get('origin') ?? 'login';
    if (origin !== 'login' && origin !== 'register') {
      sendFail(response, 400, 'bad_request', 'OAuth origin is unknown; use login or register.');
      return;
    }
    let userId: string | undefined;
    if (mode === 'link') {
      // Both-identities rule (FR3-38): the password/session side proves
      // itself here; the GitHub side proves itself at the callback, and
      // the signed state binds the two halves.
      userId = (await actingContext(auth.identity.store, request, nowIso)).userId;
    }
    const tenantParam = url.searchParams.get('tenant') ?? '';
    const tenantId = tenantParam === '' ? undefined : TenantIdSchema.parse(tenantParam);
    const returnParam = url.searchParams.get('return') ?? '';
    const returnTarget = returnParam === '' ? undefined : returnParam;
    const rememberRaw = url.searchParams.get('remember') ?? '';
    const rememberMe = rememberRaw === '1' || rememberRaw.toLowerCase() === 'true';
    const nonce = randomBytes(16).toString('hex');
    try {
      const flow = await auth.github.startFlow({
        mode,
        nonce,
        ...(userId === undefined ? {} : { userId }),
        ...(tenantId === undefined ? {} : { tenantId }),
        ...(returnTarget === undefined ? {} : { returnTarget }),
        rememberMe,
        origin,
        nowMs: Date.parse(nowIso),
      });
      setOAuthNonceCookie(response, nonce);
      sendRedirect(response, flow.authorizeUrl);
    } catch (error) {
      if (error instanceof ChangeProofError && error.message.includes('Credential ref')) {
        sendFail(response, 503, 'github_unavailable', 'GitHub login is temporarily unavailable; email login still works.');
        return;
      }
      throw error;
    }
    return;
  }
  if (method === 'GET' && pathname === '/api/auth/github/callback') {
    if (auth.github === undefined) {
      githubFailure(response, 'github_unavailable', 'login');
      return;
    }
    const denied = url.searchParams.get('error');
    const rawState = url.searchParams.get('state') ?? '';
    let verified: Awaited<ReturnType<GitHubAuthComposition['verifyFlow']>>;
    try {
      verified = await auth.github.verifyFlow({ state: rawState, nowMs: Date.parse(nowIso) });
    } catch {
      githubFailure(response, 'state_invalid', 'login');
      return;
    }
    const failPage = verified.mode === 'link' ? 'account' : verified.origin;
    const cookieNonce = cookieValue(request, OAUTH_NONCE_COOKIE);
    if (cookieNonce === undefined || cookieNonce === '' || cookieNonce !== verified.nonce) {
      githubFailure(response, 'state_invalid', failPage);
      return;
    }
    if (denied !== null) {
      githubFailure(response, 'access_denied', failPage);
      return;
    }
    const code = url.searchParams.get('code') ?? '';
    if (code === '') {
      githubFailure(response, 'state_invalid', failPage);
      return;
    }
    let profile: Awaited<ReturnType<GitHubAuthComposition['fetchProfile']>>;
    try {
      profile = await auth.github.fetchProfile(code);
    } catch (error) {
      if (error instanceof ChangeProofError && error.message.includes('no verified email')) {
        githubFailure(response, 'email_missing', failPage);
        return;
      }
      if (error instanceof Error) {
        process.stderr.write(`github oauth profile fetch failed: ${error.message}\n`);
      }
      githubFailure(response, 'provider_error', failPage);
      return;
    }
    try {
      if (verified.mode === 'link') {
        if (verified.userId === undefined) {
          githubFailure(response, 'state_invalid', 'account');
          return;
        }
        await auth.github.store.linkGitHubIdentity({
          userId: verified.userId,
          githubId: profile.githubId,
          login: profile.login,
          nowIso,
        });
        clearOAuthNonceCookie(response);
        sendRedirect(response, '/#/account?githubLinked=1');
        return;
      }
      const link = await auth.github.store.findLinkByGitHubId(profile.githubId);
      let userId: string;
      if (link !== null) {
        userId = link.userId;
      } else if ((await auth.github.store.findUserIdByEmail(profile.email)) !== null) {
        // Both identities are NOT proven (only GitHub), so a matching
        // email never auto-links: the owner logs in with the password
        // first, then links from Account.
        githubFailure(response, 'email_taken', failPage);
        return;
      } else {
        userId = (
          await auth.github.store.registerGitHubUser({
            email: profile.email,
            githubId: profile.githubId,
            login: profile.login,
            nowIso,
          })
        ).userId;
      }
      const session = await auth.github.store.loginWithGitHub({
        userId,
        ...(verified.tenantId === undefined ? {} : { tenantId: verified.tenantId }),
        rememberMe: verified.rememberMe,
        returnTarget: verified.returnTarget,
        nowIso,
      });
      response.setHeader('Set-Cookie', [
        `${SESSION_COOKIE}=${encodeURIComponent(session.sessionId)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${String(verified.rememberMe ? REMEMBER_MAX_AGE : SESSION_MAX_AGE)}`,
        `${OAUTH_NONCE_COOKIE}=; HttpOnly; Path=/api/auth/github; SameSite=Lax; Max-Age=0`,
      ]);
      sendRedirect(response, verified.returnTarget);
    } catch (error) {
      if (!(error instanceof ChangeProofError)) throw error;
      const message = error.message;
      if (message.includes('Several organizations')) {
        githubFailure(response, 'choose_tenant', failPage);
        return;
      }
      if (message.includes('deletion fence')) {
        githubFailure(response, 'tenant_deleted', failPage);
        return;
      }
      if (message.includes('already linked to a different user')) {
        githubFailure(response, 'github_taken', failPage);
        return;
      }
      if (message.includes('already has a password account')) {
        githubFailure(response, 'email_taken', failPage);
        return;
      }
      process.stderr.write(`github oauth completion failed: ${message}\n`);
      githubFailure(response, 'login_failed', failPage);
      return;
    }
    return;
  }
  if (method === 'GET' && pathname === '/api/auth/github/status') {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    if (auth.github === undefined) {
      sendOk(response, { configured: false, linked: false, links: [] });
      return;
    }
    const links = await auth.github.store.listLinksByUser(ctx.userId);
    sendOk(response, { configured: true, linked: links.length > 0, links: links.map((entry) => ({ login: entry.login })) });
    return;
  }
  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = parseBody(RegisterBody, rawBody);
    sendCreated(response, await auth.email.store.registerUser({ ...body, nowIso }));
    return;
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = parseBody(LoginBody, rawBody);
    const session = await auth.email.store.loginWithPassword({
      email: body.email,
      password: body.password,
      rememberMe: body.rememberMe,
      nowIso,
      ...(body.tenantId === undefined ? {} : { tenantId: body.tenantId }),
      ...(body.returnTarget === undefined ? {} : { returnTarget: body.returnTarget }),
    });
    setSessionCookie(response, session.sessionId, body.rememberMe ? REMEMBER_MAX_AGE : SESSION_MAX_AGE);
    sendOk(response, { tenantId: session.tenantId, expiresAt: session.expiresAt });
    return;
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const sessionId = sessionCookieId(request);
    if (sessionId !== undefined && sessionId !== '') {
      try {
        await auth.identity.store.revokeSession(sessionId);
      } catch {
        // Logout is idempotent: an unknown session still clears the cookie.
      }
    }
    clearSessionCookie(response);
    sendOk(response, { loggedOut: true });
    return;
  }
  if (method === 'GET' && pathname === '/api/auth/session') {
    const sessionId = sessionCookieId(request);
    if (sessionId === undefined || sessionId === '') {
      sendOk(response, { authenticated: false as const });
      return;
    }
    try {
      const ctx = await auth.identity.store.deriveContext({ sessionId, nowIso });
      sendOk(response, {
        authenticated: true as const,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        role: ctx.role,
        expiresAt: ctx.expiresAt,
        // T-45: the run form needs the grant version it submits
        // against plus the projects and repositories it may name.
        grantVersion: ctx.grantVersion,
        projectGrants: ctx.projectGrants,
        repositoryGrants: ctx.repositoryGrants,
      });
    } catch {
      // A dead cookie reads as logged out here; mutating calls 401 instead.
      sendOk(response, { authenticated: false as const });
    }
    return;
  }
  if (method === 'GET' && pathname === '/api/auth/sessions') {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    const sessions = await auth.email.store.listUserSessions({ userId: ctx.userId });
    const current = sessionCookieId(request);
    sendOk(
      response,
      sessions.map((session) => ({ ...session, current: session.sessionId === current })),
    );
    return;
  }
  if (method === 'DELETE' && pathname.startsWith('/api/auth/sessions/')) {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    const id = pathSegment(pathname, 4, 'Session');
    const owned = await auth.email.store.listUserSessions({ userId: ctx.userId });
    if (!owned.some((session) => session.sessionId === id)) {
      sendFail(response, 404, 'not_found', 'No such session on this account.');
      return;
    }
    await auth.identity.store.revokeSession(id);
    sendOk(response, { revoked: true });
    return;
  }
  if (method === 'POST' && pathname === '/api/auth/verify/resend') {
    const body = parseBody(EmailOnlyBody, rawBody);
    await auth.email.store.resendVerification({ ...body, nowIso });
    sendOk(response, { sent: true });
    return;
  }
  if (method === 'POST' && pathname === '/api/auth/verify') {
    const body = parseBody(VerifyBody, rawBody);
    const { claimTicket } = await auth.email.store.verifyEmail({ ...body, nowIso });
    // Single-use ticket for organization creation; the UI holds it in
    // memory only and never writes it to storage.
    sendOk(response, { claimTicket });
    return;
  }
  if (method === 'POST' && pathname === '/api/auth/password/forgot') {
    const body = parseBody(EmailOnlyBody, rawBody);
    await auth.email.store.requestPasswordReset({ ...body, nowIso });
    sendOk(response, { sent: true });
    return;
  }
  if (method === 'POST' && pathname === '/api/auth/password/reset') {
    const body = parseBody(ResetBody, rawBody);
    await auth.email.store.resetPassword({ ...body, nowIso });
    sendOk(response, { reset: true });
    return;
  }
  if (method === 'POST' && pathname === '/api/orgs') {
    const body = parseBody(ClaimBody, rawBody);
    sendCreated(response, await auth.email.store.claimTenant({ ...body, nowIso }));
    return;
  }
  if (method === 'POST' && pathname.endsWith('/invitations') && pathname.startsWith('/api/orgs/')) {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    const tenantId = pathSegment(pathname, 3, 'Organization');
    if (tenantId !== ctx.tenantId) {
      sendFail(response, 404, 'not_found', 'No such organization on this account.');
      return;
    }
    const body = parseBody(InviteBody, rawBody);
    const invitation = await auth.identity.store.createInvitation({
      actor: ctx,
      role: body.role,
      ttlMs: INVITATION_TTL_MS,
      nowMs: Date.parse(nowIso),
    });
    sendCreated(response, invitation);
    return;
  }
  if (method === 'POST' && pathname === '/api/invitations/accept') {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    const body = parseBody(AcceptBody, rawBody);
    const accepted = await auth.identity.store.acceptInvitation({
      token: body.token,
      userId: ctx.userId,
      nowMs: Date.parse(nowIso),
    });
    sendOk(response, accepted);
    return;
  }
  if (method === 'PATCH' && pathname.endsWith('/members') && pathname.startsWith('/api/orgs/')) {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    const tenantId = pathSegment(pathname, 3, 'Organization');
    if (tenantId !== ctx.tenantId) {
      sendFail(response, 404, 'not_found', 'No such organization on this account.');
      return;
    }
    const body = parseBody(MemberBody, rawBody);
    await auth.identity.store.changeMemberRole({ actor: ctx, userId: body.userId, role: body.role });
    sendOk(response, { changed: true });
    return;
  }
  if (method === 'DELETE' && pathname.includes('/members/') && pathname.startsWith('/api/orgs/')) {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    const tenantId = pathSegment(pathname, 3, 'Organization');
    if (tenantId !== ctx.tenantId) {
      sendFail(response, 404, 'not_found', 'No such organization on this account.');
      return;
    }
    const userId = pathSegment(pathname, 5, 'Member');
    await auth.identity.store.removeMember({ actor: ctx, userId });
    sendOk(response, { removed: true });
    return;
  }
  if (method === 'GET' && pathname === '/api/team/members') {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    try {
      sendOk(response, await auth.identity.store.listMembers(ctx));
    } catch (error) {
      if (error instanceof ChangeProofError && error.message.includes('no tenant authority')) {
        sendFail(response, 403, 'forbidden', error.message);
        return;
      }
      throw error;
    }
    return;
  }
  if (method === 'DELETE' && pathname.startsWith('/api/orgs/') && pathname.split('/').length === 4) {
    const ctx = await actingContext(auth.identity.store, request, nowIso);
    const tenantId = pathSegment(pathname, 3, 'Organization');
    if (tenantId !== ctx.tenantId) {
      sendFail(response, 404, 'not_found', 'No such organization on this account.');
      return;
    }
    const body = parseBody(DeleteBody, rawBody);
    await auth.identity.store.deleteTenant({ actor: ctx, reason: body.reason, nowMs: Date.parse(nowIso) });
    clearSessionCookie(response);
    sendOk(response, { deleted: true });
    return;
  }
  sendFail(response, 404, 'unknown_endpoint', `No API endpoint at "${pathname}".`);
}


