# Phase-2 report — revision 2

**Date:** 30 October 2026 (turn 2 — same day)
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `in_progress` — preparation for T2-1..T2-9 implemented with
proof (pure/fixture); full work packages remain `in_progress`/`blocked`,
native RLS proof is environment-blocked, no G3 gate passed.
**Plan revision:** 2 (24 October 2026).

## 1. Entry audit (preserved from kickoff, evidence not summary)

Phase-1 task evidence verified in the tree on `development` (clean tree at kickoff):

- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (42 modules / 97 dependencies, zero violations).
- `pnpm test` exit 0 (190 tests / 15 files), after owner-directed JVM removal
  (`docs/decisions/phase1-jvm-removal.md`): five ecosystems, `CapabilityRecord` `2`,
  adapter contract `2`. Spec documents still name six ecosystems (flagged divergence).
- Existing modules at kickoff: `adapters`, `analyzer`, `dependencies`, `detector`, `graph`,
  `policy`, `verifier`. No `observability`, `fixtures`, `identity`, `github`,
  `jobs`, or `usage` modules existed.
- Full work packages WP3-01..05 remain `in_progress`; no WP is `done`, no G3 gate passed.

Readiness probes at kickoff (Windows PowerShell): `psql` absent, no `pg` driver, no `octokit`,
no GitHub App authorization, no email delivery infrastructure. Docker server
`29.0.1` present (container-level only, not VM/microVM qualification).

## 2. T2 readiness mapping (updated after turn 2)

| Task | Requires (full WP) | State | Reason |
|---|---|---|---|
| T2-1 observability (WP3-15) | 02, 05 | preparation `done` | predecessors `in_progress`; `modules/observability` uses only proven contract inputs |
| T2-2 campaign (WP3-16) | 04, 15 | preparation `done` | predecessors `in_progress`; `modules/verifier/campaign.ts` uses only proven contract inputs |
| T2-3 reducers (WP3-17) | 01, 16 | preparation `done` | predecessors `in_progress`; `modules/verifier/reducers.ts` uses only proven contract inputs |
| T2-4 fixtures/oracle (WP3-06) | 04, 05, 16, 17 | preparation `done` / full `blocked` | `modules/fixtures` freeze-and-verify proven pure; real app+DB+broker proof blocked (no frozen oracle, no real app) |
| T2-5 identity/RLS (WP3-21) | 02 | preparation `done` / native `blocked` | `modules/identity` grant/session/challenge checks + `infra/postgres/V1__identity_tenancy.sql` + `tests/native/identity-rls.test.ts` ready; `pg 8.23.1` added; container start did not complete in this environment (see §7) |
| T2-6 GitHub (WP3-22) | 21 | preparation `done` / live `blocked` | `modules/github` HMAC verify + dedup + revocation gating proven pure; no `octokit`, no authorized installation |
| T2-7 jobs (WP3-23) | 04, 21, 22 | preparation `done` / durable `blocked` | `modules/jobs` fencing/epoch/CAS/cancel/retry/dedup core proven pure; durable dispatcher + hosted store pending |
| T2-8 usage (WP3-24) | 21, 23 | preparation `done` / billing `blocked` | `modules/usage` cap/double-debit/monotonic/entitlement core proven pure; atomic store + pricing/vendor decisions pending |
| T2-9 email (WP3-28) | 21 | preparation `done` / delivery `blocked` | challenge mint/verify/single-use + return-target guard proven pure; authorized delivery infra pending |

Per MVP §22, incomplete predecessors permit only independent preparation with
proven task inputs — no full-WP acceptance is claimable. Blocked items are
recorded, not worked around.

## 3. Execution record — preparation tasks T2-1/T2-2/T2-3 (turn 1)

