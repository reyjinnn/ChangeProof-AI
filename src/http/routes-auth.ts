import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import type { EmailIdentityComposition, IdentityComposition } from '../orchestrator/index.js';
import {
  actingContext,
  parseBody,
  pathSegment,
  SESSION_COOKIE,
  sessionCookieId,
} from './context.js';
import { sendCreated, sendFail, sendOk } from './respond.js';

/**
 * Auth/organization routes (T-44, WP3-21/22/28).
 *
 * Thin JSON over the composed identity + email stores: strict bodies,
 * HttpOnly session cookies, server-derived contexts. Adds no grant or
 * verdict behavior; unknown/expired/revoked sessions map to 401 and the
 * deletion fence to 403.
 */

export interface AuthDeps {
  readonly identity: IdentityComposition;
  readonly email: EmailIdentityComposition;
}

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

export function isAuthPath(pathname: string): boolean {
  return (
    pathname === '/api/auth/providers' ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/orgs' ||
    pathname.startsWith('/api/orgs/') ||
    pathname.startsWith('/api/invitations/')
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
    // Real capability flags: GitHub stays false until an authorized App exists.
    sendOk(response, { email: true, github: false });
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


