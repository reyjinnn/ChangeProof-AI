import { z } from 'zod';

import { ChangeProofError, SemanticViolationError } from '../../core/index.js';

/**
 * Dependency broker (WP3-04, FR3-22, FR3-23).
 *
 * The broker owns dependency acquisition. It runs on the trusted side of the
 * boundary: it resolves against an allowlisted registry, records integrity
 * digests, and produces the lockfile. Candidate code never writes the lockfile
 * and never runs an install script outside the isolated sandbox.
 *
 * Three refusals are load-bearing:
 *
 *  - a package with a lifecycle install script is refused rather than run
 *    (NEG3-10: an install script is a supply-chain execution surface);
 *  - an unpinned version is refused, because "latest" is not a reproducible
 *    identity for a proof;
 *  - a lockfile whose resolved set drifted is a hard error, because the
 *    resolved set *is* the identity the proof was computed against.
 */

/** Lifecycle script names that execute during installation. */
export const INSTALL_SCRIPT_NAMES = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'preprepare',
  'postprepare',
] as const;

export class MaliciousInstallScriptError extends ChangeProofError {
  readonly reasonCode = 'dependency_resolution_failed' as const;
  readonly packageName: string;
  readonly scriptName: string;

  constructor(packageName: string, scriptName: string) {
    super(
      `Package "${packageName}" declares an install script ("${scriptName}"). ` +
        'Install scripts execute arbitrary code during acquisition, so they are refused here. ' +
        'Run the acquisition inside the isolated build sandbox instead.',
    );
    this.packageName = packageName;
    this.scriptName = scriptName;
  }
}

export class UnpinnedResolutionError extends ChangeProofError {
  readonly reasonCode = 'dependency_resolution_failed' as const;
  readonly packageName: string;

  constructor(packageName: string, version: string) {
    super(
      `Package "${packageName}" was requested at "${version}". ` +
        'Resolution must be an exact version: a range or a tag is not a reproducible identity.',
    );
    this.packageName = packageName;
  }
}

export class LockfileDriftError extends ChangeProofError {
  readonly reasonCode = 'dependency_resolution_failed' as const;
  /** Lockfile keys (`name@version`) whose resolution no longer matches. */
  readonly drifted: readonly string[];
  /** Human-readable reason per drift entry. */
  readonly details: readonly string[];

  constructor(drifted: readonly string[], details: readonly string[]) {
    super(
      `The resolved dependency set drifted from the lockfile: ${drifted.join(', ')}. ` +
        'Proof computed against one dependency set does not apply to another.',
    );
    this.drifted = drifted;
    this.details = details;
  }
}

export const PackageManifestSchema = z
  .strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
    integrity: z.string().min(1).optional(),
    scripts: z.record(z.string(), z.string()).default({}),
  })
  .describe('The manifest of a package being acquired');
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export const ResolutionRequestSchema = z
  .strictObject({
    packageName: z.string().min(1),
    version: z.string().min(1),
    manifest: PackageManifestSchema,
    registry: z.string().min(1),
  })
  .describe('A request to acquire one package');
export type ResolutionRequest = z.input<typeof ResolutionRequestSchema>;

export interface ResolvedDependency {
  readonly packageName: string;
  readonly version: string;
  readonly integrity: string;
  readonly resolvedFrom: string;
  /** Always false: the broker never executes an install script itself. */
  readonly installScriptExecuted: boolean;
}

export interface BrokerPolicy {
  readonly allowlistedRegistries: readonly string[];
  readonly allowlistedPackages: readonly string[];
  /**
   * Whether a package may declare install scripts at all. The default policy
   * refuses them; enabling it is a deliberate, recorded decision and still
   * requires the acquisition to run inside the isolated build sandbox.
   */
  readonly installScriptsAllowed: boolean;
}

export const LockfileSchema = z
  .strictObject({
    lockfileVersion: z.literal(1),
    packages: z.record(
      z.string(),
      z.strictObject({
        integrity: z.string().min(1),
        resolvedFrom: z.string().min(1),
      }),
    ),
  })
  .describe('A broker-authored lockfile');
