import { describe, expect, it } from 'vitest';

import { composeTelemetryConnector } from '../../src/orchestrator/index.js';

/**
 * WP3-15 composition wiring.
 *
 * The composition root binds the file connector to its root without adding
 * behavior. No files are read here — ingestion is proven on real files in
 * `tests/observability/connector.test.ts`.
 */
describe('composeTelemetryConnector', () => {
  it('exposes a file backend bound to the given root', async () => {
    const composed = composeTelemetryConnector('/nonexistent-root-for-wiring');

    expect(composed.connector.backend).toBe('file-jsonl');
    expect(typeof composed.connector.query).toBe('function');
    // The root does not exist: refused specifically, never invented.
    await expect(composed.connector.query({ source: 'x.jsonl', limit: 1 })).rejects.toThrow(/unknown|scope/i);
  });
});
