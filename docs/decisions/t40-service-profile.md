# T-40 service profile + operations freeze (WP3-26, FR3-36)

Date: 2026-11-02. Owner: Reyn (confirmation pending per task-brief tentative rule).

## Frozen `HostedServiceProfile` (`[DERIVED]`, `profileId: hosted-1`)

| Field | Value |
|---|---|
| environment | production-eu |
| maxTenants | 64 |
| maxConcurrentRuns | 16 |
| maxQueueDepth | 200 |
| maxRunsPerTenant | 4 |
| queueWaitMs | 300000 |
| fairnessWindowMs | 60000 |
| costOvershootUsd | 50 |
| sloAvailability | 0.995 |
| rpoMs | 3600000 (1h) |
| rtoMs | 14400000 (4h) |
| retentionDays | 400 |
| deletionSloMs | 2592000000 (30d) |
| campaignMethod | t40-local-probe |
| frozenAt | 2026-11-02T00:00:00.000Z |

The unit test `tests/jobs/t40-operations.test.ts` parses exactly these
values; any change is a new profile version, never an edit.

## Frozen operations rules (`[DERIVED]`)

- Fairness: least-loaded tenant with queued work first; ties break by
  tenant id. Per-tenant and global caps enforced independently.
- Drain: a draining pool refuses new admissions and claims; in-flight jobs
  run to completion, cancel, or expiry — drain never kills work silently.
- Quarantine: a quarantined worker receives no claims until released.
- Outage: a component with an open outage blocks its paths until a healthy
  probe dated after the outage start resolves it.
- Deletion: fences refuse new effects per tenant+scope; tombstones block
  downloads; restore replays tombstones before serving traffic; purge waits
  for the retention deadline.
- Billing: payment events verify by HMAC-SHA256 (timing-safe) with the
  broker secret; duplicates collapse by event id; refunds need a recorded
  charge.

## Explicitly not decided (blockers, not silent choices)

- Final SLO/price/vendor/license figures for the public offer.
- Payment provider selection and live webhook credentials.
- Production backup schedule/retention approval and restore rehearsal owner.
- Full 3-org × 2-identity hosted qualification campaign (phase-7).
