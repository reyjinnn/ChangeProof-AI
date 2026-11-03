import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PublicSiteManifestSchema,
  type PublicSiteManifest,
} from '../../src/core/index.js';
import {
  assertPublicSafe,
  checkAllDestinations,
  getRoute,
  getSampleReport,
  getTemplate,
  listDesignNotes,
  listReleases,
  loadManifestFile,
  loadPublicSiteManifest,
  requestTemplateApply,
  searchFaq,
} from '../../src/modules/publicsite/index.js';

/**
 * WP3-27 / T-27 — public/private boundary and content behavior (FR3-37).
 *
 * Written before the implementation. The boundary has two layers: the closed
 * manifest schema (see manifest.test.ts) and `assertPublicSafe`, which refuses
 * any outgoing DTO carrying tenant-shaped keys, nested or top-level
 * (NEG3-21). Every CTA destination resolves; templates apply only after login;
 * FAQ search is deterministic with an explicit no-results recovery.
 */

function demo(): PublicSiteManifest {
  return PublicSiteManifestSchema.parse({
    schemaVersion: '1',
    contentVersion: '2026-11-02',
    routes: [
      {
        path: '/',
        title: 'ChangeProof AI',
        summary: 'Evidence for every software change.',
        section: 'product',
        ctas: [
          { label: 'Read the guides', destination: '/guides', kind: 'public' },
          { label: 'Open the workspace', destination: '/app', kind: 'requires-login' },
        ],
      },
      {
        path: '/guides',
        title: 'Guides',
        summary: 'How to run an evidence-backed repair.',
        section: 'docs',
        ctas: [{ label: 'Back to start', destination: '/', kind: 'public' }],
      },
    ],
    faqs: [
      {
        id: 'what-is-changeproof',
        question: 'What does ChangeProof AI do?',
        answer: 'It investigates a reported failure and proves each fix against an independent check.',
        topics: ['basics'],
        updatedAt: '2026-11-02',
      },
      {
        id: 'need-api-keys',
        question: 'Do I need to bring API keys?',
        answer: 'No. The hosted service runs the model and the checks; you connect a repository and review evidence.',
        topics: ['basics', 'onboarding'],
        updatedAt: '2026-11-02',
      },
    ],
    templates: [
      {
        id: 'bugfix-run',
        title: 'Bug fix run',
        description: 'Inputs, invariants, and budget for a single repair run.',
        requiresLogin: true,
        fields: [{ name: 'intent', label: 'What should change', help: 'One sentence the fix must preserve.' }],
      },
    ],
    samples: [
      {
        id: 'sample-order-recovery',
        title: 'Sample: order recovery report',
        summary: 'A synthetic report showing the evidence layout.',
        provenance: {
          datasetId: 'static-sample',
          datasetVersion: '1',
          capturedAt: '2026-11-02',
          synthetic: true,
          source: 'static-sample-dataset',
          label: 'SYNTHETIC SAMPLE, not a real customer result',
        },
      },
    ],
    changelog: [
      { date: '2026-11-02', kind: 'design', title: 'Public site draft', body: 'First public content draft.' },
    ],
    roadmap: [{ id: 'evidence-prs', title: 'Evidence-backed pull requests', status: 'planned' }],
    pricing: {
      pricingVersion: 'free-only-draft-0',
      currency: 'USD',
      tiers: [{ id: 'free', name: 'Free', notes: 'Usage caps are not frozen yet.' }],
    },
  });
}

describe('public/private boundary (NEG3-21)', () => {
  it('accepts clean outgoing content', () => {
    expect(() => { assertPublicSafe(demo().routes[0]); }).not.toThrow();
  });

  it('refuses a top-level tenant key in outgoing content', () => {
    expect(() => { assertPublicSafe({ title: 'Leak', tenantId: 'tenant-a' }); }).toThrow(/tenantId/i);
  });

  it('refuses nested tenant, grant, and secret keys', () => {
    expect(() => { assertPublicSafe({ page: { repo: { fullName: 'acme/app' } } }); }).toThrow(/repo/i);
    expect(() => { assertPublicSafe({ items: [{ grants: ['owner'] }] }); }).toThrow(/grants/i);
    expect(() => { assertPublicSafe({ config: { apiToken: 'shaped-like-a-secret' } }); }).toThrow(/apiToken/i);
    expect(() => { assertPublicSafe({ contact: { email: 'owner@example.com' } }); }).toThrow(/email/i);
  });

  it('publishes only boundary-checked content from every accessor', () => {
    const site = demo();

    for (const route of site.routes) {
      expect(() => getRoute(site, route.path)).not.toThrow();
    }
    expect(() => getSampleReport(site, 'sample-order-recovery')).not.toThrow();
    expect(() => getTemplate(site, 'bugfix-run')).not.toThrow();
  });
});

