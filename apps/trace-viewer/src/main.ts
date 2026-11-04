import '../../dashboard/src/tokens.css';

import { parseTraceBundle } from './bundle.js';
import { renderTrace, renderTraceError } from './view.js';

/**
 * Trace viewer entry. Read-only by construction: the only network call is a
 * GET of the bundle named by `?src=`, which must resolve same-origin.
 */

function resolveBundleUrl(raw: string | null): URL | null {
  if (raw === null || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  return url;
}

function usageCard(): HTMLElement {
  const root = document.createElement('div');
  renderTraceError(root, 'No trace selected', [
    'Pass ?src=/path/to/trace.json with a same-origin trace bundle URL.',
    'Example: trace-viewer.html?src=/api/evidence/trace?run=run_01',
  ]);
  const retry = root.querySelector('#trace-retry');
  retry?.remove();
  return root;
}

async function boot(): Promise<void> {
  document.body.classList.add('modern-design');
  const app = document.getElementById('app');
  if (app === null) throw new Error('Trace viewer root #app is missing; refusing to boot into nothing.');

  const params = new URLSearchParams(window.location.search);
  const url = resolveBundleUrl(params.get('src'));
  if (url === null) {
    if (params.get('src') === null) {
      app.replaceChildren(usageCard());
    } else {
      renderTraceError(app, 'Trace source rejected', [
        'The ?src= value must be a same-origin URL to a trace bundle.',
        'Cross-origin bundle URLs are rejected; the viewer makes no cross-origin requests.',
      ]);
    }
    return;
  }

  const loading = document.createElement('p');
  loading.className = 'help';
  loading.textContent = `Loading trace bundle from ${url.pathname}${url.search} …`;
  app.replaceChildren(loading);

  let payload: unknown;
  try {
    const response = await fetch(url.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      renderTraceError(app, 'Trace bundle unavailable', [
        `GET ${url.pathname}${url.search} returned HTTP ${String(response.status)}.`,
        'The evidence proxy may be down, the run may not exist, or access may have been revoked.',
      ]);
      return;
    }
    payload = (await response.json()) as unknown;
  } catch (error) {
    renderTraceError(app, 'Trace bundle unreachable', [
      error instanceof Error ? error.message : 'The bundle request failed.',
      'Check the connection and retry. No partial trace is shown.',
    ]);
    return;
  }

  const parsed = parseTraceBundle(payload);
  if (!parsed.ok) {
    renderTraceError(app, 'Trace bundle invalid', [
      `The bundle at ${url.pathname}${url.search} failed validation (${String(parsed.errors.length)} problem(s)).`,
      ...parsed.errors.slice(0, 12),
    ]);
    return;
  }
  renderTrace(app, parsed.bundle);
}

void boot();
