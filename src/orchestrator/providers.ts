import type { SecretBrokerPort } from '../core/index.js';
import {
  bitbucketFetchTransport,
  createProviderClient,
  createProviderEventStore,
  gitlabFetchTransport,
  type ProviderEventStore,
  type ProvidersDb,
  type ProviderTransport,
} from '../modules/providers/index.js';

/**
 * Repository-provider wiring (WP3-32).
 *
 * The composition root injects the database handle and the secret broker;
 * it adds no provider, webhook, or persistence behavior of its own. Live
 * transports are the real fetch implementations; tests inject fakes behind
 * the same seam.
 */
export interface ProvidersComposition {
  events: ProviderEventStore;
  gitlab: (transport: ProviderTransport) => ReturnType<typeof createProviderClient>;
  bitbucket: (transport: ProviderTransport) => ReturnType<typeof createProviderClient>;
  liveGitLab: (baseUrl: string) => ReturnType<typeof createProviderClient>;
  liveBitbucket: (baseUrl: string) => ReturnType<typeof createProviderClient>;
}

export function composeProviders(input: {
  db: ProvidersDb;
  secrets: SecretBrokerPort;
}): ProvidersComposition {
  return {
    events: createProviderEventStore(input.db),
    gitlab: (transport: ProviderTransport) =>
      createProviderClient({ provider: 'gitlab', transport, secrets: input.secrets }),
    bitbucket: (transport: ProviderTransport) =>
      createProviderClient({ provider: 'bitbucket', transport, secrets: input.secrets }),
    liveGitLab: (baseUrl: string) =>
      createProviderClient({
        provider: 'gitlab',
        transport: gitlabFetchTransport(baseUrl),
        secrets: input.secrets,
      }),
    liveBitbucket: (baseUrl: string) =>
      createProviderClient({
        provider: 'bitbucket',
        transport: bitbucketFetchTransport(baseUrl),
        secrets: input.secrets,
      }),
  };
}
