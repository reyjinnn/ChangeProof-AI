# Calibration proposal — SC3-01 baseline slice (NOT frozen)

Status: **PROPOSED**. Measured numbers from the disposable rig on 31 Oct 2026.
Nothing here is frozen: the owner freezes SLOs, margins, and workload envelopes
before any acceptance run (FR3-27.6, MVP §16). Values measured on this laptop
must not be mistaken for qualified-hardware SLOs.

## Measured (runs/sc3-baseline/*/measurement.json, n=12, v1, local rig)

- Order-fulfilled latency: p50 = 118ms, p90 = 121ms, p99 = 126ms, max = 126ms.
- Known observer effect: the rig polls order status every 100ms, so every
  reading carries up to +100ms of poll delay. True fulfillment is faster than
  measured; a frozen campaign must timestamp fulfillment server-side instead.

## Proposed (sandbox starting point only)

- Absolute p50 threshold: 2000ms (`lower-median-p50`, `{comparison:'lt'}`).
  Rationale: >10× the measured p99 including the poll artifact — generous on
  purpose for a disposable rig; tighten on qualified hardware with server-side
  timestamps.
- Relative margin vs baseline: +20% on the pooled lower-median for candidate
  comparisons once the WP3-07 repair loop exists (no candidate arm today).
- Baseline stability: [DERIVED] n=3 consecutive fulfilled orders per baseline.

## Still open (owner / later WPs)

- Qualified-hardware SLOs with server-side timestamps and a frozen arrival
  model, warmup/measurement/cooldown, and independent window count (FR3-27.2).
- Healthy/failing/candidate trio (FR3-27.3): the candidate arm needs WP3-07.
- Full MVP §16 envelope: Amax/Qmax, pool/lock bounds, dataset scale, cost caps.
