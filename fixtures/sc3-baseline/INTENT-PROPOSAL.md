# SC3-01 baseline slice — intent proposal (NOT approved, NOT frozen)

Status: **PROPOSED**. This document is a draft awaiting owner review. It is not
authority: no acceptance run may cite it until the owner approves the intent
and freezes the oracle with `scripts/freeze-sc3-baseline.mjs`.

## Case

`SC3-01-baseline-slice`: a single-service slice of SC3-01 (coordinated order
recovery). It proves the baseline-rig mechanics — old-valid fulfills, the new
version exhibits one attributed failure — on a real app + PostgreSQL + Redis +
browser. It is explicitly NOT the full ≥3-repo SC3-01 flagship (no feature
flags, no stale cache, no multi-repo bundle, no mixed-version campaign).

## Intended change (v1 → v2)

The order service renames the fulfillment event field `amountCents` to
`totalMinor` and bumps the event schema marker `v1` → `v2`. The HTTP contract
is unchanged. The fulfillment consumer is pinned to the v1 schema.

## Proposed oracle (expected behavior)

- Baseline old (v1): every created order reaches `fulfilled`; no deadletters.
- Baseline new (v2): order creation stays green (HTTP 201, status `created`),
  the order is NEVER fulfilled, and exactly one deadletter carries
  `cause = unsupported-event-schema` for that order id.
- Invariants (both): amounts persist exactly as posted; no duplicate
  fulfillment; no cross-tenant effects (single tenant in this slice — the
  multi-tenant proof lives in WP3-21, not here).

## Scope under freeze

`fixtures/sc3-baseline/service.mjs`, `consumer.mjs`, `schema.sql`,
`INTENT-PROPOSAL.md` (this file, approved revision), the check
`tests/native/fixture-baseline.test.ts`, and the runtime pins
`postgres:16-alpine` + `redis:7-alpine`. Any change after freeze = a new
freeze with a new digest (./prepare/AGENTS.md §3 rule 15).

## Owner ceremony

1. Review this proposal; edit it until it states the intended behavior exactly.
2. Run: `node scripts/freeze-sc3-baseline.mjs --author <owner-id>
   --intent fixtures/sc3-baseline/INTENT-PROPOSAL.md
   --scope fixtures/sc3-baseline/service.mjs
   --scope fixtures/sc3-baseline/consumer.mjs
   --scope fixtures/sc3-baseline/schema.sql
   --scope tests/native/fixture-baseline.test.ts
   --out runs/sc3-baseline/frozen-oracle.json`
3. Record the printed digests; the acceptance run compares against them.
   `assertOracleUnchanged` invalidates any run whose oracle drifted.
