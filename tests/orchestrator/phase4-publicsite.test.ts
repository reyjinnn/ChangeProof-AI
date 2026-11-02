import { describe, expect, it } from 'vitest';

import { composePublicSite } from '../../src/orchestrator/index.js';

/**
 * WP3-27 / T-27 — orchestrator exposes the public-site API.
 *
 * The composition root wires the leaf module's public functions without
 * adding behavior; the module stays reachable (no orphans) and the dashboard
 * later consumes this surface over HTTP.
 */
describe('public site composition (WP3-27)', () => {
  it('exposes the public-site API without behavior of its own', () => {
    const site = composePublicSite();

    expect(typeof site.loadPublicSiteManifest).toBe('function');
    expect(typeof site.getRoute).toBe('function');
    expect(typeof site.searchFaq).toBe('function');
    expect(typeof site.getTemplate).toBe('function');
    expect(typeof site.requestTemplateApply).toBe('function');
    expect(typeof site.getSampleReport).toBe('function');
    expect(typeof site.checkAllDestinations).toBe('function');
    expect(typeof site.assertPublicSafe).toBe('function');
  });
});
