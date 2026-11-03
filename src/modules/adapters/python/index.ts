import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import {
  AdapterCheckPlanSchema,
  AdapterFixRequestSchema,
  AdapterPatchSchema,
  CapabilityRecordSchema,
  ChangeProofError,
  SystemGraphSchema,
  digestAdapterPatch,
  type AdapterCheckPlan,
  type AdapterFixRequest,
  type AdapterPatchOperation,
  type CapabilityKey,
  type CapabilityRecord,
  type GraphEdge,
  type GraphNode,
  type SystemGraph,
} from '../../../core/index.js';
import {
  ADAPTER_CONTRACT_VERSION,
  snapshotId,
  type AdapterApplyInput,
  type AdapterApplyResult,
  type AdapterDefinition,
  type AdapterExtractInput,
  type AdapterExtractResult,
  type AdapterPlanChecksInput,
  type AdapterPlanFixInput,
  type AdapterPlanFixResult,
} from '../types.js';
import { applyAdapterPatch } from '../apply.js';
import { AdapterRegistry } from '../registry/index.js';

/**
 * Python adapter (L3: extraction, fix planning, check planning).
 *
 * The extraction runs CPython's own `ast` module in a separate interpreter
 * process, so the parse is the real language grammar rather than a text
 * approximation. The helper script is a reviewed platform component, not
 * something loaded from a customer repository.
 *
 * Dynamic constructs — `importlib.import_module`, `getattr`, `__import__`,
 * computed subscriptions — are reported as unknowns and keep the edge
 * unresolved. They are never dropped: a dynamic binding that silently
 * disappeared would read as "no impact" (NEG3-02). Fix planning likewise
 * refuses a patch when a dynamic construct could touch the changed entity.
 */

export const PYTHON_ADAPTER_VERSION = '1.1.0';

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
    'Fix planning covers field_rename and route_path_change over statically resolved references.',
  ],
  toolchainIdentities: {},
});

export const PYTHON_DJANGO_KEY: CapabilityKey = {
  ecosystem: 'python',
  language: 'python',
  framework: 'django',
  versionRange: '>=5.1 <5.3',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'python-linux',
  adapterVersion: PYTHON_ADAPTER_VERSION,
};

export const PYTHON_DJANGO_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: PYTHON_DJANGO_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Dynamic imports and getattr-based binding are reported as unresolved.',
    'Fix planning covers field_rename and route_path_change over statically resolved references.',
  ],
  toolchainIdentities: {},
});

export const PYTHON_PYDANTIC_KEY: CapabilityKey = {
  ecosystem: 'python',
  language: 'python',
  framework: 'pydantic',
  versionRange: '>=2.0 <3.0',
  componentKind: 'api',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'python-linux',
  adapterVersion: PYTHON_ADAPTER_VERSION,
};

export const PYTHON_PYDANTIC_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: PYTHON_PYDANTIC_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Dynamic imports and getattr-based binding are reported as unresolved.',
    'Fix planning covers field_rename and route_path_change over statically resolved references.',
  ],
  toolchainIdentities: {},
});

export const PYTHON_SQLALCHEMY_KEY: CapabilityKey = {
  ecosystem: 'python',
  language: 'python',
  framework: 'sqlalchemy',
  versionRange: '>=2.0 <3.0',
  componentKind: 'persistence',
  changeCategory: 'schema',
  featureRestrictions: [],
  runnerProfile: 'python-linux',
  adapterVersion: PYTHON_ADAPTER_VERSION,
};

export const PYTHON_SQLALCHEMY_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: PYTHON_SQLALCHEMY_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Dynamic imports and getattr-based binding are reported as unresolved.',
    'Fix planning covers field_rename and route_path_change over statically resolved references.',
    'Migration generation (alembic revision) is not planned; see the migrations module.',
  ],
  toolchainIdentities: {},
});

const registeredCapabilities = new AdapterRegistry([
  PYTHON_ADAPTER_RECORD,
  PYTHON_DJANGO_RECORD,
  PYTHON_PYDANTIC_RECORD,
  PYTHON_SQLALCHEMY_RECORD,
]);

