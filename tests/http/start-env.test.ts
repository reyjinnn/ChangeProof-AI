import { describe, expect, it } from 'vitest';

import { buildStartEnv } from '../../src/http/start.js';

/**
 * Server env allowlist pin (WP3-22).
 *
 * Importing start.js never starts the server (the entry is guarded by
 * argv), so this pin is safe to run anywhere. Update the key list below
 * whenever StartEnv gains a field — a field missing here silently never
 * reaches the server, which once dropped the GitHub App credentials.
 */

describe('buildStartEnv', () => {
  it('forwards every StartEnv field and nothing else', () => {
    const source: NodeJS.ProcessEnv = {
      PORT: '4179',
      HOST: '127.0.0.1',
      CP_MANIFEST: 'manifest',
      CP_DIST: 'dist',
      DATABASE_URL: 'db',
      CP_SMTP_HOST: 'smtp',
      CP_SMTP_PORT: '1025',
      CP_SMTP_SENDER: 'sender',
      CP_CHALLENGE_SECRET: 'challenge',
      CP_EVIDENCE_DIR: 'evidence',
      CP_GITHUB_CLIENT_ID: 'client',
      CP_GITHUB_CLIENT_SECRET: 'secret',
      CP_GITHUB_REDIRECT_URL: 'redirect',
      CP_GITHUB_INSTALLATION_TOKEN: 'token',
      CP_GITHUB_APP_ID: 'app',
      CP_GITHUB_APP_KEY_FILE: 'keyfile',
      CP_GITHUB_APP_SLUG: 'slug',
      SOMETHING_ELSE: 'ignored',
    };
    expect(buildStartEnv(source)).toEqual({
      PORT: '4179',
      HOST: '127.0.0.1',
      CP_MANIFEST: 'manifest',
      CP_DIST: 'dist',
      DATABASE_URL: 'db',
      CP_SMTP_HOST: 'smtp',
      CP_SMTP_PORT: '1025',
      CP_SMTP_SENDER: 'sender',
      CP_CHALLENGE_SECRET: 'challenge',
      CP_EVIDENCE_DIR: 'evidence',
      CP_GITHUB_CLIENT_ID: 'client',
      CP_GITHUB_CLIENT_SECRET: 'secret',
      CP_GITHUB_REDIRECT_URL: 'redirect',
      CP_GITHUB_INSTALLATION_TOKEN: 'token',
      CP_GITHUB_APP_ID: 'app',
      CP_GITHUB_APP_KEY_FILE: 'keyfile',
      CP_GITHUB_APP_SLUG: 'slug',
    });
  });
});
