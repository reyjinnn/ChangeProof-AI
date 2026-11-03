# Phase-7 report — whole-system testing, qualification and release assessment

**Plan revision:** 2 — 24 October 2026.
**This report covers:** T-50 (T7-1 slice, G3-01/G3-02) plus
T-51..T-55 (T7-2..T7-6 slices, §§4–8: G3-03, G3-04/05/11,
G3-06/13, G3-07/08, G3-09). Gate/WP status is stated in §3 —
this report passes no gate and closes no full WP.

## 1. T-50 / T7-1 slice / G3-01+G3-02 — negatives + guest probes

Task ID / parent WP: T-50 (T7-1 slice) / G3-01+G3-02 evidence.
Requirement IDs: WP3-01 contracts, WP3-02 identity, policy
precedence, import boundaries; runner isolation (WP3-04).
User-visible outcome: none directly — this task re-runs the
foundation's negative and boundary suites against the current
tree and attempts the qualified-guest hostile-code probes,
recording exactly what passed, what failed, and what is
blocked on credentials/scope.
Prerequisite evidence: phases 1–6 allocated tasks `done`
(phase-6 report §§1–20); full WPs still open per those reports.
Allowed source/config changes: none to product source — this
task only executes checks and writes this report. (No product
file was modified for T-50.)
Protected oracle / proof scope: suite results only; no
candidate, no verdict linkage, no publication.

What was executed (all commands on the current tree, 2026-11-02):

- `pnpm test:unit` → exit 0 — 6 files, 139/139
  (tests/contracts + tests/policy: versioned schemas,
  policy precedence, malformed-input negatives).
- `pnpm test:architecture` → exit 0 — 1 file, 9/9
  (prohibited-import/cycle/public-index boundary tests).
- `pnpm vitest run tests/identity` → exit 0 — 5 files, 47/47
  (tenancy/grant/session negatives, incl. NEG3-21 quiet refusals).
- `pnpm test:security` → exit 0 — 1 file, 14/14
  (mock-level runner security suite).
- `pnpm test:negative` → exit 1 — **missing check**: there is
  no `tests/negative/` directory, so the script reports "No
  test files found". Negatives currently live per-module
  (contracts/policy/identity/security); no consolidated
  negative suite exists to run.
- `pnpm test:adapters` → exit 1 — 11 files, 141/144. The 3
  failures are all Python L1 extraction
  (`l1-extraction.test.ts` × 2, `t07-acceptance.test.ts` × 1,
  `expected false to be true`). Proven pre-existing: with all
  working-tree changes stashed, the same file fails
  identically on the clean baseline (stash
  `t50-baseline-check`, popped afterwards, zero stashes left).
  No adapter source was touched by phases 6–7 work.
- `node scripts/runner-security-probes.mjs --dry-run` →
  exit 0 — wiring only (NOT qualification evidence): modal
  lib 1.6.3 present, `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`
  both unset, no network call, no credit spent.
- `node scripts/runner-security-probes.mjs` (real mode) →
  exit 2 — fail-closed `BLOCKED`: Modal credentials are not
  set, so no probe ran and nothing was spent. Live
  qualified-guest probes additionally need explicit session
  scope for paid Modal spend (AGENTS §16); no such scope was
  given, so they were not attempted beyond this refusal.
- Reused current-tree gates from the T-49 session (same
  uncommitted tree, no product change since): `pnpm
  typecheck` → 0, `pnpm lint` → 0 (168 modules / 526 deps,
  zero violations), `pnpm build` → 0, `pnpm build:ui` → 0,
  `pnpm test:ui` → 0 (132/132), `pnpm vitest run tests/http`
  → 0 (38/38), `pnpm test:e2e` → 0 (all eight specs).

Artifacts expected: this report with per-check commands +
exit codes — present. No receipts were fabricated for the
blocked probes; `runs/` gained no probe receipt.
Status + remaining blocker: allocated slice `done` (every
runnable check executed, blockers named concretely).
Concrete needs for the remainder of T7-1: (1) a consolidated
`tests/negative/` suite or an explicit decision that
per-module negatives are the suite (owns: backend phases);
(2) Python L1 extraction toolchain fix (owns: adapter phase);
(3) `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` + explicit paid-spend
scope for live guest probes (owns: session owner).
Next dependency-ready task: T7-2..T7-11 slices in gate order
(each needs its own frozen inputs and authorized access).

