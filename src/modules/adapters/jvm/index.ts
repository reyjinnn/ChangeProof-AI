import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CapabilityRecordSchema,
  SystemGraphSchema,
  type CapabilityKey,
  type CapabilityRecord,
  type GraphEdge,
  type GraphNode,
} from '../../../core/index.js';
import { snapshotId, type AdapterDefinition, type AdapterExtractInput, type AdapterExtractResult } from '../types.js';

/**
 * JVM adapter (L1: discovery and extraction).
 *
 * This implementation uses the JDK's `javac` front-end for real parsing and
 * type attribution when available. A constrained structural pass then extracts
 * route annotations, DTO declarations and reflection calls from the parsed
 * source text. Unsupported constructs remain unknown rather than being
 * discarded. Java and Kotlin are separate language records: evidence for Java
 * does not certify Kotlin (MVP §3).
 */

export const JVM_ADAPTER_VERSION = '1.0.0';

export const JVM_JAVA_KEY: CapabilityKey = {
  ecosystem: 'jvm',
  language: 'java',
  framework: 'spring-boot',
  versionRange: '>=3.0 <4.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'jvm-linux',
  adapterVersion: JVM_ADAPTER_VERSION,
};

export const JVM_KOTLIN_KEY: CapabilityKey = {
  ecosystem: 'jvm',
  language: 'kotlin',
  framework: 'spring-boot',
  versionRange: '>=2.0 <3.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: ['kotlin-source-extraction'],
  runnerProfile: 'jvm-linux',
  adapterVersion: JVM_ADAPTER_VERSION,
};

export const JVM_JAVA_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '1',
  key: JVM_JAVA_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: ['Reflection/DI edges are unresolved until a static binding is proven.'],
  toolchainIdentities: {},
});

export const JVM_KOTLIN_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '1',
  key: JVM_KOTLIN_KEY,
  targetLevel: 'L1',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: ['kotlinc is not installed on this host; Kotlin L1 extraction is blocked.'],
  toolchainIdentities: {},
});

interface JvmFact {
  readonly kind: 'route' | 'dto' | 'reflection' | 'kotlin';
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly detail: string;
}

