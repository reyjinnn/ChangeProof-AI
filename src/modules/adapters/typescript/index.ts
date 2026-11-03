import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import type * as Ts from 'typescript';

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
import { AdapterRegistry } from '../registry/index.js';
import { applyAdapterPatch } from '../apply.js';
import { runNative } from '../native/process.js';
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

/**
 * TypeScript adapter (L3: extraction, fix planning, check planning).
 *
 * Uses the trusted, pinned TypeScript compiler API, so extraction and fix
 * planning are done by the real parser rather than by text heuristics.
 *
 * Three properties are deliberate:
 *
 *  - A resolved symbol reference becomes a `proven` edge with an evidence
 *    locator. A reference the compiler cannot resolve to a known symbol becomes
 *    an `unresolved` edge with a reason, never a silent omission (NEG3-02).
 *  - A rename is kept as a hypothesis with its raw evidence, not asserted as
 *    a fact (FR3-04).
 *  - Fix planning rewrites only statically resolved references. A dynamic or
 *    computed access that could touch the changed entity fails the plan as
 *    `unsupported` instead of shipping a patch with hidden gaps (NEG3-02).
 */

export const TYPESCRIPT_ADAPTER_VERSION = '1.1.0';

export const TYPESCRIPT_KEY: CapabilityKey = {
  ecosystem: 'typescript',
  language: 'typescript',
  framework: 'next',
  versionRange: '>=15.0.0 <16.0.0',
  componentKind: 'frontend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'node-linux',
  adapterVersion: TYPESCRIPT_ADAPTER_VERSION,
};

export const TYPESCRIPT_ADAPTER_RECORD: CapabilityRecord = {
  schemaVersion: '2',
  key: TYPESCRIPT_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Dynamic member access through a computed key is reported as unresolved, not resolved.',
    'Fix planning covers field_rename and route_path_change over statically resolved references.',
    'Next.js file-system route moves (relocating route files) are not planned.',
  ],
  toolchainIdentities: {},
};

export const TYPESCRIPT_EXPRESS_KEY: CapabilityKey = {
  ecosystem: 'typescript',
  language: 'typescript',
  framework: 'express',
  versionRange: '>=4.21.0 <5.0.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'node-linux',
  adapterVersion: TYPESCRIPT_ADAPTER_VERSION,
};

export const TYPESCRIPT_EXPRESS_RECORD: CapabilityRecord = {
  schemaVersion: '2',
  key: TYPESCRIPT_EXPRESS_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Dynamic member access through a computed key is reported as unresolved, not resolved.',
    'Fix planning covers field_rename and route_path_change over statically resolved references.',
  ],
  toolchainIdentities: {},
};

export const TYPESCRIPT_REACT_KEY: CapabilityKey = {
  ecosystem: 'typescript',
  language: 'typescript',
  framework: 'react',
  versionRange: '>=19.0.0 <20.0.0',
  componentKind: 'frontend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'node-linux',
  adapterVersion: TYPESCRIPT_ADAPTER_VERSION,
};

export const TYPESCRIPT_REACT_RECORD: CapabilityRecord = {
  schemaVersion: '2',
  key: TYPESCRIPT_REACT_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Dynamic member access through a computed key is reported as unresolved, not resolved.',
    'Fix planning covers field_rename and route_path_change over statically resolved references.',
  ],
  toolchainIdentities: {},
};

export const TYPESCRIPT_NESTJS_KEY: CapabilityKey = {
  ecosystem: 'typescript',
  language: 'typescript',
  framework: 'nestjs',
  versionRange: '>=11.0.0 <12.0.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'node-linux',
  adapterVersion: TYPESCRIPT_ADAPTER_VERSION,
};

export const TYPESCRIPT_NESTJS_RECORD: CapabilityRecord = {
  schemaVersion: '2',
  key: TYPESCRIPT_NESTJS_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Only literal @Controller/@Get/@Post/@Put/@Delete/@Patch/@All paths are resolved; computed decorators stay unobserved.',
    'A route change that crosses the controller prefix is refused; the controller move is not planned.',
  ],
  toolchainIdentities: {},
};

export const TYPESCRIPT_FASTIFY_KEY: CapabilityKey = {
  ecosystem: 'typescript',
  language: 'typescript',
  framework: 'fastify',
  versionRange: '>=5.0.0 <6.0.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'node-linux',
  adapterVersion: TYPESCRIPT_ADAPTER_VERSION,
};

export const TYPESCRIPT_FASTIFY_RECORD: CapabilityRecord = {
  schemaVersion: '2',
  key: TYPESCRIPT_FASTIFY_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Dynamic member access through a computed key is reported as unresolved, not resolved.',
    'Fix planning covers field_rename and route_path_change over statically resolved references.',
  ],
  toolchainIdentities: {},
};

export const TYPESCRIPT_PRISMA_KEY: CapabilityKey = {
  ecosystem: 'typescript',
  language: 'typescript',
  framework: 'prisma',
  versionRange: '>=6.0.0 <7.0.0',
  componentKind: 'persistence',
  changeCategory: 'schema',
  featureRestrictions: [],
  runnerProfile: 'node-linux',
  adapterVersion: TYPESCRIPT_ADAPTER_VERSION,
};

