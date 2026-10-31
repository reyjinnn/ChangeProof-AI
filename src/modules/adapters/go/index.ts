import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { parseNativeJson, runNative } from '../native/process.js';
import { AdapterRegistry } from '../registry/index.js';

/** Go adapter L1: parse route registrations and project/package references. */
export const GO_ADAPTER_VERSION = '1.0.1';

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
const registeredCapabilities = new AdapterRegistry([GO_ADAPTER_RECORD]);

const GoParseResultSchema = z.object({
  schemaVersion: z.literal('1'),
  version: z.string(),
  facts: z.array(z.object({ kind: z.enum(['route', 'type', 'unknown', 'error']), file: z.string(),
    line: z.number().int().positive(), name: z.string(), detail: z.string() })),
});

const GO_PARSE_HELPER = String.raw`
package main
import (
  "encoding/json"
  "fmt"
  "go/ast"
  "go/parser"
  "go/token"
  "io"
  "os"
  "runtime"
  "strconv"
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
    if err != nil || file == nil {
      facts = append(facts, Fact{Kind:"error", File:entry.File, Line:1, Name:"syntax", Detail:fmt.Sprint(err)})
      continue
    }
    ginAliases := map[string]bool{}
    for _, imported := range file.Imports {
      path, _ := strconv.Unquote(imported.Path.Value)
      if path == "github.com/gin-gonic/gin" {
        alias := "gin"; if imported.Name != nil { alias = imported.Name.Name }
        ginAliases[alias] = true
      }
    }
    routers := map[*ast.Object]bool{}
    assignments := map[*ast.Object]int{}
    ast.Inspect(file, func(node ast.Node) bool {
      assignment, ok := node.(*ast.AssignStmt); if !ok { return true }
      for _, lhs := range assignment.Lhs {
        if name, ok := lhs.(*ast.Ident); ok && name.Obj != nil { assignments[name.Obj]++ }
      }
      for i, rhs := range assignment.Rhs {
        if i >= len(assignment.Lhs) { continue }
        call, ok := rhs.(*ast.CallExpr); if !ok { continue }
        selector, ok := call.Fun.(*ast.SelectorExpr); if !ok { continue }
        pkg, ok := selector.X.(*ast.Ident); if !ok || !ginAliases[pkg.Name] || pkg.Obj != nil { continue }
        if selector.Sel.Name != "Default" && selector.Sel.Name != "New" { continue }
        name, ok := assignment.Lhs[i].(*ast.Ident); if ok && name.Obj != nil { routers[name.Obj] = true }
      }
      return true
    })
    ast.Inspect(file, func(node ast.Node) bool {
      switch n := node.(type) {
      case *ast.CallExpr:
        selector, ok := n.Fun.(*ast.SelectorExpr); if !ok || len(n.Args) == 0 { return true }
        receiver, ok := selector.X.(*ast.Ident); if !ok { return true }
        method := selector.Sel.Name
        ginRoute := routers[receiver.Obj] && (method == "GET" || method == "POST" || method == "PUT" || method == "DELETE" || method == "PATCH")
        legacyHTTP := receiver.Name == "http" && (method == "Handle" || method == "HandleFunc")
        if !ginRoute && !legacyHTTP { return true }
        if ginRoute && assignments[receiver.Obj] > 1 {
          facts = append(facts, Fact{Kind:"unknown", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:method, Detail:"reassigned Gin router binding"})
          return true
        }
        path, ok := n.Args[0].(*ast.BasicLit)
        if !ok || path.Kind != token.STRING {
          detail := "non-literal HTTP route"; if ginRoute { detail = "non-literal Gin route" }
          facts = append(facts, Fact{Kind:"unknown", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:method, Detail:detail})
          return true
        }
        value, err := strconv.Unquote(path.Value); if err != nil { return true }
        facts = append(facts, Fact{Kind:"route", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:value, Detail:method})
      case *ast.TypeSpec:
        facts = append(facts, Fact{Kind:"type", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:n.Name.Name, Detail:"go-type"})
      }
      return true
    })
  }
  _ = json.NewEncoder(os.Stdout).Encode(struct{ SchemaVersion string ` + '`json:"schemaVersion"`' + `; Version string ` + '`json:"version"`' + `; Facts []Fact ` + '`json:"facts"`' + ` }{"1", runtime.Version(), facts})
}
`;

export const GO_ADAPTER: AdapterDefinition = {
  name: 'go',
  contractVersion: '2',
  key: GO_KEY,
  records: [GO_ADAPTER_RECORD],
  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      return unsupported(input, 'Unregistered or invalid Go capability tuple.');
    }
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
          toolchainIdentity: 'go@unobserved',
        };
      }
      const parsed = GoParseResultSchema.safeParse(parseNativeJson(result.stdout));
      if (!parsed.success) {
        return { status: 'failed', graph: emptyGraph(snapshot), unknowns: ['Invalid Go parser result.'],
          unsupportedSurfaces: [], diagnostics: [parsed.error.message], toolchainIdentity: 'go@unobserved' };
      }
      const { facts, version } = parsed.data;
      const observedVersion = version.replace(/^go/, '');
      const toolchainIdentity = `go@${observedVersion}`;
      const errors = facts.filter((fact) => fact.kind === 'error').map((fact) => `${fact.file}:${fact.line}: ${fact.detail}`);
      if (observedVersion !== input.version || errors.length > 0) {
        return { status: 'failed', graph: emptyGraph(snapshot),
          unknowns: observedVersion !== input.version ? [`Go toolchain mismatch: requested ${input.version}, observed ${observedVersion}.`] : errors,
          unsupportedSurfaces: [], diagnostics: [...diagnostics, ...errors], toolchainIdentity };
      }
      // An empty extraction is not a result: without facts there is no evidence,
      // so report unsupported instead of a successful empty graph (NEG3-09).
      if (facts.length === 0) {
        return unsupported(input, 'No supported Go route/type syntax was found in the snapshot.');
      }
      const nodes = new Map<string, GraphNode>();
      const edges: GraphEdge[] = [];
      const unknowns: string[] = [];
      for (const entry of entries) {
        const id = `component:${entry.file}`;
        nodes.set(id, { id, kind: 'component', locator: entry.file, snapshot, label: entry.file });
      }
      for (const fact of facts) {
        const from = `component:${fact.file}`;
        if (fact.kind === 'unknown') {
          const locator = `${fact.file}:${fact.line}`;
          const to = `symbol:unresolved:${locator}:${fact.name}`;
          const reason = `${fact.detail} at ${locator}`;
          nodes.set(to, { id: to, kind: 'symbol', locator, snapshot, label: fact.name });
          edges.push({ id: `edge:${from}->${to}`, kind: 'calls', from, to,
            resolution: 'unresolved', unresolvedReason: reason, runtimeObserved: false });
          unknowns.push(reason);
          continue;
        }
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
        unknowns, unsupportedSurfaces: [], diagnostics,
        toolchainIdentity,
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
    toolchainIdentity: 'go@unobserved',
  };
}

function emptyGraph(snapshot: string) {
  return SystemGraphSchema.parse({
    schemaVersion: '1', snapshot,
    nodes: [{ id: 'component:go-empty', kind: 'component', locator: 'empty', snapshot }],
    edges: [],
  });
}
