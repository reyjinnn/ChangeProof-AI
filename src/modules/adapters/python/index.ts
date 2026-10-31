import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import {
  CapabilityRecordSchema,
  SystemGraphSchema,
  type CapabilityKey,
  type CapabilityRecord,
  type GraphEdge,
  type GraphNode,
} from '../../../core/index.js';
import { snapshotId, type AdapterDefinition, type AdapterExtractInput, type AdapterExtractResult } from '../types.js';
import { AdapterRegistry } from '../registry/index.js';

/**
 * Python adapter (L1: discovery and extraction).
 *
 * The extraction runs CPython's own `ast` module in a separate interpreter
 * process, so the parse is the real language grammar rather than a text
 * approximation. The helper script is a reviewed platform component, not
 * something loaded from a customer repository.
 *
 * Dynamic constructs — `importlib.import_module`, `getattr`, `__import__` —
 * are reported as unknowns and keep the edge unresolved. They are never dropped:
 * a dynamic binding that silently disappeared would read as "no impact"
 * (NEG3-02).
 */

export const PYTHON_ADAPTER_VERSION = '1.0.1';

export const PYTHON_KEY: CapabilityKey = {
  ecosystem: 'python',
  language: 'python',
  framework: 'fastapi',
  versionRange: '>=0.110 <1.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'python-linux',
  adapterVersion: PYTHON_ADAPTER_VERSION,
};

export const PYTHON_ADAPTER_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: PYTHON_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Dynamic imports and getattr-based binding are reported as unresolved.',
    'No L2/L3 claim: candidate patch and native verification are not yet certified.',
  ],
  toolchainIdentities: {},
});
const registeredCapabilities = new AdapterRegistry([PYTHON_ADAPTER_RECORD]);

// Private helper protocol: the identity is emitted by the same interpreter
// process that parsed the source, rather than copied from the requested pin.
const PythonParseResultSchema = z.object({
  schemaVersion: z.literal('1'),
  pythonVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  errors: z.array(z.string()),
  facts: z.array(z.object({
    kind: z.enum(['route', 'model', 'import', 'dynamic']),
    file: z.string(),
    line: z.number().int().positive(),
    name: z.string(),
    detail: z.string(),
    resolved: z.boolean(),
  })),
});

/** The reviewed helper that parses the snapshot with CPython's own grammar. */
const PARSE_HELPER = `
import ast, json, sys

def analyse(path, source):
    facts = []
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as error:
        return facts, str(error)

    import_module_bindings = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == 'importlib'
        for alias in node.names if alias.name == 'import_module'
    }

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            module = getattr(node, 'module', None) or ''
            names = [alias.name for alias in node.names]
            facts.append({
                'kind': 'import', 'file': path, 'line': node.lineno,
                'name': names[0] if names else module,
                'detail': module or (names[0] if names else ''),
                'resolved': True,
            })

        if isinstance(node, ast.Call):
            func = node.func
            attr = getattr(func, 'attr', None)
            if attr in ('get', 'post', 'put', 'delete', 'patch') and node.args:
                first = node.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    facts.append({
                        'kind': 'route', 'file': path, 'line': node.lineno,
                        'name': first.value, 'detail': attr.upper(),
                        'resolved': True,
                    })

        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                base_name = getattr(base, 'id', None)
                if base_name:
                    facts.append({
                        'kind': 'model', 'file': path, 'line': node.lineno,
                        'name': node.name, 'detail': base_name, 'resolved': True,
                    })

        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in ('getattr', '__import__'):
                facts.append({
                    'kind': 'dynamic', 'file': path, 'line': node.lineno,
                    'name': func.id, 'detail': 'dynamic attribute or module binding',
                    'resolved': False,
                })
            if ((isinstance(func, ast.Attribute) and func.attr == 'import_module') or
                    (isinstance(func, ast.Name) and func.id in import_module_bindings)):
                facts.append({
                    'kind': 'dynamic', 'file': path, 'line': node.lineno,
                    'name': 'import_module', 'detail': 'runtime module import',
                    'resolved': False,
                })
    return facts, None

results = []
errors = []
for entry in json.loads(sys.stdin.read()):
    facts, error = analyse(entry['file'], entry['source'])
    results.extend(facts)
    if error:
        errors.append(entry['file'] + ': ' + error)

print(json.dumps({
    'schemaVersion': '1',
    'pythonVersion': '.'.join(map(str, sys.version_info[:3])),
    'facts': results,
    'errors': errors,
}))
`;

