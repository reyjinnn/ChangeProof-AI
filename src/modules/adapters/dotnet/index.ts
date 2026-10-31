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

/**
 * .NET adapter (L1 target: endpoint/type discovery).
 *
 * The adapter launches a reviewed Roslyn helper outside the input snapshot.
 * The helper reads only source bytes on stdin and uses the native C# syntax
 * parser; it never builds or loads a customer project and never executes
 * customer MSBuild targets. Roslyn reports syntax facts and source locations;
 * unsupported syntax remains a diagnostic/unknown, not a successful empty
 * extraction.
 */
export const DOTNET_ADAPTER_VERSION = '1.0.1';

export const DOTNET_KEY: CapabilityKey = {
  ecosystem: 'dotnet',
  language: 'csharp',
  framework: 'aspnet-core',
  versionRange: '>=10.0 <11.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: ['aspnet-endpoint-mapping'],
  runnerProfile: 'dotnet-windows',
  adapterVersion: DOTNET_ADAPTER_VERSION,
};

export const DOTNET_ADAPTER_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: DOTNET_KEY,
  targetLevel: 'L1',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: ['L1 evidence is a source extraction fixture; no L2/L3 proof is claimed.'],
  toolchainIdentities: { dotnet: '10.0.403' },
});
const registeredCapabilities = new AdapterRegistry([DOTNET_ADAPTER_RECORD]);

const DotnetFactsSchema = z.array(z.object({
  kind: z.enum(['endpoint', 'type', 'unknown', 'error']), file: z.string(),
  line: z.number().int().positive(), name: z.string(), method: z.string(), detail: z.string(),
}));

const ROSLYN_HELPER_SOURCE = String.raw`using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

internal record Entry(string File, string Source);
internal record Fact(string Kind, string File, int Line, string Name, string Method, string Detail);

internal static class Program
{
    public static async Task Main()
    {
        var input = await Console.In.ReadToEndAsync();
        var json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var entries = JsonSerializer.Deserialize<Entry[]>(input, json) ?? Array.Empty<Entry>();
        var facts = new List<Fact>();
        foreach (var entry in entries)
        {
            var tree = CSharpSyntaxTree.ParseText(entry.Source, path: entry.File);
            var errors = tree.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).ToArray();
            foreach (var error in errors)
                facts.Add(new Fact("error", entry.File, error.Location.GetLineSpan().StartLinePosition.Line + 1, "syntax", "", error.GetMessage()));
            if (errors.Length > 0) continue;
            var root = await tree.GetRootAsync();
            foreach (var node in root.DescendantNodes())
            {
                var line = tree.GetLineSpan(node.Span).StartLinePosition.Line + 1;
                if (node is MethodDeclarationSyntax method)
                {
                    foreach (var attribute in method.AttributeLists.SelectMany(list => list.Attributes))
                    {
                        var attributeName = attribute.Name.ToString().Split('.').Last();
                        if (!new[] { "HttpGet", "HttpPost", "HttpPut", "HttpDelete", "HttpPatch" }.Contains(attributeName)) continue;
                        var route = attribute.ArgumentList?.Arguments.FirstOrDefault()?.Expression as LiteralExpressionSyntax;
                        if (route?.Token.ValueText is string path)
                            facts.Add(new Fact("endpoint", entry.File, line, path, attributeName[4..].ToUpperInvariant(), method.Identifier.ValueText));
                        else
                            facts.Add(new Fact("unknown", entry.File, line, method.Identifier.ValueText, "", "non-literal ASP.NET route attribute"));
                    }
                }
                if (node is InvocationExpressionSyntax invocation && invocation.Expression is MemberAccessExpressionSyntax member &&
                    new[] { "MapGet", "MapPost", "MapPut", "MapDelete", "MapPatch" }.Contains(member.Name.Identifier.ValueText))
                {
                    var route = invocation.ArgumentList.Arguments.FirstOrDefault()?.Expression as LiteralExpressionSyntax;
                    if (route?.Token.ValueText is string path)
                        facts.Add(new Fact("endpoint", entry.File, line, path, member.Name.Identifier.ValueText[3..].ToUpperInvariant(), member.Name.Identifier.ValueText));
                    else
                        facts.Add(new Fact("unknown", entry.File, line, member.Name.Identifier.ValueText, "", "non-literal endpoint mapping"));
                }
                if (node is RecordDeclarationSyntax record)
                    facts.Add(new Fact("type", entry.File, line, record.Identifier.ValueText, "", "record"));
                else if (node is ClassDeclarationSyntax classDeclaration)
                    facts.Add(new Fact("type", entry.File, line, classDeclaration.Identifier.ValueText, "", "class"));
            }
        }
        Console.WriteLine(JsonSerializer.Serialize(facts, json));
    }
}
`;

