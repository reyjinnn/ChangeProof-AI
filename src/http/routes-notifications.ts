import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { ChangeProofError, NotificationCategorySchema } from '../core/index.js';
import type { LifecycleSessionPort } from '../core/ports/index.js';
import type { NotificationsComposition } from '../orchestrator/index.js';
import { actingContext, HttpRouteError, parseBody, pathSegment } from './context.js';
import { sendFail, sendOk } from './respond.js';

/**
 * Notifications routes (T-47, WP3-29).
 *
 * Thin JSON over the composed notifications store: cursor-paged inbox,
 * per-row read/dismiss, read-all, and preference get/set. The server
 * derives identity from the session; counts and snippets arrive
 * post-grant-filter from the store, never cached here. Publishing and
 * outbox claim/ack stay worker- and control-plane-only.
 */

export interface NotificationsDeps {
  readonly session: LifecycleSessionPort;
  readonly notifications: NotificationsComposition;
}

const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50),
  cursor: z.string().max(300).optional(),
  unreadOnly: z
    .string()
    .max(10)
    .optional()
    .transform((value) => value === 'true'),
});
const PreferencesBody = z.strictObject({ muted: z.array(NotificationCategorySchema) });

function queryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/** Store refusals map to status without leaking which tenant owns what. */
async function orMapped<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ChangeProofError) {
      if (error.message.includes('unknown')) {
        throw new HttpRouteError(404, 'not_found', error.message);
      }
      if (error.message.includes('no tenant authority')) {
        throw new HttpRouteError(403, 'forbidden', error.message);
      }
    }
    throw error;
  }
}

export function isNotificationsPath(pathname: string): boolean {
  return pathname === '/api/notifications' || pathname.startsWith('/api/notifications/') || pathname === '/api/notification-preferences';
}

export async function handleNotificationsApi(
  deps: NotificationsDeps | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  url: URL,
  rawBody: string,
): Promise<void> {
  if (deps === undefined) {
    sendFail(response, 503, 'notifications_unavailable', 'Notification services need a database; the server was started without one.');
    return;
  }
  const { pathname } = url;
  const nowIso = new Date().toISOString();

  if (method === 'GET' && pathname === '/api/notifications') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const query = ListQuery.parse(queryParams(url));
    const listed = await orMapped(
      deps.notifications.store.listNotifications(
        { sessionId: ctx.sessionId, nowIso },
        { limit: query.limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }), unreadOnly: query.unreadOnly },
      ),
    );
    sendOk(response, listed);
    return;
  }
  if (method === 'POST' && pathname === '/api/notifications/read-all') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const marked = await orMapped(deps.notifications.store.markAllRead({ sessionId: ctx.sessionId, nowIso }));
    sendOk(response, marked);
    return;
  }
  if (
    method === 'POST' &&
    pathname.startsWith('/api/notifications/') &&
    (pathname.endsWith('/read') || pathname.endsWith('/dismiss'))
  ) {
    const ctx = await actingContext(deps.session, request, nowIso);
    const notificationId = pathSegment(pathname, 3, 'Notification');
    if (pathname.endsWith('/read')) {
      await orMapped(deps.notifications.store.markRead({ sessionId: ctx.sessionId, nowIso }, { notificationId }));
    } else {
      await orMapped(deps.notifications.store.markDismissed({ sessionId: ctx.sessionId, nowIso }, { notificationId }));
    }
    sendOk(response, { notificationId });
    return;
  }
  if (method === 'GET' && pathname === '/api/notification-preferences') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const preferences = await orMapped(deps.notifications.store.getPreferences({ sessionId: ctx.sessionId, nowIso }));
    sendOk(response, preferences);
    return;
  }
  if (method === 'POST' && pathname === '/api/notification-preferences') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const body = parseBody(PreferencesBody, rawBody);
    const preferences = await orMapped(
      deps.notifications.store.setPreferences({ sessionId: ctx.sessionId, nowIso }, { muted: body.muted }),
    );
    sendOk(response, preferences);
    return;
  }
  sendFail(response, 404, 'unknown_endpoint', `No API endpoint at "${pathname}".`);
}
