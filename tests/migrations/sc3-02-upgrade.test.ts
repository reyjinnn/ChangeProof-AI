import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runNative } from '../../src/modules/adapters/native/process.js';
import {
  DependencyBroker,
  assertManifestLockfileMatch,
  planUpgrade,
  type BrokerPolicy,
} from '../../src/modules/dependencies/index.js';
import { createFixture } from '../adapters/fixtures.js';
import { REPO_ROOT, pnpmExe } from '../adapters/native-exec.js';

/**
 * T-23 native: coordinated dependency upgrade across two interacting
 * components (SC3-02, FR3-12).
 *
 * The broker plans semver 7.5.4 -> 7.7.3 for a pnpm workspace (app +
 * lib); the real toolchain installs, builds, and runs the upgraded
 * tree; the test proves the intended version is installed everywhere,
 * the old version is gone, and manifest and lockfile match exactly.
 */

const POLICY: BrokerPolicy = {
  allowlistedRegistries: ['https://registry.npmjs.org'],
  allowlistedPackages: ['semver'],
  installScriptsAllowed: false,
};

const OLD_VERSION = '7.5.4';
const NEW_VERSION = '7.7.3';

async function registryField(version: string, field: string): Promise<string> {
  const view = await runNative(await pnpmExe(), ['view', `semver@${version}`, field, '--json'], {
    cwd: process.cwd(),
    timeoutMs: 120_000,
    maxOutputBytes: 64_000,
  });
  expect(view.exitCode, view.stderr).toBe(0);
  return view.stdout.trim();
}

