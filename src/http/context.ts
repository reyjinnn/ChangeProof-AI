import type { IncomingMessage } from 'node:http';

import type { z } from 'zod';

import { ChangeProofError, type TenantContext } from '../core/index.js';
import type { LifecycleSessionPort } from '../core/ports/index.js';

/**
 * Shared HTTP route context (T-45).
 *
 * Session reading, acting-context derivation with 401/403 mapping, body
 * parsing, and path segments — one copy for the auth and runs route
 * tables instead of two drifting copies.
 */

export class HttpRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpRouteError';
    this.status = status;
    this.code = code;
  }
}

export const SESSION_COOKIE = 'cp_session';

export function parseBody<T>(schema: z.ZodType<T>, rawBody: string): T {
  if (rawBody === '') throw new ChangeProofError('Request needs a JSON body; refusing an empty one.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    throw new ChangeProofError('Request body is not JSON; refusing.');
  }
  return schema.parse(parsed);
}

export function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function sessionCookieId(request: IncomingMessage): string | undefined {
  return cookieValue(request, SESSION_COOKIE);
}

/** Derive the acting context or throw a 401/403 the server maps directly. */
export async function actingContext(
  session: LifecycleSessionPort,
  request: IncomingMessage,
  nowIso: string,
): Promise<TenantContext> {
  const sessionId = sessionCookieId(request);
  if (sessionId === undefined || sessionId === '') {
    throw new HttpRouteError(401, 'session_required', 'Login is required for this action.');
  }
  try {
    return await session.deriveContext({ sessionId, nowIso });
  } catch (error) {
    if (error instanceof ChangeProofError && error.message.includes('deletion fence')) {
      throw new HttpRouteError(403, 'tenant_deleted', 'This organization was deleted; nothing here is available.');
    }
    const expired = error instanceof ChangeProofError && error.message.includes('expired');
    throw new HttpRouteError(
      401,
      expired ? 'session_expired' : 'session_required',
      'This session is no longer valid; log in again.',
    );
  }
}

export function pathSegment(pathname: string, index: number, what: string): string {
  const segment = pathname.split('/')[index] ?? '';
  if (segment === '') throw new ChangeProofError(`${what} id is missing from the path; refusing.`);
  return segment;
}