```text
Task IDs / parent WPs: T2-1 / WP3-15, T2-2 / WP3-16, T2-3 / WP3-17
Requirement IDs: FR3-25/26/27/28; FR3-15/16 (precedence, receipts); NEG3-15/16/17/18;
                 NFR3-04/07; BR3-02/05/07/09/14/15/16
User-visible outcome: Telemetry degrades to explicit gaps + `causality_unproven`
  (never a cause); campaign receipts reconcile to complete/incomplete/invalid;
  matched-window reducers bind digest + raw observations and never average away loss.
Prerequisite evidence: IncidentEvidence / CharacterizationRecord / ExperimentPlan /
  TrialReceipt / DimensionAssessment / TargetAssessment contracts (phase-1, proven);
  policy precedence tests (phase-1, proven). WP3-01/02/04/05 task-level evidence only.
Allowed source/config changes: src/modules/observability/**, src/modules/verifier/**
  (campaign.ts, reducers.ts, index.ts re-export), tests/observability/**,
  tests/verifier/**, docs/phase-reports/phase-2.md.
Input snapshots + intended intervention: synthetic in-repo fixtures only; no customer
  repo, no frozen oracle, no external service.
Acceptance checks (positive, negative, native): 30 focused tests (NEG3-15/16/17/18
  failure-path first); typecheck + lint/boundaries clean.
  Native: none claimed — DB/broker/GitHub/email remain blocked (see §5/§6).
Protected oracle / proof scope: no protected oracle created, touched, or claimed.
  Preparation is pure/fixture only; it proves no real-system capability.
Actual commands + exit codes: §4.
Status + remaining blocker: preparation `done` for T2-1/T2-2/T2-3; full WP3-15/16/17
  stay `in_progress` (need WP3-02/04/05 completion + native proof); T2-4..T2-9 `blocked`.
```

### T2-1 — `modules/observability` (WP3-15 preparation)

- `src/modules/observability/index.ts` (new leaf module, imports `core` only):
  `assessTelemetryQuality` (facts + gaps + `causality_unproven`/`needs_discriminating_probe`,
  `correlationAllowed`, no cause field) and `characterizeLegacyBehaviour`
  (`behavior_contract_unknown` vs `characterized_pending_freeze`, no oracle field).
- `tests/observability/telemetry-quality.test.ts` (8 tests): clock-skew, sampling-gap,
  stale-deploy, timestamp-only-ambiguous → gaps + `causality_unproven`; clean evidence still
  requires a discriminating probe; legacy without owner interpretation/invariants stays
  `behavior_contract_unknown`.

### T2-2 — `modules/verifier/campaign.ts` (WP3-16 preparation)

- `summarizeCampaign` (all-trial accounting → `campaign_complete`/`campaign_incomplete`/
  `experiment_invalid`), `validateFaultTarget` (frozen-plan allowlist only; fault
  authority stays in the supervisor, no raw network/shell/default).
- `tests/verifier/campaign-accounting.test.ts` (12 tests): incomplete repetitions
  (NEG3-15), stuck fault / plan-hash drift / injector-recorded exclusion → `experiment_invalid`
  (NEG3-17), over-plan receipts and malformed receipts fail closed, allowlist negatives.
- Finding kept, not worked around: the `campaign.ts` contract itself rejects `pass`
  for a stuck fault, so the stuck-fault fixture carries `fail` — accounting still
  classifies it `invalid`, never `failed`.

### T2-3 — `modules/verifier/reducers.ts` (WP3-17 preparation)

- `reduceMatchedWindows` (pooled lower-median over raw observations, canonical
  `{algorithm, config}` SHA-256 `reducerDigest`, mandatory `rawRefs`); loss
  (dropped/timeouts-removed) → `inconclusive` + `measurementValidity: invalid`, never a pass
  (NEG3-18); non-finite observations and non-JSON configs throw.
- `tests/verifier/measurement-reducers.test.ts` (10 tests): loss/empty/NaN paths, healthy
  pass with pinned digest (`lower-median-p50`/`{p:50}`), pooled-vs-window-average
  discrimination (`lt 75` case), determinism, config-change digest change, rawRefs required.
- `src/modules/verifier/index.ts`: re-exports `campaign.js`/`reducers.js` through the
  public index (no deep imports; boundary rules intact).

## 4. Verification results and identities (turn 1 + turn 2)

