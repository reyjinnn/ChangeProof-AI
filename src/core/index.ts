/**
 * Core — the only module every other module may import.
 *
 * .claude/AGENTS.md §5: `core` holds contracts, ports and typed errors, and imports
 * nothing internal. It is dependency-free so that every leaf module can use it
 * without pulling behaviour into the contract layer.
 */

// Errors (typed failures — fail closed, never a silent default)
export * from './errors/index.js';

// Versioning
export * from './contracts/version.js';

// Identity domains (raw byte vs canonical structured)
export * from './contracts/identity.js';

// Status vocabulary and reason codes
export * from './contracts/vocabulary.js';
export * from './contracts/reason-codes.js';

// Structural primitives
export * from './contracts/primitives.js';

// Contract schemas
export * from './contracts/schemas/graph.js';
export * from './contracts/schemas/impact.js';
export * from './contracts/schemas/verification.js';
export * from './contracts/schemas/outcome.js';
export * from './contracts/schemas/capability.js';
export * from './contracts/schemas/budget.js';
export * from './contracts/schemas/campaign.js';
export * from './contracts/schemas/engine.js';
export * from './contracts/schemas/hosted.js';
export * from './contracts/schemas/readiness.js';

// Ports (contract surface for cross-module collaboration, wired by orchestrator)
export * from './ports/index.js';
