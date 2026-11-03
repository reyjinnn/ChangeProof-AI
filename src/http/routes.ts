import type { ServerResponse } from 'node:http';

import { z } from 'zod';

import type { PublicSiteManifest } from '../core/index.js';
import type { PublicSiteComposition } from '../orchestrator/index.js';
import { sendFail, sendOk } from './respond.js';

/**
 * API route table (T-42: public content; T-44/45 add auth + lifecycle).
 * Handlers take validated input only; unknown endpoints 404 as JSON.
 */

export interface ApiContext {
  readonly publicSite: PublicSiteComposition;
  readonly manifest: PublicSiteManifest;
}

const IdParamSchema = z.string().min(1).max(200);

function segment(pathname: string, index: number): string | undefined {
  return pathname.split('/')[index];
}

export function handleApi(ctx: ApiContext, response: ServerResponse, method: string, url: URL): void {
  const { pathname } = url;
  const { publicSite, manifest } = ctx;

  if (method === 'GET' && pathname === '/api/site/routes') {
    const only = url.searchParams.get('path');
    const data = only === null ? publicSite.listRoutes(manifest) : publicSite.getRoute(manifest, only);
    publicSite.assertPublicSafe(data);
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname === '/api/site/faq') {
    const data = publicSite.searchFaq(manifest, url.searchParams.get('q') ?? '');
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname === '/api/site/changelog') {
    const data = { design: publicSite.listDesignNotes(manifest), releases: publicSite.listReleases(manifest) };
    publicSite.assertPublicSafe(data);
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname === '/api/site/roadmap') {
    const data = manifest.roadmap;
    publicSite.assertPublicSafe(data);
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname === '/api/site/pricing') {
    const data = manifest.pricing;
    publicSite.assertPublicSafe(data);
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname === '/api/site/templates') {
    const data = manifest.templates;
    publicSite.assertPublicSafe(data);
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname === '/api/site/samples') {
    const data = manifest.samples;
    publicSite.assertPublicSafe(data);
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname === '/api/site/faqs') {
    const data = manifest.faqs;
    publicSite.assertPublicSafe(data);
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname.startsWith('/api/site/templates/')) {
    const data = publicSite.getTemplate(manifest, IdParamSchema.parse(segment(pathname, 4)));
    sendOk(response, data);
    return;
  }
  if (method === 'GET' && pathname.startsWith('/api/site/samples/')) {
    const data = publicSite.getSampleReport(manifest, IdParamSchema.parse(segment(pathname, 4)));
    sendOk(response, data);
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/site/templates/') && pathname.endsWith('/apply')) {
    // Guests never apply templates: the gate names the validated login
    // destination, and the real apply waits behind the T-44 session.
    const id = IdParamSchema.parse(segment(pathname, 4));
    const gate = publicSite.requestTemplateApply(manifest, id);
    sendFail(response, 401, 'login_required', 'Login is required before a template can be applied.', { gate });
    return;
  }
  sendFail(response, 404, 'unknown_endpoint', `No API endpoint at "${pathname}".`);
}
