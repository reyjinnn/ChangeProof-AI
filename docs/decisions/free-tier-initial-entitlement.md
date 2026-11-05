# Decision: initial free-tier entitlement on tenant creation [DERIVED]

**Date:** 5 November 2026
**Owner decision:** user authorized provisional invented values in session ("opsi B gapapa, ngarang juga").
**Status:** provisional, to be replaced by calibrated billing (rate table + plan catalog) before acceptance.

## Problem

Fresh tenants (email claim and GitHub registration) never received a usage
entitlement: `setEntitlement` had no HTTP route and no registration hook, so
`readBalances` returned `{periodId: null, cap: null}` forever and the
Usage page printed raw "null". Admission also refused every run for these
tenants (correct fail-closed, but no path ever opened it).

## Decided (derived defaults, not measured)

- Every tenant created through HTTP registration (`POST /api/orgs` claim and
  GitHub new-user registration) receives one initial entitlement:
  - `capAmount`: **1000** ledger credits (scale matches existing test fixtures;
    NOT the USD 5/month mapping — no rate table exists yet, the prior
    `phase3-service-limits-derived.md` decision stands unmapped).
  - `rateVersion`: **'default-rates-1'** (placeholder; real rate versions arrive
    with the billing catalog).
  - `periodId`: **'period-free-1'** (the tenant's first capped period).
- Wiring: `AuthDeps.usage` (optional) in `src/http/routes-auth.ts`, composed
  in `src/http/start.ts`. Suites that wire auth manually without usage keep
  the old behavior (no provisioning); only production start wires it.
- Failure semantics: provisioning failure is logged to stderr and registration
  still succeeds (identity is the primary effect; a failed cap must not strand
  a created account). The tenant then shows the honest no-period UI state until
  an operator backfills.
- UI keeps an explicit null-cap empty state ("No active billing period") for
  tenants predating this change or hit by a provisioning failure. Null is a
  displayable state, never printed raw.

## Backfill

Pre-existing tenants (e.g. local `gh-reyjinnn-*`) need a one-time operator
backfill with the same values:

```sql
INSERT INTO entitlements (tenant_id, period_id, cap_amount, rate_version, created_at, superseded_at)
VALUES ('<tenant>', 'period-free-1', 1000, 'default-rates-1', now(), NULL);
```

## Not decided (still needs the owner)

Real rate table, plan catalog, USD mapping, rollover cadence, payment vendor.