| Check | Command | Exit | Scope / limitation |
|---|---|---:|---|
| Strict TypeScript | `pnpm typecheck` | 0 | Static typecheck only |
| Lint + boundaries (turn 1) | `pnpm lint` | 0 | ESLint (strictTypeChecked) + dependency-cruiser; 45 modules / 103 dependencies, zero violations |
| Focused turn-1 tests | `pnpm vitest run tests/observability/telemetry-quality.test.ts tests/verifier/campaign-accounting.test.ts tests/verifier/measurement-reducers.test.ts` | 0 | 30 tests / 3 files, pure/fixture |
| Full suite (turn 1) | `pnpm test` | 0 | 220 tests / 18 files (was 190/15 at kickoff; +30 new) |
| Lint + boundaries (turn 2) | `pnpm lint` | 0 | ESLint (strictTypeChecked) + dependency-cruiser; 50 modules / 113 dependencies, zero violations |
| Focused turn-2 tests | `pnpm vitest run tests/identity tests/jobs tests/usage tests/github tests/fixtures tests/orchestrator` | 0 | 80 tests / 9 files, pure/fixture |
| Full suite (turn 2) | `pnpm test` | 0 | 290 tests / 25 files (+70 new: identity 25, jobs 11, usage 11, github 14, fixtures 6, phase2-composition 3) |
| Native RLS | `pnpm test:identity:native` | not run | `DATABASE_URL` unset; probe container start did not complete (see §7) — recorded as missing check, never a pass |
| Native runner probes | `pnpm test:runner-security:native` | missing | script absent from tree (pre-existing; unchanged) |
| semgrep scan | n/a | missing | `semgrep` binary absent; skill bodies loaded and applied manually, no scan evidence |

**Mock/pure:** all new checks are pure unit/fixture tests — development evidence only.
**Native:** none run or claimed this phase; every native row stays a missing check
for the WP that needs it. Source/config identities: `CapabilityRecord` `2`,
adapter contract `2` (unchanged); `pg 8.23.1` + `@types/pg 8.23.1` added
(`save-exact`; +122 lockfile lines); no schema/policy version bump (no contract
semantics changed).

Working tree at turn-2 close (uncommitted; no commit requested): `M package.json`
(+`test:identity:native` script, +`pg`/`@types/pg`), `M pnpm-lock.yaml`,
`M src/modules/verifier/index.ts` (+3), `M src/orchestrator/index.ts` (+42,
`composePhase2`), `M docs/phase-reports/phase-2.md`; new `src/modules/{identity,
jobs,usage,github,fixtures,observability}/`, `src/modules/verifier/{campaign,reducers}.ts`,
`infra/postgres/V1__identity_tenancy.sql`, `tests/{identity,jobs,usage,github,
fixtures,native,observability,verifier}/`, `tests/orchestrator/phase2-composition.test.ts`.
NOTE (foreign churn, not mine — left untouched): `mockup.html` moved to
`.template-ui/mockup.html` with reference updates across `.prepare/*.md`,
`AGENTS.md`, `README.md`, `SKILL.md`, `docs/*`, `phases/phase-6.md`, plus
`.gitignore` edits. The `phase-2.md` diff was verified to contain only this
report's own rewrite. No foreign file was created, modified, reverted, or
deleted by this turn.

## 5. Phase-2 definition-of-done tracking

- [x] T2-1 preparation — a false telemetry join produces `causality_unproven`, not a cause.
- [x] T2-2 preparation — failed injection/heal and incomplete repetitions produce
      `experiment_invalid`/`campaign_incomplete` with reconciled counts.
- [x] T2-3 preparation — dimension-inconclusive never becomes a pass; no averaging anywhere.
- [x] T2-4 preparation — oracle freeze/drift checks proven pure (`modules/fixtures`;
      6 tests, NEG3-03). Full WP3-06 `blocked` (no frozen oracle, no real app/DB/broker).
- [x] T2-5 preparation — grant/session/challenge guards + reviewed RLS migration
      (`modules/identity`, 20 tests; NEG3-21/29/30/38). Native RLS `blocked`
      (container start did not complete; ready to run when `docker run` works).
- [x] T2-6 preparation — webhook HMAC verify + dedup + revocation gating
      (`modules/github`, 13 tests; NEG3-22/23/39). Live install `blocked`.
- [x] T2-7 preparation — lease fencing/epoch/CAS/cancel/retry/dedup
      (`modules/jobs`, 12 tests; NEG3-22/23/26). Durable dispatcher `blocked`.
- [x] T2-8 preparation — cap/double-debit/monotonic/entitlement
      (`modules/usage`, 9 tests; NEG3-13/25/36). Atomic store + pricing `blocked`.