describe('routes and destinations', () => {
  it('returns the route for a known path and refuses unknown paths', () => {
    const site = demo();

    expect(getRoute(site, '/guides').title).toBe('Guides');
    expect(() => getRoute(site, '/no-such-page')).toThrow(/no public route/i);
  });

  it('reports zero broken destinations on the demo manifest', () => {
    expect(checkAllDestinations(demo())).toEqual([]);
  });

  it('catches a CTA pointing at a missing public route', () => {
    const site = demo();
    const broken = PublicSiteManifestSchema.parse({
      ...site,
      routes: [
        {
          path: '/',
          title: 'Broken',
          summary: 'A CTA to nowhere.',
          section: 'product',
          ctas: [{ label: 'Nowhere', destination: '/missing', kind: 'public' }],
        },
      ],
    });

    expect(checkAllDestinations(broken)).toEqual(['/missing']);
  });
});

describe('templates apply only after login', () => {
  it('serves the template publicly but marks apply as login-gated', () => {
    const site = demo();
    const template = getTemplate(site, 'bugfix-run');

    expect(template.requiresLogin).toBe(true);
    expect(requestTemplateApply(site, 'bugfix-run')).toEqual({
      applied: false,
      requiresLogin: true,
      loginThenReturnTo: '/app/projects/new?template=bugfix-run',
    });
  });
});

describe('FAQ search', () => {
  it('ranks title matches above body matches, deterministically', () => {
    const site = demo();
    const first = searchFaq(site, 'API keys');
    const second = searchFaq(site, 'API keys');

    expect(first).toEqual(second);
    expect(first.results[0]?.id).toBe('need-api-keys');
  });

  it('returns an explicit empty result with recovery for unknown queries', () => {
    const result = searchFaq(demo(), 'quantum billing');

    expect(result.results).toEqual([]);
    expect(result.recovery.length).toBeGreaterThan(0);
  });

  it('refuses an empty query instead of dumping the whole index', () => {
    expect(() => searchFaq(demo(), '   ')).toThrow(/empty query/i);
  });
});

describe('changelog and samples', () => {
  it('separates design notes from releases', () => {
    const site = demo();

    expect(listDesignNotes(site)).toHaveLength(1);
    expect(listReleases(site)).toHaveLength(0);
  });

  it('serves the sample with its synthetic provenance label', () => {
    const sample = getSampleReport(demo(), 'sample-order-recovery');

    expect(sample.provenance.synthetic).toBe(true);
    expect(sample.provenance.source).toBe('static-sample-dataset');
  });
});

describe('manifest loading', () => {
  it('validates raw input through the same closed schema', () => {
    const raw = JSON.parse(JSON.stringify(demo())) as unknown;

    expect(loadPublicSiteManifest(raw).contentVersion).toBe('2026-11-02');
    expect(() => loadPublicSiteManifest({})).toThrow();
  });
});

describe('shipped public content (config/publicsite/manifest.json)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = join(here, '..', '..', 'config', 'publicsite', 'manifest.json');

  it('covers all seventeen FR3-37 routes with resolving destinations', () => {
    const site = loadManifestFile(manifestPath);

    expect(site.routes.map((route) => route.path).sort()).toEqual(
      [
        '/',
        '/changelog',
        '/collaboration',
        '/evidence-overview',
        '/guides',
        '/help',
        '/impact-overview',
        '/integrations',
        '/pricing',
        '/privacy-policy',
        '/product',
        '/roadmap',
        '/sample-report',
        '/templates',
        '/terms',
        '/tutorials',
        '/verification',
      ].sort(),
    );
    expect(checkAllDestinations(site)).toEqual([]);
  });

  it('keeps samples synthetic, releases versioned, and pricing sourced', () => {
    const site = loadManifestFile(manifestPath);

    for (const sample of site.samples) {
      expect(sample.provenance.synthetic).toBe(true);
    }
    for (const release of listReleases(site)) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(site.pricing.pricingVersion.length).toBeGreaterThan(0);
    expect(getTemplate(site, 'bugfix-run').requiresLogin).toBe(true);
  });

  it('carries no em dashes in guest-readable copy', () => {
    const raw = readFileSync(manifestPath, 'utf8');

    expect(raw).not.toContain('—');
    expect(raw).not.toContain('–');
  });
});
