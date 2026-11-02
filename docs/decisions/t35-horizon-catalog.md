# T-35 soak horizon catalog freeze (WP3-19, SC3-11, FR3-27)

Date: 2026-11-02. Owner: Reyn (confirmation pending per task-brief tentative rule).

## Frozen for this implementation (`[DERIVED]`)

The catalog states which horizons count as full qualification per leak
profile. Code enforces the relationships (horizon beyond known onset,
horizon actually reached, short runs labeled `smoke-only`); the catalog
values below are the frozen comparison points for phase-7.

| Profile | Known onset | Full-qualification horizon | Required series |
|---|---|---|---|
| `node-api-smoke` | n/a (fixture only) | never qualifies; label `smoke-only` | heapUsedBytes, rssBytes |
| `node-service-leak` | 6 h sustained load / 50k cycles | 12 h / 100k cycles, all-green | heap, native, RSS, FD, threads, pool active/wait, queue |
| `worker-leak` | 2 h sustained load / 20k cycles | 4 h / 40k cycles, all-green | heap, native, RSS, FD, threads, queue |

Frozen measurement rules:

- Series are fitted per segment between restarts (least squares, slope ± 2·SE);
  every segment with ≥ 8 samples must sit inside its frozen slope bound.
- Workload accounting must close: completed + dropped + timeouts == attempted,
  and dropped + timeouts must sit inside the frozen tolerance (default 0).
- Profiler overhead must be calibrated before the run; an uncalibrated
  profiler makes the measurement inconclusive, never a pass (NEG3-18).
- Restarts are forbidden unless the frozen policy names the metric and
  threshold; an unexplained restart invalidates the run instead of hiding
  a leak.
- A short run that never errors still reports `smoke-only`, never
  `qualified` (NEG3-40: short no-OOM does not pass).

## Explicitly not frozen (qualification blockers, not silent fallbacks)

- Full-horizon provisioned soak environments + cost caps for phase-7 SC3-11.
- Calibrated profiler overhead figures per runtime/allocator/GC combination.
- Owner approval of the leak horizon per profile (WP3-19 done-criteria).
- Additional runtimes beyond the Node profiles above (catalog additions
  need their own onset evidence, never inference from these rows).

Per NEG3-40, anything above blocks its G3-17 row; no short soak, single
sample, or fixed seed is promoted to a qualification result.
