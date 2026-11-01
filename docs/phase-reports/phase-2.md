# Phase-2 report — revision 2

**Date:** 30 October 2026 (turn 2 — same day)
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `in_progress` — T2-1..T2-6 pushed to their runnable limits
(turn 5): native identity services 24/24, fixture baselines + browser, real
reducers, real campaigns, GitHub client code, file ingestion loop. Full WPs
stay `in_progress`/`blocked` on predecessors, owner decisions, and live
access (see §10); no G3 gate passed.
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
| T2-1 observability (WP3-15) | 02, 05 | connector port + file ingestion + normalize loop proven (turn 5) | live backend connectors blocked (catalog + authorized access); predecessors `in_progress` |
| T2-2 campaign (WP3-16) | 04, 15 | bounded real executor + trials proven (turn 5) | barriers/network-faults/budget/qualified-guest + frozen flagship params pending |
| T2-3 reducers (WP3-17) | 01, 16 | real-observation reducers + calibration proposal (turn 5) | owner-frozen SLOs + candidate arm (WP3-07) pending |
| T2-4 fixtures/oracle (WP3-06) | 04, 05, 16, 17 | rig + dry runs + intent proposal + ceremony tool (turn 5) / full `blocked` | real app+DB+broker+browser proven; frozen acceptance awaits owner approval + freeze (human acts) |
| T2-5 identity/RLS (WP3-21) | 02 | preparation `done` / native proof `done` (turn 4) | `modules/identity` checks + `infra/postgres/V1__identity_tenancy.sql` + `tests/native/identity-rls.test.ts` green 6/6 on disposable `postgres:16-alpine` (see §9); full WP3-21 stays `in_progress` (hosted identity services pending) |
| T2-6 GitHub (WP3-22) | 21 | octokit client + secret broker + wiring, 22 pure tests (turn 5) / live `blocked` | `octokit 5.0.5` integrated; live install/snapshot/CI proof needs an authorized App |
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

**Next dependency-ready task (updated turn 5):** engineering to the runnable
limit is done (§10) — remaining items are owner/external acts, not code:
(1) approve the SC3-01 intent + run the freeze ceremony (T-13 one signature
away); (2) authorize a GitHub App + installation for live WP3-22 proof;
(3) freeze SLO/calibration numbers (proposal in fixtures/sc3-baseline/
CALIBRATION-PROPOSAL.md); (4) usage pricing/vendors + email delivery + pilot
repos for T2-7..T2-9/G3-08/G3-10. Do not start phase-3 automatically.

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

## 8. Execution record — turn 3 (T-10..T-15 full-acceptance attempt, 1 Nov 2026)

Team assignments executed: T-10 (WP3-15), T-11 (WP3-16), T-12 (WP3-17),
T-13 (WP3-06), T-14 (WP3-21), T-15 (WP3-22). Mode: audit-first, smallest
diff (ponytail full). No source-semantics change; 3 acceptance tests added,
each pinning a previously untested branch of documented behavior.

### 8.1 Acceptance audits (T-10/T-11/T-12)

| Task | Acceptance rows checked | Finding |
|---|---|---|
| T-10 observability (FR3-25/28) | clock-skew, sampling-gap, stale-deploy, redacted-keys, timestamp-only, clean→probe, legacy unknown/pending-freeze | `redacted-keys` branch had no test → 1 test added |
| T-11 campaign (FR3-26, NEG3-15/17) | incomplete/never-started/complete, over-plan throw, stuck-fault, plan-hash drift, malformed throw, 5 allowlist negatives | `injector-recorded exclusion → experiment_invalid` was claimed in §3 but had no test → 1 test added |
| T-12 reducers (FR3-27, NEG3-18) | loss/timeouts→invalid, empty→inconclusive, NaN throw, pinned digest, pooled-median, pooled-vs-average, determinism, config digest, rawRefs | non-empty windows with zero observations (unstated edge) had no test → 1 test added, also pins the `uncertainty` note |

Full WP3-15/16/17 stay `in_progress`: pure rows are now fully pinned, but
full acceptance needs WP3-02/04/05 completion + native proof (unchanged).

### 8.2 Frozen oracle scope (T-13, WP3-06 — still `blocked`)

