import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  ChangeProofError,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  NotificationCategorySchema,
  NotificationPreferencesSchema,
  NotificationRecordSchema,
  type NotificationPreferences,
  type NotificationRecord,
  type TenantContext,
} from '../../core/index.js';
import type { LifecycleSessionPort } from '../../core/ports/index.js';

/**
 * PostgreSQL-backed notifications (WP3-29, FR3-39).
 *
 * The inbox, per-user preferences, and the channel outbox live in
 * `infra/postgres/V7` and are reached only with bound parameters. Every
 * session call re-derives the context first; recipients must be tenant
 * members (a forged recipient is refused, NEG3-31); repeat deliveries of one
 * business event collapse onto the idempotent event id; linked runs, projects,
 * and repositories are re-checked at list time so a lost grant hides the
 * notification, its snippet, and its count. Read/dismiss state is per user
 * and never deletes audit or evidence. The only delivery channel in this
 * slice is in-app; the outbox rows commit atomically with the notification
 * so future channel workers can claim them with a bounded retry cap.
 */

export interface NotificationsDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface NotificationsDbClient {
  query(text: string, params?: readonly unknown[]): Promise<NotificationsDbResult>;
  release(): void;
}

export interface NotificationsDb {
  query(text: string, params?: readonly unknown[]): Promise<NotificationsDbResult>;
  connect(): Promise<NotificationsDbClient>;
}

export interface NotificationsActor {
  readonly sessionId: string;
  readonly nowIso: string;
}

export interface PublishEventInput {
  readonly tenantId: string;
  readonly eventId: string;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly userId: string;
  readonly deepLink?: string;
  readonly runId?: string;
  readonly projectId?: string;
  readonly repositoryId?: string;
  readonly nowIso: string;
}

export interface ListNotificationsInput {
  readonly limit: number;
  readonly cursor?: string;
  readonly unreadOnly?: boolean;
}

export interface MarkNotificationInput {
  readonly notificationId: string;
}

export interface SetPreferencesInput {
  readonly muted: readonly string[];
}

export interface ClaimOutboxInput {
  readonly tenantId: string;
  readonly limit: number;
  readonly maxAttempts: number;
}

export interface AckOutboxInput {
  readonly tenantId: string;
  readonly eventId: string;
  readonly outcome: 'sent' | 'failed';
}

export interface NotificationsStore {
  publishFromEvent(
    input: PublishEventInput,
  ): Promise<{ notificationId: string; duplicate: boolean; suppressed: boolean }>;
  listNotifications(
    actor: NotificationsActor,
    input: ListNotificationsInput,
  ): Promise<{ items: readonly NotificationRecord[]; unreadCount: number; cursor: string }>;
  markRead(actor: NotificationsActor, input: MarkNotificationInput): Promise<void>;
  markDismissed(actor: NotificationsActor, input: MarkNotificationInput): Promise<void>;
  markAllRead(actor: NotificationsActor): Promise<{ marked: number }>;
  getPreferences(actor: NotificationsActor): Promise<NotificationPreferences>;
  setPreferences(actor: NotificationsActor, input: SetPreferencesInput): Promise<NotificationPreferences>;
  claimOutboxBatch(input: ClaimOutboxInput): Promise<readonly { eventId: string; attempts: number }[]>;
  ackOutbox(input: AckOutboxInput): Promise<void>;
}

const NotificationRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  user_id: z.string(),
  event_id: z.string(),
  category: z.string(),
  title: z.string(),
  body: z.string(),
  deep_link: z.string().nullable(),
  run_id: z.string().nullable(),
  project_id: z.string().nullable(),
  repository_id: z.string().nullable(),
  read_at: z.date().nullable(),
  dismissed_at: z.date().nullable(),
  created_at: z.date(),
});

const PreferencesRowSchema = z.object({ categories: z.unknown() });
const OutboxRowSchema = z.object({ event_id: z.string(), attempts: z.number() });