// Private helper protocol: the identity is emitted by the same interpreter
// process that parsed the source, rather than copied from the requested pin.
// Protocol v2 adds position-carrying facts for fix planning (`attr`, `field`,
// `kw`, `str`, `fstr`); the graph builder skips them, the planner consumes them.
const PythonParseResultSchema = z.object({
  schemaVersion: z.literal('2'),
  pythonVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  errors: z.array(z.string()),
  facts: z.array(z.object({
    kind: z.enum(['route', 'model', 'import', 'dynamic', 'attr', 'field', 'kw', 'str', 'fstr']),
    file: z.string(),
    line: z.number().int().positive(),
    name: z.string(),
    detail: z.string(),
    resolved: z.boolean(),
    col: z.number().int().nonnegative().optional(),
    length: z.number().int().positive().optional(),
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

    # Typing generics (Mapped[int], list[str]) are static annotations,
    # not computed subscriptions. Only runtime-position subscripts stay dynamic.
    annotated = set()
    for node in ast.walk(tree):
        positions = []
        if isinstance(node, ast.AnnAssign):
            positions.append(node.annotation)
        elif isinstance(node, ast.arg):
            if node.annotation is not None:
                positions.append(node.annotation)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.returns is not None:
                positions.append(node.returns)
        for position in positions:
            for child in ast.walk(position):
                annotated.add(id(child))

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
            if isinstance(func, ast.Name) and func.id in ('path', 're_path') and node.args:
                first = node.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    facts.append({
                        'kind': 'route', 'file': path, 'line': node.lineno,
                        'name': first.value, 'detail': 'URLCONF',
                        'resolved': True,
                    })

        # Position-carrying facts for fix planning (protocol v2). The graph
        # builder skips these; the planner turns them into precise edits.
        if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load):
            attr_col = node.end_col_offset - len(node.attr)
            facts.append({
                'kind': 'attr', 'file': path, 'line': node.lineno,
                'name': node.attr, 'detail': '', 'resolved': True,
                'col': attr_col, 'length': len(node.attr),
            })

        if isinstance(node, ast.ClassDef):
            for stmt in node.body:
                targets = []
                if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                    targets = [stmt.target.id]
                elif isinstance(stmt, ast.Assign):
                    targets = [t.id for t in stmt.targets if isinstance(t, ast.Name)]
                for target in targets:
                    facts.append({
                        'kind': 'field', 'file': path, 'line': stmt.lineno,
                        'name': target, 'detail': node.name, 'resolved': True,
                    })

        if isinstance(node, ast.Call):
            for keyword in node.keywords:
                if keyword.arg:
                    facts.append({
                        'kind': 'kw', 'file': path, 'line': keyword.lineno,
                        'name': keyword.arg, 'detail': '', 'resolved': True,
                        'col': keyword.col_offset, 'length': len(keyword.arg),
                    })

        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            facts.append({
                'kind': 'str', 'file': path, 'line': node.lineno,
                'name': node.value, 'detail': '', 'resolved': True,
                'col': node.col_offset,
                'length': node.end_col_offset - node.col_offset,
            })

        if isinstance(node, ast.JoinedStr):
            static = ''.join(v.value for v in node.values if isinstance(v, ast.Constant))
            facts.append({
                'kind': 'fstr', 'file': path, 'line': node.lineno,
                'name': static, 'detail': '', 'resolved': True,
            })

        if isinstance(node, ast.Subscript) and not isinstance(node.slice, ast.Constant) and id(node) not in annotated:
            facts.append({
                'kind': 'dynamic', 'file': path, 'line': node.lineno,
                'name': 'subscript', 'detail': 'computed subscription',
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
    'schemaVersion': '2',
    'pythonVersion': '.'.join(map(str, sys.version_info[:3])),
    'facts': results,
    'errors': errors,
}))
`;

export const PYTHON_ADAPTER: AdapterDefinition = {
  name: 'python',
  contractVersion: ADAPTER_CONTRACT_VERSION,
  key: PYTHON_KEY,
  records: [PYTHON_ADAPTER_RECORD, PYTHON_DJANGO_RECORD, PYTHON_PYDANTIC_RECORD, PYTHON_SQLALCHEMY_RECORD],

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

      // Planner-only facts (protocol v2) carry edit positions, not graph
      // structure. They never become import edges.
      if (fact.kind === 'attr' || fact.kind === 'field' || fact.kind === 'kw' || fact.kind === 'str' || fact.kind === 'fstr') {
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

  async planFix(input: AdapterPlanFixInput): Promise<AdapterPlanFixResult> {
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      const reason = 'Unregistered or invalid Python capability tuple: fix planning refuses unknown scope.';
      return { status: 'unsupported', patch: null, unknowns: [], unsupportedSurfaces: [reason], diagnostics: [] };
    }
    const request = AdapterFixRequestSchema.safeParse(input.request);
    if (!request.success) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Malformed fix request: ${request.error.message}`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    const extracted = await PYTHON_ADAPTER.extract({
      root: input.root,
      files: input.files,
      version: input.version,
      capability: input.capability,
    });
    if (extracted.status !== 'ok') {
      return {
        status: 'failed',
        patch: null,
        unknowns: [...extracted.unknowns],
        unsupportedSurfaces: [...extracted.unsupportedSurfaces],
        diagnostics: [...extracted.diagnostics],
      };
    }
    try {
      const facts = await collectPythonFacts(input);
      if (facts.pythonVersion !== input.version) {
        return {
          status: 'failed',
          patch: null,
          unknowns: [`Python toolchain mismatch: requested ${input.version}, observed ${facts.pythonVersion}.`],
          unsupportedSurfaces: [],
          diagnostics: [],
        };
      }
      return planPythonFix(input, request.data, facts.facts, extracted.graph);
    } catch (error) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [error instanceof Error ? error.message : 'Python fact collection failed.'],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
  },

  async applyPatch(input: AdapterApplyInput): Promise<AdapterApplyResult> {
    return applyAdapterPatch(input);
  },

  async planChecks(input: AdapterPlanChecksInput): Promise<AdapterCheckPlan> {
    const patch = AdapterPatchSchema.parse(input.patch);
    if (digestAdapterPatch(patch) !== patch.patchDigest) {
      throw new ChangeProofError('Patch digest mismatch; refusing to plan checks for a changed candidate.');
    }
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      throw new ChangeProofError('Unregistered Python capability tuple; refusing to plan checks for unknown scope.');
    }
    const request = AdapterFixRequestSchema.safeParse(input.request);
    if (!request.success) {
      throw new ChangeProofError('Malformed fix request; refusing to plan checks without a known change.');
    }
    const framework = capability.data.key.framework;
    if (framework !== 'fastapi' && framework !== 'django' && framework !== 'pydantic' && framework !== 'sqlalchemy') {
      throw new ChangeProofError(`No Python check plan for framework "${framework}".`);
    }
    const entity = splitEntity(request.data.entity);
    if (entity === null) {
      throw new ChangeProofError(`Entity "${request.data.entity}" is not module-qualified; expected "module.Symbol".`);
    }
    const checks =
      framework === 'django'
        ? [
            {
              checkId: 'django-test',
              kind: 'test' as const,
              command: 'python',
              args: ['manage.py', 'test'],
              cwd: input.root,
              timeoutMs: 180_000,
              required: true,
            },
          ]
        : [
            {
              checkId: 'compileall',
              kind: 'build' as const,
              command: 'python',
              args: ['-m', 'compileall', '-q', '.'],
              cwd: input.root,
              timeoutMs: 120_000,
              required: true,
            },
            {
              checkId: 'import-module',
              kind: 'test' as const,
              command: 'python',
              args: ['-c', `import ${entity.module}`],
              cwd: input.root,
              timeoutMs: 60_000,
              required: true,
            },
          ];
    return Promise.resolve(
      AdapterCheckPlanSchema.parse({
        schemaVersion: '1',
        planId: `plan-${patch.patchDigest.slice(0, 12)}`,
        patchDigest: patch.patchDigest,
        checks,
        runnerIdentity: input.runnerIdentity,
      }),
    );
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

type PythonFact = z.infer<typeof PythonParseResultSchema>['facts'][number];

async function collectPythonFacts(
  input: AdapterPlanFixInput,
): Promise<{ facts: readonly PythonFact[]; pythonVersion: string }> {
  const entries: { file: string; source: string }[] = [];
  for (const file of input.files) {
    if (!file.endsWith('.py')) continue;
    try {
      entries.push({ file, source: readFileSync(join(input.root, file), 'utf8') });
    } catch {
      throw new ChangeProofError(`Cannot plan without reading ${file}; hidden references fail closed.`);
    }
  }
  if (entries.length === 0) {
    throw new ChangeProofError('No Python source file could be read; refusing to plan blind.');
  }
  const { runNative, parseNativeJson } = await import('../native/process.js');
  const run = await runNative('python', ['-c', PARSE_HELPER], {
    cwd: input.root,
    timeoutMs: 30_000,
    maxOutputBytes: 4 * 1024 * 1024,
    input: JSON.stringify(entries),
  });
  if (run.exitCode !== 0) {
    throw new ChangeProofError(`Python helper failed with exit code ${run.exitCode}; refusing to plan blind.`);
  }
  const parsed = PythonParseResultSchema.safeParse(parseNativeJson(run.stdout));
  if (!parsed.success) {
    throw new ChangeProofError('Python helper did not return a valid fact set; refusing to plan blind.');
  }
  if (parsed.data.errors.length > 0) {
    throw new ChangeProofError(`Python sources carry syntax errors: ${parsed.data.errors.join('; ')}`);
  }
  return { facts: parsed.data.facts, pythonVersion: parsed.data.pythonVersion };
}

function splitEntity(entity: string): { module: string; symbol: string } | null {
  const dot = entity.lastIndexOf('.');
  if (dot <= 0 || dot === entity.length - 1) return null;
  return { module: entity.slice(0, dot), symbol: entity.slice(dot + 1) };
}

function inScope(file: string, scope: readonly string[]): boolean {
  return scope.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

/** True when two dotted module spellings overlap without being equal. */
function partiallyMatches(candidate: string, module: string): boolean {
  if (candidate === module || candidate.startsWith('.')) return false;
  return candidate.startsWith(`${module}.`) || module.startsWith(`${candidate}.`);
}

interface OffsetEdit {
  readonly line: number;
  readonly col: number;
  readonly length: number;
  readonly text: string;
}

function lineStartsOf(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function applyOffsetEdits(content: string, edits: readonly OffsetEdit[]): string {
  const starts = lineStartsOf(content);
  const absolute = edits.map((edit) => {
    const lineStart = starts[edit.line - 1];
    if (lineStart === undefined) {
      throw new ChangeProofError(`Helper emitted line ${edit.line} outside the file; refusing the patch.`);
    }
    const lineEnd = content.indexOf('\n', lineStart);
    const end = lineEnd === -1 ? content.length : lineEnd;
    if (edit.col < 0 || edit.col + edit.length > end - lineStart) {
      throw new ChangeProofError('Helper emitted a column outside its line; refusing the patch.');
    }
    return { start: lineStart + edit.col, end: lineStart + edit.col + edit.length, text: edit.text };
  });
  const ordered = [...absolute].sort((left, right) => right.start - left.start);
  let result = content;
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/** Re-quote a replacement string literal with the original quoting style. */
function requote(literal: string, value: string): string {
  const match = /^([rubfRUBF]*)('''|"""|'|")/.exec(literal);
  if (match === null) {
    throw new ChangeProofError('Helper emitted a string position that is not a literal; refusing the patch.');
  }
  return `${match[1]}${match[2]}${value}${match[2]}`;
}

function readSources(root: string, files: readonly string[]): Map<string, string> {
  const contents = new Map<string, string>();
  for (const file of files) {
    if (!file.endsWith('.py')) continue;
    contents.set(file, readFileSync(join(root, file), 'utf8'));
  }
  return contents;
}

function planPythonFix(
  input: AdapterPlanFixInput,
  request: AdapterFixRequest,
  facts: readonly PythonFact[],
  graph: SystemGraph,
): AdapterPlanFixResult {
  const entity = splitEntity(request.entity);
  if (entity === null) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Entity "${request.entity}" is not module-qualified; expected "module.Symbol".`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  if (request.changeKind === 'field_rename') {
    return planPythonFieldRename(input, request, entity, facts, graph);
  }
  return planPythonRouteChange(input, request, facts, graph);
}

function consumerFilesOf(facts: readonly PythonFact[], module: string): { consumers: Set<string>; ambiguous: string[] } {
  const consumers = new Set<string>();
  const ambiguous: string[] = [];
  for (const fact of facts) {
    if (fact.kind !== 'import') continue;
    for (const spelling of [fact.detail, fact.name]) {
      if (spelling === module) consumers.add(fact.file);
      else if (partiallyMatches(spelling, module)) ambiguous.push(`${fact.file} imports "${spelling}"`);
    }
  }
  return { consumers, ambiguous };
}

function buildPythonPatch(request: AdapterFixRequest, operations: AdapterPatchOperation[]) {
  const intentRefs = [request.intentRef];
  const patchId = `py-${createHash('sha256').update(`${request.requestId}:${request.entity}:${request.before}:${request.after}`).digest('hex').slice(0, 12)}`;
  return {
    schemaVersion: '1' as const,
    patchId,
    intentRefs,
    operations,
    patchDigest: digestAdapterPatch({ intentRefs, operations }),
  };
}

function planPythonFieldRename(
  input: AdapterPlanFixInput,
  request: AdapterFixRequest,
  entity: { module: string; symbol: string },
  facts: readonly PythonFact[],
  graph: SystemGraph,
): AdapterPlanFixResult {
  const afterDeclared = facts.some(
    (fact) => fact.kind === 'field' && fact.detail === entity.symbol && fact.name === request.after,
  );
  if (!afterDeclared) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [
        `After-state "${request.after}" is not declared on "${entity.symbol}"; refusing to plan against an unobserved change.`,
      ],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const { consumers, ambiguous } = consumerFilesOf(facts, entity.module);
  if (ambiguous.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: ambiguous.map(
        (entry) => `${entry}: the binding to "${entity.module}" is ambiguous; static planning refuses to guess.`,
      ),
      diagnostics: [],
    };
  }
  const defFiles = new Set(
    facts.filter((fact) => fact.kind === 'field' && fact.detail === entity.symbol).map((fact) => fact.file),
  );
  const dynamicBlockers = [...consumers, ...defFiles].filter((file) =>
    facts.some((fact) => fact.kind === 'dynamic' && fact.file === file),
  );
  if (dynamicBlockers.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: dynamicBlockers.map(
        (file) => `Dynamic access in ${file} could touch "${entity.symbol}"; static planning refuses hidden gaps.`,
      ),
      diagnostics: [],
    };
  }

  const contents = readSources(input.root, input.files);
  const operations: AdapterPatchOperation[] = [];
  const outOfScope: string[] = [];
  const unproven: string[] = [];
  const candidates = facts.filter(
    (fact) =>
      (fact.kind === 'attr' || fact.kind === 'kw') &&
      fact.name === request.before &&
      fact.col !== undefined &&
      fact.length !== undefined,
  );
  const byFile = new Map<string, typeof candidates>();
  for (const fact of candidates) {
    const list = byFile.get(fact.file) ?? [];
    list.push(fact);
    byFile.set(fact.file, list);
  }
  for (const [file, matches] of byFile) {
    const known = consumers.has(file) || defFiles.has(file);
    if (!known) {
      unproven.push(file);
      continue;
    }
    if (!inScope(file, request.scope)) {
      outOfScope.push(file);
      continue;
    }
    const content = contents.get(file);
    if (content === undefined) continue;
    const edits: OffsetEdit[] = [];
    for (const fact of matches) {
      if (fact.col === undefined || fact.length === undefined) continue;
      edits.push({ line: fact.line, col: fact.col, length: fact.length, text: request.after });
    }
    let patched: string;
    try {
      patched = applyOffsetEdits(content, edits);
    } catch (error) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [error instanceof Error ? error.message : 'Edit positions failed validation.'],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    const refs = graph.edges
      .filter((edge) => edge.from === `component:${file}` && edge.resolution === 'proven')
      .map((edge) => edge.id);
    operations.push({
      operation: 'write',
      path: file,
      content: patched,
      impactRefs: refs.length > 0 ? refs : [`component:${file}`],
    });
  }
  if (unproven.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: unproven.map(
        (file) => `"${request.before}" is read in ${file} without a proven import edge to "${entity.module}".`,
      ),
      diagnostics: [],
    };
  }
  if (outOfScope.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: outOfScope.map(
        (file) => `"${entity.symbol}" is referenced from ${file}, outside the approved scope.`,
      ),
      diagnostics: [],
    };
  }
  if (operations.length === 0) {
    return {
      status: 'no_impact',
      patch: null,
      unknowns: [`"${entity.symbol}" has no consumer reference to "${request.before}" in scope; no patch planned.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  return { status: 'ok', patch: buildPythonPatch(request, operations), unknowns: [], unsupportedSurfaces: [], diagnostics: [] };
}

function planPythonRouteChange(
  input: AdapterPlanFixInput,
  request: AdapterFixRequest,
  facts: readonly PythonFact[],
  graph: SystemGraph,
): AdapterPlanFixResult {
  const observed = facts.some((fact) => fact.kind === 'route' && fact.name === request.before);
  if (!observed) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Route "${request.before}" was not observed in the snapshot; refusing to plan blind.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const ambiguous = facts.find((fact) => fact.kind === 'fstr' && fact.name.includes(request.before));
  if (ambiguous !== undefined) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: [
        `Route "${request.before}" is embedded in an f-string in ${ambiguous.file}; static planning refuses to guess the pattern.`,
      ],
      diagnostics: [],
    };
  }
  const contents = readSources(input.root, input.files);
  const operations: AdapterPatchOperation[] = [];
  const outOfScope: string[] = [];
  const byFile = new Map<string, PythonFact[]>();
  for (const fact of facts) {
    if (fact.kind !== 'str' || fact.name !== request.before || fact.col === undefined || fact.length === undefined) continue;
    const list = byFile.get(fact.file) ?? [];
    list.push(fact);
    byFile.set(fact.file, list);
  }
  for (const [file, matches] of byFile) {
    if (!inScope(file, request.scope)) {
      outOfScope.push(file);
      continue;
    }
    const content = contents.get(file);
    if (content === undefined) continue;
    const starts = lineStartsOf(content);
    const edits: OffsetEdit[] = [];
    for (const fact of matches) {
      const lineStart = starts[fact.line - 1];
      if (lineStart === undefined || fact.col === undefined || fact.length === undefined) {
        return {
          status: 'failed',
          patch: null,
          unknowns: ['Helper emitted a string position outside its file; refusing the patch.'],
          unsupportedSurfaces: [],
          diagnostics: [],
        };
      }
      const literal = content.slice(lineStart + fact.col, lineStart + fact.col + fact.length);
      try {
        edits.push({ line: fact.line, col: fact.col, length: fact.length, text: requote(literal, request.after) });
      } catch (error) {
        return {
          status: 'failed',
          patch: null,
          unknowns: [error instanceof Error ? error.message : 'String re-quoting failed.'],
          unsupportedSurfaces: [],
          diagnostics: [],
        };
      }
    }
    let patched: string;
    try {
      patched = applyOffsetEdits(content, edits);
    } catch (error) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [error instanceof Error ? error.message : 'Edit positions failed validation.'],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    const refs = graph.edges
      .filter((edge) => edge.from === `component:${file}` && edge.to.startsWith('endpoint:') && edge.resolution === 'proven')
      .map((edge) => edge.id);
    operations.push({
      operation: 'write',
      path: file,
      content: patched,
      impactRefs: refs.length > 0 ? refs : [`component:${file}`],
    });
  }
  if (outOfScope.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: outOfScope.map(
        (file) => `Route "${request.before}" is referenced from ${file}, outside the approved scope.`,
      ),
      diagnostics: [],
    };
  }
  if (operations.length === 0) {
    return {
      status: 'no_impact',
      patch: null,
      unknowns: [`Route "${request.before}" has no in-scope literal to update; no patch planned.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  return { status: 'ok', patch: buildPythonPatch(request, operations), unknowns: [], unsupportedSurfaces: [], diagnostics: [] };
}
