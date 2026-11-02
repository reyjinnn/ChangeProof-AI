import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  AudienceChangeSchema,
  ChangeProofError,
  CommentBodySchema,
  CommentSchema,
  IdSchema,
  InstantSchema,
  Sha256Schema,
  ShareRecordSchema,
  ThreadAudienceSchema,
  ThreadSchema,
  type Comment,
  type ShareRecord,
  type TenantContext,
  type Thread,
} from '../../core/index.js';
import type { LifecycleSessionPort, MentionNotifyPort } from '../../core/ports/index.js';

/**
 * PostgreSQL-backed collaboration (WP3-30, FR3-42).
 *
 * Threads, versioned comments with edit history, and explicit shares live in
 * `infra/postgres/V8` and are reached only with bound parameters. Every
 * session call re-derives the context first. Threads bind a run to the
 * candidate digest under discussion; a candidate revision marks dependent
 * comments outdated without moving them. Comment bodies reject active markup
 * at parse time. Internal threads admit owners, admins, and members; reviewer
 * threads additionally admit viewers and explicitly shared users; operators
 * hold no thread authority. Shares are idempotent and revocable, audience
 * changes are owner/admin acts with recorded history, and mentions notify
 * only users who hold access — nobody else receives a snippet. Nothing here
 * can change a verdict, oracle, or publication: the store writes discussion
 * rows only.
 */

export interface CollaborationDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface CollaborationDbClient {
  query(text: string, params?: readonly unknown[]): Promise<CollaborationDbResult>;
  release(): void;
}

export interface CollaborationDb {
  query(text: string, params?: readonly unknown[]): Promise<CollaborationDbResult>;
  connect(): Promise<CollaborationDbClient>;
}

export interface CollaborationActor {
  readonly sessionId: string;
  readonly nowIso: string;
}

export interface CreateThreadInput {
  readonly runId: string;
  readonly candidateDigest: string;
  readonly artifactRef?: string;
  readonly diffLocation?: string;
  readonly audience: string;
}

export interface ListThreadsInput {
  readonly runId: string;
}

export interface PostCommentInput {
  readonly threadId: string;
  readonly body: string;
}

export interface EditCommentInput {
  readonly commentId: string;
  readonly body: string;
}

export interface ThreadRefInput {
  readonly threadId: string;
}

export interface ChangeAudienceInput {
  readonly threadId: string;
  readonly audience: string;
}

export interface ShareThreadInput {
  readonly threadId: string;
  readonly userId: string;
}

export interface RevokeShareInput {
  readonly shareId: string;
}

export interface ListCommentsInput {
  readonly threadId: string;
}

export interface CommentHistoryInput {
  readonly commentId: string;
}

export interface RecordCandidateRevisionInput {
  readonly tenantId: string;
  readonly runId: string;
  readonly candidateDigest: string;
  readonly nowIso: string;
}

export interface CollaborationDeps {
  readonly session: LifecycleSessionPort;
  readonly mentions: MentionNotifyPort;
}

export interface CollaborationStore {
  createThread(actor: CollaborationActor, input: CreateThreadInput): Promise<Thread>;
  listThreads(actor: CollaborationActor, input: ListThreadsInput): Promise<{ threads: readonly Thread[] }>;
  postComment(actor: CollaborationActor, input: PostCommentInput): Promise<Comment>;
  editComment(actor: CollaborationActor, input: EditCommentInput): Promise<Comment>;
  listComments(actor: CollaborationActor, input: ListCommentsInput): Promise<{ comments: readonly Comment[] }>;
  commentHistory(
    actor: CollaborationActor,
    input: CommentHistoryInput,
  ): Promise<{ versions: readonly { version: number; body: string; editedAt: string }[] }>;
  resolveThread(actor: CollaborationActor, input: ThreadRefInput): Promise<Thread>;
  changeAudience(actor: CollaborationActor, input: ChangeAudienceInput): Promise<Thread>;
  shareThread(actor: CollaborationActor, input: ShareThreadInput): Promise<ShareRecord>;
  revokeShare(actor: CollaborationActor, input: RevokeShareInput): Promise<void>;
  recordCandidateRevision(input: RecordCandidateRevisionInput): Promise<{ outdated: number }>;
}

const ThreadRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  run_id: z.string(),
  created_by: z.string(),
  candidate_digest: z.string(),
  artifact_ref: z.string().nullable(),
  diff_location: z.string().nullable(),
  audience: z.string(),
  status: z.string(),
  audience_history: z.unknown(),
  created_at: z.date(),
});

const CommentRowSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  tenant_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  version: z.number(),
  outdated: z.boolean(),
  created_at: z.date(),
  edited_at: z.date().nullable(),
});

const ShareRowSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  tenant_id: z.string(),
  shared_with: z.string(),
  granted_by: z.string(),
  revoked_at: z.date().nullable(),
  created_at: z.date(),
});

const MENTION_PATTERN = /@([A-Za-z0-9][A-Za-z0-9._~:@+-]*)/g;

function randomId(prefix: string): string {
  return IdSchema.parse(`${prefix}-${randomBytes(8).toString('hex')}`);
}

function parseThread(row: unknown): Thread {
  const parsed = ThreadRowSchema.parse(row);
  return ThreadSchema.parse({
    schemaVersion: '1',
    threadId: parsed.id,
    tenantId: parsed.tenant_id,
    runId: parsed.run_id,
    candidateDigest: parsed.candidate_digest,
    ...(parsed.artifact_ref === null ? {} : { artifactRef: parsed.artifact_ref }),
    ...(parsed.diff_location === null ? {} : { diffLocation: parsed.diff_location }),
    audience: parsed.audience,
    status: parsed.status,
    audienceHistory: z.array(AudienceChangeSchema).parse(parsed.audience_history),
    createdAt: parsed.created_at.toISOString(),
  });
}

function parseComment(row: unknown): Comment {
  const parsed = CommentRowSchema.parse(row);
  return CommentSchema.parse({
    schemaVersion: '1',
    commentId: parsed.id,
    threadId: parsed.thread_id,
    tenantId: parsed.tenant_id,
    authorId: parsed.author_id,
    body: parsed.body,
    version: parsed.version,
    outdated: parsed.outdated,
    createdAt: parsed.created_at.toISOString(),
    ...(parsed.edited_at === null ? {} : { editedAt: parsed.edited_at.toISOString() }),
  });
}

function parseShare(row: unknown): ShareRecord {
  const parsed = ShareRowSchema.parse(row);
  return ShareRecordSchema.parse({
    schemaVersion: '1',
    shareId: parsed.id,
    threadId: parsed.thread_id,
    tenantId: parsed.tenant_id,
    sharedWith: parsed.shared_with,
    grantedBy: parsed.granted_by,
    ...(parsed.revoked_at === null ? {} : { revokedAt: parsed.revoked_at.toISOString() }),
    createdAt: parsed.created_at.toISOString(),
  });
}

