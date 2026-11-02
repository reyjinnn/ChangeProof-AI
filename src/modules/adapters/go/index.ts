import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { createHash } from 'node:crypto';

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
import { parseNativeJson, runNative } from '../native/process.js';
import { AdapterRegistry } from '../registry/index.js';

/**
 * Go adapter L2: Gin/Fiber route registration extraction plus route-path
 * candidate patches with guard validation. Route mechanics are shared
 * between frameworks; each tuple selects the framework it targets.
 */
export const GO_ADAPTER_VERSION = '1.1.0';

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
  limitations: [
    'Fix planning covers route_path_change over statically resolved route literals; field renames are not planned.',
    'Route literals are matched textually within the approved scope; a computed route or reassigned router anywhere in scope refuses the plan.',
    'Route groups, sub-routers, and static mounts with route-shaped paths refuse the plan; prefixes are not composed.',
  ],
  toolchainIdentities: { go: '1.27.3/windows-amd64' },
});

export const GO_FIBER_KEY: CapabilityKey = {
  ecosystem: 'go',
  language: 'go',
  framework: 'fiber',
  versionRange: '>=1.27 <1.28',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: ['fiber-routes'],
  runnerProfile: 'go-windows',
  adapterVersion: GO_ADAPTER_VERSION,
};

export const GO_FIBER_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: GO_FIBER_KEY,
  targetLevel: 'L2',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Fix planning covers route_path_change over statically resolved route literals; field renames are not planned.',
    'Route literals are matched textually within the approved scope; a computed route or reassigned router anywhere in scope refuses the plan.',
    'Route groups, sub-routers, and static mounts with route-shaped paths refuse the plan; prefixes are not composed.',
  ],
  toolchainIdentities: { go: '1.27.3/windows-amd64' },
});

const registeredCapabilities = new AdapterRegistry([GO_ADAPTER_RECORD, GO_FIBER_RECORD]);

const GoParseResultSchema = z.object({
  schemaVersion: z.literal('2'),
  version: z.string(),
  facts: z.array(z.object({ kind: z.enum(['route', 'type', 'unknown', 'error', 'str']), file: z.string(),
    line: z.number().int().positive(), offset: z.number().int().nonnegative(), length: z.number().int().nonnegative(),
    name: z.string(), detail: z.string() })),
});

