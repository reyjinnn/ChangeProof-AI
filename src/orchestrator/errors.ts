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

/** The run was cancelled or its lease was lost; further effects are refused. */
export class RunNotAuthorisedError extends ChangeProofError {
  readonly reason: string;

  constructor(reason: string) {
    super(`This run is no longer authorised: ${reason}`);
    this.reason = reason;
  }
}