function randomId(prefix: string): string {
  return IdSchema.parse(`${prefix}-${randomBytes(8).toString('hex')}`);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function parseRow(row: unknown): NotificationRecord {
  const parsed = NotificationRowSchema.parse(row);
  return NotificationRecordSchema.parse({
    schemaVersion: '1',
    notificationId: parsed.id,
    tenantId: parsed.tenant_id,
    userId: parsed.user_id,
    eventId: parsed.event_id,
    category: parsed.category,
    title: parsed.title,
    body: parsed.body,
    ...(parsed.deep_link === null ? {} : { deepLink: parsed.deep_link }),
    ...(parsed.run_id === null ? {} : { runId: parsed.run_id }),
    ...(parsed.project_id === null ? {} : { projectId: parsed.project_id }),
    ...(parsed.repository_id === null ? {} : { repositoryId: parsed.repository_id }),
    ...(parsed.read_at === null ? {} : { readAt: parsed.read_at.toISOString() }),
    ...(parsed.dismissed_at === null ? {} : { dismissedAt: parsed.dismissed_at.toISOString() }),
    createdAt: parsed.created_at.toISOString(),
  });
}

function parseCursor(cursor: string | undefined): { afterCreatedAt: string | null; afterId: string | null } {
  if (cursor === undefined || cursor === '') return { afterCreatedAt: null, afterId: null };
  const [afterCreatedAt, afterId] = cursor.split('|');
  if (afterCreatedAt === undefined || afterId === undefined || afterCreatedAt === '' || afterId === '') {
    throw new ChangeProofError('Notification cursor is unreadable; refusing to page.');
  }
  return { afterCreatedAt, afterId };
}

export function createNotificationsStore(db: NotificationsDb, session: LifecycleSessionPort): NotificationsStore {
  async function inTenant<T>(tenantId: string, work: (client: NotificationsDbClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      try {
        await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async function derive(actor: NotificationsActor): Promise<TenantContext> {
    const context = await session.deriveContext({
      sessionId: IdSchema.parse(actor.sessionId),
      nowIso: InstantSchema.parse(actor.nowIso),
    });
    const source: string = context.authoritySource;
    if (source !== 'server') {
      throw new ChangeProofError('Tenant context is not server-derived; refusing to authorize.');
    }
    if (context.role === 'operator') {
      throw new ChangeProofError('Operator accounts carry no tenant authority here (NEG3-34).');
    }
    return context;
  }

  return {
    async publishFromEvent(input) {
      const tenantId = IdSchema.parse(input.tenantId);
      const userId = IdSchema.parse(input.userId);
      const eventId = NonEmptyStringSchema.parse(input.eventId);
      const category = NotificationCategorySchema.parse(input.category);
      const title = NonEmptyStringSchema.parse(input.title);
      const body = NonEmptyStringSchema.parse(input.body);
      const nowIso = InstantSchema.parse(input.nowIso);
      const record = NotificationRecordSchema.parse({
        schemaVersion: '1',
        notificationId: randomId('notif'),
        tenantId,
        userId,
        eventId,
        category,
        title,
        body,
        ...(input.deepLink === undefined ? {} : { deepLink: input.deepLink }),
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.repositoryId === undefined ? {} : { repositoryId: input.repositoryId }),
        createdAt: nowIso,
      });
      const precheck = await inTenant(tenantId, async (client) => {
        const member = await client.query('SELECT user_id FROM memberships WHERE user_id = $1', [userId]);
        if (member.rows.length === 0) {
          throw new ChangeProofError('Notification recipient is not a member of this tenant; refusing (NEG3-31).');
        }
        const prefs = await client.query('SELECT categories FROM notification_preferences WHERE user_id = $1', [
          userId,
        ]);
        if (prefs.rows.length > 0) {
          const muted = z.array(z.string()).parse(PreferencesRowSchema.parse(prefs.rows[0]).categories);
          if (muted.includes(category)) {
            return { suppressed: true as const, duplicateId: null as string | null };
          }
        }
        const existing = await client.query('SELECT id FROM notifications WHERE tenant_id = $1 AND event_id = $2', [
          tenantId,
          eventId,
        ]);
        const id = (existing.rows[0] as { id: string } | undefined)?.id;
        return { suppressed: false as const, duplicateId: id ?? null };
      });
      if (precheck.suppressed) {
        return { notificationId: '', duplicate: false as const, suppressed: true as const };
      }
      if (precheck.duplicateId !== null) {
        return { notificationId: precheck.duplicateId, duplicate: true as const, suppressed: false as const };
      }
      try {
        await inTenant(tenantId, async (client) => {
          await client.query(
            'INSERT INTO notifications (id, tenant_id, user_id, event_id, category, title, body, deep_link, run_id, project_id, repository_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
            [
              record.notificationId,
              tenantId,
              userId,
              eventId,
              category,
              title,
              body,
              record.deepLink ?? null,
              record.runId ?? null,
              record.projectId ?? null,
              record.repositoryId ?? null,
              nowIso,
            ],
          );
          await client.query(
            "INSERT INTO notification_outbox (tenant_id, event_id, channel, state, attempts, created_at) VALUES ($1, $2, 'in-app', 'pending', 0, $3)",
            [tenantId, eventId, nowIso],
          );
        });
      } catch (error) {
        if (errorCode(error) !== '23505') throw error;
        const raced = await inTenant(tenantId, async (client) => {
          const existing = await client.query('SELECT id FROM notifications WHERE tenant_id = $1 AND event_id = $2', [
            tenantId,
            eventId,
          ]);
          return (existing.rows[0] as { id: string } | undefined)?.id ?? null;
        });
        if (raced === null) throw error;
        return { notificationId: raced, duplicate: true as const, suppressed: false as const };
      }
      return { notificationId: record.notificationId, duplicate: false as const, suppressed: false as const };
    },

    async listNotifications(actor, input) {
      const context = await derive(actor);
      const limit = z.number().int().min(1).max(50).parse(input.limit);
      const { afterCreatedAt, afterId } = parseCursor(input.cursor);
      return inTenant(context.tenantId, async (client) => {
        const rows = await client.query(
          'SELECT * FROM notifications WHERE user_id = $1 AND dismissed_at IS NULL ORDER BY created_at DESC, id DESC',
          [context.userId],
        );
        const grantedRepos = await client.query('SELECT repository_id FROM repository_grants');
        const granted = new Set(
          grantedRepos.rows.map((row) => (row as { repository_id: string }).repository_id),
        );
        const visible: NotificationRecord[] = [];
        for (const row of rows.rows) {
          const parsed = parseRow(row);
          if (parsed.projectId !== undefined && !context.projectGrants.includes(parsed.projectId)) continue;
          if (parsed.repositoryId !== undefined && !granted.has(parsed.repositoryId)) continue;
          if (parsed.runId !== undefined) {
            const run = await client.query('SELECT project_id FROM lifecycle_runs WHERE id = $1', [parsed.runId]);
            const projectId = (run.rows[0] as { project_id: string } | undefined)?.project_id;
            if (projectId === undefined || !context.projectGrants.includes(projectId)) continue;
          }
          visible.push(parsed);
        }
        const unreadCount = visible.filter((item) => item.readAt === undefined).length;
        const page = visible.filter((item) => {
          if (afterCreatedAt === null || afterId === null) return true;
          return (
            item.createdAt < afterCreatedAt || (item.createdAt === afterCreatedAt && item.notificationId < afterId)
          );
        });
        if (input.unreadOnly === true) {
          const unread = page.filter((item) => item.readAt === undefined).slice(0, limit);
          const last = unread[unread.length - 1];
          return {
            items: unread,
            unreadCount,
            cursor: last === undefined ? '' : `${last.createdAt}|${last.notificationId}`,
          };
        }
        const items = page.slice(0, limit);
        const last = items[items.length - 1];
        return {
          items,
          unreadCount,
          cursor: last === undefined ? '' : `${last.createdAt}|${last.notificationId}`,
        };
      });
    },

    async markRead(actor, input) {
      const context = await derive(actor);
      const notificationId = IdSchema.parse(input.notificationId);
      await inTenant(context.tenantId, async (client) => {
        const updated = await client.query(
          'UPDATE notifications SET read_at = $3 WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
          [notificationId, context.userId, actor.nowIso],
        );
        if ((updated.rowCount ?? 0) === 0) {
          const exists = await client.query('SELECT id FROM notifications WHERE id = $1 AND user_id = $2', [
            notificationId,
            context.userId,
          ]);
          if (exists.rows.length === 0) {
            throw new ChangeProofError('Notification is unknown.');
          }
        }
      });
    },

    async markDismissed(actor, input) {
      const context = await derive(actor);
      const notificationId = IdSchema.parse(input.notificationId);
      await inTenant(context.tenantId, async (client) => {
        const updated = await client.query(
          'UPDATE notifications SET dismissed_at = $3 WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL',
          [notificationId, context.userId, actor.nowIso],
        );
        if ((updated.rowCount ?? 0) === 0) {
          throw new ChangeProofError('Notification is unknown or already dismissed.');
        }
      });
    },

    async markAllRead(actor) {
      const context = await derive(actor);
      return inTenant(context.tenantId, async (client) => {
        const updated = await client.query(
          'UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL',
          [context.userId, actor.nowIso],
        );
        return { marked: updated.rowCount ?? 0 };
      });
    },

    async getPreferences(actor) {
      const context = await derive(actor);
      return inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT categories FROM notification_preferences WHERE user_id = $1', [
          context.userId,
        ]);
        if (found.rows.length === 0) {
          return NotificationPreferencesSchema.parse({
            schemaVersion: '1',
            tenantId: context.tenantId,
            userId: context.userId,
            muted: [],
          });
        }
        const muted = z.array(z.string()).parse(PreferencesRowSchema.parse(found.rows[0]).categories);
        return NotificationPreferencesSchema.parse({
          schemaVersion: '1',
          tenantId: context.tenantId,
          userId: context.userId,
          muted,
        });
      });
    },

    async setPreferences(actor, input) {
      const context = await derive(actor);
      const muted = z.array(NotificationCategorySchema).parse([...input.muted]);
      return inTenant(context.tenantId, async (client) => {
        await client.query(
          'INSERT INTO notification_preferences (tenant_id, user_id, categories) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO UPDATE SET categories = EXCLUDED.categories',
          [context.tenantId, context.userId, JSON.stringify(muted)],
        );
        return NotificationPreferencesSchema.parse({
          schemaVersion: '1',
          tenantId: context.tenantId,
          userId: context.userId,
          muted,
        });
      });
    },

    async claimOutboxBatch(input) {
      const tenantId = IdSchema.parse(input.tenantId);
      const limit = z.number().int().min(1).max(100).parse(input.limit);
      const maxAttempts = z.number().int().min(1).parse(input.maxAttempts);
      return inTenant(tenantId, async (client) => {
        await client.query(
          "UPDATE notification_outbox SET state = 'failed' WHERE state = 'pending' AND attempts >= $1",
          [maxAttempts],
        );
        const claimed = await client.query(
          "SELECT event_id, attempts FROM notification_outbox WHERE state = 'pending' AND attempts < $1 ORDER BY created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED",
          [maxAttempts, limit],
        );
        const rows = claimed.rows.map((row) => OutboxRowSchema.parse(row));
        for (const row of rows) {
          await client.query('UPDATE notification_outbox SET attempts = attempts + 1 WHERE tenant_id = $1 AND event_id = $2', [
            tenantId,
            row.event_id,
          ]);
        }
        return rows.map((row) => ({ eventId: row.event_id, attempts: row.attempts + 1 }));
      });
    },

    async ackOutbox(input) {
      const tenantId = IdSchema.parse(input.tenantId);
      const eventId = NonEmptyStringSchema.parse(input.eventId);
      const outcome = z.enum(['sent', 'failed']).parse(input.outcome);
      await inTenant(tenantId, async (client) => {
        const updated = await client.query(
          'UPDATE notification_outbox SET state = $1 WHERE tenant_id = $2 AND event_id = $3',
          [outcome, tenantId, eventId],
        );
        if ((updated.rowCount ?? 0) === 0) {
          throw new ChangeProofError('Outbox entry is unknown.');
        }
      });
    },
  };
}
