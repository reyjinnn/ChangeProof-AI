import { describe, expect, it } from 'vitest';

import { composeAgent } from '../../src/orchestrator/index.js';

/**
 * WP3-07 composition wiring.
 *
 * The composition root injects the transport, broker, and budgets into the
 * model client without adding behavior. The transport below never connects —
 * broker, gateway, and guard behavior is proven in `tests/agent/**`, not
 * here. No live provider exists at the configured URL (see the phase
 * report); nothing here invents one.
 */
describe('composeAgent', () => {
  const config = {
    transport: {
      send: () => Promise.resolve({ status: 200, bodyText: '{}' }),
    },
    secrets: {
      readCredential: () => Promise.resolve('stub-secret'),
    },
    secretRef: 'stub-ref',
    provider: 'stub-provider',
    model: 'stub-model',
    configId: 'config-stub-1',
    tokenCeiling: 1000,
  };

  it('exposes the client, gateway, and guard without wrapping them', () => {
    const composed = composeAgent(config);

    expect(composed.client.provider).toBe('stub-provider');
    expect(composed.client.contractVersion).toBe('1');
    expect(typeof composed.client.complete).toBe('function');
    expect(typeof composed.authorizeMutation).toBe('function');
    expect(typeof composed.reviewPatch).toBe('function');
    expect(typeof composed.createLedger).toBe('function');
  });

  it('reuses the same gateway the guard enforces', () => {
    const composed = composeAgent(config);

    expect(() =>
      composed.authorizeMutation({
        operation: 'write_file',
        path: '../escape.ts',
        writableRoots: ['a'],
        protectedRoots: [],
        allowedOperations: ['write_file'],
      }),
    ).toThrow(/escape/i);
  });
});
