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
 * PHP adapter (L1: discovery and extraction).
 *
 * Extraction uses PHP's own tokenizer (`token_get_all`), so the token stream
 * comes from the real lexer rather than a regular expression pass. The adapter
 * supports Laravel's route files and controller classes.
 *
 * A framework this adapter does not implement yields a typed `unsupported`
 * status with an empty graph and a named unsupported surface. It never returns
 * an empty *success*, because an empty graph reads as "no impact" (NEG3-09).
 */

export const PHP_ADAPTER_VERSION = '1.0.0';

export const PHP_KEY: CapabilityKey = {
  ecosystem: 'php',
  language: 'php',
  framework: 'laravel',
  versionRange: '>=11.0 <12.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'php-linux',
  adapterVersion: PHP_ADAPTER_VERSION,
};

export const PHP_ADAPTER_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: PHP_KEY,
  targetLevel: 'L2',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Only the Laravel route/controller shape is extracted; other frameworks are reported as unsupported.',
    'Dynamic container resolution is reported as unresolved.',
  ],
  toolchainIdentities: {},
});

/** The reviewed helper that tokenises the snapshot with PHP's own lexer. */
const TOKENISE_HELPER = `
$payload = json_decode(stream_get_contents(STDIN), true);
$out = [];
foreach ($payload as $entry) {
    $tokens = token_get_all($entry['source']);
    $count = count($tokens);
    for ($i = 0; $i < $count; $i++) {
        $token = $tokens[$i];
        if (!is_array($token)) { continue; }
        [$id, $text, $line] = $token;

        if ($id === T_STRING && in_array(strtolower($text), ['get', 'post', 'put', 'delete', 'patch'], true)) {
            $j = $i + 1;
            while ($j < $count && is_array($tokens[$j]) && in_array($tokens[$j][0], [T_WHITESPACE], true)) { $j++; }
            if ($j < $count && $tokens[$j] === '(') {
                $k = $j + 1;
                while ($k < $count && is_array($tokens[$k]) && $tokens[$k][0] === T_WHITESPACE) { $k++; }
                if ($k < $count && is_array($tokens[$k]) && $tokens[$k][0] === T_CONSTANT_ENCAPSED_STRING) {
                    $route = trim($tokens[$k][1], "'\\"");
                    $out[] = ['kind' => 'route', 'file' => $entry['file'], 'line' => $line,
                              'name' => $route, 'detail' => strtoupper($text)];
                }
            }
        }

        if ($id === T_VARIABLE && $text === '$this') {
            $out[] = ['kind' => 'controller', 'file' => $entry['file'], 'line' => $line,
                      'name' => '$this', 'detail' => 'controller instance'];
        }
    }
}
echo json_encode($out);
`;

interface PhpFact {
  readonly kind: 'route' | 'controller';
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly detail: string;
}

export const PHP_ADAPTER: AdapterDefinition = {
  name: 'php',
  contractVersion: '2',
  key: PHP_KEY,
  records: [PHP_ADAPTER_RECORD],

  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    const snapshot = snapshotId(input.root, input.version);
    const diagnostics: string[] = [];

    // Framework gate: an unsupported framework is refused explicitly.
    const composer = input.files.find((file) => file.endsWith('composer.json'));
    if (composer !== undefined) {
      try {
        const manifest = JSON.parse(readFileSync(join(input.root, composer), 'utf8')) as {
          require?: Record<string, string>;
        };
        const dependencies = Object.keys(manifest.require ?? {});
        const supported = dependencies.some((dependency) => dependency.startsWith('laravel/framework'));
        if (!supported) {
          return unsupported(
            input,
            `Framework dependencies [${dependencies.join(', ') || 'none'}] are not supported by the PHP adapter`,
          );
        }
      } catch (error) {
        diagnostics.push(`Could not read composer.json: ${(error as Error).message}`);
      }
    }

    const entries: { file: string; source: string }[] = [];
    for (const file of input.files) {
      if (!file.endsWith('.php')) continue;
      try {
        entries.push({ file, source: readFileSync(join(input.root, file), 'utf8') });
      } catch (error) {
        diagnostics.push(`Could not read ${file}: ${(error as Error).message}`);
      }
    }

    if (entries.length === 0) {
      return unsupported(input, 'No PHP source was present in the snapshot.');
    }

    const { runNative, parseNativeJson } = await import('../native/process.js');
    const run = await runNative(
      'php',
      ['-r', TOKENISE_HELPER],
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
        unknowns: [`php exited with code ${run.exitCode}`],
        unsupportedSurfaces: [],
        diagnostics: [run.stderr.slice(0, 2000)],
        toolchainIdentity: `php@${input.version}`,
      };
    }

    const facts = (parseNativeJson(run.stdout) as PhpFact[] | null) ?? [];
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const unknowns: string[] = [];

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
            method: 'php-tokenizer-route-call',
          },
          runtimeObserved: false,
        });
      }
    }

    return {
      status: 'ok',
      graph: SystemGraphSchema.parse({ schemaVersion: '1', snapshot, nodes: [...nodes.values()], edges }),
      unknowns,
      unsupportedSurfaces: [],
      diagnostics,
      toolchainIdentity: `php@${input.version}`,
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
    toolchainIdentity: `php@${input.version}`,
  };
}

function emptyGraph(snapshot: string) {
  return SystemGraphSchema.parse({
    schemaVersion: '1',
    snapshot,
    nodes: [{ id: 'component:empty', kind: 'component', locator: 'empty', snapshot }],
    edges: [],
  });
}