const ROSLYN_HELPER_PROJECT = (sdkDirectory: string): string => `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="Microsoft.CodeAnalysis">
      <HintPath>${sdkDirectory}\\Roslyn\\bincore\\Microsoft.CodeAnalysis.dll</HintPath>
    </Reference>
    <Reference Include="Microsoft.CodeAnalysis.CSharp">
      <HintPath>${sdkDirectory}\\Roslyn\\bincore\\Microsoft.CodeAnalysis.CSharp.dll</HintPath>
    </Reference>
  </ItemGroup>
</Project>`;

export const DOTNET_ADAPTER: AdapterDefinition = {
  name: 'dotnet',
  contractVersion: '2',
  key: DOTNET_KEY,
  records: [DOTNET_ADAPTER_RECORD],

  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      return unsupported(input, 'Unregistered or invalid .NET capability tuple.');
    }
    if (input.version.trim() === '' || input.version === 'unavailable') {
      return unsupported(input, '.NET SDK unavailable: no pinned SDK version was provided.');
    }
    if (input.version !== '10.0.403') return unsupported(input, `Unsupported .NET SDK pin ${input.version}; expected 10.0.403.`);
    const snapshot = snapshotId(input.root, input.version);
    const sources: { file: string; source: string }[] = [];
    const diagnostics: string[] = [];

    for (const file of input.files.filter((path) => path.endsWith('.cs'))) {
      try {
        sources.push({ file, source: readFileSync(join(input.root, file), 'utf8') });
      } catch (error) {
        diagnostics.push(`Could not read ${file}: ${(error as Error).message}`);
      }
    }

    if (sources.length === 0) return unsupported(input, 'No C# source was present in the snapshot.');

    const helperDirectory = mkdtempSync(join(tmpdir(), 'changeproof-roslyn-'));
    const projectPath = join(helperDirectory, 'ChangeProofRoslyn.csproj');
    const sourcePath = join(helperDirectory, 'Program.cs');
    try {
      const { stdout: sdkPath, exitCode: sdkExit, stderr: sdkError } = await runNative(
        'dotnet', ['--info'],
        { cwd: helperDirectory, timeoutMs: 30_000, maxOutputBytes: 2 * 1024 * 1024 },
      ).then(async (info) => {
        const { stdout: path, exitCode, stderr } = await runNative(
          'dotnet', ['--list-sdks'],
          { cwd: helperDirectory, timeoutMs: 30_000, maxOutputBytes: 256 * 1024 },
        );
        return { stdout: path || info.stdout, exitCode, stderr: stderr || info.stderr };
      });
      if (sdkExit !== 0) {
        return {
          status: 'failed', graph: emptyGraph(snapshot), unknowns: ['dotnet SDK discovery failed'],
          unsupportedSurfaces: [], diagnostics: [...diagnostics, sdkError.slice(0, 2000)],
          toolchainIdentity: 'dotnet@unobserved',
        };
      }
      const sdkLine = sdkPath.split(/\r?\n/).find((line) => /10\.0\.403\s+\[(.+)\]/.test(line));
      const sdkBase = sdkLine?.match(/\[(.+)\]/)?.[1];
      // --list-sdks prints the SDK root; Roslyn ships under the versioned directory.
      const sdkRoot = sdkBase === undefined ? undefined : join(sdkBase, '10.0.403');
      if (sdkRoot === undefined) {
        return {
          status: 'failed', graph: emptyGraph(snapshot), unknowns: ['pinned .NET SDK 10.0.403 was not found'],
          unsupportedSurfaces: [], diagnostics: [...diagnostics, sdkPath],
          toolchainIdentity: 'dotnet@unobserved',
        };
      }

      writeFileSync(projectPath, ROSLYN_HELPER_PROJECT(sdkRoot), 'utf8');
      writeFileSync(sourcePath, ROSLYN_HELPER_SOURCE, 'utf8');
      const build = await runNative(
        'dotnet', ['build', projectPath, '--nologo', '--verbosity', 'normal'],
        { cwd: helperDirectory, timeoutMs: 120_000, maxOutputBytes: 4 * 1024 * 1024 },
      );
      if (build.exitCode !== 0) {
        return {
          status: 'failed', graph: emptyGraph(snapshot), unknowns: ['Roslyn helper build failed'],
          unsupportedSurfaces: [], diagnostics: [...diagnostics, (build.stdout + build.stderr).slice(0, 3000)],
          toolchainIdentity: `dotnet@${input.version}`,
        };
      }

      const helperDll = join(helperDirectory, 'bin', 'Debug', 'net10.0', 'ChangeProofRoslyn.dll');
      const run = await runNative(
        'dotnet', [helperDll],
        { cwd: helperDirectory, timeoutMs: 30_000, maxOutputBytes: 4 * 1024 * 1024, input: JSON.stringify(sources) },
      );
      if (run.exitCode !== 0) {
        return {
          status: 'failed', graph: emptyGraph(snapshot), unknowns: [`Roslyn helper exited ${run.exitCode}`],
          unsupportedSurfaces: [], diagnostics: [...diagnostics, run.stderr.slice(0, 2000)],
          toolchainIdentity: `dotnet@${input.version}`,
        };
      }

      const parsed = DotnetFactsSchema.safeParse(parseNativeJson(run.stdout));
      if (!parsed.success) {
        return { status: 'failed', graph: emptyGraph(snapshot), unknowns: ['Invalid Roslyn parser result.'],
          unsupportedSurfaces: [], diagnostics: [parsed.error.message], toolchainIdentity: 'dotnet@10.0.403/roslyn' };
      }
      const facts = parsed.data;
      const errors = facts.filter((fact) => fact.kind === 'error').map((fact) => `${fact.file}:${fact.line}: ${fact.detail}`);
      if (errors.length > 0) {
        return { status: 'failed', graph: emptyGraph(snapshot), unknowns: errors,
          unsupportedSurfaces: [], diagnostics: [...diagnostics, ...errors], toolchainIdentity: 'dotnet@10.0.403/roslyn' };
      }
      // L1 API discovery without an endpoint is not a result: a type-only graph
      // carries no api-contract evidence, so it must not report success (NEG3-09).
      const hasEndpoint = facts.some((fact) => fact.kind === 'endpoint');
      const nodes = new Map<string, GraphNode>();
      const edges: GraphEdge[] = [];
      const unknowns: string[] = [];
      for (const source of sources) {
        const id = `component:${source.file}`;
        nodes.set(id, { id, kind: 'component', locator: source.file, snapshot, label: source.file });
      }
      for (const fact of facts) {
        const from = `component:${fact.file}`;
        if (fact.kind === 'unknown') {
          const locator = `${fact.file}:${fact.line}`;
          const reason = `${fact.detail} at ${locator}`;
          const to = `symbol:unresolved:${locator}:${fact.name}`;
          nodes.set(to, { id: to, kind: 'symbol', locator, snapshot, label: fact.name });
          edges.push({ id: `edge:${from}->${to}`, kind: 'calls', from, to,
            resolution: 'unresolved', unresolvedReason: reason, runtimeObserved: false });
          unknowns.push(reason);
          continue;
        }
        const kind = fact.kind === 'endpoint' ? 'endpoint' : 'dto';
        const label = fact.kind === 'endpoint' ? `${fact.method} ${fact.name}` : fact.name;
        const to = `${kind}:${label}`;
        nodes.set(to, { id: to, kind, locator: `${fact.file}:${fact.line}`, snapshot, label });
        edges.push({
          id: `edge:${from}->${to}`,
          kind: fact.kind === 'endpoint' ? 'calls' : 'serializes',
          from,
          to,
          resolution: 'proven',
          evidence: { locator: `${fact.file}:${fact.line}`, snapshot, method: 'roslyn-csharp-syntax' },
          runtimeObserved: false,
        });
      }
      // Unknowns collected above are preserved; only proven API evidence is withheld.
      if (!hasEndpoint) {
        return {
          status: 'unsupported',
          graph: SystemGraphSchema.parse({ schemaVersion: '1', snapshot, nodes: [...nodes.values()],
            edges: edges.filter((edge) => edge.resolution === 'unresolved') }),
          unknowns,
          unsupportedSurfaces: ['no supported ASP.NET endpoint syntax was found in the snapshot'],
          diagnostics,
          toolchainIdentity: `dotnet@10.0.403/roslyn`,
        };
      }
      return {
        status: 'ok',
        graph: SystemGraphSchema.parse({ schemaVersion: '1', snapshot, nodes: [...nodes.values()], edges }),
        unknowns,
        unsupportedSurfaces: [],
        diagnostics,
        toolchainIdentity: `dotnet@10.0.403/roslyn`,
      };
    } finally {
      try {
        rmSync(helperDirectory, { recursive: true, force: true });
      } catch {
        diagnostics.push('Temporary Roslyn helper cleanup failed.');
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
    toolchainIdentity: 'dotnet@unobserved',
  };
}

function emptyGraph(snapshot: string) {
  return SystemGraphSchema.parse({
    schemaVersion: '1', snapshot,
    nodes: [{ id: 'component:dotnet-empty', kind: 'component', locator: 'empty', snapshot }],
    edges: [],
  });
}