`freezeOracle`/`assertOracleUnchanged` re-verified (6 tests green, NEG3-03);
`planGuestRun` confirmed in code to mount the oracle read-only outside the
candidate workspace. Real-runtime proof still needs, concretely: (1) a pinned
real target app with SC3-01 old-valid baseline + new-attributed-failure,
(2) a disposable real PostgreSQL + broker inside a qualified guest,
(3) a trusted author + approved intent + frozen digest. None exists today.

### 8.3 Native RLS attempt (T-14, WP3-21 — still `blocked`, cause now precise)

This turn tried to make the runner available instead of re-recording the old
blocker: Docker daemon was down, so Docker Desktop was started once
(`Start-Process ... Docker Desktop.exe`, issued OK; `com.docker.backend`
alive). The daemon now answers `Error response from daemon: Docker Desktop
is unable to start`, and `wsl --status` / `wsl --list` hang without output —
the WSL2 backend is wedged (worse than turn 2, when read-only calls worked).
No `psql` on PATH; `embedded-postgres` ships no local binaries (runtime
download would be needed). No host-level repair was attempted (out of scope
without explicit authorization). Next safe action (host owner): repair the
WSL2 backend (`wsl --shutdown`, reopen Docker Desktop, or repair the
install), then run the §6 `docker run` + `pnpm test:identity:native` and
remove the probe container. The migration and 6-check native test are
unchanged and ready.

### 8.4 GitHub pure re-verified (T-15, WP3-22 — live still `blocked`)

14 pure tests green (HMAC verify, tamper/empty-secret/header negatives, dedup,
revocation gating, freshness window). Live proof still needs, concretely: an
authorized GitHub App + installation, `octokit` integration, and a real
delivery/snapshot/CI-attestation target. No dependency was added without
credentials (deliberate).

### 8.5 Verification (this turn, actual commands + exit codes)

- `pnpm typecheck` → 0 (strict, after final edit)
- `pnpm lint` → 0 (ESLint strictTypeChecked + depcruise, 50 modules / 118 deps)
- `pnpm test` → 0 (**367 tests / 28 files**; was 364/28 at turn open, +3 new)
- Focused: observability+campaign+reducers 33/33; fixtures+github+identity 45/45
- `pnpm test:identity:native` → not run (environment-blocked, see §8.3)

Changed files this turn (3, tests only): `tests/observability/
telemetry-quality.test.ts`, `tests/verifier/campaign-accounting.test.ts`,
`tests/verifier/measurement-reducers.test.ts` (+ this report). No contract,
policy, threshold, or schema change; no version bump needed. No full WP and
no G3 gate passed. Phase status stays `in_progress`.

## 9. Execution record — turn 4 (T-10..T-15 execution, 31 Oct 2026 UTC)

```text
Task IDs / parent WPs: T-10 / WP3-15, T-11 / WP3-16, T-12 / WP3-17,
  T-13 / WP3-06, T-14 / WP3-21, T-15 / WP3-22
Requirement IDs: FR3-25/26/27/28/29/30; FR3-15/16; NEG3-03/15/16/17/18/21/22/23/38/39
User-visible outcome: every runnable proof executed — native RLS green 6/6 on
  real PostgreSQL; pure rows re-verified 53/53; remaining native/live rows
  recorded as concrete blockers, full WPs honestly unchanged.
Prerequisite evidence: turn-3 §8 (3 pinning tests, uncommitted); WP3-01/02/04/05
  task-level evidence only; daemon recovered (docker ps answers, images cached).
Allowed source/config changes: test/config wiring required by failing runs only
  (native vitest config + RLS assertion). No policy/oracle/threshold/contract change.
Input snapshots + intended intervention: in-repo fixtures + one disposable
  postgres:16-alpine container (created, used, removed same turn); no customer
  repo, no frozen product oracle, no external service, no paid API.
Acceptance checks: focused pure suites + first live `pnpm test:identity:native`;
  typecheck + lint/boundaries + full suite green before and after.
Protected oracle / proof scope: freeze/verify helpers + mount boundary only;
  no protected product oracle created, touched, or claimed.
Actual commands + exit codes: §9.5 list.
Status: T-14 allocated task `done` (native proof); T-10/11/12 pure `done`,
  full WP3-15/16/17 `in_progress`; T-13/T-15 live `blocked` (see §9.2/§9.3).
```

