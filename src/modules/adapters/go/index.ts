import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { parseNativeJson, runNative } from '../native/process.js';

/** Go adapter L1: parse route registrations and project/package references. */
export const GO_ADAPTER_VERSION = '1.0.0';

export const GO_KEY: CapabilityKey = {
  ecosystem: 'go',
  language: 'go',
  framework: 'gin',
  versionRange: '>=1.27 <1.28',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: ['gin-routes'],
  runnerProfile: 'go-windows',
  adapterVersion: GO_ADAPTER_VERSION,
};

export const GO_ADAPTER_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: GO_KEY,
  targetLevel: 'L2',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: ['No L2 claim: candidate patch and guard proof are not part of this adapter check.'],
  toolchainIdentities: { go: '1.27.3/windows-amd64' },
});

interface GoFact {
  readonly kind: 'route' | 'type';
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly detail: string;
}

const GO_PARSE_HELPER = String.raw`
package main
import (
  "encoding/json"
  "go/ast"
  "go/parser"
  "go/token"
  "io"
  "os"
)
type Entry struct { File string ` + '`json:"file"`' + `; Source string ` + '`json:"source"`' + ` }
type Fact struct { Kind string ` + '`json:"kind"`' + `; File string ` + '`json:"file"`' + `; Line int ` + '`json:"line"`' + `; Name string ` + '`json:"name"`' + `; Detail string ` + '`json:"detail"`' + ` }
func main() {
  input, err := io.ReadAll(os.Stdin); if err != nil { os.Exit(2) }
  var entries []Entry; if json.Unmarshal(input, &entries) != nil { os.Exit(2) }
  facts := []Fact{}
  fset := token.NewFileSet()
  for _, entry := range entries {
    file, err := parser.ParseFile(fset, entry.File, entry.Source, parser.ParseComments|parser.AllErrors)
    if err != nil || file == nil { continue }
    ast.Inspect(file, func(node ast.Node) bool {
      switch n := node.(type) {
      case *ast.CallExpr:
        selector, ok := n.Fun.(*ast.SelectorExpr); if !ok || len(n.Args) == 0 { return true }
        receiver, ok := selector.X.(*ast.Ident); if !ok || receiver.Name != "http" { return true }
        path, ok := n.Args[0].(*ast.BasicLit); if !ok || path.Kind != token.STRING { return true }
        facts = append(facts, Fact{Kind:"route", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:path.Value, Detail:selector.Sel.Name})
      case *ast.TypeSpec:
        facts = append(facts, Fact{Kind:"type", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:n.Name.Name, Detail:"go-type"})
      }
      return true
    })
  }
  _ = json.NewEncoder(os.Stdout).Encode(facts)
}
`;

export const GO_ADAPTER: AdapterDefinition = {
  name: 'go',
  contractVersion: '2',
  key: GO_KEY,
  records: [GO_ADAPTER_RECORD],
  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    if (input.version.trim() === '' || input.version === 'unavailable') {
      return unsupported(input, 'Go toolchain unavailable: no pinned toolchain version was provided.');
    }
    const snapshot = snapshotId(input.root, input.version);
    const diagnostics: string[] = [];
    const entries: { file: string; source: string }[] = [];
    for (const file of input.files.filter((path) => path.endsWith('.go'))) {
      try {
        entries.push({ file, source: readFileSync(join(input.root, file), 'utf8') });
      } catch (error) {
        diagnostics.push(`Could not read ${file}: ${(error as Error).message}`);
      }
    }
    if (entries.length === 0) return unsupported(input, 'No Go source was present in the snapshot.');

    const helperDirectory = mkdtempSync(join(tmpdir(), 'changeproof-go-ast-'));
    const helperPath = join(helperDirectory, 'main.go');
    try {
      writeFileSync(helperPath, GO_PARSE_HELPER, 'utf8');
      const result = await runNative(
        'go', ['run', helperPath],
        { cwd: helperDirectory, timeoutMs: 60_000, maxOutputBytes: 4 * 1024 * 1024, input: JSON.stringify(entries) },
      );
      if (result.exitCode !== 0) {
        return {
          status: 'failed', graph: emptyGraph(snapshot), unknowns: [`Go parser exited ${result.exitCode}`],
          unsupportedSurfaces: [], diagnostics: [...diagnostics, result.stderr.slice(0, 2000)],
          toolchainIdentity: `go@${input.version}`,
        };
      }
      const facts = (parseNativeJson(result.stdout) as GoFact[] | null) ?? [];
      // An empty extraction is not a result: without facts there is no evidence,
      // so report unsupported instead of a successful empty graph (NEG3-09).
      if (facts.length === 0) {
        return unsupported(input, 'No supported Go route/type syntax was found in the snapshot.');
      }
      const nodes = new Map<string, GraphNode>();
      const edges: GraphEdge[] = [];
      for (const entry of entries) {
        const id = `component:${entry.file}`;
        nodes.set(id, { id, kind: 'component', locator: entry.file, snapshot, label: entry.file });
      }
      for (const fact of facts) {
        const from = `component:${fact.file}`;
        const kind = fact.kind === 'route' ? 'endpoint' : 'symbol';
        const label = fact.kind === 'route' ? `${fact.detail} ${fact.name}` : fact.name;
        const to = `${kind}:${label}`;
        nodes.set(to, { id: to, kind, locator: `${fact.file}:${fact.line}`, snapshot, label });
        edges.push({
          id: `edge:${from}->${to}`,
          kind: fact.kind === 'route' ? 'calls' : 'depends_on',
          from,
          to,
          resolution: 'proven',
          evidence: { locator: `${fact.file}:${fact.line}`, snapshot, method: 'go-ast-parser' },
          runtimeObserved: false,
        });
      }
      return {
        status: 'ok',
        graph: SystemGraphSchema.parse({ schemaVersion: '1', snapshot, nodes: [...nodes.values()], edges }),
        unknowns: [], unsupportedSurfaces: [], diagnostics,
        toolchainIdentity: `go@${input.version}`,
      };
    } finally {
      try {
        rmSync(helperDirectory, { recursive: true, force: true });
      } catch {
        diagnostics.push('Temporary Go AST helper directory cleanup failed.');
      }
    }
  },
};

function unsupported(input: AdapterExtractInput, reason: string): AdapterExtractResult {
  const snapshot = snapshotId(input.root, input.version);
  return {
    status: 'unsupported',
    graph: emptyGraph(snapshot),
    unknowns: [],
    unsupportedSurfaces: [reason],
    diagnostics: [],
    toolchainIdentity: `go@${input.version}`,
  };
}

function emptyGraph(snapshot: string) {
  return SystemGraphSchema.parse({
    schemaVersion: '1', snapshot,
    nodes: [{ id: 'component:go-empty', kind: 'component', locator: 'empty', snapshot }],
    edges: [],
  });
}
