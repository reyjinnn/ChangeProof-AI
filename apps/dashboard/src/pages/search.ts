/* Global search palette (T-47, WP3-29). Ctrl/Cmd+K opens a modal over
 * the real grant-scoped search; results link runs, projects, and audit
 * events. Counts and snippets arrive post-grant-filter from the server —
 * the palette caches nothing between opens. */

import { apiPost, ApiRequestError } from '../api.js';
import { emptyState, h, modal } from '../components.js';

const SEARCH_LIMIT = 10;

interface SearchHit {
  readonly kind: 'project' | 'run' | 'audit-event';
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
}

interface SearchResult {
  readonly hits: readonly SearchHit[];
  readonly totalCount: number;
}

function hitHref(hit: SearchHit): string {
  if (hit.kind === 'run') return `#/run?id=${encodeURIComponent(hit.id)}`;
  if (hit.kind === 'audit-event') {
    const runId = hit.id.split(':')[0] ?? '';
    return `#/run?id=${encodeURIComponent(runId)}`;
  }
  return '#/runs';
}

function hitLabel(hit: SearchHit): string {
  if (hit.kind === 'run') return 'Open run';
  if (hit.kind === 'audit-event') return 'Open run event';
  return 'Open runs';
}

export function openSearchPalette(trigger: HTMLElement): void {
  const query = h('input', { type: 'search', id: 'palette-q', autocomplete: 'off' });
  query.setAttribute('aria-label', 'Search text');
  const scope = h('select', { id: 'palette-scope' });
  for (const value of ['runs', 'projects', 'audit']) {
    const option = h('option', { value }, [value === 'audit' ? 'audit events' : value]);
    scope.appendChild(option);
  }
  const scopeLabel = h('label', { for: 'palette-scope' }, ['Scope']);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Search']);
  const form = h('form', { id: 'palette-form' }, [query, document.createTextNode(' '), scopeLabel, document.createTextNode(' '), scope, document.createTextNode(' '), submit]);
  const results = h('div', { id: 'palette-results', 'aria-live': 'polite' }, []);
  // Keep one palette: a second Ctrl+K while open focuses the input again.
  if (document.querySelector('#palette-form') !== null) {
    document.querySelector<HTMLInputElement>('#palette-q')?.focus();
    return;
  }
  modal(trigger, 'Search', h('div', {}, [form, results]));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    results.replaceChildren(emptyState('Searching…', 'Asking the service.'));
    const text = query.value.trim();
    void apiPost<SearchResult>(
      '/api/search',
      {
        schemaVersion: '1',
        scope: scope.value,
        ...(text === '' ? {} : { text }),
        limit: SEARCH_LIMIT,
      },
    )
      .then((found) => {
        if (found.hits.length === 0) {
          results.replaceChildren(emptyState('No matches', 'Nothing visible to you matches. Try other words or scope.'));
          return;
        }
        results.replaceChildren(
          h('p', {}, [`${String(found.totalCount)} match${found.totalCount === 1 ? '' : 'es'} — newest first.`]),
          h(
            'ul',
            {},
            found.hits.map((hit) =>
              h('li', {}, [
                h('p', {}, [h('a', { href: hitHref(hit) }, [`${hitLabel(hit)}: ${hit.title}`])]),
                h('p', { class: 'muted' }, [hit.snippet]),
              ]),
            ),
          ),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && error.failure.status === 401) {
          results.replaceChildren(
            h('div', {}, [
              h('p', {}, ['Log in to search.']),
              h('p', {}, [h('a', { class: 'button', href: '#/login' }, ['Log in'])]),
            ]),
          );
          return;
        }
        const message = error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
        results.replaceChildren(
          h('div', {}, [
            h('p', { class: 'error-text', role: 'alert' }, [message]),
            h('p', {}, ['Fix the problem, then search again — the form kept your words.']),
          ]),
        );
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
}
