import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { MissingConfigurationError } from '../../src/core/index.js';
import { createMapSecretBroker } from '../../src/modules/github/index.js';
import { composeInstallationConnect } from '../../src/orchestrator/index.js';

/**
 * Installation connect composition (WP3-22).
 *
 * The composition root binds the broker key, the App id, and the network
 * seam. Octokit still runs for real here — only its fetch is faked — so a
 * wrong endpoint or mapping fails the test instead of the demo.
 */

function throwawayPrivatePem(): { privatePem: string; publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'] } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privatePem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), publicKey };
}

function fakeGitHub(seen: { exchangeAuth?: string; calls: string[] }): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    const href = url;
    seen.calls.push(href);
    const headers = new Headers({ 'content-type': 'application/json' });
    if (href.endsWith('/app/installations/178697398/access_tokens')) {
      const auth = (init?.headers as Record<string, string>)['Authorization'] ?? '';
      seen.exchangeAuth = auth;
      const body = JSON.stringify({ token: 'ghs-connect-token', expires_at: '2026-11-05T06:00:00Z' });
      return Promise.resolve({ status: 201, headers, url: href, text: () => Promise.resolve(body), json: () => Promise.resolve(JSON.parse(body)) });
    }
    if (href.includes('/installation/repositories')) {
      const body = JSON.stringify({
        repositories: [
          { id: 1438299201, full_name: 'reyjinnn/ChangeProof-AI', private: false },
          { id: 1, full_name: 'reyjinnn/pilot', private: true },
        ],
      });
      return Promise.resolve({ status: 200, headers, url: href, text: () => Promise.resolve(body), json: () => Promise.resolve(JSON.parse(body)) });
    }
    throw new Error(`unexpected request: ${href}`);
  }) as unknown as typeof fetch;
}

describe('composeInstallationConnect', () => {
  it('mints, exchanges, and lists verified repositories', async () => {
    const { privatePem, publicKey } = throwawayPrivatePem();
    const seen: { exchangeAuth?: string; calls: string[] } = { calls: [] };
    const connect = composeInstallationConnect({
      secrets: createMapSecretBroker(new Map([['github-app-key', privatePem]])),
      keyRef: 'github-app-key',
      appId: '5617882',
      fetchImpl: fakeGitHub(seen),
    });
    const result = await connect.connect('178697398', Date.parse('2026-11-05T05:00:00.000Z'));
    expect(result.installationId).toBe('178697398');
    expect(result.repositories).toEqual([
      { id: '1438299201', fullName: 'reyjinnn/ChangeProof-AI', isPrivate: false },
      { id: '1', fullName: 'reyjinnn/pilot', isPrivate: true },
    ]);
    // The exchange carried a real JWT for this App, signed by this key.
    const jwt = (seen.exchangeAuth ?? '').replace(/^Bearer /, '');
    const [header, payload, signature] = jwt.split('.');
    expect(header).toBeDefined();
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify(publicKey, signature ?? '', 'base64url')).toBe(true);
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toMatchObject({ iss: '5617882' });
  });

  it('fails closed without the broker key before any request', async () => {
    const seen: { exchangeAuth?: string; calls: string[] } = { calls: [] };
    const connect = composeInstallationConnect({
      secrets: createMapSecretBroker(new Map()),
      keyRef: 'github-app-key',
      appId: '5617882',
      fetchImpl: fakeGitHub(seen),
    });
    await expect(connect.connect('178697398', Date.now())).rejects.toThrow(MissingConfigurationError);
    expect(seen.calls).toHaveLength(0);
  });
});
