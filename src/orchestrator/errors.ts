import { ChangeProofError } from '../core/index.js';

/**
 * Typed orchestrator failures.
 *
 * The orchestrator is the composition root: it wires modules, scopes a run and
 * drives its lifecycle. It does not define verdicts — that authority belongs
 * to `policy`, over verifier evidence.
 */

/** A required module was not wired. Never default one in silently. */
export class UnwiredDependencyError extends ChangeProofError {
  readonly dependency: string;

  constructor(dependency: string, detail: string) {
    super(
      `Required dependency "${dependency}" was not wired. ${detail} ` +
        'Refusing to start with a missing dependency.',
    );
    this.dependency = dependency;
  }
}

/** A stage was requested that the current scope does not permit. */
export class StageNotAllowedError extends ChangeProofError {
  readonly stage: string;

  constructor(stage: string, reason: string) {
    super(`Stage "${stage}" is not allowed in the current scope. ${reason}`);
    this.stage = stage;
  }
}

/**
 * Bundle coordination input was malformed or would silently weaken proof.
 * The orchestrator assembles policy facts; it never repairs them.
 */
export class BundleCoordinationError extends ChangeProofError {
  constructor(detail: string) {
    super(`Bundle coordination refused: ${detail}`);
  }
}

/**
 * Publication was withheld: the bundle is not verified, its evidence is
 * inaccessible or mismatched, the head moved, or the provider does not match.
 * Withholding is explicit and names the blocker; it never degrades to a
 * silent skip or a weaker claim.
 */
export class PublicationWithheldError extends ChangeProofError {
  constructor(detail: string) {
    super(`Publication withheld: ${detail}`);
  }
}

/**
 * The open call failed and the reconciliation lookup failed too, so the
 * broker cannot tell whether a pull request exists. Both failures are named;
 * retrying the same idempotency key stays safe.
 */
export class PublicationReconciliationError extends ChangeProofError {
  readonly openFailure: string;
  readonly lookupFailure: string;

  constructor(openFailure: string, lookupFailure: string) {
    super(
      `Publication reconciliation failed: open failed (${openFailure}) and the follow-up lookup failed (${lookupFailure}).`,
    );
    this.openFailure = openFailure;
    this.lookupFailure = lookupFailure;
  }
}

/** The run was cancelled or its lease was lost; further effects are refused. */
export class RunNotAuthorisedError extends ChangeProofError {
  readonly reason: string;

  constructor(reason: string) {
    super(`This run is no longer authorised: ${reason}`);
    this.reason = reason;
  }
}