## 2. Gate rows touched by T-50 (contributions, not passes)

| Gate | T-50 contribution | State after T-50 |
| --- | --- | --- |
| G3-01 Foundation | contracts 139/139, architecture 9/9, identity 47/47, typecheck/lint green | `in_progress` — negative suite missing, adapter env failing |
| G3-02 Native runner | security mock 14/14; guest-probe wiring dry-run OK; live probes blocked (no creds/scope) | `blocked` — qualified-guest hostile-code probes have no credentials or spend authorization |

## 3. Gate/WP status after T-50..T-55 (contributions, not passes)

| Gate | Status | Evidence slices |
| --- | --- | --- |
| G3-01 Foundation | `in_progress` — negative suite now runnable (T-53), adapter env green (T-51) | T-50, T-51, T-53 |
| G3-02 Native runner | `blocked` — live guest probes still lack creds/scope | T-50, T-53 (dry-run) |
| G3-03 Support matrix | `in_progress` — full matrix audited, 0/32 formally certified | T-51 (§4) |
| G3-04 Baseline/intent | `not_started` for acceptance — mechanics green, no owner freeze | T-52 (§5) |
| G3-05 Complex repair | `not_started` — no AI repair run, no bundle proof | T-52 (§5) |
| G3-06 Negative safety | `in_progress` — 36/40 NEGs pinned+green, 3 gaps + soak open | T-53 (§6) |
| G3-07 Reproduction | `blocked` — runner ready, no frozen manifest to reproduce from | T-54 (§7) |
| G3-08 Publication | `blocked` — no App install/scope/CI client; no live PR attempted | T-54 (§7) |
| G3-09 Evaluation | `in_progress` (HELD) — skeleton + harness ready, live arms need scope | T-55 (§8) |
| G3-10 User impact | `not_started` — needs pilot access (T7-7) | — |
| G3-11 Campaign proof | `not_started` — all counts below MVP §17.3 floors | T-52 (§5) |
| G3-12, G3-15 Product/hosted journey | `not_started` (T7-8) | — |
| G3-13 Hosted security | `blocked` — guest probes + live IdP/provider/billing need scope | T-53 (§6) |
| G3-14 Service release | `not_started` (T7-9) | — |
| G3-16 Distribution/enterprise | `not_started` (T7-10) | — |
| G3-17 Full complex scope | `not_started` (T7-11; soak variation open) | T-52, T-53 (probe-only) |

Full WP3-01..34: open, exactly as the phase 1–6 reports
state; per-task `done` rows in those reports are not full-WP
acceptance. Slices T-51..T-55 are each `done` on their own
allocation (§§4–8). No gate passes on the evidence in this
report alone. This session grants no paid-API, external
publication, or production scope.

## 4. T-51 / T7-2 / G3-03 — six-ecosystem L1/L2/L3 tuple matrix

Task ID / parent WP: T-51 (T7-2 slice) / WP3-13 input, WP3-03/08/09 source.
Requirement IDs: MVP §3, G3-03, MVP §10 item 6 + Native certification.
Full slice file: `docs/phase-reports/slices/T-51.md` (+ `runs/20261102-T51/`).

What was executed (2026-11-02, `controlled_change`/`real_runtime`/
`human_reference` — real dev-machine toolchains, no guest):

- `pnpm test:adapters` before fix → exit 1, 141/144 (3 pre-existing
  Python L1 failures, all `requested 3.10.0, observed 3.12.7`).
- Toolchain probes → exit 0: python 3.12.7, php 8.5.12, go1.27.3,
  dotnet 10.0.403.
- ONE bounded env-only fix under `tests/adapters` (probe observed
  python interpreter — the pattern 4 sibling files already use; the
  mismatch fail-closed path stays covered by `python-l1.test.ts`).
  No `src` touched. T-53 independently diff-verified non-weakening
  (assertions identical).
