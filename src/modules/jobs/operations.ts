import { ChangeProofError } from '../../core/index.js';

/**
 * Service operations decision core (WP3-26, FR3-36, NEG3-26).
 *
 * Pure gates over capacity, fairness, drain, quarantine, and outage state.
 * A tenant at its cap never starves another tenant; draining pools accept
 * no new work while in-flight jobs finish; quarantined workers get no
 * claims; and an unresolved outage blocks its component until a healthy
 * probe after the outage start reopens it. The durable ops store
 * (`ops-store.ts`) persists drain/quarantine/outage rows and calls these
 * guards; it adds no rule of its own.
 */

export interface CapacityInput {
  readonly tenantActive: number;
  readonly tenantConcurrency: number;
  readonly globalActive: number;
  readonly globalConcurrency: number;
}

/** Both the tenant cap and the global cap must admit the work. */
export function assertCapacityAvailable(input: CapacityInput): void {
  for (const amount of [input.tenantActive, input.tenantConcurrency, input.globalActive, input.globalConcurrency]) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new ChangeProofError('Capacity counts must be non-negative integers.');
    }
  }
  if (input.tenantConcurrency <= 0 || input.globalConcurrency <= 0) {
    throw new ChangeProofError('Concurrency caps must be positive.');
  }
  if (input.tenantActive >= input.tenantConcurrency) {
    throw new ChangeProofError('Tenant concurrency cap reached; queued behind its own cap, never ahead of others.');
  }
  if (input.globalActive >= input.globalConcurrency) {
    throw new ChangeProofError('Global concurrency cap reached; no tenant jumps the queue.');
  }
}

export interface TenantLoad {
  readonly tenantId: string;
  readonly active: number;
  readonly queued: number;
}

/** Least-active tenant with queued work wins; ties break by tenant id. */
export function pickFairTenant(tenants: readonly TenantLoad[]): string | null {
  const eligible = tenants.filter((tenant) => tenant.queued > 0);
  const first = eligible[0];
  if (first === undefined) {
    return null;
  }
  let winner = first;
  for (const candidate of eligible.slice(1)) {
    if (candidate.active < winner.active || (candidate.active === winner.active && candidate.tenantId < winner.tenantId)) {
      winner = candidate;
    }
  }
  return winner.tenantId;
}

/** Draining pools take no new admissions or claims; in-flight work finishes. */
export function assertNotDraining(draining: boolean): void {
  if (draining) {
    throw new ChangeProofError('Service is draining; new work is refused until the drain clears.');
  }
}

/** Quarantined workers receive no claims until released. */
export function assertWorkerUsable(quarantined: ReadonlySet<string>, workerId: string): void {
  if (quarantined.has(workerId)) {
    throw new ChangeProofError(`Worker "${workerId}" is quarantined; no claims until it is released.`);
  }
}

export interface OutageRecord {
  readonly component: string;
  readonly startedAt: string;
  readonly resolvedAt?: string;
}

export interface RecoveryProbe {
  readonly component: string;
  readonly checkedAt: string;
  readonly healthy: boolean;
}

/** A component reopens only on a healthy probe dated after the outage start. */
export function assertComponentHealthy(outage: OutageRecord | null, probe: RecoveryProbe | null): void {
  if (outage === null) {
    return;
  }
  if (outage.resolvedAt !== undefined) {
    return;
  }
  if (probe?.component !== outage.component || !probe.healthy) {
    throw new ChangeProofError(`Component "${outage.component}" is in outage; blocked until a healthy probe reopens it.`);
  }
  const started = Date.parse(outage.startedAt);
  const checked = Date.parse(probe.checkedAt);
  if (!Number.isFinite(started) || !Number.isFinite(checked)) {
    throw new ChangeProofError('Outage timestamps are unreadable; the component stays blocked.');
  }
  if (checked <= started) {
    throw new ChangeProofError('Recovery probe predates the outage; the component stays blocked.');
  }
}