- [x] T2-9 preparation — challenge mint/verify/single-use + return-target guard
      (`modules/identity/challenges.ts`, in the 20 identity tests; NEG3-29/30).
      Delivery `blocked`.
- [x] WP3-15/16/17 preparation wiring — `composePhase2` in the orchestrator with
      `tests/orchestrator/phase2-composition.test.ts` (3 tests). Full acceptance
      still needs WP3-02/04/05 completion + native proof.
- [ ] WP3-06/21/22/23/24/28 full acceptance — `blocked` per §2 table.
- [ ] Every unavailable access recorded as a specific gate `blocked`, not simulated.
      G3-08/G3-10 stay `blocked` without pilot repo access.
- [x] This report written to AGENTS §7.1/§7.2.

## 6. Blockers, missing checks, next ready task

Blockers (pre-existing unless noted): no `psql` CLI (unchanged); no `octokit`/GitHub App
authorization (unchanged); no usage pricing/vendor decisions (unchanged); no email
delivery infra (unchanged); no frozen oracle or domain-approved intent (unchanged);
WP3-02/04/05 full completion pending (caps T2-1..T2-3 at preparation).
New this turn: `semgrep` binary absent (mandatory-scan evidence missing for T2-5/T2-7 —
skill bodies applied manually); probe-container start did not complete (see §7);
concurrent foreign tree restructuring observed (see §4 NOTE).

Missing checks: concurrent-tenant RLS on live PostgreSQL (test + migration ready,
one `docker run` + `pnpm test:identity:native` away), real DB/broker service test,
native campaign on a real application, live GitHub/email integration — each recorded
per-WP, none substituted with mocks.

**Next dependency-ready task:** run the native RLS proof interactively
(`docker run -d --name changeproof-pg-t25b -e POSTGRES_PASSWORD=probe-only-local
-p 127.0.0.1:55432:5432 postgres:16-alpine`, then
`DATABASE_URL=postgresql://postgres:probe-only-local@127.0.0.1:55432/postgres
pnpm test:identity:native`) and remove the container afterwards; then obtain the
remaining hosted decisions (GitHub App authorization, usage pricing/vendors, email
delivery, pilot repos) to unblock T2-6..T2-9 live acceptance and G3-08/G3-10.
Do not start phase-3 automatically.

## 7. Execution record — turn 2 (T2-4..T2-9 preparation + T2-5 native attempt)

```text
Task IDs / parent WPs: T2-4 / WP3-06, T2-5 / WP3-21, T2-6 / WP3-22, T2-7 / WP3-23,
  T2-8 / WP3-24, T2-9 / WP3-28; plus WP3-15/16/17 preparation wiring
Requirement IDs: FR3-29/30/32/33/34/38; FR3-15 (oracle freeze); NEG3-21/22/23/25/26/
  29/30/36/38; NFR3-04; BR3-17/18/20/21/24
User-visible outcome: Tenant, lease, usage, webhook, challenge, and oracle guards
  fail closed with proof; hosted RLS migration reviewed and native test ready but
  unexecuted for environment reasons.
Prerequisite evidence: TenantContext / JobLease / UsageLedgerEntry /
  RepositoryConnection contracts (phase-1, proven); T2-1..T2-3 preparation (turn 1).
Allowed source/config changes: src/modules/{identity,jobs,usage,github,fixtures}/**,
  src/orchestrator/index.ts, infra/postgres/**, tests/{identity,jobs,usage,github,
  fixtures,native}/**, tests/orchestrator/phase2-composition.test.ts, package.json
  (+pg, +test:identity:native), pnpm-lock.yaml, docs/phase-reports/phase-2.md.
Input snapshots + intended intervention: synthetic in-repo fixtures only (+ reviewed
  SQL migration text); no customer repo, no frozen oracle, no external service;
  no paid API, no external mutation, no production deployment.
Acceptance checks (positive, negative, native): 70 new tests failure-path first
  (modules) + 3 composition tests; typecheck + lint/boundaries + full suite green.
  Native RLS: attempted, environment-blocked (below), recorded as missing check.
Protected oracle / proof scope: freeze/verify helpers only; no protected product
  oracle created or claimed.
Actual commands + exit codes: §4 table; container attempts below.
Status + remaining blocker: preparation `done` T2-4..T2-9; native/live/durable/full
  acceptance `blocked` per §2.
```