- `pnpm typecheck` → exit 0; targeted eslint on both edited files → 0.
- `pnpm test:adapters` after fix → exit 0, 144/144, 11 files.

Matrix verdict: registry untouched (all `provenLevel=none`). Formally
certified 0/32 → G3-03 FAILS (no frozen matrix version, no records).
Evidence-ready per assessment: gin L2, fiber L2, laravel L2
(lint-only), aspnet-core L1. All 10 L3 rows stay none (single
positive pattern each; no real-runtime no-impact control; no
pre-fix failure capture; no browser/actual-HTTP/PostgreSQL per §3
scope). 18 framework rows + all `javascript`-language variants have
no tuple at all. `*-linux` evidence ran on Windows, not the named
runner profile.
Blockers: B1 missing 18 L1 tuples + JS variants (WP3-03); B2
pinned-runner qualification (WP3-04); B3 L3 case debt (WP3-08/10);
B4 frozen matrix + certification records (WP3-13).
Status: slice `done` (assessment, not a gate pass).
Next ready: freeze capability-matrix v1 with pinned versions +
linux runner profiles, then one second-pattern L3 case per row.

## 5. T-52 / T7-3 / G3-04+G3-05+G3-11 — baselines, oracle, causality, scenarios

Task ID / parent WP: T-52 (T7-3 slice) / G3-04+G3-05+G3-11 evidence.
Requirement IDs: MVP §4/§5/§6/§17/§21; FR3-11/13/15/17/25/26/27/28.
Full slice file: `docs/phase-reports/slices/T-52.md` (+
`runs/t52-2026-11-02-freeze/`, receipts in `runs/sc3-baseline/` +
`runs/sc3-18/`). No product file modified.

What was executed (UTC 15:57–16:16, `controlled_change`/
`real_runtime`/`human_reference` — mechanics only, disposable
PG16/Redis7 removed after):

- Freeze mechanics probe → exit 0: oracle `67122b49…` unchanged
  since 10-31, but scope drifted (only
  `tests/native/fixture-baseline.test.ts` changed); no owner freeze
  exists. G3-04 acceptance unstarted.
- `tests/verifier` → exit 0, 59/59 (mock-level).
- Native checker/soak/legacy → exit 0, 6/6.
- Native campaign + SC3-03/04/07/08 → exit 0, 21/21.
- `fixture-baseline`: attempt 1 exit 1 (2 rig `listening` timeouts),
  attempt 2 exit 0, 3/3 incl. real Chrome — unexplained variation.
- `regions` → exit 0, 2/2 (real docker partitions, `probe-only`).
- `migration-online` 2/2; `migration-frameworks` Alembic upgrade
  fails deterministically on missing `psycopg2` in `.venv` (env gap,
  adapter-phase owned). First attempt also hit Docker Desktop
  auto-pausing containers mid-run.
- Live model: BLOCKED, nothing spent (key present in env, no
  session scope; broker needs transport + secret-ref + frozen IDs +
  budget). SC3-09 verified nowhere counted as repair success (no
  native test asserts `fixed`/`verified`).
- Counts vs MVP §17.3 floors: ALL BELOW (1 trial/schedule,
  1 instance; no perturbed trials; ≤3 perf windows) — dry runs.

Unresolved: (1) no owner-approved frozen oracle; (2) baseline flake
unproven; (3) `.venv` lacks psycopg2; (4) Docker auto-pause vs
campaigns (runbook); (5) no native tests for full
SC3-01/02/05/06; (6) C/R/D lack native `DimensionAssessment`
records; (7) SC3-10/11 need geo topology / leak horizon / owner
contracts / budget.
Status: slice `done`; G3-04/05/11 `not_started` for acceptance.
Next ready: T7-4..T7-11 in gate order; owner freeze ceremony for
INTENT-PROPOSAL.md unblocks any G3-04 run.

## 6. T-53 / T7-4 / G3-06+G3-13 — NEG3-01..40 + tenant isolation

