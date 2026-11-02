/* Run discussions (T-48, WP3-30): threads pinned to a candidate digest
 * with comments, edit history, audience, and shares. Bodies render as
 * text through the shared builder; active markup is refused by the
 * server at write time and the refusal is shown, never retried
 * silently. Outdated flags come from worker-recorded candidate
 * revisions — the page displays them, it never computes them. */

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, emptyState, errorState, h } from '../components.js';
import { registerRoute, type RouteContext } from '../routes.js';

import { expired } from './support.js';

interface ThreadSession {
  readonly authenticated: boolean;
}

interface RunHeader {
  readonly runId: string;
  readonly submitDigest: string;
}

interface Thread {
  readonly threadId: string;
  readonly candidateDigest: string;
  readonly audience: string;
  readonly status: string;
  readonly createdAt: string;
}

interface Comment {
  readonly commentId: string;
  readonly authorId: string;
  readonly body: string;
  readonly version: number;
  readonly outdated: boolean;
  readonly createdAt: string;
}

interface HistoryVersion {
  readonly version: number;
  readonly body: string;
  readonly editedAt: string;
}

function asErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
}

function statusOf(error: unknown): number {
  return error instanceof ApiRequestError ? error.failure.status : 0;
}

async function renderThreads(outlet: HTMLElement, ctx: RouteContext): Promise<void> {
  const runId = ctx.params.get('run');
  if (runId === undefined || runId === '') {
    outlet.replaceChildren(
      errorState('Discussions need a run', 'Open discussions from a run, where threads live.', undefined),
    );
    outlet.appendChild(h('p', {}, [h('a', { class: 'button', href: '#/runs' }, ['Back to runs'])]));
    return;
  }
  outlet.replaceChildren(emptyState('Loading…', 'Reading the run discussions.'));
  try {
    const session = await apiGet<ThreadSession>('/api/auth/session');
    if (!session.authenticated) {
      outlet.replaceChildren(
        h('section', { class: 'card' }, [
          h('h1', {}, ['Discussions need a login']),
          h('p', {}, ['Log in to read and write run discussions.']),
          h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
        ]),
      );
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Discussions unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderThreads(outlet, ctx),
      }),
    );
    return;
  }

  let header: RunHeader;
  try {
    header = await apiGet<RunHeader>(`/api/runs/${encodeURIComponent(runId)}`);
  } catch (error) {
    if (statusOf(error) === 401) {
      expired(outlet);
      return;
    }
    outlet.replaceChildren(errorState('Run not found', asErrorMessage(error)));
    return;
  }

  const createNote = h('p', { 'aria-live': 'polite' }, []);
  const digest = h('input', { type: 'text', id: 'thread-digest', maxlength: '64', size: '66' });
  digest.setAttribute('aria-label', 'Candidate digest');
  (digest).value = header.submitDigest;
  const audience = h('select', { id: 'thread-audience' });
  audience.appendChild(h('option', { value: 'internal' }, ['internal']));
  audience.appendChild(h('option', { value: 'reviewer' }, ['reviewer']));
  const create = h('button', { id: 'thread-create', class: 'button primary', type: 'button' }, ['Start thread']);
  const threadList = h('div', {}, []);

  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, ['Discussions']),
      h('p', { class: 'muted' }, [
        `Run ${header.runId}. Threads pin to a candidate digest; comments never change verdicts — they discuss the work around them.`,
      ]),
      h('p', {}, [h('a', { href: `#/run?id=${encodeURIComponent(header.runId)}` }, ['Back to the run'])]),
    ]),
    h('section', { class: 'card' }, [h('h2', {}, ['Threads']), createNote, threadList]),
    h('section', { class: 'card' }, [
      h('h2', {}, ['Start a thread']),
      h('p', {}, [h('label', { for: 'thread-digest' }, ['Candidate digest']), document.createTextNode(' '), digest]),
      h('p', { class: 'muted' }, ['Prefilled with this run submission digest.']),
      h('p', {}, [h('label', { for: 'thread-audience' }, ['Audience']), document.createTextNode(' '), audience]),
      h('p', {}, [create]),
    ]),
  );

  const renderComments = async (threadId: string, host: HTMLElement, note: HTMLElement): Promise<void> => {
    try {
      const listed = await apiGet<{ comments: readonly Comment[] }>(
        `/api/threads/${encodeURIComponent(threadId)}/comments`,
      );
      if (listed.comments.length === 0) {
        host.replaceChildren(emptyState('No comments', 'Write the first one below.'));
        return;
      }
      host.replaceChildren(
        ...listed.comments.map((item) => {
          const historyHost = h('div', {}, []);
          const historyButton = h('button', { class: 'button', type: 'button', 'data-history': item.commentId }, [
            `History (v${String(item.version)})`,
          ]);
          historyButton.addEventListener('click', () => {
            void apiGet<{ versions: readonly HistoryVersion[] }>(
              `/api/comments/${encodeURIComponent(item.commentId)}/history`,
            )
              .then((found) => {
                if (found.versions.length === 0) {
                  historyHost.replaceChildren(h('p', { class: 'muted' }, ['No earlier versions.']));
                  return;
                }
                historyHost.replaceChildren(
                  h(
                    'ol',
                    {},
                    found.versions.map((version) =>
                      h('li', {}, [`v${String(version.version)} · ${version.editedAt} — ${version.body}`]),
                    ),
                  ),
                );
              })
              .catch((error: unknown) => {
                if (statusOf(error) === 401) {
                  expired(outlet);
                  return;
                }
                historyHost.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
              });
          });
          const editBox = h('textarea', { rows: '2', maxlength: '4000' });
          editBox.setAttribute('aria-label', `Edit comment ${item.commentId}`);
          (editBox).value = item.body;
          const editSave = h('button', { class: 'button', type: 'button', 'data-edit': item.commentId }, ['Save edit']);
          editSave.addEventListener('click', () => {
            void apiPost(`/api/comments/${encodeURIComponent(item.commentId)}/edit`, {
              body: (editBox).value,
            })
              .then(() => renderComments(threadId, host, note))
              .catch((error: unknown) => {
                if (statusOf(error) === 401) {
                  expired(outlet);
                  return;
                }
                note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
              });
          });
          return h('article', { class: 'faq-item', 'data-comment': item.commentId }, [
            h('h4', {}, [
              ...(item.outdated ? [badge('warn', 'outdated'), document.createTextNode(' ')] : []),
              document.createTextNode(`${item.commentId} · by ${item.authorId} · v${String(item.version)} · ${item.createdAt}`),
            ]),
            h('p', {}, [item.body]),
            historyHost,
            h('p', {}, [historyButton]),
            h('p', {}, [editBox]),
            h('p', {}, [editSave]),
          ]);
        }),
      );
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      host.replaceChildren(
        errorState('Comments unavailable', asErrorMessage(error), {
          label: 'Retry',
          onClick: () => void renderComments(threadId, host, note),
        }),
      );
    }
  };

  const renderThread = (thread: Thread): HTMLElement => {
    const note = h('p', { 'aria-live': 'polite' }, []);
    const comments = h('div', {}, []);
    const postBox = h('textarea', { rows: '2', maxlength: '4000', 'data-post': thread.threadId });
    postBox.setAttribute('aria-label', `Comment on ${thread.threadId}`);
    const send = h('button', { class: 'button', type: 'button', 'data-send': thread.threadId }, ['Post comment']);
    send.addEventListener('click', () => {
      const body = (postBox).value.trim();
      if (body === '') {
        note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Write the comment first.']));
        return;
      }
      void apiPost<{ commentId: string }>(`/api/threads/${encodeURIComponent(thread.threadId)}/comments`, { body })
        .then((posted) => {
          note.replaceChildren(document.createTextNode(`Comment ${posted.commentId} posted.`));
          (postBox).value = '';
          return renderComments(thread.threadId, comments, note);
        })
        .catch((error: unknown) => {
          if (statusOf(error) === 401) {
            expired(outlet);
            return;
          }
          note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        });
    });
    const resolve = h('button', { class: 'button', type: 'button', 'data-resolve': thread.threadId }, ['Resolve thread']);
    resolve.addEventListener('click', () => {
      void apiPost(`/api/threads/${encodeURIComponent(thread.threadId)}/resolve`, {})
        .then(() => refreshThreads())
        .catch((error: unknown) => {
          if (statusOf(error) === 401) {
            expired(outlet);
            return;
          }
          note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        });
    });
    const audiencePick = h('select', { [`data-audience-pick`]: thread.threadId });
    audiencePick.setAttribute('aria-label', `Audience for ${thread.threadId}`);
    audiencePick.appendChild(h('option', { value: 'internal' }, ['internal']));
    audiencePick.appendChild(h('option', { value: 'reviewer' }, ['reviewer']));
    (audiencePick).value = thread.audience;
    const audienceSave = h('button', { class: 'button', type: 'button', 'data-audience': thread.threadId }, ['Set audience']);
    audienceSave.addEventListener('click', () => {
      void apiPost(`/api/threads/${encodeURIComponent(thread.threadId)}/audience`, {
        audience: (audiencePick).value,
      })
        .then(() => refreshThreads())
        .catch((error: unknown) => {
          if (statusOf(error) === 401) {
            expired(outlet);
            return;
          }
          note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        });
    });
    const shareField = h('input', { type: 'text', [`data-share-field`]: thread.threadId, maxlength: '120' });
    shareField.setAttribute('aria-label', `User id to share ${thread.threadId} with`);
    shareField.setAttribute('placeholder', 'user-…');
    const shareSave = h('button', { class: 'button', type: 'button', 'data-share': thread.threadId }, ['Share']);
    shareSave.addEventListener('click', () => {
      const userId = (shareField).value.trim();
      if (userId === '') {
        note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Type the user id first.']));
        return;
      }
      void apiPost<{ shareId: string }>(`/api/threads/${encodeURIComponent(thread.threadId)}/share`, { userId })
        .then((shared) => {
          note.replaceChildren(document.createTextNode(`Share ${shared.shareId} granted to ${userId}.`));
        })
        .catch((error: unknown) => {
          if (statusOf(error) === 401) {
            expired(outlet);
            return;
          }
          note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        });
    });
    const revokeField = h('input', { type: 'text', [`data-revoke-field`]: thread.threadId, maxlength: '120' });
    revokeField.setAttribute('aria-label', `Share id to revoke on ${thread.threadId}`);
    revokeField.setAttribute('placeholder', 'share-…');
    const revokeSave = h('button', { class: 'button', type: 'button', 'data-revoke': thread.threadId }, ['Revoke share']);
    revokeSave.addEventListener('click', () => {
      const shareId = (revokeField).value.trim();
      if (shareId === '') {
        note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, ['Paste the share id first.']));
        return;
      }
      void apiPost(`/api/threads/shares/${encodeURIComponent(shareId)}/revoke`, {})
        .then(() => {
          note.replaceChildren(document.createTextNode(`Share ${shareId} revoked.`));
        })
        .catch((error: unknown) => {
          if (statusOf(error) === 401) {
            expired(outlet);
            return;
          }
          note.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
        });
    });
    void renderComments(thread.threadId, comments, note);
    return h('article', { class: 'faq-item' }, [
      h('h3', {}, [
        badge(thread.status === 'resolved' ? 'ok' : 'info', thread.status),
        document.createTextNode(` ${thread.threadId} · ${thread.audience} · ${thread.createdAt}`),
      ]),
      h('p', { class: 'muted' }, ['Candidate ', h('code', { class: 'inline' }, [thread.candidateDigest])]),
      note,
      comments,
      h('p', {}, [postBox]),
      h('p', {}, [send]),
      h('p', {}, [resolve, document.createTextNode(' '), audiencePick, document.createTextNode(' '), audienceSave]),
      h('p', {}, [shareField, document.createTextNode(' '), shareSave]),
      h('p', {}, [revokeField, document.createTextNode(' '), revokeSave]),
    ]);
  };

  const refreshThreads = async (): Promise<void> => {
    try {
      const listed = await apiGet<{ threads: readonly Thread[] }>(`/api/threads?runId=${encodeURIComponent(runId)}`);
      if (listed.threads.length === 0) {
        threadList.replaceChildren(emptyState('No threads', 'Start the first one below.'));
        return;
      }
      threadList.replaceChildren(...listed.threads.map((thread) => renderThread(thread)));
    } catch (error) {
      if (statusOf(error) === 401) {
        expired(outlet);
        return;
      }
      threadList.replaceChildren(
        errorState('Threads unavailable', asErrorMessage(error), {
          label: 'Retry',
          onClick: () => void refreshThreads(),
        }),
      );
    }
  };

  create.addEventListener('click', () => {
    const candidateDigest = (digest).value.trim();
    if (!/^[0-9a-f]{64}$/.test(candidateDigest)) {
      createNote.replaceChildren(
        h('span', { class: 'error-text', role: 'alert' }, ['Candidate digest must be 64 lowercase hex chars.']),
      );
      return;
    }
    (create).disabled = true;
    void apiPost<Thread>('/api/threads', {
      runId,
      candidateDigest,
      audience: (audience).value,
    })
      .then((created) => {
        createNote.replaceChildren(document.createTextNode(`Thread ${created.threadId} started.`));
        return refreshThreads();
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 401) {
          expired(outlet);
          return;
        }
        createNote.replaceChildren(h('span', { class: 'error-text', role: 'alert' }, [asErrorMessage(error)]));
      })
      .finally(() => {
        (create).disabled = false;
      });
  });

  await refreshThreads();
}

export function registerThreadPages(): void {
  registerRoute({ path: '/threads', title: 'Discussions', render: renderThreads });
}