export function createCollaborationStore(db: CollaborationDb, deps: CollaborationDeps): CollaborationStore {
  async function inTenant<T>(tenantId: string, work: (client: CollaborationDbClient) => Promise<T>): Promise<T> {
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

  async function derive(actor: CollaborationActor): Promise<TenantContext> {
    const context = await deps.session.deriveContext({
      sessionId: IdSchema.parse(actor.sessionId),
      nowIso: InstantSchema.parse(actor.nowIso),
    });
    const source: string = context.authoritySource;
    if (source !== 'server') {
      throw new ChangeProofError('Tenant context is not server-derived; refusing to authorize.');
    }
    if (context.role === 'operator') {
      throw new ChangeProofError('Operator accounts carry no thread authority here (NEG3-34).');
    }
    return context;
  }

  async function runProject(client: CollaborationDbClient, runId: string): Promise<string | null> {
    const run = await client.query('SELECT project_id FROM lifecycle_runs WHERE id = $1', [runId]);
    return (run.rows[0] as { project_id: string } | undefined)?.project_id ?? null;
  }

  async function threadAccess(
    client: CollaborationDbClient,
    thread: Thread,
    context: TenantContext,
  ): Promise<boolean> {
    const projectId = await runProject(client, thread.runId);
    if (projectId === null || !context.projectGrants.includes(projectId)) return false;
    if (context.role === 'owner' || context.role === 'admin' || context.role === 'member') return true;
    if (context.role === 'viewer' && thread.audience === 'reviewer') return true;
    const share = await client.query(
      'SELECT id FROM shares WHERE thread_id = $1 AND shared_with = $2 AND revoked_at IS NULL',
      [thread.threadId, context.userId],
    );
    return share.rows.length > 0;
  }

  async function requireThread(client: CollaborationDbClient, threadId: string): Promise<Thread> {
    const found = await client.query('SELECT * FROM threads WHERE id = $1', [threadId]);
    if (found.rows.length === 0) {
      throw new ChangeProofError('Thread is unknown or not shared with you.');
    }
    return parseThread(found.rows[0]);
  }

  async function requireAccess(client: CollaborationDbClient, thread: Thread, context: TenantContext): Promise<void> {
    if (!(await threadAccess(client, thread, context))) {
      throw new ChangeProofError('Thread is unknown or not shared with you.');
    }
  }

  return {
    async createThread(actor, input) {
      const context = await derive(actor);
      const runId = IdSchema.parse(input.runId);
      const candidateDigest = Sha256Schema.parse(input.candidateDigest);
      const audience = ThreadAudienceSchema.parse(input.audience);
      const nowIso = InstantSchema.parse(actor.nowIso);
      return inTenant(context.tenantId, async (client) => {
        const projectId = await runProject(client, runId);
        if (projectId === null || !context.projectGrants.includes(projectId)) {
          throw new ChangeProofError('Run is unknown or not shared with you.');
        }
        if (context.role === 'viewer') {
          throw new ChangeProofError('Viewers may discuss reviewer threads but not open new ones.');
        }
        const thread = ThreadSchema.parse({
          schemaVersion: '1',
          threadId: randomId('thread'),
          tenantId: context.tenantId,
          runId,
          candidateDigest,
          ...(input.artifactRef === undefined ? {} : { artifactRef: input.artifactRef }),
          ...(input.diffLocation === undefined ? {} : { diffLocation: input.diffLocation }),
          audience,
          status: 'open' as const,
          audienceHistory: [],
          createdAt: nowIso,
        });
        await client.query(
          'INSERT INTO threads (id, tenant_id, run_id, created_by, candidate_digest, artifact_ref, diff_location, audience, status, audience_history, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
          [
            thread.threadId,
            thread.tenantId,
            thread.runId,
            context.userId,
            thread.candidateDigest,
            thread.artifactRef ?? null,
            thread.diffLocation ?? null,
            thread.audience,
            thread.status,
            JSON.stringify(thread.audienceHistory),
            thread.createdAt,
          ],
        );
        return thread;
      });
    },

    async listThreads(actor, input) {
      const context = await derive(actor);
      const runId = IdSchema.parse(input.runId);
      return inTenant(context.tenantId, async (client) => {
        const projectId = await runProject(client, runId);
        if (projectId === null || !context.projectGrants.includes(projectId)) {
          throw new ChangeProofError('Run is unknown or not shared with you.');
        }
        const rows = await client.query('SELECT * FROM threads WHERE run_id = $1 ORDER BY created_at ASC, id ASC', [
          runId,
        ]);
        const threads: Thread[] = [];
        for (const row of rows.rows) {
          const thread = parseThread(row);
          if (await threadAccess(client, thread, context)) threads.push(thread);
        }
        return { threads };
      });
    },

    async postComment(actor, input) {
      const context = await derive(actor);
      const threadId = IdSchema.parse(input.threadId);
      const body = CommentBodySchema.parse(input.body);
      const nowIso = InstantSchema.parse(actor.nowIso);
      const posted = await inTenant(context.tenantId, async (client) => {
        const thread = await requireThread(client, threadId);
        await requireAccess(client, thread, context);
        if (thread.status !== 'open') {
          throw new ChangeProofError('Thread is resolved; open a new thread to continue.');
        }
        const comment = CommentSchema.parse({
          schemaVersion: '1',
          commentId: randomId('comment'),
          threadId,
          tenantId: context.tenantId,
          authorId: context.userId,
          body,
          version: 1,
          outdated: false,
          createdAt: nowIso,
        });
        await client.query(
          'INSERT INTO comments (id, thread_id, tenant_id, author_id, body, version, outdated, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            comment.commentId,
            comment.threadId,
            comment.tenantId,
            comment.authorId,
            comment.body,
            comment.version,
            comment.outdated,
            comment.createdAt,
          ],
        );
        return { comment, thread };
      });
      const mentioned = new Set<string>();
      for (const match of posted.comment.body.matchAll(MENTION_PATTERN)) {
        const raw = match[1];
        if (raw === undefined) continue;
        const userId = raw.replace(/[.,!?;:]+$/, '');
        if (userId.length > 0 && userId !== context.userId) mentioned.add(userId);
        if (mentioned.size >= 10) break;
      }
      for (const userId of mentioned) {
        const hasAccess = await inTenant(context.tenantId, async (client) => {
          const member = await client.query('SELECT role FROM memberships WHERE user_id = $1', [userId]);
          const role = (member.rows[0] as { role: string } | undefined)?.role;
          if (role === undefined || role === 'operator') return false;
          if (role === 'owner' || role === 'admin' || role === 'member') {
            const projectId = await runProject(client, posted.thread.runId);
            return projectId !== null;
          }
          if (posted.thread.audience === 'reviewer') return true;
          const share = await client.query(
            'SELECT id FROM shares WHERE thread_id = $1 AND shared_with = $2 AND revoked_at IS NULL',
            [posted.thread.threadId, userId],
          );
          return share.rows.length > 0;
        });
        if (!hasAccess) continue;
        await deps.mentions.notifyMention({
          tenantId: context.tenantId,
          eventId: `mention:${posted.comment.commentId}:${userId}`,
          userId,
          threadId: posted.thread.threadId,
          runId: posted.thread.runId,
          mentionedBy: context.userId,
          nowIso,
        });
      }
      return posted.comment;
    },

    async editComment(actor, input) {
      const context = await derive(actor);
      const commentId = IdSchema.parse(input.commentId);
      const body = CommentBodySchema.parse(input.body);
      const nowIso = InstantSchema.parse(actor.nowIso);
      return inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM comments WHERE id = $1 FOR UPDATE', [commentId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Comment is unknown or not shared with you.');
        }
        const current = parseComment(found.rows[0]);
        if (current.authorId !== context.userId) {
          throw new ChangeProofError('Only the author may edit this comment.');
        }
        const thread = await requireThread(client, current.threadId);
        await requireAccess(client, thread, context);
        await client.query('INSERT INTO comment_history (comment_id, version, body, edited_at) VALUES ($1, $2, $3, $4)', [
          commentId,
          current.version,
          current.body,
          nowIso,
        ]);
        await client.query('UPDATE comments SET body = $2, version = version + 1, edited_at = $3 WHERE id = $1', [
          commentId,
          body,
          nowIso,
        ]);
        const updated = await client.query('SELECT * FROM comments WHERE id = $1', [commentId]);
        return parseComment(updated.rows[0]);
      });
    },

    async listComments(actor, input) {
      const context = await derive(actor);
      const threadId = IdSchema.parse(input.threadId);
      return inTenant(context.tenantId, async (client) => {
        const thread = await requireThread(client, threadId);
        await requireAccess(client, thread, context);
        const rows = await client.query(
          'SELECT * FROM comments WHERE thread_id = $1 ORDER BY created_at ASC, id ASC',
          [threadId],
        );
        return { comments: rows.rows.map((row) => parseComment(row)) };
      });
    },

    async commentHistory(actor, input) {
      const context = await derive(actor);
      const commentId = IdSchema.parse(input.commentId);
      return inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM comments WHERE id = $1', [commentId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Comment is unknown or not shared with you.');
        }
        const current = parseComment(found.rows[0]);
        const thread = await requireThread(client, current.threadId);
        await requireAccess(client, thread, context);
        const rows = await client.query(
          'SELECT version, body, edited_at FROM comment_history WHERE comment_id = $1 ORDER BY version ASC',
          [commentId],
        );
        const versions = rows.rows.map((row) => {
          const parsed = z.object({ version: z.number(), body: z.string(), edited_at: z.date() }).parse(row);
          return { version: parsed.version, body: parsed.body, editedAt: parsed.edited_at.toISOString() };
        });
        return { versions };
      });
    },

    async resolveThread(actor, input) {
      const context = await derive(actor);
      const threadId = IdSchema.parse(input.threadId);
      return inTenant(context.tenantId, async (client) => {
        const thread = await requireThread(client, threadId);
        await requireAccess(client, thread, context);
        if (context.role !== 'owner' && context.role !== 'admin' && context.role !== 'member') {
          throw new ChangeProofError('Only the team may resolve a thread.');
        }
        await client.query("UPDATE threads SET status = 'resolved' WHERE id = $1", [threadId]);
        const updated = await client.query('SELECT * FROM threads WHERE id = $1', [threadId]);
        return parseThread(updated.rows[0]);
      });
    },

    async changeAudience(actor, input) {
      const context = await derive(actor);
      if (context.role !== 'owner' && context.role !== 'admin') {
        throw new ChangeProofError('Only owners and admins may change thread audience.');
      }
      const threadId = IdSchema.parse(input.threadId);
      const audience = ThreadAudienceSchema.parse(input.audience);
      const nowIso = InstantSchema.parse(actor.nowIso);
      return inTenant(context.tenantId, async (client) => {
        const thread = await requireThread(client, threadId);
        await requireAccess(client, thread, context);
        if (thread.audience === audience) return thread;
        const history = [
          ...thread.audienceHistory,
          { from: thread.audience, to: audience, by: context.userId, at: nowIso },
        ];
        await client.query('UPDATE threads SET audience = $2, audience_history = $3 WHERE id = $1', [
          threadId,
          audience,
          JSON.stringify(history),
        ]);
        if (audience === 'internal') {
          await client.query('UPDATE shares SET revoked_at = $2 WHERE thread_id = $1 AND revoked_at IS NULL', [
            threadId,
            nowIso,
          ]);
        }
        const updated = await client.query('SELECT * FROM threads WHERE id = $1', [threadId]);
        return parseThread(updated.rows[0]);
      });
    },

    async shareThread(actor, input) {
      const context = await derive(actor);
      if (context.role !== 'owner' && context.role !== 'admin' && context.role !== 'member') {
        throw new ChangeProofError('Only the team may share a thread.');
      }
      const threadId = IdSchema.parse(input.threadId);
      const userId = IdSchema.parse(input.userId);
      const nowIso = InstantSchema.parse(actor.nowIso);
      return inTenant(context.tenantId, async (client) => {
        const thread = await requireThread(client, threadId);
        await requireAccess(client, thread, context);
        const member = await client.query('SELECT role FROM memberships WHERE user_id = $1', [userId]);
        const role = (member.rows[0] as { role: string } | undefined)?.role;
        if (role === undefined || role === 'operator') {
          throw new ChangeProofError('Threads share only with tenant members and viewers.');
        }
        const existing = await client.query(
          'SELECT * FROM shares WHERE thread_id = $1 AND shared_with = $2',
          [threadId, userId],
        );
        if (existing.rows.length > 0) {
          await client.query(
            'UPDATE shares SET revoked_at = NULL, granted_by = $3 WHERE thread_id = $1 AND shared_with = $2 RETURNING *',
            [threadId, userId, context.userId],
          );
          const refreshed = await client.query('SELECT * FROM shares WHERE thread_id = $1 AND shared_with = $2', [
            threadId,
            userId,
          ]);
          return parseShare(refreshed.rows[0]);
        }
        const share = ShareRecordSchema.parse({
          schemaVersion: '1',
          shareId: randomId('share'),
          threadId,
          tenantId: context.tenantId,
          sharedWith: userId,
          grantedBy: context.userId,
          createdAt: nowIso,
        });
        await client.query(
          'INSERT INTO shares (id, thread_id, tenant_id, shared_with, granted_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [share.shareId, share.threadId, share.tenantId, share.sharedWith, share.grantedBy, share.createdAt],
        );
        return share;
      });
    },

    async revokeShare(actor, input) {
      const context = await derive(actor);
      const shareId = IdSchema.parse(input.shareId);
      const nowIso = InstantSchema.parse(actor.nowIso);
      await inTenant(context.tenantId, async (client) => {
        const found = await client.query('SELECT * FROM shares WHERE id = $1', [shareId]);
        if (found.rows.length === 0) {
          throw new ChangeProofError('Share is unknown.');
        }
        const share = parseShare(found.rows[0]);
        if (context.role !== 'owner' && context.role !== 'admin' && share.grantedBy !== context.userId) {
          throw new ChangeProofError('Only owners, admins, or the granter may revoke this share.');
        }
        await client.query('UPDATE shares SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [
          shareId,
          nowIso,
        ]);
      });
    },

    async recordCandidateRevision(input) {
      const tenantId = IdSchema.parse(input.tenantId);
      const runId = IdSchema.parse(input.runId);
      const candidateDigest = Sha256Schema.parse(input.candidateDigest);
      InstantSchema.parse(input.nowIso);
      return inTenant(tenantId, async (client) => {
        const marked = await client.query(
          'UPDATE comments SET outdated = TRUE WHERE outdated = FALSE AND thread_id IN (SELECT id FROM threads WHERE run_id = $1 AND candidate_digest <> $2)',
          [runId, candidateDigest],
        );
        return { outdated: marked.rowCount ?? 0 };
      });
    },
  };
}