export const TYPESCRIPT_PRISMA_RECORD: CapabilityRecord = {
  schemaVersion: '2',
  key: TYPESCRIPT_PRISMA_KEY,
  targetLevel: 'L3',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Schema facts come from a structural scan gated by native prisma validate; only model/view fields are modeled.',
    'Field renames cover the schema file only; any TypeScript usage of the old field fails the plan (client co-rename is not planned).',
    'Datasource/generator blocks are validated but not modeled as impact nodes.',
  ],
  toolchainIdentities: {},
};

const registeredCapabilities = new AdapterRegistry([
  TYPESCRIPT_ADAPTER_RECORD,
  TYPESCRIPT_EXPRESS_RECORD,
  TYPESCRIPT_REACT_RECORD,
  TYPESCRIPT_NESTJS_RECORD,
  TYPESCRIPT_FASTIFY_RECORD,
  TYPESCRIPT_PRISMA_RECORD,
]);

interface ReferenceFact {
  readonly fromFile: string;
  readonly line: number;
  readonly symbol: string;
  readonly module: string;
  readonly imported: string;
  readonly resolved: boolean;
  readonly reason?: string;
}

interface EndpointFact {
  readonly file: string;
  readonly line: number;
  readonly route: string;
  readonly method: string;
  readonly symbol: string;
  readonly evidenceMethod: string;
}

