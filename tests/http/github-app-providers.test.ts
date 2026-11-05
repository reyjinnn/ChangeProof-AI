import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

import type { AuthDeps } from '../../src/http/routes-auth.js';
import { createHttpServer, type HttpHandle } from '../../src/http/index.js';
import {
  composePublicSite,
  type EmailIdentityComposition,
  type GitHubClient,
  type IdentityComposition,
} from '../../src/orchestrator/index.js';

/**
 * Repository-authority providers flag (P2, FR3-30).
 *
 * `githubApp` is true only when the server holds an operator-provisioned
 * installation credential. The stubs below are empty on purpose: the
 * providers path must not touch identity, email, or the GitHub client,
 * so any unexpected call fails loudly instead of passing quietly.
 */

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, '..', '..', 'config', 'publicsite', 'manifest.json');

function throwingClient(): GitHubClient {
  const fail = (): Promise<never> =>
    Promise.reject(new Error('The providers probe never calls the GitHub client.'));
  return {
    fetchCommit: fail,
    listInstallationRepositories: fail,
    fetchBranchHead: fail,
    openPullRequest: fail,
    findPullRequestByHead: fail,
  };
}

function deps(githubApp: boolean): AuthDeps {
  return {
    identity: {} as IdentityComposition,
    email: {} as EmailIdentityComposition,
    ...(githubApp ? { githubApp: { client: throwingClient() } } : {}),
  };
}

let wired: HttpHandle | undefined;
let bare: HttpHandle | undefined;
let wiredBase = '';
let bareBase = '';

async function listen(handle: HttpHandle): Promise<string> {
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Server did not bind.');
  return `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
  wired = createHttpServer({ publicSite: composePublicSite(), manifestPath, auth: deps(true) });
  wiredBase = await listen(wired);
  bare = createHttpServer({ publicSite: composePublicSite(), manifestPath, auth: deps(false) });
  bareBase = await listen(bare);
});

afterAll(async () => {
  await wired?.close();
  await bare?.close();
});

async function providers(base: string): Promise<unknown> {
  const response = await fetch(`${base}/api/auth/providers`);
  expect(response.status).toBe(200);
  return (await response.json());
}

test('reports githubApp true only with a wired installation credential', async () => {
  const withApp = (await providers(wiredBase)) as { data: unknown };
  expect(withApp.data).toEqual({ email: true, github: false, githubApp: true });
  const withoutApp = (await providers(bareBase)) as { data: unknown };
  expect(withoutApp.data).toEqual({ email: true, github: false, githubApp: false });
});
