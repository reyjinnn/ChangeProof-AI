# ChangeProof service runbook (WP3-26, FR3-36)

Operator procedures for capacity, drain, quarantine, outage, restore, and
billing. Every procedure names its gate, its receipts, and what stays
blocked. Parameters follow `docs/decisions/t40-service-profile.md`.

## 1. Capacity and fairness

- Admission checks per-tenant (`maxRunsPerTenant: 4`) and global
  (`maxConcurrentRuns: 16`) caps independently; a tenant at its cap queues
  behind its own cap and never starves others.
- Dispatch serves the least-loaded tenant with queued work first
  (`pickFairTenant`); ties break by tenant id for determinism.
- When the global cap saturates, new admissions fail closed with a
  quota-exhausted error — proof is never weakened to fit.

## 2. Drain

1. `ops.setDraining({ draining: true })` — new admissions and claims refuse
   immediately; in-flight jobs continue to completion, cancel, or expiry.
2. Watch `jobs` for `claimed`/`running` to reach zero (or cancel with
   `requestCancel` + `settleCancelled`, which drains instead of relabelling).
3. Deploy or maintain, then `ops.setDraining({ draining: false })`.
4. Receipts: drain flag rows in `ops_drain`; refused admissions surface as
   drain errors, never silent drops.

## 3. Quarantine

1. `ops.quarantineWorker({ workerId, reason })` on a suspect worker — it
   receives no further claims; its in-flight lease expires or completes.
2. Investigate with the lease/heartbeat trail; `ops.releaseWorker(workerId)`
   only after the cause is fixed.
3. A quarantine never deletes history: heartbeats, checkpoints, and the
   outbox stay for audit.

## 4. Outage and recovery

1. `ops.recordOutage({ component })` at detection — `admission` blocks
   `admitRun`, `dispatch` blocks `claimJob`.
2. Mitigate, then run a real health probe against the component.
3. `ops.resolveOutage({ component, checkedAt, probeReceipt })` — refuses
   unless the probe is healthy and dated after the outage start.
4. A resolved outage keeps its row (`resolved_at` + `probe_receipt`) as the
   recovery receipt.

## 5. Backup, deletion, and restore

1. Backups capture bytes plus metadata; credential material is never in a
   backup (broker refs only).
2. `deletion.fenceScope({ tenantId, scope })` before deleting a tenant scope
   — new effects in that scope refuse at submit time.
3. `deletion.recordTombstone(...)` per removed subject with a `purgeAfter`
   deadline; downloads of tombstoned artifacts refuse.
4. Restore replays tombstones before serving traffic
   (`restoreWithTombstones`) — deleted subjects stay deleted, other tenants
   untouched.
5. `purgeTombstone` only after the retention deadline; early purge refuses.

## 6. Billing lifecycle

1. Provider webhooks verify by HMAC-SHA256 with the broker-held secret
   before any effect; forged events change nothing.
2. `recordPaymentEvent` is idempotent by `event_id` — retries and duplicate
   deliveries collapse to one effect; a colliding id with different content
   refuses loudly.
3. Refunds apply only after a recorded charge for the same tenant.
4. Settlement still requires the server-verified provider receipt ref; a
   browser checkout page never grants entitlement.

## 7. What stays blocked

- Live payment provider, public SLO/pricing, and license/vendor choices
  (see `docs/decisions/t40-service-profile.md`).
- Full multi-org hosted qualification and paid-billing launch (phase-7).
- Any step above that lacks its receipt is not done — re-run it, do not
  mark it complete.