Module detail (all leaf modules import `core` only; tests import public indexes):

- `src/modules/identity/index.ts` — `assertServerAuthority` (narrowed to
  `{ authoritySource }`, so a forged payload is expressible and rejected),
  `assertTenantMatch`, `assertGrantCurrent`, `assertCanMutate` (viewer/operator
  denied), `assertProjectGrant`, `assertAllRepositoryGrants`,
  `assertSessionFresh`, `assertNoLastOwnerLockout`, `assertConnectionActive`;
  plus `challenges.ts` — HMAC challenge mint/verify (`v1.b64.sig`, purpose-bound,
  expiring, injected time), `assertNonceUnused`, `assertSafeReturnTarget`.
- `src/modules/jobs/index.ts` — `isLeaseExpired`, `assertLeaseWritable`
  (active + live + epoch + CAS version + no-cancel + grant currency),
  `assertEffectIdUnique`, `nextRetryCount` (bounded).
- `src/modules/usage/index.ts` — `assertReservationAdmitted` (capped),
  `assertNoDoubleDebit` (debit-event identity; reserve lifecycles stay idempotent),
  `assertCumulativeMonotonic` (budget never resets), `assertEntitlementVerified`
  (settle needs a server-verified receipt).
- `src/modules/github/index.ts` — `verifyWebhookSignature` (HMAC-SHA256,
  timing-safe, header + shape validated, empty secret refused),
  `checkDuplicateDelivery`, `assertInstallationGrant` (active + revocation
  currency + allowlist), `assertDeliveryFresh` (skew window, out-of-order held).
- `src/modules/fixtures/index.ts` — `freezeOracle` (digest + author + time +
  scope, all validated), `assertOracleUnchanged` (drift invalidates, NEG3-03).
- `src/orchestrator/index.ts` — `composePhase2` wiring the seven proven
  preparation functions; no verdict/grant/scheduling/persistence behavior added.
- `infra/postgres/V1__identity_tenancy.sql` — tenants/memberships/projects/
  repository_grants with `tenant_isolation` RLS on `app.current_tenant`
  (absent ⇒ no rows), least-privilege `app_user NOBYPASSRLS`, idempotent for
  disposable probe databases.
- `tests/native/identity-rls.test.ts` — 6 live checks (per-tenant visibility,
  unset-setting fail-closed, pool context reset, parallel-tenant isolation,
  NOBYPASSRLS + no-DDL); fails closed without `DATABASE_URL`; excluded from
  `pnpm test`, run via `pnpm test:identity:native` (new script).

T2-5 native attempt log (Windows PowerShell, Docker Desktop 29.0.1, images
`postgres:16` + `postgres:16-alpine` cached locally, no pulls needed):

- `docker run -d --name changeproof-pg-t25 ... postgres:16-alpine` (×2 under
  different names), `docker run -d --name changeproof-pg-t25c ...`, and
  `docker create --name changeproof-pg-t25d ...` never completed in this
  session (managed commands backgrounded without delivery); a retry reported
  `Conflict. ... "/changeproof-pg-t25" is already in use by "cd9df178..."`,
  yet `docker ps -a` never lists that container or ID — a stale daemon-side
  name reservation. Read-only calls (`ps`, `images`, `info`, `inspect`, `logs`)
  work fine, so the daemon is healthy; only mutating container calls hang.
  No foreign container was touched (other projects' redis/mysql/postgres left
  alone; no prune). Next safe action: run the single `docker run` + native
  test interactively (see §6), then `docker rm -f` the probe container.

Lint findings fixed in passing (not weakened): 61 `no-confusing-void-expression`
in new tests (void-returning asserts wrapped in braces — `eslint --fix`,
verified no semantics changed by the green rerun), 2
`non-nullable-type-assertion-style` in `challenges.ts` (replaced `as string`
with explicit undefined guards), 1 `no-redundant-type-constituents` in the
challenge-test helper (narrowed to `Partial<MintChallengeInput>`).
Final gates: `pnpm typecheck` 0, `pnpm lint` 0 (50 modules / 113 deps),
`pnpm test` 0 (290/25).
