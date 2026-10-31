import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type * as Ts from 'typescript';

import {
  SystemGraphSchema,
  type CapabilityKey,
  type CapabilityRecord,
  type GraphEdge,
  type GraphNode,
} from '../../../core/index.js';
import { snapshotId, type AdapterDefinition, type AdapterExtractInput, type AdapterExtractResult } from '../types.js';

/**
 * TypeScript adapter (L1: discovery and extraction).
 *
 * Uses the TypeScript compiler API that ships with the pinned Node toolchain, so
 * the extraction is done by the real parser rather than by a text heuristic.
 *
 * Two properties are deliberate:
 *
 *  - A resolved symbol reference becomes a `proven` edge with an evidence
 *    locator. A reference the compiler cannot resolve to a known symbol becomes
 *    an `unresolved` edge with a reason, never a silent omission (NEG3-02).
 *  - A rename is kept as a hypothesis with its raw evidence, not asserted as
 *    a fact (FR3-04).
 */

export const TYPESCRIPT_ADAPTER_VERSION = '1.0.0';

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
    'No L2/L3 claim: candidate patch and native verification are not yet certified.',
  ],
  toolchainIdentities: {},
};

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
}

export const TYPESCRIPT_ADAPTER: AdapterDefinition = {
  name: 'typescript',
  contractVersion: '2',
  key: TYPESCRIPT_KEY,
  records: [TYPESCRIPT_ADAPTER_RECORD],

  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    const snapshot = snapshotId(input.root, input.version);
    const ts = (await import('typescript'));

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
      const sourceFile = ts.createSourceFile(
        source.file,
        source.content,
        ts.ScriptTarget.ES2023,
        true,
        ts.ScriptKind.TS,
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

      if (exported !== undefined && !nodes.has(targetId)) {
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
          method: 'typescript-compiler-call-expression',
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
      toolchainIdentity: `typescript@${ts.version}`,
    };
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
