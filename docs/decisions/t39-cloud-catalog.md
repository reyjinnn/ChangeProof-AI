# T-39 cloud deployment catalog freeze (WP3-34, FR3-43)

Date: 2026-11-02. Owner: Reyn (confirmation pending per task-brief tentative rule).

## Frozen for this implementation (`[DERIVED]`)

| Surface | Frozen choice |
|---|---|
| Providers | AWS, Azure, Google Cloud — one profile each, no other provider claimed |
| AWS profile | `aws-ecs-fargate-1`, region `eu-central-1`, compute `ecs-fargate` |
| Azure profile | `azure-container-apps-1`, region `westeurope`, compute `container-apps` |
| GCP profile | `gcp-cloud-run-1`, region `europe-west1`, compute `cloud-run` |
| Lifecycle | provision → run → upgrade/rollback → snapshot/restore → delete/teardown, in that order, each with a driver-observed receipt |
| Image pin | `sha256:` digest of the deployed compute image, drift-checked on every step |
| Secrets | Broker refs only (`secretBroker.refPrefix`); key material never in profiles, receipts, logs, or evidence |
| Teardown | Refuses without `confirm` exactly matching the profile id |

## Explicitly not frozen (qualification-catalog blockers, not silent fallbacks)

- Live AWS/Azure/GCP credentials and session authorization for provisioning.
- Live image digests per provider (native probes pin the real local image they run).
- Provider-native snapshot/restore mechanics beyond the driver seam.
- Cost/egress budgets for qualification runs.

Per FR3-43, config rendering alone never qualifies a profile: each compute
deployment needs provision/run/upgrade/rollback/restore/delete/teardown
receipts from the real provider. The native probe exercises the lifecycle
state machine, drift checks, and receipt chain on real local containers and
labels every provider row `probe-only`.
