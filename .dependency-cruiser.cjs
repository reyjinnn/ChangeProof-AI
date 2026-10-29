/**
 * Dependency boundary rules for the ChangeProof single host package.
 *
 * Source of truth: .prepare/architecture.md §3 import matrix, .claude/AGENTS.md §5 boundary rules.
 *
 *   core        -> imports nothing internal
 *   modules/*   -> may import core only (leaf modules never import each other)
 *   orchestrator-> may import core AND every module's public index
 *   http/workers/cli -> may import core + orchestrator
 *
 * Each module exposes exactly one public entry point: <module>/index.ts.
 * Deep imports into a module's internals are a violation, as are cycles,
 * unresolved imports, and re-export/transitive escapes.
 *
 * The patterns match the *module structure* rather than a repository prefix,
 * so the same rules apply to the product source and to the isolated fixtures
 * used by the boundary tests.
 */
const MODULES = '(?:^|/)modules/';
const CORE = '(?:^|/)core/';
const ENTRY = '(?:^|/)orchestrator/';
const PROCESS = '(?:^|/)((?:http|workers|cli)/)';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'A cycle means two modules depend on each other. Cross-module collaboration goes ' +
        'through ports in core, wired by orchestrator. .prepare/architecture.md §3.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        'Orphan modules are unreachable from the composition root. They are usually a sign ' +
        'that wiring was forgotten instead of declared.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)(vitest|eslint)\\.config\\.(ts|mjs)$'],
      },
      to: {},
    },
    {
      name: 'core-imports-nothing-internal',
      comment:
        'core holds contracts, ports and typed errors. It must stay dependency-free so that ' +
        'every module can import it without pulling in behaviour. .claude/AGENTS.md §5.',
      severity: 'error',
      from: { path: CORE },
      to: {
        path: '(?:^|/)(?:modules|orchestrator|http|workers|cli)/',
      },
    },
    {
      name: 'leaf-modules-import-core-only',
      comment:
        'Leaf modules may only import core. A module importing another module directly ' +
        'creates the coupling that ports in core exist to prevent. .claude/AGENTS.md §5. ' +
        'A module public index may re-export its own internals; no other file may ' +
        'reach across module boundaries.',
      severity: 'error',
      from: { path: `${MODULES}([^/]+)/` },
      to: {
        path: `${MODULES}([^/]+)/`,
        pathNot: [`${MODULES}$1/`],
      },
    },
    {
      name: 'no-deep-module-imports',
      comment:
        'Each module publishes exactly one entry point: <module>/index.ts. Reaching into ' +
        'another module internals bypasses its published contract. Imports within the same ' +
        'module are unrestricted. .claude/AGENTS.md §5.',
      severity: 'error',
      from: { path: `${MODULES}([^/]+)/` },
      to: {
        path: `${MODULES}[^/]+/`,
        pathNot: [`${MODULES}$1/`, `${MODULES}[^/]+/index\\.ts$`],
      },
    },
    {
      name: 'orchestrator-imports-public-apis-only',
      comment:
        'orchestrator is the composition root: it may import core and every module public ' +
        'index, and nothing else in src. .claude/AGENTS.md §5.',
      severity: 'error',
      from: { path: ENTRY },
      to: {
        path: '(?:^|/)(?:core|modules|orchestrator|http|workers|cli)/',
        pathNot: [
          CORE,
          `${MODULES}[^/]+/index\\.ts$`,
          ENTRY,
        ],
      },
    },
    {
      name: 'http-workers-cli-import-core-orchestrator',
      comment:
        'Process entrypoints compose core contracts with the orchestrator. They do not reach ' +
        'into module internals. .claude/AGENTS.md §5.',
      severity: 'error',
      from: { path: PROCESS },
      to: {
        path: '(?:^|/)(?:core|modules|orchestrator|http|workers|cli)/',
        pathNot: [
          CORE,
          ENTRY,
          '(?:^|/)(?:http|workers|cli)/',
        ],
      },
    },
    {
      name: 'no-unresolvable',
      comment:
        'An unresolved import is a hole in the boundary check: dependency-cruiser cannot ' +
        'prove a rule it cannot follow. FAIL CLOSED (.claude/AGENTS.md §3 rule 8).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      comment: 'Do not depend on transitive dependencies directly; declare what you use.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-dev-dependency-in-source',
      comment:
        'Production source may not import a devDependency. That is how a build that only ' +
        'works on the author machine ships.',
      severity: 'error',
      from: { path: '(?:^|/)src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)node_modules/|(^|/)dist/|(^|/)runs/|(^|/)fixtures/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