export type Lockfile = z.infer<typeof LockfileSchema>;

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class DependencyBroker {
  private readonly policy: BrokerPolicy;

  constructor(policy: BrokerPolicy) {
    this.policy = policy;
  }

  /**
   * Resolve one package against the trusted allowlists.
   *
   * @throws {MaliciousInstallScriptError} when the manifest declares an
   *         install script and the policy forbids them.
   * @throws {UnpinnedResolutionError} when the version is not exact.
   */
  resolve(request: ResolutionRequest): ResolvedDependency {
    const parsed = ResolutionRequestSchema.parse(request);

    // The install-script check comes first on purpose: it is the check that
    // protects the acquisition boundary, so it must not be pre-empted by a
    // less specific refusal (an unlisted package is a weaker fact than "this
    // package executes code at install time").
    if (!this.policy.installScriptsAllowed) {
      for (const scriptName of INSTALL_SCRIPT_NAMES) {
        if (parsed.manifest.scripts[scriptName] !== undefined) {
          throw new MaliciousInstallScriptError(parsed.packageName, scriptName);
        }
      }
    }

    if (!this.policy.allowlistedRegistries.includes(parsed.registry)) {
      throw new SemanticViolationError(
        'dependencies.registry.not_allowed',
        `Registry "${parsed.registry}" is not allowlisted. ` +
          `Allowed registries: ${this.policy.allowlistedRegistries.join(', ') || '(none)'}.`,
        { registry: parsed.registry },
      );
    }

    if (!this.policy.allowlistedPackages.includes(parsed.packageName)) {
      throw new SemanticViolationError(
        'dependencies.package.not_allowed',
        `Package "${parsed.packageName}" is not on the allowlist. ` +
          'Acquisition is limited to reviewed packages; a new dependency needs review first.',
        { packageName: parsed.packageName },
      );
    }

    if (!EXACT_VERSION.test(parsed.version)) {
      throw new UnpinnedResolutionError(parsed.packageName, parsed.version);
    }

    if (parsed.manifest.name !== parsed.packageName) {
      throw new SemanticViolationError(
        'dependencies.manifest.name_mismatch',
        `Manifest declares "${parsed.manifest.name}" but "${parsed.packageName}" was requested.`,
        { declared: parsed.manifest.name, requested: parsed.packageName },
      );
    }

    if (parsed.manifest.version !== parsed.version) {
      throw new SemanticViolationError(
        'dependencies.manifest.version_mismatch',
        `Manifest declares version "${parsed.manifest.version}" but "${parsed.version}" was requested.`,
        { declared: parsed.manifest.version, requested: parsed.version },
      );
    }

    return {
      packageName: parsed.packageName,
      version: parsed.version,
      integrity: parsed.manifest.integrity ?? '',
      resolvedFrom: parsed.registry,
      installScriptExecuted: false,
    };
  }

  /**
   * Produce the lockfile. The broker owns this artifact: the candidate
   * workspace never authors it, because a candidate that can write its own
   * lockfile can also widen its own dependency set.
   */
  writeLockfile(resolutions: readonly ResolvedDependency[]): Lockfile {
    const packages: Record<string, { integrity: string; resolvedFrom: string }> = {};

    for (const resolution of resolutions) {
      if (resolution.integrity.trim().length === 0) {
        throw new SemanticViolationError(
          'dependencies.lockfile.missing_integrity',
          `Package "${resolution.packageName}@${resolution.version}" has no integrity digest. ` +
            'An artifact without a digest cannot be identified, so it cannot enter a lockfile.',
          { packageName: resolution.packageName },
        );
      }

      const key = `${resolution.packageName}@${resolution.version}`;
      packages[key] = {
        integrity: resolution.integrity,
        resolvedFrom: resolution.resolvedFrom,
      };
    }

    return LockfileSchema.parse({ lockfileVersion: 1, packages });
  }

  /**
   * Assert that a freshly resolved set matches an existing lockfile.
   *
   * @throws {LockfileDriftError} when any package changed.
   */
  assertNoDrift(expected: Lockfile, actual: Lockfile): void {
    const expectedParsed = LockfileSchema.parse(expected);
    const actualParsed = LockfileSchema.parse(actual);

    const drifted: string[] = [];
    const details: string[] = [];

    // Drift is compared per *package*, not per lockfile key: a version bump
    // changes the key, and the report has to name the package that moved.
    const byPackage = (
      lockfile: Lockfile,
    ): Map<string, { key: string; integrity: string; resolvedFrom: string }> => {
      const map = new Map<string, { key: string; integrity: string; resolvedFrom: string }>();
      for (const [key, entry] of Object.entries(lockfile.packages)) {
        const packageName = key.slice(0, key.lastIndexOf('@')) || key;
        map.set(packageName, { key, integrity: entry.integrity, resolvedFrom: entry.resolvedFrom });
      }
      return map;
    };

    const expectedPackages = byPackage(expectedParsed);
    const actualPackages = byPackage(actualParsed);

    for (const [packageName, before] of expectedPackages) {
      const after = actualPackages.get(packageName);

      if (after === undefined) {
        drifted.push(before.key);
        details.push(`${packageName} was removed from the resolved set`);
        continue;
      }
      if (before.key !== after.key) {
        drifted.push(before.key);
        details.push(`${packageName} moved from ${before.key} to ${after.key}`);
      }
      if (before.integrity !== after.integrity) {
        drifted.push(before.key);
        details.push(
          `${packageName} integrity changed from ${before.integrity} to ${after.integrity}`,
        );
      }
      if (before.resolvedFrom !== after.resolvedFrom) {
        drifted.push(before.key);
        details.push(
          `${packageName} moved from registry ${before.resolvedFrom} to ${after.resolvedFrom}`,
        );
      }
    }

    for (const [packageName, after] of actualPackages) {
      if (!expectedPackages.has(packageName)) {
        drifted.push(after.key);
        details.push(`${packageName} was added to the resolved set`);
      }
    }

    if (drifted.length > 0) {
      throw new LockfileDriftError([...new Set(drifted)].sort(), details);
    }
  }
}