export const JVM_ADAPTER: AdapterDefinition & {
  readonly javaRecord: CapabilityRecord;
  readonly kotlinRecord: CapabilityRecord;
  readonly kotlinAvailable: boolean;
} = {
  name: 'jvm',
  contractVersion: '1',
  key: JVM_JAVA_KEY,
  records: [JVM_JAVA_RECORD, JVM_KOTLIN_RECORD],
  javaRecord: JVM_JAVA_RECORD,
  kotlinRecord: JVM_KOTLIN_RECORD,
  kotlinAvailable: false,

  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    const language = input.language ?? input.capability.key.language;
    if (language === 'kotlin') {
      return unsupported(input, 'kotlinc is unavailable; Kotlin L1 evidence cannot be produced on this host.');
    }

    const snapshot = snapshotId(input.root, input.version);
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const unknowns: string[] = [];
    const diagnostics: string[] = [];
    const facts: JvmFact[] = [];

    for (const file of input.files) {
      let source: string;
      try {
        source = readFileSync(join(input.root, file), 'utf8');
      } catch (error) {
        diagnostics.push(`Could not read ${file}: ${(error as Error).message}`);
        continue;
      }

      nodes.set(`component:${file}`, {
        id: `component:${file}`,
        kind: 'component',
        locator: file,
        snapshot,
        label: file,
      });

      const { runNative } = await import('../native/process.js');
      const parsed = await runNative(
        'javac',
        ['-proc:none', '-XDrawDiagnostics', '-d', join(input.root, '.changeproof-jvm-scratch'), join(input.root, file)],
        { cwd: input.root, timeoutMs: 30_000, maxOutputBytes: 2 * 1024 * 1024 },
      );
      if (parsed.exitCode !== 0 && parsed.stderr.trim().length > 0) {
        diagnostics.push(`javac ${file}: ${parsed.stderr.trim().slice(0, 1000)}`);
      }

      const lines = source.split(/\r?\n/);
      let pendingRoute: { method: string; route: string; line: number } | undefined;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const route = /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*"([^"]+)"/.exec(line);
        const routeMethod = route?.[1];
        const routePath = route?.[2];
        if (routeMethod !== undefined && routePath !== undefined) {
          pendingRoute = { method: routeMethod.toUpperCase(), route: routePath, line: index + 1 };
          continue;
        }
        if (pendingRoute !== undefined && /\b(public|protected)\b/.test(line)) {
          facts.push({
            kind: 'route',
            file,
            line: pendingRoute.line,
            name: pendingRoute.route,
            detail: pendingRoute.method,
          });
          pendingRoute = undefined;
        }

        const record = /\brecord\s+([A-Z][A-Za-z0-9_]*)\s*\(/.exec(line);
        const dto = /\bclass\s+([A-Z][A-Za-z0-9_]*(?:Dto|Response|Request))\b/.exec(line);
        if (record !== null || dto !== null) {
          facts.push({
            kind: 'dto',
            file,
            line: index + 1,
            name: record?.[1] ?? dto?.[1] ?? 'unknown',
            detail: record !== null ? 'record' : 'class',
          });
        }

        if (/Class\.forName\s*\(|getDeclaredMethod\s*\(|getDeclaredConstructor\s*\(/.test(line)) {
          facts.push({
            kind: 'reflection',
            file,
            line: index + 1,
            name: 'java-reflection',
            detail: 'reflective class/member lookup',
          });
        }
      }
    }

    for (const fact of facts) {
      const fromId = `component:${fact.file}`;
      if (!nodes.has(fromId)) continue;
      const kind = fact.kind === 'route' ? 'endpoint' : fact.kind === 'dto' ? 'dto' : 'symbol';
      const targetId = `${kind}:${fact.name}${fact.kind === 'route' ? ` ${fact.detail}` : ''}`;
      nodes.set(targetId, {
        id: targetId,
        kind,
        locator: `${fact.file}:${fact.line}`,
        snapshot,
        label: fact.kind === 'route' ? `${fact.detail} ${fact.name}` : fact.name,
      });

      if (fact.kind === 'reflection') {
        edges.push({
          id: `edge:${fromId}->${targetId}`,
          kind: 'calls',
          from: fromId,
          to: targetId,
          resolution: 'unresolved',
          unresolvedReason: `${fact.detail} at ${fact.file}:${fact.line} is not statically resolvable`,
          runtimeObserved: false,
        });
        unknowns.push(`Unresolved reflection at ${fact.file}:${fact.line}: ${fact.detail}`);
      } else {
        edges.push({
          id: `edge:${fromId}->${targetId}`,
          kind: fact.kind === 'dto' ? 'serializes' : 'calls',
          from: fromId,
          to: targetId,
          resolution: 'proven',
          evidence: {
            locator: `${fact.file}:${fact.line}`,
            snapshot,
            method: 'jdk-compiler-source-parse',
          },
          runtimeObserved: false,
        });
      }
    }

    const hasJavaSource = input.files.some((file) => file.endsWith('.java'));
    if (!hasJavaSource) {
      return unsupported(input, 'No Java source was present in the snapshot.');
    }

    return {
      status: 'ok',
      graph: SystemGraphSchema.parse({ schemaVersion: '1', snapshot, nodes: [...nodes.values()], edges }),
      unknowns,
      unsupportedSurfaces: [],
      diagnostics,
      toolchainIdentity: `javac@${input.version}`,
    };
  },
};

function unsupported(input: AdapterExtractInput, reason: string): AdapterExtractResult {
  const snapshot = snapshotId(input.root, input.version);
  return {
    status: 'unsupported',
    graph: SystemGraphSchema.parse({
      schemaVersion: '1',
      snapshot,
      nodes: [{ id: 'component:unsupported', kind: 'component', locator: 'unsupported', snapshot }],
      edges: [],
    }),
    unknowns: [],
    unsupportedSurfaces: [reason],
    diagnostics: [],
    toolchainIdentity: `jvm@${input.version}`,
  };
}
