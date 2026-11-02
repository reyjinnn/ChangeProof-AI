# bench/ — evaluation suites and frozen-manifest workspace

WP3-13 harness data. The harness itself lives in `src/modules/evaluation/`
(freeze, role-checked case store, arm runner, comparison, abort and release
policy); this directory holds versioned suite fixtures plus workspace
conventions.

## Layout

- `suites/*.json` — dev-authored suite fixtures in `FreezeCaseInput` shape.
  Clearly labeled DEV-ONLY. They exercise the harness path; they are NOT
  frozen evaluation datasets and never qualify a release.
- Frozen manifests, case stores, and comparison records are written under
  `runs/` (gitignored) at execution time, never committed here.

## Frozen datasets (phase-7)

Trusted dev/holdout packages arrive in phase-7 from the dataset author with
independent oracles, fixability labels, and reference solutions. They freeze
through `freezeManifest` like everything else; until then, any manifest
whose cases are not the frozen datasets compares dev materials only, and the
comparison record says exactly which manifest digest it reduced.

## Roles

- `proposer` sees dev cases without oracle/reference bindings; holdout bytes
  refuse proposer reads even by digest.
- `evaluator` sees every case with bindings intact.
- Comparisons aggregate counts only and are safe for analysts by
  construction — case content never enters one.

## Running

Tests drive the harness today (`tests/evaluation/`); full B0/B1/B2/Full
campaign execution over the product pipeline wires up in phase-7 (G3-09).
The frozen holdout is never opened during development.