### 9.1 T-10/T-11/T-12 pure re-verified (33/33), no new gaps

- T-10 observability 9/9 (incl. turn-3 redacted-keys pin); T-11 campaign 13/13
  (incl. injector-exclusion → `experiment_invalid`); T-12 reducers 11/11 (incl.
  empty-observations → `inconclusive` + uncertainty note).
- Full WP3-15/16/17 stay `in_progress`: native rows need WP3-02/04/05
  completion + frozen MVP §16 calibration numbers (Amax/Qmax/SLO/n) + a real
  target app in a qualified guest. Nothing here was weakened to pass.

### 9.2 T-13 still `blocked` — freeze core + mount boundary confirmed, zero diff

- `tests/fixtures/oracle-freeze.test.ts` 6/6 (NEG3-03); mount boundary already
  pinned by `tests/security/runner.test.ts` (oracle RO + outside workspace,
  inside-workspace run refused) — 39/39 with the identity suite. The candidate
  pinning test from planning was unnecessary; no code written.
- Real proof still needs: (1) pinned real target app with SC3-01 old-valid +
  new-attributed-failure, (2) disposable real PostgreSQL + broker in a qualified
  guest, (3) trusted author + approved intent + frozen digest. Owner decision.

### 9.3 T-14 native RLS `done` — two real bugs found and fixed (first native proof)

Environment: daemon healthy (`docker ps` exit 0, empty); `postgres:16-alpine`
cached. `docker run -d --name changeproof-pg-t14 ... -p 127.0.0.1:55432:5432`
→ `d8aa546a...` exit 0; `pg_isready` accepting connections; container
`rm -f` afterwards, `docker ps` empty. No foreign container touched.

Bug 1 — the script could never run: `vitest run tests/native/...` matches
nothing because `vitest.config.ts` excludes `tests/native/**`, and CLI
`--exclude` merges with (not replaces) the config list. Fix: new
`vitest.native.config.ts` (same settings, native include) + one-line
`package.json` script change. Default `pnpm test` still excludes native.

Bug 2 — wrong test assumption, not a leak: after `RESET`, PostgreSQL 16
reports a custom GUC as `''`, not NULL (probed directly:
`is_null = f`). The pool-reset test asserted `toBeNull()` and failed 1/6.
Fix: assert null-or-empty (previous tenant must not survive) AND zero rows
on the reset checkout — the actual fail-closed property. Now 6/6 green:
per-tenant projects/memberships/grants, absent-setting zero rows, pool reset,
parallel-tenant isolation, NOBYPASSRLS + no-DDL.

Security notes (code-security applied; `semgrep` binary still absent —
missing check as before): `''` matches no row (`tenant_id = ''` is false for
all real ids), so RESET is fail-closed. Forward constraints for the hosted
service (not this phase): tenant-id creation MUST reject empty ids, and
production pool checkout MUST bind the tenant via `set_config` parameters,
never string interpolation.

### 9.4 T-15 live still `blocked` — pure re-verified 14/14

HMAC verify + tamper/empty-secret/header negatives, dedup, revocation gating,
freshness window — all green. Live needs: authorized GitHub App + installation
on approved repos, broker-held webhook secret, `octokit` integration (still
deliberately unadded), durable dedup store, CI-attestation target.

### 9.5 Verification (this turn, actual commands + exit codes)

- `pnpm typecheck` → 0 (before and after changes)
- `pnpm lint` → 0 (50 modules / 118 deps, zero violations; before and after)
- `pnpm test` → 0 (367/28; native still excluded)
- Focused pure: observability+campaign+reducers+fixtures+github → 53/53
- Runner-boundary + identity: `tests/security/runner.test.ts tests/identity` → 39/39
- `DATABASE_URL=… pnpm test:identity:native` → 0 (6/6 on real PostgreSQL 16)
- `semgrep` → missing (binary absent; skill applied manually)

