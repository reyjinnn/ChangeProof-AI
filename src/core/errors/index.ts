/**
 * Typed failures for the ChangeProof core.
 *
 * .claude/AGENTS.md §3 rule 8 (fail closed): an unknown or unresolved condition must
 * produce a specific, actionable error — never a silent default and never a
 * generic success. Every error here carries the data needed to act on it.
 */

export class ChangeProofError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A schema field names a contract version the code does not know. */
export class SchemaVersionUnknownError extends ChangeProofError {
  readonly contract: string;
  readonly received: string;
  readonly known: readonly string[];

  constructor(contract: string, received: string, known: readonly string[]) {
    super(
      `Unknown schemaVersion "${received}" for contract "${contract}". ` +
        `Known versions: ${known.length > 0 ? known.join(', ') : '(none registered)'}. ` +
        'Refusing to guess: a forward-compatible default would silently reinterpret evidence.',
    );
    this.contract = contract;
    this.received = received;
    this.known = known;
  }
}

/** A reference points at something that does not exist in the same document. */
export class DanglingReferenceError extends ChangeProofError {
  readonly references: readonly string[];
  readonly scope: string;

  constructor(scope: string, references: readonly string[]) {
    const unique = [...new Set(references)].sort();
    super(
      `${scope} contains ${unique.length} dangling reference(s): ${unique.join(', ')}. ` +
        'An unresolvable reference is a coverage gap, not an empty result.',
    );
    this.scope = scope;
    this.references = unique;
  }
}

/** A value violated a semantic rule that shape validation cannot express. */
export class SemanticViolationError extends ChangeProofError {
  readonly rule: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(rule: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(`[${rule}] ${message}`);
    this.rule = rule;
    this.details = details;
  }
}

/** A required configuration value is absent. Never fall back to a default. */
export class MissingConfigurationError extends ChangeProofError {
  readonly key: string;
  readonly source: string;

  constructor(key: string, source: string, hint?: string) {
    super(
      `Missing required configuration "${key}" (looked in: ${source}). ` +
        (hint ?? 'Provision it explicitly; there is no silent default.'),
    );
    this.key = key;
    this.source = source;
  }
}

/**
 * The capability tuple an unsupported request referred to.
 *
 * Declared here rather than imported from the capability schema so that the
 * error layer stays dependency-free of the contract layer.
 */
export interface UnsupportedCapabilityKey {
  readonly ecosystem: string;
  readonly language: string;
  readonly framework: string;
  readonly versionRange: string;
  readonly componentKind: string;
  readonly changeCategory: string;
  readonly runnerProfile: string;
  readonly adapterVersion: string;
}

/** A capability was requested that the registry has no evidence for. */
export class UnsupportedCapabilityError extends ChangeProofError {
  readonly capabilityKey: UnsupportedCapabilityKey;
  readonly reasonCode = 'adapter_unsupported' as const;

  constructor(message: string, capabilityKey: UnsupportedCapabilityKey) {
    super(message);
    this.capabilityKey = capabilityKey;
  }
}

/** A budget or resource profile cannot fund the proof that is required. */
export class ResourceProfileInsufficientError extends ChangeProofError {
  readonly reasonCode = 'resource_profile_insufficient' as const;
  readonly shortfall: Readonly<Record<string, number>>;

  constructor(message: string, shortfall: Readonly<Record<string, number>>) {
    super(message);
    this.shortfall = shortfall;
  }
}
