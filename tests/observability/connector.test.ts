import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assessTelemetryQuality,
  createFileTelemetryConnector,
  normalizeToEvidence,
} from '../../src/modules/observability/index.js';

/**
 * WP3-15 — file telemetry connector over real files (FR3-25.1-4).
 *
 * Real ingestion, deterministic content: JSONL files in a temp dir flow
 * through the connector into validated `IncidentEvidence` and the quality
 * assessor. Malformed lines surface as dropped counts, never silent gaps.
 * Backend-profile live connectors (FR3-25.5) need catalogued backends plus
 * authorized access and stay blocked; this file proves the ingestion loop.
 */

const IDENTITIES = {
  incidentId: 'incident-conn-1',
  sourceIdentity: 'file-connector-probe',
  deployIdentity: 'd'.repeat(64),
  configIdentity: 'config-probe-1',
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'changeproof-conn-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSource(name: string, lines: string[]): void {
  writeFileSync(join(root, name), `${lines.join('\n')}\n`);
}

describe('file connector ingests real JSONL with receipts', () => {
  it('reads records with correlation ids end to end into a clean assessment', async () => {
    writeSource('orders.jsonl', [
      JSON.stringify({ eventAt: '2026-10-31T00:00:01.000Z', observedAt: '2026-10-31T00:00:01.120Z', traceId: 't-1', operationId: 'op-1', amount: 1200 }),
      JSON.stringify({ eventAt: '2026-10-31T00:00:02.000Z', observedAt: '2026-10-31T00:00:02.090Z', traceId: 't-1', operationId: 'op-2', amount: 300 }),
    ]);
    const connector = createFileTelemetryConnector(root);

    const page = await connector.query({ source: 'orders.jsonl', limit: 100 });
    expect(page.records).toHaveLength(2);
    expect(page.dropped).toBe(0);
    expect(page.truncated).toBe(false);
    expect(page.queryReceipt.length).toBeGreaterThan(0);

    const evidence = normalizeToEvidence(page, IDENTITIES);
    expect(evidence.traceIds).toEqual(['t-1']);
    expect(evidence.operationIds).toEqual(['op-1', 'op-2']);
    const quality = assessTelemetryQuality(evidence);
    expect(quality.causality).toBe('needs_discriminating_probe');
    expect(quality.correlationAllowed).toBe(true);
    expect('cause' in quality).toBe(false);
  });

  it('counts malformed lines as dropped and degrades to a sampling gap', async () => {
    writeSource('ragged.jsonl', [
      JSON.stringify({ eventAt: '2026-10-31T00:00:01.000Z', observedAt: '2026-10-31T00:00:01.050Z', traceId: 't-9' }),
      'this is not json',
      JSON.stringify({ eventAt: '2026-10-31T00:00:03.000Z', observedAt: '2026-10-31T00:00:03.050Z' }),
    ]);
    const connector = createFileTelemetryConnector(root);

    const page = await connector.query({ source: 'ragged.jsonl', limit: 100 });
    expect(page.records).toHaveLength(2);
    expect(page.dropped).toBe(1);

    const quality = assessTelemetryQuality(normalizeToEvidence(page, IDENTITIES));
    expect(quality.causality).toBe('causality_unproven');
    expect(quality.reasons).toContain('sampling_gap');
  });

  it('marks id-less records as timestamp-only instead of joining them', async () => {
    writeSource('plain.jsonl', [
      JSON.stringify({ eventAt: '2026-10-31T00:00:01.000Z', observedAt: '2026-10-31T00:00:01.050Z', note: 'no ids' }),
    ]);
    const connector = createFileTelemetryConnector(root);

    const page = await connector.query({ source: 'plain.jsonl', limit: 100 });
    const quality = assessTelemetryQuality(normalizeToEvidence(page, IDENTITIES));

    expect(quality.causality).toBe('causality_unproven');
    expect(quality.reasons).toContain('timestamp_only_ambiguous');
  });

  it('filters by time window and enforces the limit visibly', async () => {
    writeSource('window.jsonl', [
      JSON.stringify({ eventAt: '2026-10-31T00:00:01.000Z', observedAt: '2026-10-31T00:00:01.000Z', traceId: 'old' }),
      JSON.stringify({ eventAt: '2026-10-31T00:00:05.000Z', observedAt: '2026-10-31T00:00:05.000Z', traceId: 'new' }),
    ]);
    const connector = createFileTelemetryConnector(root);

    const windowed = await connector.query({
      source: 'window.jsonl',
      sinceIso: '2026-10-31T00:00:04.000Z',
      limit: 100,
    });
    expect(windowed.records.map((record) => record.traceId)).toEqual(['new']);

    const capped = await connector.query({ source: 'window.jsonl', limit: 1 });
    expect(capped.records).toHaveLength(1);
    expect(capped.truncated).toBe(true);
    const quality = assessTelemetryQuality(normalizeToEvidence(capped, IDENTITIES));
    expect(quality.reasons).toContain('sampling_gap');
  });
});

describe('file connector fails closed', () => {
  it('refuses traversal, absolute paths, and missing sources specifically', async () => {
    const connector = createFileTelemetryConnector(root);

    await expect(connector.query({ source: '../outside.jsonl', limit: 10 })).rejects.toThrow(/source|path|scope/i);
    await expect(connector.query({ source: '/etc/hostname', limit: 10 })).rejects.toThrow(/source|path|scope/i);
    await expect(connector.query({ source: '', limit: 10 })).rejects.toThrow(/source/i);
    await expect(connector.query({ source: 'missing.jsonl', limit: 10 })).rejects.toThrow(/unknown|missing|found/i);
  });

  it('refuses oversized files, bad limits, and unreadable time bounds', async () => {
    writeSource('big.jsonl', ['{"observedAt":"2026-10-31T00:00:01.000Z"}']);
    const small = createFileTelemetryConnector(root, { maxBytes: 10, maxLimit: 5 });

    await expect(small.query({ source: 'big.jsonl', limit: 1 })).rejects.toThrow(/size|byte|large/i);
    await expect(small.query({ source: 'big.jsonl', limit: 0 })).rejects.toThrow(/limit/i);
    await expect(small.query({ source: 'big.jsonl', limit: 6 })).rejects.toThrow(/limit/i);
    await expect(
      small.query({ source: 'big.jsonl', sinceIso: 'not-a-time', limit: 1 }),
    ).rejects.toThrow(/time|since|unreadable/i);
  });
});
