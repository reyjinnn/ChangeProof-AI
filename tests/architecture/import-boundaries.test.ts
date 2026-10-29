import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * WP3-02 / T1-3 — executable import boundary negatives.
 *
 * Each fixture is a tiny, isolated graph under the project root and is removed
 * after the assertion. The tool is run against the repository's actual
 * `.dependency-cruiser.cjs`; the test is not a snapshot of the config text.
 * The forbidden graphs must fail the actual boundary command (AGENTS.md §14).
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const depcruise = join(root, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const config = join(root, '.dependency-cruiser.cjs');
const temporaryRoots: string[] = [];

function fixture(files: Readonly<Record<string, string>>): string {
  const base = mkdtempSync(join(tmpdir(), 'changeproof-boundary-'));
  temporaryRoots.push(base);
  for (const [path, content] of Object.entries(files)) {
    const file = join(base, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
  return base;
}

function cruise(path: string): { status: number | null; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [depcruise, '--config', config, '--output-type', 'err-long', path],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, output };
  } catch (error) {
    const result = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: result.status ?? 1,
      output: `${result.stdout?.toString() ?? ''}\n${result.stderr?.toString() ?? ''}`,
    };
  }
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('dependency-cruiser boundary negatives', () => {
  it('rejects a leaf module importing a sibling leaf module', () => {
    const base = fixture({
      'src/modules/consumer/index.ts': "import { x } from '../policy/index.js'; export { x };\n",
      'src/modules/policy/index.ts': 'export const x = 1;\n',
    });
    const result = cruise(join(base, 'src/modules/consumer/index.ts'));

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/leaf-modules-import-core-only/);
  });

  it('rejects a core module importing a leaf module', () => {
    const base = fixture({
      'src/core/leak.ts': "import { evaluate } from '../modules/policy/index.js'; export { evaluate };\n",
      'src/modules/policy/index.ts': 'export const evaluate = () => true;\n',
    });
    const result = cruise(join(base, 'src/core/leak.ts'));

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/core-imports-nothing-internal/);
  });

  it('rejects an import that bypasses another module public index', () => {
    const base = fixture({
      'src/orchestrator/wire.ts': "import { x } from '../modules/policy/precedence.js'; export { x };\n",
      'src/modules/policy/index.ts': 'export const x = 1;\n',
      'src/modules/policy/precedence.ts': 'export const x = 1;\n',
    });
    const result = cruise(join(base, 'src/orchestrator/wire.ts'));

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/no-deep-module-imports|orchestrator-imports-public-apis-only/);
  });

  it('rejects an import cycle', () => {
    const base = fixture({
      'src/core/a.ts': "import { b } from './b.js'; export const a = b;\n",
      'src/core/b.ts': "import { a } from './a.js'; export const b = a;\n",
    });
    const result = cruise(join(base, 'src/core/a.ts'));

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/no-circular/);
  });

  it('rejects an unresolved import instead of treating the graph as clean', () => {
    const base = fixture({
      'src/core/unresolved.ts': "import { value } from './missing.js'; export { value };\n",
    });
    const result = cruise(join(base, 'src/core/unresolved.ts'));

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/no-unresolvable/);
  });

  it('rejects a direct non-package dependency that was not declared', () => {
    const base = fixture({
      'src/core/undeclared.ts': "import { readFile } from 'some-transitive-package'; export { readFile };\n",
    });
    const result = cruise(join(base, 'src/core/undeclared.ts'));

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/couldNotResolve|no-unresolvable/);
  });

  it('fixture roots are outside the project tree', () => {
    // Sanity check: probes cannot leave residue in product source or get
    // accidentally picked up by `pnpm build`.
    const base = fixture({ 'probe.ts': 'export {};\n' });
    expect(relative(root, base).startsWith('..')).toBe(true);
  });
});

describe('ESLint import restriction negatives', () => {
  it('rejects a deep module import that names the module directory', async () => {
    const { ESLint } = await import('eslint');
    const base = fixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
        },
        include: ['**/*.ts'],
      }),
      'src/modules/policy/index.ts': "export { x } from './precedence.js';\nexport const x = 1;\n",
      'src/modules/policy/precedence.ts': 'export const x = 1;\n',
      'src/modules/detector/index.ts':
        "import { x } from 'src/modules/policy/precedence.js';\nexport { x };\n",
    });

    const eslint = new ESLint({
      cwd: base,
      overrideConfigFile: join(root, 'eslint.config.mjs'),
      // The fixture is outside the repository, so both the project and the
      // tsconfig root must be pointed at it rather than at the repository.
      overrideConfig: {
        languageOptions: {
          parserOptions: {
            projectService: false,
            project: './tsconfig.json',
            tsconfigRootDir: base,
          },
        },
      },
    });
    const results = await eslint.lintFiles([join(base, 'src/modules/detector/index.ts')]);

    const messages = results.flatMap((result) => result.messages);
    expect(messages.some((message) => message.ruleId === 'no-restricted-imports')).toBe(true);
    expect(messages.some((message) => message.fatal === true)).toBe(false);
  }, 15_000);

  it('leaves the relative form to dependency-cruiser, which resolves the target', async () => {
    // Split responsibility, recorded so a gap is never assumed covered: ESLint
    // sees the specifier text, dependency-cruiser resolves the real target.
    // A relative import like `../policy/precedence.js` does not name the module
    // directory, so ESLint stays silent and the `no-deep-module-imports` rule
    // catches it — proven by the dependency-cruiser case above.
    const { ESLint } = await import('eslint');
    const base = fixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
        },
        include: ['**/*.ts'],
      }),
      'src/modules/policy/index.ts': "export { x } from './precedence.js';\nexport const x = 1;\n",
      'src/modules/policy/precedence.ts': 'export const x = 1;\n',
      'src/modules/detector/index.ts':
        "import { x } from '../policy/precedence.js';\nexport { x };\n",
    });

    const eslint = new ESLint({
      cwd: base,
      overrideConfigFile: join(root, 'eslint.config.mjs'),
      overrideConfig: {
        languageOptions: {
          parserOptions: {
            projectService: false,
            project: './tsconfig.json',
            tsconfigRootDir: base,
          },
        },
      },
    });
    const results = await eslint.lintFiles([join(base, 'src/modules/detector/index.ts')]);
    const messages = results.flatMap((result) => result.messages);

    expect(messages.some((message) => message.fatal === true)).toBe(false);
    expect(messages.some((message) => message.ruleId === 'no-restricted-imports')).toBe(false);

    // The same fixture must fail the structural boundary check.
    const cruiseResult = cruise(join(base, 'src/modules/detector/index.ts'));
    expect(cruiseResult.status).not.toBe(0);
    expect(cruiseResult.output).toMatch(/no-deep-module-imports/);
  });
});