type GoFact = z.infer<typeof GoParseResultSchema>['facts'][number];

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
  "strings"
)
type Entry struct { File string ` + '`json:"file"`' + `; Source string ` + '`json:"source"`' + ` }
type Fact struct { Kind string ` + '`json:"kind"`' + `; File string ` + '`json:"file"`' + `; Line int ` + '`json:"line"`' + `; Offset int ` + '`json:"offset"`' + `; Length int ` + '`json:"length"`' + `; Name string ` + '`json:"name"`' + `; Detail string ` + '`json:"detail"`' + ` }
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
    frameworkAliases := map[string]string{}
    for _, imported := range file.Imports {
      path, _ := strconv.Unquote(imported.Path.Value)
      framework := ""
      if path == "github.com/gin-gonic/gin" { framework = "Gin" }
      if path == "github.com/gofiber/fiber/v2" { framework = "Fiber" }
      if framework != "" {
        alias := "gin"; if framework == "Fiber" { alias = "fiber" }
        if imported.Name != nil { alias = imported.Name.Name }
        frameworkAliases[alias] = framework
      }
    }
    routers := map[*ast.Object]string{}
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
        pkg, ok := selector.X.(*ast.Ident); if !ok || pkg.Obj != nil { continue }
        framework, ok := frameworkAliases[pkg.Name]; if !ok { continue }
        if selector.Sel.Name != "Default" && selector.Sel.Name != "New" { continue }
        name, ok := assignment.Lhs[i].(*ast.Ident); if ok && name.Obj != nil { routers[name.Obj] = framework }
      }
      return true
    })
    ast.Inspect(file, func(node ast.Node) bool {
      switch n := node.(type) {
      case *ast.CallExpr:
        selector, ok := n.Fun.(*ast.SelectorExpr); if !ok || len(n.Args) == 0 { return true }
        receiver, ok := selector.X.(*ast.Ident); if !ok { return true }
        method := selector.Sel.Name
        framework, isFramework := routers[receiver.Obj]
        upper := strings.ToUpper(method)
        isRouteMethod := upper == "GET" || upper == "POST" || upper == "PUT" || upper == "DELETE" || upper == "PATCH"
        frameworkRoute := isFramework && isRouteMethod
        legacyHTTP := receiver.Name == "http" && (method == "Handle" || method == "HandleFunc")
        if !frameworkRoute && !legacyHTTP {
          // Group/All/Static and friends shape routes the planner does not
          // model: a route-shaped literal there stays visible, never silent.
          if isFramework {
            if lit, ok := n.Args[0].(*ast.BasicLit); ok && lit.Kind == token.STRING {
              if value, err := strconv.Unquote(lit.Value); err == nil && len(value) > 0 && value[0] == '/' {
                facts = append(facts, Fact{Kind:"unknown", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:method, Detail:"unmodeled " + framework + " router call"})
              }
            }
          }
          return true
        }
        if frameworkRoute && assignments[receiver.Obj] > 1 {
          facts = append(facts, Fact{Kind:"unknown", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:method, Detail:"reassigned " + framework + " router binding"})
          return true
        }
        path, ok := n.Args[0].(*ast.BasicLit)
        if !ok || path.Kind != token.STRING {
          detail := "non-literal HTTP route"; if frameworkRoute { detail = "non-literal " + framework + " route" }
          facts = append(facts, Fact{Kind:"unknown", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:method, Detail:detail})
          return true
        }
        value, err := strconv.Unquote(path.Value); if err != nil { return true }
        facts = append(facts, Fact{Kind:"route", File:entry.File, Line:fset.Position(n.Pos()).Line, Offset:fset.Position(path.Pos()).Offset, Length:len(path.Value), Name:value, Detail:upper})
      case *ast.TypeSpec:
        facts = append(facts, Fact{Kind:"type", File:entry.File, Line:fset.Position(n.Pos()).Line, Name:n.Name.Name, Detail:"go-type"})
      case *ast.BasicLit:
        if n.Kind != token.STRING { return true }
        value, err := strconv.Unquote(n.Value); if err != nil { return true }
        facts = append(facts, Fact{Kind:"str", File:entry.File, Line:fset.Position(n.Pos()).Line, Offset:fset.Position(n.Pos()).Offset, Length:len(n.Value), Name:value, Detail:"string-literal"})
      }
      return true
    })
  }
  _ = json.NewEncoder(os.Stdout).Encode(struct{ SchemaVersion string ` + '`json:"schemaVersion"`' + `; Version string ` + '`json:"version"`' + `; Facts []Fact ` + '`json:"facts"`' + ` }{"2", runtime.Version(), facts})
}
`;

export const GO_ADAPTER: AdapterDefinition = {
  name: 'go',
  contractVersion: ADAPTER_CONTRACT_VERSION,
  key: GO_KEY,
  records: [GO_ADAPTER_RECORD, GO_FIBER_RECORD],
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
      // String literals are planner positions, not graph evidence.
      const meaningful = facts.filter((fact) => fact.kind !== 'str');
      if (meaningful.length === 0) {
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
        if (fact.kind === 'str') continue;
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

  async planFix(input: AdapterPlanFixInput): Promise<AdapterPlanFixResult> {
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      return {
        status: 'unsupported',
        patch: null,
        unknowns: [],
        unsupportedSurfaces: ['Unregistered or invalid Go capability tuple: fix planning refuses unknown scope.'],
        diagnostics: [],
      };
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
    if (request.data.changeKind !== 'route_path_change') {
      return {
        status: 'unsupported',
        patch: null,
        unknowns: [],
        unsupportedSurfaces: ['Go L2 plans route_path_change only; field renames are not planned.'],
        diagnostics: [],
      };
    }
    if (splitEntity(request.data.entity) === null) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Entity "${request.data.entity}" is not module-qualified; expected "module.Symbol".`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    const extracted = await GO_ADAPTER.extract({
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
    const observed = extracted.graph.nodes.some(
      (node) => node.kind === 'endpoint' && (node.label?.endsWith(` ${request.data.before}`) ?? false),
    );
    if (!observed) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Route "${request.data.before}" was not observed in the snapshot; refusing to plan blind.`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    return planGoRouteChange(input, request.data, extracted.graph);
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
      throw new ChangeProofError('Unregistered Go capability tuple; refusing to plan checks for unknown scope.');
    }
    const framework = capability.data.key.framework;
    if (framework !== 'gin' && framework !== 'fiber') {
      throw new ChangeProofError(`No Go check plan for framework "${framework}".`);
    }
    return Promise.resolve(
      AdapterCheckPlanSchema.parse({
        schemaVersion: '1',
        planId: `plan-${patch.patchDigest.slice(0, 12)}`,
        patchDigest: patch.patchDigest,
        checks: [
          {
            checkId: 'go-build',
            kind: 'build',
            command: 'go',
            args: ['build', './...'],
            cwd: input.root,
            timeoutMs: 300_000,
            required: true,
          },
          {
            checkId: 'go-vet',
            kind: 'test',
            command: 'go',
            args: ['vet', './...'],
            cwd: input.root,
            timeoutMs: 300_000,
            required: true,
          },
        ],
        runnerIdentity: input.runnerIdentity,
      }),
    );
  },
};

async function runGoHelper(
  root: string,
  files: readonly string[],
): Promise<{ facts: GoFact[]; version: string }> {
  const entries: { file: string; source: string }[] = [];
  for (const file of files.filter((path) => path.endsWith('.go'))) {
    entries.push({ file, source: readFileSync(join(root, file), 'utf8') });
  }
  const helperDirectory = mkdtempSync(join(tmpdir(), 'changeproof-go-plan-'));
  const helperPath = join(helperDirectory, 'main.go');
  try {
    writeFileSync(helperPath, GO_PARSE_HELPER, 'utf8');
    const result = await runNative('go', ['run', helperPath], {
      cwd: helperDirectory,
      timeoutMs: 60_000,
      maxOutputBytes: 4 * 1024 * 1024,
      input: JSON.stringify(entries),
    });
    if (result.exitCode !== 0) {
      throw new ChangeProofError(`Go parser exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
    }
    const parsed = GoParseResultSchema.safeParse(parseNativeJson(result.stdout));
    if (!parsed.success) {
      throw new ChangeProofError(`Invalid Go parser result: ${parsed.error.message}`);
    }
    return { facts: parsed.data.facts, version: parsed.data.version.replace(/^go/, '') };
  } finally {
    try {
      rmSync(helperDirectory, { recursive: true, force: true });
    } catch {
      // Best effort: a leaked temp dir never fails the plan.
    }
  }
}