Task ID / parent WP: T-53 (T7-4 slice) / G3-06+G3-13 evidence.
Requirement IDs: MVP §7 NEG3-01..40; §6 G3-06/G3-13; §17.6;
§21 preparation-reuse/forecast; PRD §18.
Full slice file: `docs/phase-reports/slices/T-53.md` (+ new
`tests/negative/neg3-suite.test.ts`, `runs/2026-11-02-t53/`).

What was executed (UTC 22:55–23:27, mock + native separate):

- `pnpm test:negative` (new thin suite: 46 NEG-pinned mock
  modules, zero duplicated bodies) → exit 0, 636/636. Closes
  T-50's missing check; no `package.json` change needed.
- 24 mock dirs → exit 0, 684/684; `pnpm test:adapters` → exit 0,
  144/144 (T-51 fix verified non-weakening).
- Native N1 (RLS/services/jobs/usage/lifecycle/engagement/
  teamwork) → exit 0, 85/85; N2 (email/auth/notifications/
  teamwork/enterprise/runs HTTP) → exit 0, 64/64.
- Native N3 attempt 1 → exit 1, 34/36 (2 rig-spawn timeouts
  under parallel load; both NEG tests passed); retry → exit 0, 6/6.
- Soak+regions+checker → exit 1: regions 2/2, checker 2/2,
  soak 0/2 FAILING twice (T-52 saw 2/2 on same code 7h earlier —
  unresolved variation, T7-11 owns).
- Guest probes `--dry-run` → exit 0 (wiring only); live probes
  NOT attempted — BLOCKED (no Modal creds/scope).
- Docker auto-paused all containers mid-run; only own 3
  unpaused, foreign `changeproof-t31` left untouched.

40-row matrix: 36 pinned+green; NEG3-12 gap (no multi-PR
partial pin — WP3-12 + T7-5); NEG3-27 restore half open (T7-9);
NEG3-40 native incomplete (soak red). Skill triage
(`code-security`, `secret-serialization` read + applied, no src
edits): one finding F-53-1 (low-med, WP3-25 — session cookie
lacks `Secure` flag, recorded not fixed); `semgrep` binary
absent (missing check).
Status: slice `done`; G3-06 `in_progress`, G3-13 `blocked`.
Next ready: T7-5 (G3-07/08) in gate order.

## 7. T-54 / T7-5 / G3-07+G3-08 — reproduction + publication

Task ID / parent WP: T-54 (T7-5 slice) / G3-07+G3-08 evidence.
Requirement IDs: FR3-18/19/20; MVP §6/§11/§17.2-3/§21.
Full slice file: `docs/phase-reports/slices/T-54.md` (+ new
`scripts/reproduce-campaign.mjs`, `runs/t54-repro/`).

What was executed (mechanics `real_runtime` on own disposable
containers, removed after; mock unit suites separate):

- G3-07 audit: no frozen campaign manifest and no reproduction
  runner existed (receipts are in-test dry runs; freeze record is
  probe-authored). Added manifest-driven clean-room runner
  `scripts/reproduce-campaign.mjs` reusing existing
  trial/reset/service modules; refuses missing manifest,
  fault plans, original-workspace dirs, non-empty dirs, hash
  mismatch (all exit 2, N1–N5).
- Mechanics runs M1–M5 vs `frozen:false` manifest: M1 exit 1
  (own comparison bug, fixed), M2 exit 1 (1 pass + 2 invalid
  resets, cause unknown — predates stderr capture), M3/M4/M5
  exit 0 (3/3, match=true). Clean-state verified exit 0.
  Full-campaign reproduction vs a frozen plan is a MISSING
  CHECK (blocked on owner freeze ceremony, WP3-06).
- G3-08: procedure reviewable in code (idempotency identity →
  stable branch, lost-response find-by-head reconciliation,
  head-drift refusal, manifest hash binding). Unit suites
  (mock transports): github+evidence 48/48, orchestrator
  t25-publication 11/11, http 38/38 — all exit 0. No live PR
  attempted. Missing: exact-commit CI-check client (no code
  path; proposal → WP3-12/WP3-22).

