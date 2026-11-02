import { readFileSync } from 'node:fs';

import {
  ChangeProofError,
  PublicSiteManifestSchema,
  type PublicFaq,
  type PublicRoute,
  type PublicSiteManifest,
  type SampleReport,
} from '../../core/index.js';

/**
 * Public website content (WP3-27, FR3-37).
 *
 * Serves the guest-readable site manifest: routes, FAQs, templates, sample
 * reports, changelog, roadmap, and pricing. The manifest schema is closed, and
 * every accessor re-checks its output with `assertPublicSafe`, so tenant data
 * can never leak into public content even if a caller smuggles it past the
 * schema (NEG3-21). Templates are readable by guests but apply only after
 * login; the actual apply is the authenticated WP3-25 API.
 */

export class PublicContentNotFoundError extends ChangeProofError {
  constructor(message: string) {
    super(message);
    this.name = 'PublicContentNotFoundError';
  }
}

export class PublicBoundaryError extends ChangeProofError {
  readonly key: string;

  constructor(key: string) {
    super(
      `Outgoing public content carries the forbidden key "${key}"; ` +
        'tenant, grant, and secret fields must never reach guests (NEG3-21).',
    );
    this.name = 'PublicBoundaryError';
    this.key = key;
  }
}

const FORBIDDEN_KEYS = new Set([
  'tenant',
  'tenantid',
  'org',
  'orgid',
  'organization',
  'organizationid',
  'repo',
  'repoid',
  'repository',
  'repofullname',
  'email',
  'emailaddress',
  'token',
  'accesstoken',
  'refreshtoken',
  'apitoken',
  'secret',
  'secretref',
  'credential',
  'password',
  'grant',
  'grants',
  'session',
  'sessionid',
  'apikey',
]);

/** Walk an outgoing DTO and refuse any tenant/grant/secret-shaped key. */
export function assertPublicSafe(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertPublicSafe(entry);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new PublicBoundaryError(key);
    }
    assertPublicSafe(entry);
  }
}

/** Validate raw input through the closed manifest schema. */
export function loadPublicSiteManifest(raw: unknown): PublicSiteManifest {
  const manifest = PublicSiteManifestSchema.parse(raw);
  assertPublicSafe(manifest);
  return manifest;
}

/** Load and validate the versioned manifest file. Missing file fails closed. */
export function loadManifestFile(path: string): PublicSiteManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new ChangeProofError(
      `Public manifest at "${path}" is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return loadPublicSiteManifest(raw);
}

export function listRoutes(manifest: PublicSiteManifest): readonly PublicRoute[] {
  const routes = PublicSiteManifestSchema.parse(manifest).routes;
  assertPublicSafe(routes);
  return routes;
}

export function getRoute(manifest: PublicSiteManifest, path: string): PublicRoute {
  const routes = listRoutes(manifest);
  const route = routes.find((entry) => entry.path === path);
  if (route === undefined) {
    throw new PublicContentNotFoundError(`No public route for path "${path}".`);
  }
  return route;
}

export interface FaqSearchResult {
  readonly results: readonly (PublicFaq & { readonly score: number })[];
  readonly recovery: string;
}

function scoreFaq(faq: PublicFaq, terms: readonly string[]): number {
  const question = faq.question.toLowerCase();
  const answer = faq.answer.toLowerCase();
  const topics = faq.topics.join(' ').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (question.includes(term)) score += 3;
    if (topics.includes(term)) score += 2;
    if (answer.includes(term)) score += 1;
  }
  return score;
}

/** Deterministic FAQ search: question > topics > answer, ties broken by id. */
export function searchFaq(manifest: PublicSiteManifest, query: string): FaqSearchResult {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
  if (terms.length === 0) {
    throw new ChangeProofError('Refusing an empty query; guests narrow with words, not a full index dump.');
  }
  const faqs = PublicSiteManifestSchema.parse(manifest).faqs;
  const ranked = faqs
    .map((faq) => ({ ...faq, score: scoreFaq(faq, terms) }))
    .filter((faq) => faq.score > 0)
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1))
    .slice(0, 10);
  assertPublicSafe(ranked);
  return {
    results: ranked,
    recovery:
      ranked.length === 0
        ? `No FAQ matches "${query}". Try fewer words, or browse the guides from the start page.`
        : '',
  };
}

export function getTemplate(manifest: PublicSiteManifest, id: string) {
  const templates = PublicSiteManifestSchema.parse(manifest).templates;
  const template = templates.find((entry) => entry.id === id);
  if (template === undefined) {
    throw new PublicContentNotFoundError(`No public template with id "${id}".`);
  }
  assertPublicSafe(template);
  return template;
}

export interface TemplateApplyGate {
  readonly applied: false;
  readonly requiresLogin: true;
  readonly loginThenReturnTo: string;
}

/**
 * Templates never apply for guests. The gate names the validated login
 * destination; the authenticated apply lives in the WP3-25 API.
 */
export function requestTemplateApply(manifest: PublicSiteManifest, id: string): TemplateApplyGate {
  const template = getTemplate(manifest, id);
  return {
    applied: false,
    requiresLogin: true,
    loginThenReturnTo: `/app/projects/new?template=${template.id}`,
  };
}

export function getSampleReport(manifest: PublicSiteManifest, id: string): SampleReport {
  const samples = PublicSiteManifestSchema.parse(manifest).samples;
  const sample = samples.find((entry) => entry.id === id);
  if (sample === undefined) {
    throw new PublicContentNotFoundError(`No public sample report with id "${id}".`);
  }
  assertPublicSafe(sample);
  return sample;
}

export function listDesignNotes(manifest: PublicSiteManifest) {
  return PublicSiteManifestSchema.parse(manifest).changelog.filter((entry) => entry.kind === 'design');
}

export function listReleases(manifest: PublicSiteManifest) {
  return PublicSiteManifestSchema.parse(manifest).changelog.filter((entry) => entry.kind === 'release');
}

/**
 * Every same-site CTA destination must resolve. `requires-login` destinations
 * must stay on the validated `/app` surface. Absolute URLs carry a scheme and
 * are crawled by the phase-7 external link check, not here.
 */
export function checkAllDestinations(manifest: PublicSiteManifest): readonly string[] {
  const routes = new Set(listRoutes(manifest).map((route) => route.path));
  const broken: string[] = [];
  for (const entry of listRoutes(manifest)) {
    for (const cta of entry.ctas) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cta.destination)) continue;
      if (cta.kind === 'requires-login') {
        if (cta.destination !== '/app' && !cta.destination.startsWith('/app/') && !cta.destination.startsWith('/app?')) {
          broken.push(cta.destination);
        }
        continue;
      }
      const path = cta.destination.split(/[?#]/)[0] ?? cta.destination;
      if (!routes.has(path)) broken.push(cta.destination);
    }
  }
  return [...new Set(broken)].sort();
}