async function planGoRouteChange(
  input: AdapterPlanFixInput,
  request: AdapterFixRequest,
  graph: SystemGraph,
): Promise<AdapterPlanFixResult> {
  if (request.after.includes('"') || request.after.includes('`')) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Route "${request.after}" cannot be quoted into a Go string literal; refusing to emit broken code.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  let facts: GoFact[];
  try {
    const parsed = await runGoHelper(input.root, input.files);
    if (parsed.version !== input.version) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Go toolchain mismatch: requested ${input.version}, observed ${parsed.version}.`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    facts = parsed.facts;
  } catch (error) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [error instanceof Error ? error.message : 'Go parser failed.'],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const blockers = [...new Set(facts.filter((fact) => fact.kind === 'unknown').map((fact) => fact.file))];
  if (blockers.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: blockers.map(
        (file) => `Computed route or reassigned router in ${file} could touch "${request.before}"; static planning refuses hidden gaps.`,
      ),
      diagnostics: [],
    };
  }
  const contents = new Map<string, string>();
  for (const file of input.files.filter((path) => path.endsWith('.go'))) {
    try {
      contents.set(file, readFileSync(join(input.root, file), 'utf8'));
    } catch {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Cannot plan without reading ${file}; hidden references fail closed.`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
  }
  const matches = facts.filter((fact) => fact.kind === 'str' && fact.name === request.before);
  const operations: AdapterPatchOperation[] = [];
  const outOfScope: string[] = [];
  const byFile = new Map<string, GoFact[]>();
  for (const match of matches) {
    const list = byFile.get(match.file) ?? [];
    list.push(match);
    byFile.set(match.file, list);
  }
  for (const [file, literals] of byFile) {
    const content = contents.get(file);
    if (content === undefined) continue;
    if (!inScope(file, request.scope)) {
      outOfScope.push(file);
      continue;
    }
    const ordered = [...literals].sort((left, right) => right.offset - left.offset);
    let patched = content;
    for (const literal of ordered) {
      const quote = patched.slice(literal.offset, literal.offset + 1);
      const closer = quote === '`' ? '`' : '"';
      patched =
        patched.slice(0, literal.offset) +
        `${closer}${request.after}${closer}` +
        patched.slice(literal.offset + literal.length);
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
  const intentRefs = [request.intentRef];
  return {
    status: 'ok',
    patch: {
      schemaVersion: '1',
      patchId: `go-${createHash('sha256').update(`${request.requestId}:${request.entity}:${request.before}:${request.after}`).digest('hex').slice(0, 12)}`,
      intentRefs,
      operations,
      patchDigest: digestAdapterPatch({ intentRefs, operations }),
    },
    unknowns: [],
    unsupportedSurfaces: [],
    diagnostics: [],
  };
}

function inScope(file: string, scope: readonly string[]): boolean {
  return scope.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

function splitEntity(entity: string): { module: string; symbol: string } | null {
  const dot = entity.lastIndexOf('.');
  if (dot <= 0 || dot === entity.length - 1) return null;
  return { module: entity.slice(0, dot), symbol: entity.slice(dot + 1) };
}

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