Unresolved: (1) G3-07 vs frozen plan — missing check, owner
freeze ceremony; (2) G3-08 live PR + exact-commit CI — needs
authorized GitHub App install, explicit session scope,
CI-check client; (3) M2's 2 invalid resets unexplained.
Status: slice `done`; G3-07/G3-08 `blocked`.
Next ready: owner freeze (ExperimentPlan + oracle) → rerun
runner for real G3-07 evidence; App install + CI client for G3-08.

## 8. T-55 / T7-6 / G3-09 — frozen dev/holdout evaluation

Task ID / parent WP: T-55 (T7-6 slice of WP3-13 acceptance) / G3-09.
Requirement IDs: FR3-24/27; MVP §6/§9/§10/§21.
Full slice file: `docs/phase-reports/slices/T-55.md` (+ new
`fixtures/changeproof-3/dataset-manifest.json`,
`runs/t55-20261102-eval-freeze/`). All mock/replay,
`human_reference` — harness checks, NOT acceptance evidence.

What was executed:

- `npx vitest run tests/evaluation` → exit 0, 24/24 (t33
  manifest/harness/policy/roles incl. NEG3-03/07/13/15 paths).
- `node runs/t55-20261102-eval-freeze/validate.mjs` → exit 0,
  8/8 mechanics checks (7 arm/ablation defs parse, rev-2
  equality, ablation discipline, 9-class dev+holdout with
  SC3-09 excluded, freeze/verify round-trip digest
  `57f64b78…`, projection clean, abort smoke).
- Credential probe (names only) → exit 0: `OPENAI_API_KEY=SET`,
  all else absent; zero spend, env presence not treated as scope.
- Live B0/B1/B2/Full/ablation runs → NOT RUN, recorded HELD.
- Oracle isolation audit: no arm reaches hidden oracle content
  in current code (oracle content absent from module; projection
  strips bindings; store refuses proposer holdout reads). 4
  honest gaps recorded for the future live harness (caller-chosen
  role, declarative access matrix, identity-by-assertion,
  procedural Full-trace non-disclosure) — WP3-13 owned, not edited.

Evaluation HELD pending, in order: (1) trusted-author dataset
freeze (real cases, oracles, campaigns, references); (2) frozen
run identities + finite budget; (3) paid-model session scope;
(4) arm-execution harness with pinned roles.
Status: slice `done`; G3-09 HELD (not passed, not failed).
Next ready: trusted-author freeze of `changeproof-3-dataset-1`,
then live arm runs under granted scope.

## 9. Parent merge + final verification (2026-11-02)

Merge: §§4–8 condensed from `docs/phase-reports/slices/T-51.md`
through `T-55.md` (each read back in full); §3 rewritten as the
status table above; §§1–2 (T-50) preserved. No slice result
invented; no gate passed.

Parent edits after the merge (only to this session's own
deliverables): `scripts/reproduce-campaign.mjs` — removed the
unused `statSync` import (verified zero other occurrences);
`eslint.config.mjs` — added `setTimeout`/`clearTimeout`/`URL` to
the `scripts/**/*.mjs` globals (same precedent as the
`tests/e2e` block; both are node runtimes).

Final-tree verification by the parent (all slices finished, no
other writers from this session):

- `pnpm typecheck` → exit 0.
- `depcruise --config .dependency-cruiser.cjs src apps` →
  exit 0, no violations (168 modules, 527 deps).
- `pnpm exec eslint scripts/reproduce-campaign.mjs
  eslint.config.mjs` → exit 0.
- `pnpm test:negative` → exit 0, 636/636.
- `pnpm test:adapters` → 144/144 per T-51 (post-fix) and T-53
  re-runs; no adapter change since, not re-run by parent.

Known red that stays: `pnpm lint` overall exit 1 on exactly 7
eslint errors in `apps/dashboard/src/pages/public.ts` (5) and
`runs.ts` (2). Those sit inside large uncommitted dashboard
edits (12 files, +1902/−81, UI scope) made outside this
session's slices — recorded pre-existing/external, not fixed
here. Next ready task overall: T7-7 (G3-10 organic pilot) in
gate order, then T7-8..T7-11.