export const TYPESCRIPT_ADAPTER: AdapterDefinition = {
  name: 'typescript',
  contractVersion: ADAPTER_CONTRACT_VERSION,
  key: TYPESCRIPT_KEY,
  records: [
    TYPESCRIPT_ADAPTER_RECORD,
    TYPESCRIPT_EXPRESS_RECORD,
    TYPESCRIPT_REACT_RECORD,
    TYPESCRIPT_NESTJS_RECORD,
    TYPESCRIPT_FASTIFY_RECORD,
    TYPESCRIPT_PRISMA_RECORD,
  ],

  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    const snapshot = snapshotId(input.root, input.version);
    const ts = (await import('typescript'));

    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      const reason = capability.success
        ? `Unregistered TypeScript capability tuple: ${JSON.stringify(capability.data.key)}`
        : 'Invalid TypeScript capability record: expected CapabilityRecord v2 for a registered tuple.';
      return {
        status: 'unsupported',
        graph: emptyGraph(snapshot),
        unknowns: [reason],
        unsupportedSurfaces: [reason],
        diagnostics: [],
        toolchainIdentity: `typescript@${ts.version}`,
      };
    }

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const unknowns: string[] = [];
    const diagnostics: string[] = [];

    const sources: { file: string; content: string }[] = [];
    for (const file of input.files) {
      try {
        sources.push({ file, content: readFileSync(join(input.root, file), 'utf8') });
      } catch (error) {
        diagnostics.push(`Could not read ${file}: ${(error as Error).message}`);
      }
    }

    if (sources.length === 0) {
      return {
        status: 'failed',
        graph: emptyGraph(snapshot),
        unknowns: ['no source file could be read'],
        unsupportedSurfaces: [],
        diagnostics,
        toolchainIdentity: `typescript@${ts.version}`,
      };
    }

    const referenceFacts: ReferenceFact[] = [];
    const endpointFacts: EndpointFact[] = [];

    for (const source of sources) {
      if (source.file.endsWith('.prisma')) continue;
      const scriptKind =
        source.file.endsWith('.tsx') || source.file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const sourceFile = ts.createSourceFile(
        source.file,
        source.content,
        ts.ScriptTarget.ES2023,
        true,
        scriptKind,
      );

      const visit = (node: Ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const moduleName = node.moduleSpecifier.text;
          const clause = node.importClause;

          if (clause?.namedBindings === undefined) {
            if (clause?.name !== undefined) {
              referenceFacts.push({
                fromFile: source.file,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                symbol: clause.name.text,
                module: moduleName,
                imported: '*',
                resolved: false,
                reason: 'default import: the bound symbol is not statically known',
              });
            }
          } else if (ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
              referenceFacts.push({
                fromFile: source.file,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                symbol: element.name.text,
                module: moduleName,
                imported: element.propertyName?.text ?? element.name.text,
                resolved: true,
              });
            }
          } else if (ts.isNamespaceImport(clause.namedBindings)) {
            // `import * as ns` binds the whole module. The members that are
            // actually used are found at the usage site; until then the edge
            // stays unresolved rather than being dropped.
            referenceFacts.push({
              fromFile: source.file,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              symbol: clause.namedBindings.name.text,
              module: moduleName,
              imported: '*',
              resolved: false,
              reason: 'namespace import: individual members are not statically known',
            });
          }
        }

        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          if (method === 'get' || method === 'post' || method === 'put' || method === 'delete') {
            const [firstArgument] = node.arguments;
            if (firstArgument !== undefined && ts.isStringLiteral(firstArgument)) {
              endpointFacts.push({
                file: source.file,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                route: firstArgument.text,
                method: method.toUpperCase(),
                symbol: `${method} ${firstArgument.text}`,
                evidenceMethod: 'typescript-compiler-call-expression',
              });
            }
          }
        }

        // `fetch('/api/orders/...')` — the global fetch call carries the route.
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
          const [firstArgument] = node.arguments;
          if (firstArgument !== undefined) {
            if (ts.isStringLiteral(firstArgument)) {
              endpointFacts.push({
                file: source.file,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                route: firstArgument.text,
                method: 'GET',
                symbol: `GET ${firstArgument.text}`,
                evidenceMethod: 'typescript-compiler-call-expression',
              });
            } else if (ts.isTemplateExpression(firstArgument)) {
              // A template route with substitutions is a route *pattern*; the
              // literal head is recorded and the substitution stays visible.
              const head = firstArgument.head;
              endpointFacts.push({
                file: source.file,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                route: head.text,
                method: 'GET',
                symbol: `GET ${head.text}`,
                evidenceMethod: 'typescript-compiler-call-expression',
              });
            }
          }
        }

        // A computed member access on an imported namespace cannot be resolved
        // statically. It stays visible as an unresolved edge.
        if (
          ts.isElementAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          !ts.isStringLiteral(node.argumentExpression)
        ) {
          unknowns.push(
            `Dynamic member access in ${source.file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} ` +
              `cannot be resolved statically (${node.expression.text}[computed])`,
          );
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
      await collectDecoratorRoutes(sourceFile, source.file, endpointFacts, unknowns);
    }

    const prismaFiles = sources.filter((source) => source.file.endsWith('.prisma'));
    let prismaVersion: string | null = null;
    if (prismaFiles.length > 0) {
      const validated = await validatePrismaSchemas(input.root, prismaFiles.map((source) => source.file));
      if (!validated.ok) {
        return {
          status: 'failed',
          graph: emptyGraph(snapshot),
          unknowns: validated.errors,
          unsupportedSurfaces: [],
          diagnostics,
          toolchainIdentity: `typescript@${ts.version}`,
        };
      }
      prismaVersion = validated.version;
      for (const source of prismaFiles) {
        collectPrismaFacts(source.file, source.content, nodes, edges, unknowns, snapshot);
      }
    }

    // Resolve imports against the files that were actually read.
    const knownExports = new Map<string, Set<string>>();
    for (const source of sources) {
      const exported = new Set<string>();
      const sourceFile = ts.createSourceFile(source.file, source.content, ts.ScriptTarget.ES2023, true);
      for (const statement of sourceFile.statements) {
        const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
        const isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
        if (!isExported) continue;
        if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
          exported.add(statement.name.text);
        }
        if (ts.isInterfaceDeclaration(statement)) {
          exported.add(statement.name.text);
        }
        if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
          exported.add(statement.name.text);
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) exported.add(declaration.name.text);
          }
        }
      }
      knownExports.set(normaliseModule(source.file), exported);
    }

    const nodeId = (kind: string, identifier: string): string => `${kind}:${identifier}`;

    for (const source of sources) {
      const moduleId = nodeId('component', source.file);
      nodes.set(moduleId, {
        id: moduleId,
        kind: 'component',
        locator: source.file,
        snapshot,
        label: source.file,
      });
    }

    for (const fact of referenceFacts) {
      const targetModule = normaliseModule(fact.module, fact.fromFile);
      const targetId = nodeId('symbol', `${targetModule}#${fact.imported}`);

      const exported = knownExports.get(targetModule);
      const resolved = exported?.has(fact.imported) ?? false;

      // Preserve the observed import reference even when its definition is
      // outside this snapshot. Its edge remains explicitly unresolved below.
      if (!nodes.has(targetId)) {
        nodes.set(targetId, {
          id: targetId,
          kind: 'symbol',
          locator: targetModule,
          snapshot,
          label: fact.imported,
        });
      }

      const fromId = nodeId('component', fact.fromFile);
      if (!nodes.has(fromId)) continue;

      if (resolved) {
        edges.push({
          id: `edge:${fromId}->${targetId}`,
          kind: 'calls',
          from: fromId,
          to: targetId,
          resolution: 'proven',
          evidence: {
            locator: `${fact.fromFile}:${fact.line}`,
            snapshot,
            method: 'typescript-compiler-import-resolution',
          },
          runtimeObserved: false,
        });
      } else {
        edges.push({
          id: `edge:${fromId}->${targetId}`,
          kind: 'calls',
          from: fromId,
          to: targetId,
          resolution: 'unresolved',
          unresolvedReason:
            fact.reason ??
            `Import "${fact.imported}" from "${fact.module}" could not be resolved to an exported symbol in the analysed snapshot`,
          runtimeObserved: false,
        });
        unknowns.push(
          `Unresolved import "${fact.imported}" from "${fact.module}" referenced at ${fact.fromFile}:${fact.line}`,
        );
      }
    }

    for (const fact of endpointFacts) {
      const endpointId = nodeId('endpoint', `${fact.method} ${fact.route}`);
      nodes.set(endpointId, {
        id: endpointId,
        kind: 'endpoint',
        locator: `${fact.file}:${fact.line}`,
        snapshot,
        label: `${fact.method} ${fact.route}`,
      });

      const fromId = nodeId('component', fact.file);
      if (!nodes.has(fromId)) continue;

      edges.push({
        id: `edge:${fromId}->${endpointId}`,
        kind: 'calls',
        from: fromId,
        to: endpointId,
        resolution: 'proven',
        evidence: {
          locator: `${fact.file}:${fact.line}`,
          snapshot,
          method: fact.evidenceMethod,
        },
        runtimeObserved: false,
      });
    }

    return {
      status: 'ok',
      graph: SystemGraphSchema.parse({ schemaVersion: '1', snapshot, nodes: [...nodes.values()], edges }),
      unknowns,
      unsupportedSurfaces: [],
      diagnostics,
      toolchainIdentity:
        prismaVersion === null ? `typescript@${ts.version}` : `typescript@${ts.version}+prisma@${prismaVersion}`,
    };
  },

  async planFix(input: AdapterPlanFixInput): Promise<AdapterPlanFixResult> {
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      const reason = 'Unregistered or invalid TypeScript capability tuple: fix planning refuses unknown scope.';
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
    const extracted = await TYPESCRIPT_ADAPTER.extract({
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
    return planTypeScriptFix(input, request.data, extracted.graph, [...extracted.unknowns]);
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
      throw new ChangeProofError('Unregistered TypeScript capability tuple; refusing to plan checks for unknown scope.');
    }
    const framework = capability.data.key.framework;
    const schemaOp =
      framework === 'prisma'
        ? patch.operations.find((operation) => operation.path.endsWith('.prisma'))
        : undefined;
    if (framework === 'prisma' && schemaOp === undefined) {
      throw new ChangeProofError('No Prisma schema in the patch; refusing to plan validation without a target.');
    }
    const checks =
      framework === 'next'
        ? [
            {
              checkId: 'next-build',
              kind: 'build' as const,
              command: 'pnpm',
              args: ['--dir', input.root, 'exec', 'next', 'build'],
              cwd: input.root,
              timeoutMs: 300_000,
              required: true,
            },
          ]
        : framework === 'express' ||
            framework === 'react' ||
            framework === 'nestjs' ||
            framework === 'fastify'
          ? [
              {
                checkId: 'tsc-noemit',
                kind: 'build' as const,
                command: 'pnpm',
                args: ['--dir', input.root, 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'],
                cwd: input.root,
                timeoutMs: 180_000,
                required: true,
              },
            ]
          : framework === 'prisma' && schemaOp !== undefined
            ? [
                {
                  checkId: 'prisma-validate',
                  kind: 'build' as const,
                  command: 'prisma',
                  args: ['validate', '--schema', schemaOp.path],
                  cwd: input.root,
                  timeoutMs: 180_000,
                  required: true,
                },
              ]
            : null;
    if (checks === null) {
      throw new ChangeProofError(`No TypeScript check plan for framework "${framework}".`);
    }
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
    nodes: [
      {
        id: 'component:empty',
        kind: 'component',
        locator: 'empty',
        snapshot,
      },
    ],
    edges: [],
  });
}

