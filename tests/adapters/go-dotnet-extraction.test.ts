import { afterEach, describe, expect, it } from 'vitest';

import {
  DOTNET_ADAPTER,
  GO_ADAPTER,
  type AdapterDefinition,
} from '../../src/modules/adapters/index.js';
import { createFixture } from './fixtures.js';

/**
 * WP3-03 / T1-5 — Go and .NET native L1 extraction.
 *
 * These run the installed native toolchains: Go's own `go/parser` for Go
 * source, and the Roslyn C# syntax parser shipped with the pinned .NET SDK for
 * C# source. Both helpers are reviewed platform components that read source
 * bytes on stdin; neither builds nor loads a customer project.
 */
const fixtures: { cleanup: () => void }[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

/**
 * The single capability record an adapter registers. Failing loudly here keeps
 * the test honest when the adapter's registry changes.
 */
function soleRecord(adapter: AdapterDefinition): (typeof adapter.records)[number] {
  const record = adapter.records[0];
  if (record === undefined) {
    throw new Error(`Adapter ${adapter.name} registers no capability record.`);
  }
  return record;
}

const GO_SERVICE = {
  'go.mod': 'module changeproof/go-fixture\n\ngo 1.27\n',
  'main.go': [
    'package main',
    '',
    'import (',
    '\t"net/http"',
    ')',
    '',
    'type Order struct {',
    '\tID string',
    '}',
    '',
    'func main() {',
    '\thttp.HandleFunc("/api/orders", func(w http.ResponseWriter, r *http.Request) {',
    '\t\t_ = Order{ID: r.URL.Query().Get("id")}',
    '\t})',
    '\thttp.ListenAndServe(":8080", nil)',
    '}',
  ].join('\n'),
};

const GO_UNSUPPORTED = {
  'go.mod': 'module changeproof/go-unsupported\n\ngo 1.27\n',
  'main.go': [
    'package main',
    '',
    '// No route registration: nothing for the L1 extractor to resolve.',
    'func helper() int { return 42 }',
  ].join('\n'),
};

const DOTNET_SERVICE = {
  'Program.cs': [
    'using Microsoft.AspNetCore.Builder;',
    '',
    'var app = WebApplication.Create();',
    'app.MapGet("/api/orders/{id}", (string id) => new OrderDto(id));',
    'app.Run();',
    '',
    'public record OrderDto(string Id);',
  ].join('\n'),
};

const DOTNET_UNSUPPORTED = {
  'Program.cs': [
    'using System;',
    '',
    '// A computed route: the extractor cannot resolve it statically.',
    'public class Handler',
    '{',
    '    public string Build() => "/api/orders";',
    '}',
  ].join('\n'),
};

describe('Go L1 extraction (go1.27.3)', () => {
  it('extracts a positive HTTP route and type with provenance', async () => {
    const fixture = createFixture(GO_SERVICE);
    fixtures.push(fixture);

    const result = await GO_ADAPTER.extract({
      root: fixture.root,
      files: Object.keys(GO_SERVICE),
      version: '1.27.3',
      capability: soleRecord(GO_ADAPTER),
    });

    expect(result.status).toBe('ok');
    expect(result.graph.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'symbol')).toBe(true);
    expect(result.graph.edges.every((edge) => edge.resolution !== 'proven' || edge.evidence !== undefined)).toBe(true);
    expect(result.toolchainIdentity).toContain('go@1.27.3');
  }, 60_000);

  it('does not claim a generic verified result for source it cannot resolve', async () => {
    const fixture = createFixture(GO_UNSUPPORTED);
    fixtures.push(fixture);

    const result = await GO_ADAPTER.extract({
      root: fixture.root,
      files: Object.keys(GO_UNSUPPORTED),
      version: '1.27.3',
      capability: soleRecord(GO_ADAPTER),
    });

    expect(result.status).not.toBe('ok');
    expect(result.graph.edges).toHaveLength(0);
    expect(result.unsupportedSurfaces.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('.NET L1 extraction (SDK 10.0.403, Roslyn)', () => {
  it('extracts a positive endpoint mapping and record with provenance', async () => {
    const fixture = createFixture(DOTNET_SERVICE);
    fixtures.push(fixture);

    const result = await DOTNET_ADAPTER.extract({
      root: fixture.root,
      files: Object.keys(DOTNET_SERVICE),
      version: '10.0.403',
      capability: soleRecord(DOTNET_ADAPTER),
    });

    expect(result.status).toBe('ok');
    expect(result.graph.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'dto')).toBe(true);
    expect(result.graph.edges.every((edge) => edge.resolution !== 'proven' || edge.evidence !== undefined)).toBe(true);
    expect(result.toolchainIdentity).toContain('roslyn');
  }, 120_000);

  it('does not claim a generic verified result for source it cannot resolve', async () => {
    const fixture = createFixture(DOTNET_UNSUPPORTED);
    fixtures.push(fixture);

    const result = await DOTNET_ADAPTER.extract({
      root: fixture.root,
      files: Object.keys(DOTNET_UNSUPPORTED),
      version: '10.0.403',
      capability: soleRecord(DOTNET_ADAPTER),
    });

    expect(result.status).not.toBe('ok');
    expect(result.graph.edges).toHaveLength(0);
  }, 120_000);
});