export const PYTHON_ADAPTER: AdapterDefinition = {
  name: 'python',
  contractVersion: '2',
  key: PYTHON_KEY,
  records: [PYTHON_ADAPTER_RECORD],

  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    const snapshot = snapshotId(input.root, input.version);
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      const reason = 'Unregistered or invalid Python capability tuple.';
      return { status: 'unsupported', graph: emptyGraph(snapshot), unknowns: [reason],
        unsupportedSurfaces: [reason], diagnostics: [], toolchainIdentity: 'python@unobserved' };
    }
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const unknowns: string[] = [];
    const diagnostics: string[] = [];

    const entries: { file: string; source: string }[] = [];
    for (const file of input.files) {
      if (!file.endsWith('.py')) continue;
      try {
        entries.push({ file, source: readFileSync(join(input.root, file), 'utf8') });
      } catch (error) {
        diagnostics.push(`Could not read ${file}: ${(error as Error).message}`);
      }
    }

    if (entries.length === 0) {
      return {
        status: 'failed',
        graph: emptyGraph(snapshot),
        unknowns: ['no source file could be read'],
        unsupportedSurfaces: [],
        diagnostics,
        toolchainIdentity: 'python@unobserved',
      };
    }

    const { runNative, parseNativeJson } = await import('../native/process.js');
    const run = await runNative(
      'python',
      ['-c', PARSE_HELPER],
      {
        cwd: input.root,
        timeoutMs: 30_000,
        maxOutputBytes: 4 * 1024 * 1024,
        input: JSON.stringify(entries),
      },
    );

    if (run.exitCode !== 0) {
      return {
        status: 'failed',
        graph: emptyGraph(snapshot),
        unknowns: [`python interpreter exited with code ${run.exitCode}`],
        unsupportedSurfaces: [],
        diagnostics: [run.stderr.slice(0, 2000)],
        toolchainIdentity: 'python@unobserved',
      };
    }

    const parsed = PythonParseResultSchema.safeParse(parseNativeJson(run.stdout));
    if (!parsed.success) {
      return {
        status: 'failed',
        graph: emptyGraph(snapshot),
        unknowns: ['Python helper did not return a valid parser result and interpreter identity.'],
        unsupportedSurfaces: [],
        diagnostics: [parsed.error.message],
        toolchainIdentity: 'python@unobserved',
      };
    }
    const { facts, pythonVersion, errors } = parsed.data;
    const toolchainIdentity = `python@${pythonVersion}`;
    if (pythonVersion !== input.version) {
      return {
        status: 'failed',
        graph: emptyGraph(snapshot),
        unknowns: [`Python toolchain mismatch: requested ${input.version}, observed ${pythonVersion}; select the pinned interpreter before retrying.`],
        unsupportedSurfaces: [],
        diagnostics,
        toolchainIdentity,
      };
    }
    if (errors.length > 0) {
      return { status: 'failed', graph: emptyGraph(snapshot), unknowns: errors,
        unsupportedSurfaces: [], diagnostics: [...diagnostics, ...errors], toolchainIdentity };
    }

    for (const entry of entries) {
      const moduleId = `component:${entry.file}`;
      nodes.set(moduleId, {
        id: moduleId,
        kind: 'component',
        locator: entry.file,
        snapshot,
        label: entry.file,
      });
    }

    for (const fact of facts) {
      const fromId = `component:${fact.file}`;
      if (!nodes.has(fromId)) continue;

      if (fact.kind === 'route') {
        const endpointId = `endpoint:${fact.detail} ${fact.name}`;
        nodes.set(endpointId, {
          id: endpointId,
          kind: 'endpoint',
          locator: `${fact.file}:${fact.line}`,
          snapshot,
          label: `${fact.detail} ${fact.name}`,
        });
        edges.push({
          id: `edge:${fromId}->${endpointId}`,
          kind: 'calls',
          from: fromId,
          to: endpointId,
          resolution: 'proven',
          evidence: {
            locator: `${fact.file}:${fact.line}`,
            snapshot,
            method: 'python-ast-decorator-call',
          },
          runtimeObserved: false,
        });
        continue;
      }

      if (fact.kind === 'model') {
        const dtoId = `dto:${fact.name}`;
        nodes.set(dtoId, {
          id: dtoId,
          kind: 'dto',
          locator: `${fact.file}:${fact.line}`,
          snapshot,
          label: fact.name,
        });
        edges.push({
          id: `edge:${fromId}->${dtoId}`,
          kind: 'serializes',
          from: fromId,
          to: dtoId,
          resolution: 'proven',
          evidence: {
            locator: `${fact.file}:${fact.line}`,
            snapshot,
            method: 'python-ast-class-base',
          },
          runtimeObserved: false,
        });
        continue;
      }

      if (fact.kind === 'dynamic') {
        const targetId = `symbol:dynamic:${fact.name}`;
        nodes.set(targetId, {
          id: targetId,
          kind: 'symbol',
          locator: `${fact.file}:${fact.line}`,
          snapshot,
          label: fact.name,
        });
        edges.push({
          id: `edge:${fromId}->${targetId}`,
          kind: 'calls',
          from: fromId,
          to: targetId,
          resolution: 'unresolved',
          unresolvedReason: `${fact.detail} at ${fact.file}:${fact.line} cannot be resolved statically`,
          runtimeObserved: false,
        });
        unknowns.push(
          `Dynamic binding (${fact.detail}) at ${fact.file}:${fact.line} is unresolved`,
        );
        continue;
      }

      // Import: resolved when the imported module is part of the analysed set.
      const modulePath = normaliseModule(fact.detail, fact.file);
      const known = entries.some((entry) => normaliseModule(entry.file, entry.file) === modulePath);
      const targetId = `symbol:${modulePath}#${fact.name}`;
      nodes.set(targetId, {
        id: targetId,
        kind: 'symbol',
        locator: modulePath,
        snapshot,
        label: fact.name,
      });

      edges.push({
        id: `edge:${fromId}->${targetId}`,
        kind: 'depends_on',
        from: fromId,
        to: targetId,
        resolution: known ? 'proven' : 'unresolved',
        ...(known
          ? {
              evidence: {
                locator: `${fact.file}:${fact.line}`,
                snapshot,
                method: 'python-ast-import',
              },
            }
          : {
              unresolvedReason:
                `Imported module "${fact.detail}" at ${fact.file}:${fact.line} is outside the analysed snapshot`,
            }),
        runtimeObserved: false,
      });

      if (!known) {
        unknowns.push(
          `Import "${fact.detail}" at ${fact.file}:${fact.line} was not resolved within the analysed snapshot`,
        );
      }
    }

    return {
      status: 'ok',
      graph: SystemGraphSchema.parse({ schemaVersion: '1', snapshot, nodes: [...nodes.values()], edges }),
      unknowns,
      unsupportedSurfaces: [],
      diagnostics,
      toolchainIdentity,
    };
  },
};

function emptyGraph(snapshot: string) {
  return SystemGraphSchema.parse({
    schemaVersion: '1',
    snapshot,
    nodes: [{ id: 'component:empty', kind: 'component', locator: 'empty', snapshot }],
    edges: [],
  });
}

function normaliseModule(specifier: string, fromFile: string): string {
  if (!specifier.startsWith('.')) return specifier;
  const stack = fromFile.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/').replace(/\.py$/, '');
}
