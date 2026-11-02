# SC3-01 sandbox calibration — frozen, not a production SLO

Status: **FROZEN for the disposable SC3-01 baseline fixture only** by owner
decision [DEC3-P3-01](../../docs/decisions/phase3-sc3-01-sandbox-calibration-freeze.md)
on 1 November 2026. This does not freeze a qualified-hardware SLO or the full
workload/service profile. Values measured on this laptop must not be presented
as production or hosted-service guarantees.

## Measured (runs/sc3-baseline/*/measurement.json, n=12, v1, local rig)

- Order-fulfilled latency: p50 = 118ms, p90 = 121ms, p99 = 126ms, max = 126ms.
- Known observer effect: the rig polls order status every 100ms, so every
  reading carries up to +100ms of poll delay. True fulfillment is faster than
  measured; a qualified campaign must timestamp fulfillment server-side.

## Frozen sandbox criteria

- Absolute p50 threshold: 2000ms (`lower-median-p50`, `{comparison:'lt'}`).
- Relative margin vs baseline: +20% on the pooled lower-median for candidate
  comparisons, once the WP3-07 candidate arm exists.
- Baseline stability: n=3 consecutive fulfilled orders per baseline.

These criteria apply only to the disposable SC3-01 fixture and its current
measurement method. They do not establish qualified runtime performance; the
candidate arm is not yet available.

## Still open (owner / later WPs)

- Qualified-hardware SLOs with server-side timestamps and a frozen arrival
  model, warmup/measurement/cooldown, and independent window count (FR3-27.2).
- Healthy/failing/candidate trio (FR3-27.3): the candidate arm needs WP3-07.
- Full MVP §16 envelope: Amax/Qmax, pool/lock bounds, dataset scale, cost caps,
  and complete campaign method.