const NEST_METHOD_DECORATORS: Record<string, string> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Delete: 'DELETE',
  Patch: 'PATCH',
  All: 'ALL',
};

interface DecoratorRoute {
  readonly method: string;
  readonly route: string;
  readonly prefix: string;
  readonly path: string;
  readonly pathNode: Ts.StringLiteral | null;
  readonly line: number;
}

function joinRoute(prefix: string, path: string): string {
  const clean = (part: string): string => part.replace(/^\/+|\/+$/g, '');
  const middle = [clean(prefix), clean(path)].filter((part) => part.length > 0).join('/');
  return `/${middle}`;
}

/** NestJS `@Controller(prefix)` + `@Get(path)` routes composed from literal decorators only. */
async function decoratorRoutes(
  sourceFile: Ts.SourceFile,
): Promise<{ routes: DecoratorRoute[]; computed: number[] }> {
  const ts = await import('typescript');
  const routes: DecoratorRoute[] = [];
  const computed: number[] = [];
  const lineOf = (node: Ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const literalOf = (node: Ts.Decorator): { text: string; node: Ts.StringLiteral | null } | null => {
    if (!ts.isCallExpression(node.expression)) return { text: '', node: null };
    const [first] = node.expression.arguments;
    if (first === undefined) return { text: '', node: null };
    if (!ts.isStringLiteral(first)) return null;
    return { text: first.text, node: first };
  };
  const visit = (node: Ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      let prefix: string | null = null;
      let isController = false;
      for (const decorator of ts.getDecorators(node) ?? []) {
        const call = ts.isCallExpression(decorator.expression) ? decorator.expression : null;
        const name =
          call !== null && ts.isIdentifier(call.expression)
            ? call.expression.text
            : ts.isIdentifier(decorator.expression)
              ? decorator.expression.text
              : null;
        if (name !== 'Controller') continue;
        isController = true;
        const literal = literalOf(decorator);
        if (literal === null) {
          computed.push(lineOf(decorator));
          prefix = null;
        } else {
          prefix = literal.text;
        }
      }
      if (isController && prefix !== null) {
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          for (const decorator of ts.getDecorators(member) ?? []) {
            const call = ts.isCallExpression(decorator.expression) ? decorator.expression : null;
            const name =
              call !== null && ts.isIdentifier(call.expression) ? call.expression.text : null;
            const method = name === null ? undefined : NEST_METHOD_DECORATORS[name];
            if (method === undefined) continue;
            const literal = literalOf(decorator);
            if (literal === null) {
              computed.push(lineOf(decorator));
              continue;
            }
            routes.push({
              method,
              route: joinRoute(prefix, literal.text),
              prefix,
              path: literal.text,
              pathNode: literal.node,
              line: lineOf(decorator),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { routes, computed };
}

async function collectDecoratorRoutes(
  sourceFile: Ts.SourceFile,
  file: string,
  endpointFacts: EndpointFact[],
  unknowns: string[],
): Promise<void> {
  const { routes, computed } = await decoratorRoutes(sourceFile);
  for (const route of routes) {
    endpointFacts.push({
      file,
      line: route.line,
      route: route.route,
      method: route.method,
      symbol: `${route.method} ${route.route}`,
      evidenceMethod: 'typescript-compiler-decorator',
    });
  }
  for (const line of computed) {
    unknowns.push(
      `Computed route decorator in ${file}:${line} cannot be resolved statically; the route stays unobserved.`,
    );
  }
}

async function decoratorRouteEdits(
  sourceFile: Ts.SourceFile,
  request: AdapterFixRequest,
): Promise<{ status: 'ok'; edits: TextEdit[] } | { status: 'refuse'; reason: string }> {
  const { routes } = await decoratorRoutes(sourceFile);
  const edits: TextEdit[] = [];
  for (const route of routes) {
    if (route.route !== request.before) continue;
    const prefixPart = route.prefix === '' ? '/' : `/${route.prefix}/`;
    if (!request.after.startsWith(prefixPart)) {
      return {
        status: 'refuse',
        reason:
          `Route change "${request.before}" -> "${request.after}" crosses the controller prefix ` +
          `"${route.prefix}"; move the controller instead of renaming the path.`,
      };
    }
    const remainder = request.after.slice(prefixPart.length);
    if (remainder === '' || remainder.includes('/')) {
      return {
        status: 'refuse',
        reason:
          `Route change "${request.before}" -> "${request.after}" cannot be expressed as a single ` +
          'method-path literal; refusing to reshape the controller.',
      };
    }
    if (route.pathNode === null) {
      return {
        status: 'refuse',
        reason: `Route "${request.before}" has no method-path literal to edit; refusing to invent one.`,
      };
    }
    const quote = route.pathNode.getText().startsWith("'") ? "'" : '"';
    edits.push({
      start: route.pathNode.getStart(),
      end: route.pathNode.getEnd(),
      text: `${quote}${remainder}${quote}`,
    });
  }
  return { status: 'ok', edits };
}

const prismaRequire = createRequire(import.meta.url);

async function validatePrismaSchemas(
  root: string,
  files: readonly string[],
): Promise<{ ok: true; version: string } | { ok: false; errors: string[] }> {
  let cli: string;
  try {
    cli = prismaRequire.resolve('prisma/build/index.js');
  } catch {
    return {
      ok: false,
      errors: [
        'prisma CLI is not installed; refusing to extract schema facts without the native validator.',
      ],
    };
  }
  const errors: string[] = [];
  for (const file of files) {
    // Validate a copy in an empty directory: prisma loads `.env` from its
    // working directory, and the snapshot must never leak secrets into
    // validator output.
    const sandbox = mkdtempSync(join(tmpdir(), 'prisma-validate-'));
    try {
      const content = readFileSync(join(root, file), 'utf8');
      writeFileSync(join(sandbox, 'schema.prisma'), content, 'utf8');
      const result = await runNative(
        process.execPath,
        [cli, 'validate', '--schema', 'schema.prisma'],
        { cwd: sandbox, timeoutMs: 120_000, maxOutputBytes: 16_000 },
      );
      if (result.exitCode !== 0) {
        errors.push(`prisma validate rejected ${file}: ${(result.stdout + result.stderr).trim().slice(0, 500)}`);
      }
    } catch (error) {
      errors.push(`prisma validate could not run for ${file}: ${(error as Error).message}`);
    } finally {
      await removeDirResilient(sandbox);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, version: readPrismaVersion(cli) };
}

async function removeDirResilient(dir: string): Promise<void> {
  // A spawned validator can hold the directory briefly after exit on
  // Windows; retry rather than failing extraction on cleanup.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 3) return;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

function readPrismaVersion(cliPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(cliPath), '..', 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

interface PrismaField {
  readonly name: string;
  readonly line: number;
}

interface PrismaModel {
  readonly name: string;
  readonly line: number;
  readonly fields: PrismaField[];
}

function scanPrismaSchema(content: string): { models: PrismaModel[]; unclassified: number[] } {
  const models: PrismaModel[] = [];
  const unclassified: number[] = [];
  let current: { name: string; line: number; fields: PrismaField[] } | null = null;
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const trimmed = (lines[index] ?? '').trim();
    if (current === null) {
      const name = /^(model|view)\s+([A-Za-z_]\w*)\s*\{/.exec(trimmed)?.[2];
      if (name !== undefined) {
        current = { name, line: index + 1, fields: [] };
      }
      continue;
    }
    if (trimmed === '}') {
      models.push(current);
      current = null;
      continue;
    }
    if (
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('@@') ||
      trimmed.startsWith('@')
    ) {
      continue;
    }
    const field = /^([A-Za-z_]\w*)\s+[\w[\]?]+/.exec(trimmed)?.[1];
    if (field !== undefined) {
      current.fields.push({ name: field, line: index + 1 });
    } else {
      unclassified.push(index + 1);
    }
  }
  if (current !== null) models.push(current);
  return { models, unclassified };
}

function collectPrismaFacts(
  file: string,
  content: string,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  unknowns: string[],
  snapshot: string,
): void {
  const module = file.replace(/\.prisma$/, '');
  const { models, unclassified } = scanPrismaSchema(content);
  for (const model of models) {
    const tableId = `db_table:${module}#${model.name}`;
    nodes.set(tableId, {
      id: tableId,
      kind: 'db_table',
      locator: `${file}:${model.line}`,
      snapshot,
      label: model.name,
    });
    const fromId = `component:${file}`;
    edges.push({
      id: `edge:${fromId}->${tableId}`,
      kind: 'generates',
      from: fromId,
      to: tableId,
      resolution: 'proven',
      evidence: {
        locator: `${file}:${model.line}`,
        snapshot,
        method: 'prisma-validate-structural-scan',
      },
      runtimeObserved: false,
    });
    for (const field of model.fields) {
      const columnId = `db_column:${module}#${model.name}.${field.name}`;
      nodes.set(columnId, {
        id: columnId,
        kind: 'db_column',
        locator: `${file}:${field.line}`,
        snapshot,
        label: `${model.name}.${field.name}`,
      });
      edges.push({
        id: `edge:${tableId}->${columnId}`,
        kind: 'generates',
        from: tableId,
        to: columnId,
        resolution: 'proven',
        evidence: {
          locator: `${file}:${field.line}`,
          snapshot,
          method: 'prisma-validate-structural-scan',
        },
        runtimeObserved: false,
      });
    }
  }
  for (const line of unclassified) {
    unknowns.push(`Unclassified schema line in ${file}:${line}; kept visible, not modeled.`);
  }
}

/** Resolve a relative import specifier to a repository-relative module path. */
function normaliseModule(specifier: string, fromFile?: string): string {
  const withoutExtension = specifier.replace(/\.(?:js|jsx|ts|tsx|mjs|cjs)$/, '');
  if (!withoutExtension.startsWith('.')) {
    return withoutExtension;
  }
  if (fromFile === undefined) return withoutExtension;
  const fromDirectory = fromFile.split('/').slice(0, -1);
  const parts = withoutExtension.split('/');
  const stack = [...fromDirectory];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

export function relativeToRoot(root: string, file: string): string {
  return relative(root, file);
}

interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function applyTextEdits(content: string, edits: readonly TextEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let result = content;
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function inScope(file: string, scope: readonly string[]): boolean {
  return scope.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

function splitEntity(entity: string): { module: string; symbol: string } | null {
  const dot = entity.lastIndexOf('.');
  if (dot <= 0 || dot === entity.length - 1) return null;
  return { module: entity.slice(0, dot), symbol: entity.slice(dot + 1) };
}

interface ParsedSource {
  readonly file: string;
  readonly content: string;
  readonly sourceFile: Ts.SourceFile;
  readonly importsEntity: boolean;
}

async function parseSources(
  input: AdapterPlanFixInput,
  module: string,
): Promise<{ sources: ParsedSource[]; unreadable: string[] }> {
  const ts = await import('typescript');
  const sources: ParsedSource[] = [];
  const unreadable: string[] = [];
  for (const file of input.files) {
    let content: string;
    try {
      content = readFileSync(join(input.root, file), 'utf8');
    } catch {
      unreadable.push(file);
      continue;
    }
    const scriptKind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.ES2023, true, scriptKind);
    let importsEntity = false;
    const visit = (node: Ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (normaliseModule(node.moduleSpecifier.text, file) === module) importsEntity = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    sources.push({ file, content, sourceFile, importsEntity });
  }
  return { sources, unreadable };
}

function dynamicFileOf(unknown: string): string | null {
  const prefix = 'Dynamic member access in ';
  if (!unknown.startsWith(prefix)) return null;
  const rest = unknown.slice(prefix.length);
  const separator = rest.lastIndexOf(':');
  if (separator <= 0) return null;
  return rest.slice(0, separator);
}

async function planTypeScriptFix(
  input: AdapterPlanFixInput,
  request: AdapterFixRequest,
  graph: SystemGraph,
  unknowns: readonly string[],
): Promise<AdapterPlanFixResult> {
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
    const parsed = CapabilityRecordSchema.safeParse(input.capability);
    if (parsed.success && parsed.data.key.framework === 'prisma') {
      return planPrismaRename(input, request, graph);
    }
  }
  const { sources, unreadable } = await parseSources(input, entity.module);
  if (unreadable.length > 0) {
    return {
      status: 'failed',
      patch: null,
      unknowns: unreadable.map((file) => `Cannot plan without reading ${file}; hidden references fail closed.`),
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  if (request.changeKind === 'field_rename') {
    return planFieldRename(request, entity, sources, unknowns, graph);
  }
  return planRoutePathChange(request, sources, graph);
}

async function planPrismaRename(
  input: AdapterPlanFixInput,
  request: AdapterFixRequest,
  graph: SystemGraph,
): Promise<AdapterPlanFixResult> {
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
  const schemaFile = `${entity.module}.prisma`;
  if (!input.files.includes(schemaFile)) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Schema file "${schemaFile}" is not in the analysed snapshot; refusing to plan blind.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  let content: string;
  try {
    content = readFileSync(join(input.root, schemaFile), 'utf8');
  } catch {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Cannot plan without reading ${schemaFile}; hidden references fail closed.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  if (!inScope(schemaFile, request.scope)) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: [`"${schemaFile}" is outside the approved scope; open a scope revision instead.`],
      diagnostics: [],
    };
  }
  const { models } = scanPrismaSchema(content);
  const model = models.find((candidate) => candidate.name === entity.symbol);
  if (model === undefined) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Model "${entity.symbol}" was not found in ${schemaFile}; refusing to plan blind.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  if (!model.fields.some((field) => field.name === request.before)) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [
        `Field "${request.before}" is not declared on model "${entity.symbol}"; refusing to plan against an unobserved change.`,
      ],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  if (model.fields.some((field) => field.name === request.after)) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [
        `Model "${entity.symbol}" already declares "${request.after}"; refusing an ambiguous rename.`,
      ],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  // The prisma tuple plans schema edits only: any TypeScript usage of the
  // old field fails the plan rather than shipping a half rename.
  const ts = await import('typescript');
  const usedBy: string[] = [];
  const unreadable: string[] = [];
  for (const file of input.files) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    let source: string;
    try {
      source = readFileSync(join(input.root, file), 'utf8');
    } catch {
      unreadable.push(file);
      continue;
    }
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.ES2023,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const hits: Ts.Node[] = [];
    const visit = (node: Ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === request.before) hits.push(node);
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === request.before) {
        hits.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (hits.length > 0) usedBy.push(file);
  }
  if (unreadable.length > 0) {
    return {
      status: 'failed',
      patch: null,
      unknowns: unreadable.map((file) => `Cannot plan without reading ${file}; hidden references fail closed.`),
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  if (usedBy.length > 0) {
    return {
      status: 'failed',
      patch: null,
      unknowns: usedBy.map(
        (file) =>
          `"${request.before}" is used by TypeScript in ${file}; the prisma tuple plans schema edits only — coordinate the client rename instead.`,
      ),
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const target = model.fields.find((field) => field.name === request.before);
  if (target === undefined) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Field "${request.before}" disappeared from the scan; refusing to edit blind.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const lines = content.split('\n');
  const line = lines[target.line - 1] ?? '';
  const escaped = request.before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const renamed = line.replace(new RegExp(`^([ \\t]*)${escaped}(?=\\s)`), (_match, indent: string) => {
    return `${indent}${request.after}`;
  });
  if (renamed === line) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Field line for "${request.before}" did not match the expected shape; refusing to edit blind.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const patched = [...lines.slice(0, target.line - 1), renamed, ...lines.slice(target.line)].join('\n');
  return {
    status: 'ok',
    patch: buildPatch(request.requestId, request, [
      {
        operation: 'write',
        path: schemaFile,
        content: patched,
        impactRefs: edgeRefsFor(graph, schemaFile, `db_table:${entity.module}#${entity.symbol}`),
      },
    ]),
    unknowns: [],
    unsupportedSurfaces: [],
    diagnostics: [],
  };
}

function edgeRefsFor(graph: SystemGraph, file: string, to: string): string[] {
  const refs = graph.edges
    .filter((edge) => edge.from === `component:${file}` && edge.to === to && edge.resolution === 'proven')
    .map((edge) => edge.id);
  return refs.length > 0 ? refs : [`component:${file}`];
}

function buildPatch(requestId: string, request: AdapterFixRequest, operations: AdapterPatchOperation[]) {
  const intentRefs = [request.intentRef];
  const patchId = `ts-${createHash('sha256').update(`${requestId}:${request.entity}:${request.before}:${request.after}`).digest('hex').slice(0, 12)}`;
  return {
    schemaVersion: '1' as const,
    patchId,
    intentRefs,
    operations,
    patchDigest: digestAdapterPatch({ intentRefs, operations }),
  };
}

async function planFieldRename(
  request: AdapterFixRequest,
  entity: { module: string; symbol: string },
  sources: readonly ParsedSource[],
  unknowns: readonly string[],
  graph: SystemGraph,
): Promise<AdapterPlanFixResult> {
  const ts = await import('typescript');
  let afterDeclared = false;
  const defFiles = new Set<string>();
  for (const source of sources) {
    for (const statement of source.sourceFile.statements) {
      if (!ts.isInterfaceDeclaration(statement) && !ts.isClassDeclaration(statement)) continue;
      if (statement.name?.text !== entity.symbol) continue;
      defFiles.add(source.file);
      afterDeclared = statement.members.some(
        (member) =>
          (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) &&
          ts.isIdentifier(member.name) &&
          member.name.text === request.after,
      );
      if (afterDeclared) break;
    }
    if (afterDeclared) break;
  }
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

  const dynamicBlockers = sources.filter(
    (source) =>
      source.importsEntity && unknowns.some((unknown) => dynamicFileOf(unknown) === source.file),
  );
  if (dynamicBlockers.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: dynamicBlockers.map(
        (source) => `Computed access in ${source.file} could touch "${entity.symbol}"; static planning refuses hidden gaps.`,
      ),
      diagnostics: [],
    };
  }

  const operations: AdapterPatchOperation[] = [];
  const outOfScope: string[] = [];
  const unproven: string[] = [];
  for (const source of sources) {
    const edits: TextEdit[] = [];
    const visit = (node: Ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === request.before) {
        edits.push({ start: node.name.getStart(), end: node.name.getEnd(), text: request.after });
      }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === request.before) {
        edits.push({ start: node.name.getStart(), end: node.name.getEnd(), text: request.after });
      }
      ts.forEachChild(node, visit);
    };
    visit(source.sourceFile);
    if (edits.length === 0) continue;
    if (!source.importsEntity && !defFiles.has(source.file)) {
      unproven.push(source.file);
      continue;
    }
    if (!inScope(source.file, request.scope)) {
      outOfScope.push(source.file);
      continue;
    }
    operations.push({
      operation: 'write',
      path: source.file,
      content: applyTextEdits(source.content, edits),
      impactRefs: edgeRefsFor(graph, source.file, `symbol:${entity.module}#${entity.symbol}`),
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
        (file) => `"${entity.symbol}" is referenced from ${file}, outside the approved scope; open a scope revision instead.`,
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
  return { status: 'ok', patch: buildPatch(request.requestId, request, operations), unknowns: [], unsupportedSurfaces: [], diagnostics: [] };
}

async function planRoutePathChange(
  request: AdapterFixRequest,
  sources: readonly ParsedSource[],
  graph: SystemGraph,
): Promise<AdapterPlanFixResult> {
  const ts = await import('typescript');
  const observed = graph.nodes.some(
    (node) => node.kind === 'endpoint' && (node.label?.endsWith(` ${request.before}`) ?? false),
  );
  if (!observed) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Route "${request.before}" was not observed in the snapshot; refusing to plan blind.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const operations: AdapterPatchOperation[] = [];
  const outOfScope: string[] = [];
  for (const source of sources) {
    const edits: TextEdit[] = [];
    const seen = { ambiguous: false };
    const visit = (node: Ts.Node): void => {
      if (ts.isStringLiteral(node) && node.text === request.before) {
        const quote = node.getText().startsWith("'") ? "'" : '"';
        edits.push({ start: node.getStart(), end: node.getEnd(), text: `${quote}${request.after}${quote}` });
      }
      if (ts.isTemplateExpression(node) && node.getText().includes(request.before)) {
        seen.ambiguous = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(source.sourceFile);
    if (seen.ambiguous) {
      return {
        status: 'unsupported',
        patch: null,
        unknowns: [],
        unsupportedSurfaces: [
          `Route "${request.before}" is embedded in a template expression in ${source.file}; static planning refuses to guess the pattern.`,
        ],
        diagnostics: [],
      };
    }
    const decoratorResult = await decoratorRouteEdits(source.sourceFile, request);
    if (decoratorResult.status === 'refuse') {
      return {
        status: 'unsupported',
        patch: null,
        unknowns: [],
        unsupportedSurfaces: [decoratorResult.reason],
        diagnostics: [],
      };
    }
    edits.push(...decoratorResult.edits);
    if (edits.length === 0) continue;
    if (!inScope(source.file, request.scope)) {
      outOfScope.push(source.file);
      continue;
    }
    const refs = graph.edges
      .filter((edge) => edge.from === `component:${source.file}` && edge.to.startsWith('endpoint:') && edge.resolution === 'proven')
      .map((edge) => edge.id);
    operations.push({
      operation: 'write',
      path: source.file,
      content: applyTextEdits(source.content, edits),
      impactRefs: refs.length > 0 ? refs : [`component:${source.file}`],
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
  return { status: 'ok', patch: buildPatch(request.requestId, request, operations), unknowns: [], unsupportedSurfaces: [], diagnostics: [] };
}
