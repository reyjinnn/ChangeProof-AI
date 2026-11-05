import './tokens.css';
import './workspace-refinement.css';
import './auth-refinement.css';

import type { PublicRoute, PublicTemplate, SampleReport } from '../../../src/core/contracts/schemas/publicsite.js';

import { apiGet } from './api.js';
import { emptyState } from './components.js';
import { registerAuthPages } from './pages/auth.js';
import { registerBillingPages } from './pages/billing.js';
import { registerEnterprisePages } from './pages/enterprise.js';
import { registerEvidencePages } from './pages/evidence.js';
import { registerNotificationPages } from './pages/notifications.js';
import { registerOperatorPages } from './pages/operator.js';
import { registerSupportPages } from './pages/support.js';
import { registerThreadPages } from './pages/threads.js';
import { registerPublicPages } from './pages/public.js';
import { registerRunPages } from './pages/runs.js';
import { registerWorkspacePages } from './pages/workspace.js';
import { registerSettingsPage } from './pages/settings.js';
import { renderRoute, registerRoute } from './routes.js';
import { refreshAccount, SESSION_CHANGED_EVENT } from './session.js';
import { renderShell } from './shell.js';
import { renderStatus } from './status.js';

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (app === null) throw new Error('Dashboard root #app is missing; refusing to boot into nothing.');
  app.replaceChildren(emptyState('Opening ChangeProof…', 'Loading the published navigation.'));

  registerRoute({
    path: '/',
    title: 'Workspace overview',
    navLabel: 'Overview',
    navSection: 'workspace',
    render: (outlet) => renderStatus(outlet),
  });
  registerRoute({ path: '/service-status', title: 'Service status', render: outlet => renderStatus(outlet) });

  // Public navigation follows the live manifest; an unreachable API still
  // boots the shell with the status route, which reports the outage itself.
  registerPublicPages([], [], []);
  try {
    const [routes, templates, samples] = await Promise.all([
      apiGet<readonly PublicRoute[]>('/api/site/routes'),
      apiGet<readonly PublicTemplate[]>('/api/site/templates'),
      apiGet<readonly SampleReport[]>('/api/site/samples'),
    ]);
    registerPublicPages(
      routes,
      templates.map((template) => template.id),
      samples.map((sample) => sample.id),
    );
  } catch {
    // Status route stays; its own fetch names the outage with a retry.
  }

  registerAuthPages();
  registerSettingsPage();

  registerRunPages();
  registerWorkspacePages();
  registerBillingPages();
  registerEnterprisePages();
  registerEvidencePages();
  registerNotificationPages();
  registerSupportPages();
  registerOperatorPages();
  registerThreadPages();

  const { outlet } = renderShell(app);
  await refreshAccount();
  window.addEventListener('hashchange', () => void renderRoute(outlet, window.location.hash));
  window.addEventListener(SESSION_CHANGED_EVENT, () => {
    // The account refresh is async; if the user navigates meanwhile, the
    // stale completion must not re-render (and re-fire) the new route.
    const atDispatch = window.location.hash;
    void (async () => {
      await refreshAccount();
      if (window.location.hash !== atDispatch) return;
      await renderRoute(outlet, window.location.hash);
    })();
  });
  await renderRoute(outlet, window.location.hash);
}

void boot();
