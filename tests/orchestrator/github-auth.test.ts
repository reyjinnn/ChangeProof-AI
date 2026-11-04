import { describe, expect, it } from 'vitest';

import { createMapSecretBroker } from '../../src/modules/github/index.js';
import { composeGitHubAuth } from '../../src/orchestrator/index.js';

/**
 * GitHub sign-in composition wiring.
 *
 * The composition root injects the database handle, the broker, the public
 * client config, and the transport without adding behavior. Invalid client
 * config fails fast at compose time — a half-wired OAuth client never
 * serves traffic. Behavior is proven with fakes in
 * `tests/github/oauth.test.ts` and over HTTP in
 * `tests/http/t50-github-auth.test.ts`.
 */
describe('composeGitHubAuth', () => {
  const db = { query: () => Promise.resolve({ rows: [], rowCount: 0 }) };
  const secrets = createMapSecretBroker(
    new Map([
      ['email-challenge-secret', 'compose-probe-secret-32-chars-min!'],
      ['github-client-secret', 'client-secret-value'],
    ]),
  );

  it('exposes the flow surface without wrapping it', () => {
    const composed = composeGitHubAuth({
      db,
      secrets,
      clientId: 'Iv1.probe',
      redirectUri: 'https://app.example.com/api/auth/github/callback',
      clientSecretRef: 'github-client-secret',
      stateSecretRef: 'email-challenge-secret',
    });
    expect(composed.config.clientId).toBe('Iv1.probe');
    expect(typeof composed.startFlow).toBe('function');
    expect(typeof composed.verifyFlow).toBe('function');
    expect(typeof composed.fetchProfile).toBe('function');
    expect(typeof composed.store.registerGitHubUser).toBe('function');
    expect(typeof composed.store.loginWithGitHub).toBe('function');
  });

  it('refuses half-wired config at compose time', () => {
    expect(() =>
      composeGitHubAuth({
        db,
        secrets,
        clientId: '',
        redirectUri: 'https://app.example.com/api/auth/github/callback',
        clientSecretRef: 'github-client-secret',
        stateSecretRef: 'email-challenge-secret',
      }),
    ).toThrow(/client id/i);
    expect(() =>
      composeGitHubAuth({
        db,
        secrets,
        clientId: 'Iv1.probe',
        redirectUri: 'http://app.example.com/api/auth/github/callback',
        clientSecretRef: 'github-client-secret',
        stateSecretRef: 'email-challenge-secret',
      }),
    ).toThrow(/https/);
  });
});