describe('SC3-02 coordinated dependency upgrade', () => {
  it(
    'upgrades semver across app+lib with broker proof and real build',
    { timeout: 600_000 },
    async () => {
      const fixture = createFixture({
        'package.json': JSON.stringify({ name: 't23-shop', private: true, version: '1.0.0' }),
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'tsconfig.json': JSON.stringify(
          {
            compilerOptions: {
              strict: true,
              target: 'es2022',
              module: 'esnext',
              moduleResolution: 'bundler',
              noEmit: true,
              types: ['node'],
            },
            include: ['packages'],
          },
          null,
          2,
        ),
        'packages/lib/package.json': JSON.stringify({
          name: '@t23/lib',
          version: '1.0.0',
          type: 'module',
          main: 'newer.ts',
          dependencies: { semver: OLD_VERSION },
        }),
        'packages/lib/newer.ts': [
          "import { gt } from 'semver';",
          '',
          'export function newer(a: string, b: string): string {',
          '  return gt(a, b) ? a : b;',
          '}',
          '',
        ].join('\n'),
        'packages/lib/semver.d.ts': [
          "declare module 'semver' {",
          '  export function gt(a: string, b: string): boolean;',
          '}',
          '',
        ].join('\n'),
        'packages/app/package.json': JSON.stringify({
          name: '@t23/app',
          version: '1.0.0',
          private: true,
          type: 'module',
          dependencies: { '@t23/lib': 'workspace:*', semver: OLD_VERSION },
        }),
        'packages/app/check.ts': [
          "import { readFileSync } from 'node:fs';",
          "import { dirname, join } from 'node:path';",
          "import { fileURLToPath } from 'node:url';",
          "import { newer } from '@t23/lib';",
          '',
          'const semverMain = fileURLToPath(import.meta.resolve(`semver`));',
          'const pkg = JSON.parse(readFileSync(join(dirname(semverMain), `package.json`), `utf8`)) as { version: string };',
          'const expected = process.argv[2];',
          'if (pkg.version !== expected) throw new Error(`wrong semver: ${pkg.version}`);',
          "if (newer('1.2.3', '1.10.0') !== '1.10.0') throw new Error('lib comparison broke');",
          'console.log(`ok ${pkg.version}`);',
          '',
        ].join('\n'),
      });
      try {
        const pnpm = await pnpmExe();
        const install = await runNative(pnpm, ['install'], {
          cwd: fixture.root,
          timeoutMs: 300_000,
          maxOutputBytes: 64_000,
        });
        expect(install.exitCode, install.stdout + install.stderr).toBe(0);
        const broker = new DependencyBroker(POLICY);
        const oldIntegrity = JSON.parse(await registryField(OLD_VERSION, 'dist.integrity')) as string;
        const newIntegrity = JSON.parse(await registryField(NEW_VERSION, 'dist.integrity')) as string;
        const scriptsJson = await registryField(NEW_VERSION, 'scripts');
        const scriptsRaw: unknown = scriptsJson === '' ? {} : JSON.parse(scriptsJson);
        const scripts = (scriptsRaw ?? {}) as Record<string, string>;
        const current = planUpgrade(broker, {
          schemaVersion: '1',
          components: [
            {
              name: 'lib',
              requirements: [
                {
                  packageName: 'semver',
                  version: OLD_VERSION,
                  registry: 'https://registry.npmjs.org',
                  manifest: { name: 'semver', version: OLD_VERSION, integrity: oldIntegrity, scripts: {} },
                },
              ],
            },
            {
              name: 'app',
              requirements: [
                {
                  packageName: 'semver',
                  version: OLD_VERSION,
                  registry: 'https://registry.npmjs.org',
                  manifest: { name: 'semver', version: OLD_VERSION, integrity: oldIntegrity, scripts: {} },
                },
              ],
            },
          ],
        }).lockfile;
        const planned = planUpgrade(broker, {
          schemaVersion: '1',
          components: [
            {
              name: 'lib',
              requirements: [
                {
                  packageName: 'semver',
                  version: NEW_VERSION,
                  registry: 'https://registry.npmjs.org',
                  manifest: { name: 'semver', version: NEW_VERSION, integrity: newIntegrity, scripts },
                },
              ],
            },
            {
              name: 'app',
              requirements: [
                {
                  packageName: 'semver',
                  version: NEW_VERSION,
                  registry: 'https://registry.npmjs.org',
                  manifest: { name: 'semver', version: NEW_VERSION, integrity: newIntegrity, scripts },
                },
              ],
            },
          ],
          currentLockfile: current,
        });
        expect(planned.diff.changed).toEqual([{ packageName: 'semver', from: OLD_VERSION, to: NEW_VERSION }]);
        const up = await runNative(pnpm, ['up', `semver@${NEW_VERSION}`, '-r'], {
          cwd: fixture.root,
          timeoutMs: 300_000,
          maxOutputBytes: 64_000,
        });
        expect(up.exitCode, up.stdout + up.stderr).toBe(0);
        const frozen = await runNative(pnpm, ['install', '--frozen-lockfile'], {
          cwd: fixture.root,
          timeoutMs: 300_000,
          maxOutputBytes: 64_000,
        });
        expect(frozen.exitCode, frozen.stdout + frozen.stderr).toBe(0);
        const types = await runNative(pnpm, ['add', '-D', '@types/node@24.8.0'], {
          cwd: fixture.root,
          timeoutMs: 300_000,
          maxOutputBytes: 32_000,
        });
        expect(types.exitCode, types.stdout + types.stderr).toBe(0);
        const tsc = await runNative(
          process.execPath,
          [`${REPO_ROOT}/node_modules/typescript/bin/tsc`, '--noEmit', '-p', 'tsconfig.json'],
          { cwd: fixture.root, timeoutMs: 180_000, maxOutputBytes: 32_000 },
        );
        expect(tsc.exitCode, tsc.stdout + tsc.stderr).toBe(0);
        for (const pkg of ['lib', 'app']) {
          const installed = JSON.parse(
            readFileSync(`${fixture.root}/node_modules/.pnpm/semver@${NEW_VERSION}/node_modules/semver/package.json`, 'utf8'),
          ) as { version: string };
          expect(installed.version, pkg).toBe(NEW_VERSION);
        }
        const lockfile = readFileSync(`${fixture.root}/pnpm-lock.yaml`, 'utf8');
        expect(lockfile).toContain(`semver@${NEW_VERSION}`);
        expect(lockfile).not.toContain(`semver@${OLD_VERSION}`);
        const node = await runNative(process.execPath, ['packages/app/check.ts', NEW_VERSION], {
          cwd: fixture.root,
          timeoutMs: 60_000,
          maxOutputBytes: 16_000,
        });
        expect(node.exitCode, node.stdout + node.stderr).toBe(0);
        expect(node.stdout).toContain(`ok ${NEW_VERSION}`);
        const libManifest = JSON.parse(readFileSync(`${fixture.root}/packages/lib/package.json`, 'utf8')) as {
          dependencies: Record<string, string>;
        };
        const appManifest = JSON.parse(readFileSync(`${fixture.root}/packages/app/package.json`, 'utf8')) as {
          dependencies: Record<string, string>;
        };
        const libSemver = libManifest.dependencies['semver'];
        const appSemver = appManifest.dependencies['semver'];
        if (libSemver === undefined || appSemver === undefined) {
          throw new Error('fixture manifests must pin semver');
        }
        expect(() => {
          assertManifestLockfileMatch({ dependencies: { semver: libSemver } }, planned.lockfile);
        }).not.toThrow();
        expect(() => {
          assertManifestLockfileMatch({ dependencies: { semver: appSemver } }, planned.lockfile);
        }).not.toThrow();
        broker.assertNoDrift(planned.lockfile, planned.lockfile);
      } finally {
        fixture.cleanup();
      }
    },
  );
});