Changed files this turn: `vitest.native.config.ts` (new, 18 lines),
`package.json` (1 script line), `tests/native/identity-rls.test.ts` (+6/-1,
assertion + hardening), `docs/phase-reports/phase-2.md`, `task-brief.md`.
No contract, policy, threshold, or schema change; no version bump needed.
No full WP and no G3 gate passed. Phase status stays `in_progress`.

## 10. Execution record — turn 5 (T-10..T-15 to the runnable limit, 31 Oct 2026 UTC)

```text
Task IDs / parent WPs: T-10 / WP3-15, T-11 / WP3-16, T-12 / WP3-17,
  T-13 / WP3-06, T-14 / WP3-21, T-15 / WP3-22
Requirement IDs: FR3-25/26/27/28/29/30/35/38; FR3-15/16; NEG3-03/15/16/17/18/
  21/22/23/30/38/39; NFR3-04/07
User-visible outcome: every runnable row executed with real proof — native
  identity services, fixture baselines + browser, real reducers, real
  campaigns, GitHub client code, file ingestion loop. What remains is owner
  acts and live access, named per WP below — no gap is worked around.
Prerequisite evidence: turn-4 §9 (native RLS 6/6, pure 53/53); recovered
  Docker daemon; cached postgres:16-alpine + redis:7-alpine images.
Allowed source/config changes: WP3-15/16/17/06/21/22 implementation + tests +
  fixture rig + migrations V1/V2 + deps (redis, octokit, playwright-core).
  No policy/oracle/threshold/contract-semantic change to existing schemas.
Input snapshots + intended intervention: in-repo fixtures + disposable
  postgres:16-alpine + redis:7-alpine containers (created, used, removed same
  turn) + system Chrome; no customer repo, no frozen product oracle, no paid
  API, no external mutation.
Acceptance checks: unit 386/33 + native 33/5 green; typecheck + lint/boundaries
  clean; new deps resolve; containers removed afterwards.
Protected oracle / proof scope: freeze/verify helpers unchanged; dry-run
  receipts are explicitly unfrozen; the owner ceremony freezes the oracle.
Actual commands + exit codes: §10.7 list.
Status: T-14 allocated task stays `done`; T-10/11/12/13/15 pushed to their
  runnable limits (`in_progress`/`blocked` with owner-only remainders, §10.1-10.6).
```

### 10.1 T-14/WP3-21 — identity services complete + native 24/24

- `infra/postgres/V2__identity_services.sql`: sessions, invitations
  (hash-only tokens), tenant tombstones (deletion fence), lifecycle_records
  (RLS), SECURITY DEFINER pre-auth functions (exact-match only, no table dumps).
- `src/modules/identity/store.ts`: tenant/session/invite/role/remove/delete/
  retention flows — bound parameters only, injected time, SET LOCAL tenant
  (auto-reset), last-owner + stale-grant + fence enforcement. Guards factored
  to `guards.ts` (no import cycle). New versioned Session/Invitation contracts
  + conformance rows; orchestrator `composeIdentityStore` + wiring test.
- `tests/native/identity-services.test.ts`: 18/18 on real PostgreSQL
  (NEG3-21/30/38, secret-serialization regression: raw token never persists).
  Full WP3-21 stays `in_progress`: implementation + native proof are complete;
  full acceptance (incl. phase-7) and hosted deployment proof remain.
- `[DERIVED]` invites and role changes are owner/admin-only (spec is silent on
  who may invite); tenant-id creation rejects empty ids (T-14 constraint).

### 10.2 T-13/WP3-06 — real rig + dry runs, one signature away (`blocked`)

- `fixtures/sc3-baseline/`: real order service (v1/v2, identical HTTP),
  pinned-v1 consumer, schema; v2's event-schema change is the single
  attributed failure (API green, workflow dead-letters).
- `tests/native/fixture-baseline.test.ts` 3/3: v1 n=3 fulfills ([DERIVED]
  repeat count), v2 attributed failure with deadletter cause, real system-Chrome
  order fulfills end to end. Receipts in runs/sc3-baseline/ (gitignored).
- `INTENT-PROPOSAL.md` (explicitly UNAPPROVED/UNFROZEN) +
  `scripts/freeze-sc3-baseline.mjs` (owner ceremony tool, mechanics-checked
  with a probe author). The agent must not author the oracle — the owner
  approves the intent and runs the freeze. Full WP stays `blocked` on that act.

