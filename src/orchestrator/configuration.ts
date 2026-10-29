import { MissingConfigurationError } from '../core/index.js';

/**
 * Configuration access (WP3-02 / NFR3-08).
 *
 * A missing tool, credential or config must become a specific, actionable
 * error. Never a silent default, never a fabricated value: a default here would
 * let a run proceed with a capability it does not actually have, which is the
 * difference between "unverified" and "verified" (.claude/AGENTS.md §3 rule 8).
 */

export interface ConfigurationSource {
  readonly name: string;
  require(key: string): string;
  optional(key: string): string | null;
  has(key: string): boolean;
}

export class EnvironmentConfiguration implements ConfigurationSource {
  readonly name: string;
  private readonly entries: Map<string, string>;

  constructor(name: string, entries: Readonly<Record<string, string>> = {}) {
    this.name = name;
    this.entries = new Map(Object.entries(entries));
  }

  static fromProcessEnv(prefix = 'CHANGEPROOF_'): EnvironmentConfiguration {
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix) && value !== undefined) {
        entries[key.slice(prefix.length)] = value;
      }
    }
    return new EnvironmentConfiguration(`process.env(${prefix}*)`, entries);
  }

  require(key: string): string {
    const value = this.entries.get(key);
    if (value === undefined || value === '') {
      throw new MissingConfigurationError(key, this.name);
    }
    return value;
  }

  optional(key: string): string | null {
    const value = this.entries.get(key);
    return value === undefined || value === '' ? null : value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }
}

/**
 * Merge configuration sources. Later sources win, but a value that is only
 * present in an earlier source is still available — merging never invents a
 * value that no source provided.
 */
export class CompositeConfiguration implements ConfigurationSource {
  readonly name: string;
  private readonly sources: readonly ConfigurationSource[];

  constructor(sources: readonly ConfigurationSource[]) {
    this.sources = sources;
    this.name = sources.map((source) => source.name).join(' + ');
  }

  require(key: string): string {
    for (const source of this.sources) {
      const value = source.optional(key);
      if (value !== null) return value;
    }
    throw new MissingConfigurationError(key, this.name);
  }

  optional(key: string): string | null {
    for (const source of this.sources) {
      const value = source.optional(key);
      if (value !== null) return value;
    }
    return null;
  }

  has(key: string): boolean {
    return this.sources.some((source) => source.has(key));
  }
}

/**
 * A required configuration key set. The whole set is validated up front, so a
 * run cannot start with half its configuration present.
 */
export function requireAll(
  configuration: ConfigurationSource,
  keys: readonly string[],
): Readonly<Record<string, string>> {
  const missing = keys.filter((key) => configuration.optional(key) === null);
  if (missing.length > 0) {
    throw new MissingConfigurationError(
      missing.join(', '),
      configuration.name,
      `Configure ${missing.length} required value(s) before starting a run.`,
    );
  }

  const resolved: Record<string, string> = {};
  for (const key of keys) {
    resolved[key] = configuration.require(key);
  }
  return resolved;
}
