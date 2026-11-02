import { describe, expect, it } from 'vitest';

import {
  PublicSiteManifestSchema,
  type PublicSiteManifest,
} from '../../src/core/index.js';

/**
 * WP3-27 / T-27 — public content contracts (FR3-37).
 *
 * Written before the implementation. The public manifest is a closed,
 * versioned contract: every route/CTA, FAQ, template, sample, changelog entry,
 * roadmap item, and pricing snapshot validates here. Tenant-shaped fields are
 * rejected by the closed schema (NEG3-21, first layer); sample reports without
 * provenance and releases without a version are refused; design notes and
 * releases stay separate kinds.
 */

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1',
    contentVersion: '2026-11-02',
    routes: [
      {
        path: '/',
        title: 'ChangeProof AI',
        summary: 'Evidence for every software change.',
        section: 'product',
        ctas: [{ label: 'Read the guides', destination: '/guides', kind: 'public' }],
      },
      {
        path: '/guides',
        title: 'Guides',
        summary: 'How to run an evidence-backed repair.',
        section: 'docs',
        ctas: [{ label: 'Start a project', destination: '/app/projects/new', kind: 'requires-login' }],
      },
    ],
    faqs: [
      {
        id: 'what-is-changeproof',
        question: 'What does ChangeProof AI do?',
        answer: 'It investigates a reported failure, proposes a fix, and proves the fix against an independent check.',
        topics: ['basics'],
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
    roadmap: [
      { id: 'evidence-prs', title: 'Evidence-backed pull requests', status: 'planned' },
    ],
    pricing: {
      pricingVersion: 'free-only-draft-0',
      currency: 'USD',
      tiers: [{ id: 'free', name: 'Free', notes: 'Usage caps are not frozen yet.' }],
    },
    ...overrides,
  };
}

describe('public manifest contract', () => {
  it('accepts a complete manifest', () => {
    const parsed: PublicSiteManifest = PublicSiteManifestSchema.parse(manifest());

    expect(parsed.contentVersion).toBe('2026-11-02');
    expect(parsed.routes).toHaveLength(2);
  });

  it('rejects tenant-shaped fields anywhere in the manifest (NEG3-21)', () => {
    const poisoned = manifest({
      routes: [
        {
          path: '/',
          title: 'Leak',
          summary: 'Tenant data slipped into public content.',
          section: 'product',
          ctas: [],
          tenantId: 'tenant-a',
        },
      ],
    });

    expect(() => PublicSiteManifestSchema.parse(poisoned)).toThrow();
  });

  it('rejects a sample report without provenance', () => {
    const bare = { id: 'sample-x', title: 'Sample without provenance', summary: 'Must be refused.' };

    expect(() => PublicSiteManifestSchema.parse(manifest({ samples: [bare] }))).toThrow(/provenance/i);
  });

  it('rejects a non-synthetic sample (samples never claim real results)', () => {
    const samples = manifest()['samples'] as Record<string, unknown>[];
    const first = samples[0];
    if (first === undefined) throw new Error('Demo manifest lost its sample.');
    const provenance = { ...(first['provenance'] as Record<string, unknown>), synthetic: false };

    expect(() => PublicSiteManifestSchema.parse(manifest({ samples: [{ ...first, provenance }] }))).toThrow(
      /synthetic/i,
    );
  });

  it('requires a version on releases but not on design notes', () => {
    const release = { date: '2026-11-02', kind: 'release', title: 'Launch', body: 'First release.' };

    expect(() => PublicSiteManifestSchema.parse(manifest({ changelog: [release] }))).toThrow(/version/i);
    const versioned = PublicSiteManifestSchema.parse(
      manifest({ changelog: [{ ...release, version: '1.0.0' }] }),
    );
    expect(versioned.changelog[0]?.kind).toBe('release');
  });

  it('carries the pricing source version so prices are never guessed', () => {
    const parsed = PublicSiteManifestSchema.parse(manifest());

    expect(parsed.pricing.pricingVersion).toBe('free-only-draft-0');
    expect(parsed.pricing.tiers[0]?.notes).toMatch(/not frozen yet/i);
  });
});
