import { describe, expect, it } from 'vitest';

import { ECOSYSTEMS } from '../../src/core/index.js';
import {
  DOTNET_ADAPTER,
  DOTNET_ADAPTER_RECORD,
  GO_ADAPTER,
  GO_ADAPTER_RECORD,
  JVM_ADAPTER,
  JVM_JAVA_RECORD,
  JVM_KOTLIN_RECORD,
  PHP_ADAPTER,
  PYTHON_ADAPTER,
  TYPESCRIPT_ADAPTER,
} from '../../src/modules/adapters/index.js';

/** WP3-03: all six ecosystems registered; only measured evidence can promote. */
describe('six-ecosystem capability catalog', () => {
  it('registers every required ecosystem', () => {
    const records = [
      ...TYPESCRIPT_ADAPTER.records,
      ...PYTHON_ADAPTER.records,
      ...JVM_ADAPTER.records,
      ...PHP_ADAPTER.records,
      GO_ADAPTER_RECORD,
      DOTNET_ADAPTER_RECORD,
    ];
    const ecosystems = [...new Set(records.map((record) => record.key.ecosystem))].sort();

    expect(ecosystems).toEqual([...ECOSYSTEMS].sort());
  });

  it('starts all records at provenLevel none', () => {
    const records = [
      ...TYPESCRIPT_ADAPTER.records,
      ...PYTHON_ADAPTER.records,
      ...JVM_ADAPTER.records,
      ...PHP_ADAPTER.records,
      GO_ADAPTER_RECORD,
      DOTNET_ADAPTER_RECORD,
    ];

    expect(records.every((record) => record.provenLevel === 'none')).toBe(true);
  });

  it('keeps Kotlin as its own JVM capability record', () => {
    expect(JVM_JAVA_RECORD.key.language).toBe('java');
    expect(JVM_KOTLIN_RECORD.key.language).toBe('kotlin');
    expect(JVM_JAVA_RECORD.key.framework).toBe(JVM_KOTLIN_RECORD.key.framework);
    expect(JVM_KOTLIN_RECORD.provenLevel).toBe('none');
  });

  it('returns unsupported for Go without claiming a successful empty extraction', async () => {
    const result = await GO_ADAPTER.extract({
      root: 'C:/fixture',
      files: ['go.mod', 'main.go'],
      version: 'unavailable',
      capability: GO_ADAPTER_RECORD,
    });

    expect(result.status).toBe('unsupported');
    expect(result.unsupportedSurfaces[0]).toMatch(/toolchain unavailable/i);
    expect(result.graph.edges).toHaveLength(0);
  });

  it('returns unsupported for .NET without a generic success fallback', async () => {
    const result = await DOTNET_ADAPTER.extract({
      root: 'C:/fixture',
      files: ['Orders.csproj', 'Program.cs'],
      version: 'unavailable',
      capability: DOTNET_ADAPTER_RECORD,
    });

    expect(result.status).toBe('unsupported');
    expect(result.unsupportedSurfaces[0]).toMatch(/SDK unavailable/i);
    expect(result.graph.edges).toHaveLength(0);
  });
});