### 10.3 T-12/WP3-17 — reducers on real data + calibration proposal

- `tests/native/measurement-real.test.ts` 2/2: three real v1 windows assess
  pass with pinned digest + rawRefs + determinism; a window with a real
  service blackout assesses `inconclusive`/`invalid` (NEG3-18, never a pass).
- Measured p50/p90/p99 = 118/121/126ms (n=12, incl. a documented +100ms poll
  observer effect); `CALIBRATION-PROPOSAL.md` proposes a sandbox p50 threshold
  of 2000ms + 20% margin — explicitly UNFROZEN. Missing: owner-frozen SLOs and
  the candidate arm (needs the WP3-07 repair loop for the FR3-27.3 trio).

### 10.4 T-11/WP3-16 — bounded real executor + campaigns 4/4

- `src/modules/verifier/executor.ts`: argv-only spawn (never a shell), per-trial
  declared resets with receipts, exact-n + frozen-seed enforcement, allowlisted
  kill / kill-and-restart faults as an explicit race (no shared mutation),
  validated TrialReceipts. Trust boundary documented in-code; untrusted code
  still requires a qualified guest (rule 11 — not claimed here).
- `tests/native/campaign-real.test.ts` 4/4: clean n=3+warmup →
  `campaign_complete`; real kill without restart → `experiment_invalid`
  (NEG3-17); kill-and-restart → applied-and-removed pass; unlisted
  target/short seeds/timeout fail closed. Missing for full WP: barrier/
  interleaving control, network-edge faults, budget enforcement, qualified
  guest, frozen flagship params.

### 10.5 T-15/WP3-22 — client + broker code, live still `blocked`

- Core `SecretBrokerPort` + `createMapSecretBroker` (exact-match, fail closed,
  never logs values); `createGitHubClient` over `octokit 5.0.5`: exact-commit
  fetch (active-connection + allowlist + GitHub-provider + full-sha checks,
  sha-echo verification) and installation-scope reads; provider errors mapped
  specifically without token leakage. 22/22 pure tests (incl. secret
  regression) + orchestrator wiring. Live install/snapshot/CI proof needs an
  authorized GitHub App — the one physical blocker. Non-GitHub providers
  correctly refused (WP3-32 scope).

### 10.6 T-10/WP3-15 — ingestion loop proven, live backends `blocked`

- Core `TelemetryConnectorPort` + `createFileTelemetryConnector` (allowlisted
  root, traversal/symlink/absolute refused, size + limit caps, malformed lines
  counted dropped, query receipts) + `normalizeToEvidence` into validated
  `IncidentEvidence`. 15/15 unit tests on real temp files, incl. the full
  loop file → evidence → `causality_unproven`/`needs_discriminating_probe`
  (never a cause) + wiring. Live backend-profile connectors (FR3-25.5) need
  catalogued backends + authorized access.

### 10.7 Verification (this turn, actual commands + exit codes)

- `pnpm typecheck` → 0 · `pnpm lint` → 0 (57 modules / 141 deps, zero violations)
- `pnpm test` → 0 (**386 tests / 33 files**; was 367/28 at turn open, +19)
- `DATABASE_URL=… REDIS_URL=… pnpm test:identity:native` → 0 (**33 tests /
  5 files**: RLS 6, services 18, fixture 3, measurement 2, campaign 4)
- New deps resolve: `redis 6.3.1`, `octokit 5.0.5`, `playwright-core 1.64.1`
- `docker rm -f changeproof-pg-t21 changeproof-redis-t06` → 0; `docker ps`
  shows only foreign containers, untouched
- `semgrep` → missing (binary absent; skill bodies applied manually)

Engineering notes: native files are isolated per database + redis db
(`tests/native/db.ts`) after combined runs proved file-level cross-talk;
vitest `singleFork` is kept but did not serialize files in this version, so
isolation — not scheduling — carries correctness. `pnpm add` needed
`--ignore-scripts` (pre-existing ignored-builds gate on embedded-postgres).
No contract, policy, threshold, or existing-schema semantic change; new
schemas are versioned from birth; no version bump needed. No full WP and no
G3 gate passed. Phase status stays `in_progress`.
