# Phase-5 report — revision 2

**Date:** 2 November 2026
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `in_progress` — allocated tasks T5-1..T5-9
(T-33..T-41) `done` (see §2–§4, §7–§11, §13). No full WP and no G3
gate passed; phase stays `in_progress` pending phase-7 acceptance.
**Plan revision:** 2 (24 October 2026).

## 1. Entry audit (evidence, not summary)

Phase-4 turn state verified in the tree at kickoff (same day, before
any phase-5 edit): `pnpm typecheck` exit 0; `pnpm lint` exit 0;
T-31 native 7/7 + T-32 native 9/9 green on disposable `changeproof-t31`
PG16; unit 752 passed + 3 pre-existing Python adapter failures
(proven identical on the untouched tree via `git stash -u` re-run).
Task-level prerequisites present: T-31 (distribution), T-32
(identity/providers), T-18 (campaigns), T-12 (verifier), T-25
(evidence). Full-WP dependencies (frozen holdout/datasets, live
model, provisioned regions/soak environments, owner approvals)
remain open, so every task below is independent preparation plus
local/native mechanics proof; full-WP statuses stay open per MVP
§22. Order T-33→T-34→T-35: bench contracts before infra-heavy
probes; multi-region before long-horizon (shared verifier patterns).

## 2. T-33 / WP3-13 — bench harness + evaluation contracts (`done`)

Task ID / parent WP: T-33 (T5-1) / WP3-13.
Requirement IDs: FR3-24, NEG3-13/15 (+ B2/ablation accounting).
User-visible outcome: frozen B0/B1/B2/Full + ablation manifests with
canonical freeze digests; content-addressed case store with role
gates (fixer never reads the protected oracle); arm comparison only
on equal evaluator/oracle/budget/dataset; exact denominators with
null rates over empty sets and gross/net cost split.
Prerequisite evidence: WP3-08/09/10/11/12/18 task evidence
(task-level `done`).
Allowed source/config changes: `src/core` readiness Eval contracts,
`src/modules/evaluation/`, `bench/` suites + README, tests.
Input snapshots + intended intervention: frozen dev suites only
(`dev-functionality`, `dev-refusal`); holdout never opened in dev.
Acceptance checks: unit 46/46 (manifest, policy, roles, harness,
incl. conformance rows); native not applicable — no execution
surface (stated, not skipped); phase-7 owns frozen evaluation.
Protected oracle / proof scope: harness mechanics on dev material
only; no capability claims, no release evaluation.
Artifacts expected: module + suites + contracts — present.
Actual commands + exit codes: see §5.
Status + remaining blocker: allocated task `done`. Full WP3-13 stays
open: frozen holdout/datasets/oracles, live model freeze, phase-7
release evaluation with independent reproduction.
Next dependency-ready task: T-34 (executed same session).

What was built (tests-first):

- Canonical freeze digest over manifests; content-addressed store
  with role gate (fixer/evaluator separation enforced at read).
- Arms compare only when evaluator, oracle, budget, and dataset are
  equal; unequal arms rejected, omitted failures still counted.
- Null rate over empty denominators; exclusions stay visible;
  probe-only runs never qualify an arm.
- NEG3-13: unequal B2 budgets and oracle leakage invalidate the
  comparison. NEG3-15: selective omission invalidates the related
  arm instead of silently narrowing the denominator.

## 3. T-34 / WP3-19 — multi-region supervisor (`done`)

Task ID / parent WP: T-34 (T5-2) / WP3-19.
Requirement IDs: FR3-26/27, NEG3-08/17/40.
User-visible outcome: frozen region campaigns (topology + faults +
RPO/RTO/ordering bounds + digest) executed through injected fault
and workload seams; per-trial journal receipts reduced to
per-check verdicts with an enforced qualification label.
Prerequisite evidence: WP3-18 campaign task evidence (task-level
`done`).
Allowed source/config changes: `src/core` region contracts,
`src/modules/verifier/regions.ts` + index export, tests.
Input snapshots + intended intervention: frozen topology + fault
schedule; native probe on 2× real `postgres:16-alpine` with real
`docker network disconnect` partitions verified by failed
`pg_isready` from the peer.
Acceptance checks: unit 6/6; native 2/2 (divergence-as-failure
without resync; green-as-probe-only after a labeled harness
resync); conformance rows added.
Protected oracle / proof scope: supervisor mechanics on
single-host containers only; SC3-10 full qualification waits for
provisioned regions in phase-7.
Artifacts expected: contracts + supervisor + probes — present.
Actual commands + exit codes: see §5.
Status + remaining blocker: allocated task `done`. Full WP3-19
(multi-region half) stays open: provisioned regions (paid cloud
needs explicit session auth), owner consistency/RPO/RTO approval,
phase-7 SC3-10 campaign + independent repetition.
Next dependency-ready task: T-35 (executed same session).

What was built (tests-first):

- Frozen topology/faults/digest with target resolution against the
  topology; drift refused at verify time.
- No simulated driver in product code: tests inject fakes, the
  native probe drives real containers.
- A fault that never applies or never heals invalidates the
  experiment instead of blaming the application (NEG3-17); a
  no-op injector is reported, not treated as recovery.
- Single-host provenance reports `probe-only` even when every
  check is green; only complete all-green evidence from
  provisioned regions reports `qualified` (NEG3-40).

## 4. T-35 / WP3-19 — long-horizon profiler (`done`)

Task ID / parent WP: T-35 (T5-3) / WP3-19.
Requirement IDs: FR3-27, NEG3-18/40.
User-visible outcome: frozen soak catalog (decision record) + soak
plans frozen beyond the known onset (cycles/workload/GC/runtime/
allocator/profiler); per-cycle resource histories with slope ±
uncertainty fits per segment between restarts; enforced restart
policy; actual resource receipts; short runs labeled `smoke-only`.
Prerequisite evidence: T-34 supervisor patterns + WP3-18 campaign
task evidence (task-level `done`).
Allowed source/config changes: `src/core` soak contracts,
`src/modules/verifier/soak.ts` + index export,
`docs/decisions/t35-horizon-catalog.md`, tests + worker fixture.
Input snapshots + intended intervention: frozen horizon catalog
(`node-api-smoke` fixture-only; `node-service-leak` 12h/100k
cycles; `worker-leak` 4h/40k cycles); native smoke on a real node
worker with frozen allocation cycles and real `memoryUsage`
samples.
Acceptance checks: unit 14/14 (freeze, labels, series, workload,
restarts); native 2/2 (flat worker green-as-smoke-only; leaking
worker fails its heap series as invalid); conformance rows added.
Protected oracle / proof scope: profiler mechanics on short local
smoke only; SC3-11 full qualification waits for provisioned soak
environments in phase-7.
Artifacts expected: catalog + contracts + profiler + probes —
present.
Actual commands + exit codes: see §5.
Status + remaining blocker: allocated task `done`. Full WP3-19
(long-horizon half) stays open: provisioned soak environments +
cost caps, calibrated profiler overhead per runtime, owner leak
horizon approval, phase-7 SC3-11 campaign.
Next dependency-ready task: T5-4 (WP3-20 legacy fixtures —
needs trusted domain owner + corpus decision).

What was built (tests-first):

- Soak plans freeze horizon beyond known onset in both cycles and
  duration (schema-enforced); heap + RSS mandatory in every
  sample; every required series needs a frozen slope bound.
- Series fitted per segment between restarts (least squares,
  slope + 2·SE against bound); segments below the frozen sample
  minimum are inconclusive, never passes.
- Workload accounting must close (completed + dropped + timeouts
  == attempted) inside frozen tolerance, else the measurement is
  invalid — dropped traffic never reads as improvement (NEG3-18).
- Uncalibrated profiler overhead is inconclusive, never a pass
  (NEG3-18); restarts forbidden unless the frozen policy names
  metric + threshold, and any unexplained restart — or an
  unanswered threshold breach — invalidates the run.
- Short runs report `smoke-only` even when green; full-horizon
  runs that never reach their horizon report `invalid` (NEG3-40:
  short no-OOM does not pass).

## 5. Verification (this turn, actual commands + exit codes)

- `typecheck` (`tsc --noEmit -p tsconfig.json`) → 0 ·
  `eslint .` → 0 · `depcruise src` → 0 (123 modules / 350 deps,
  zero violations)
- New unit: evaluation 46/46 · regions 6/6 · soak 14/14 ·
  conformance matrix 26/26 (incl. new Region + Soak rows)
- Native (`vitest.native.config.ts`): regions 2/2 on 2× real
  PG16 + real network partitions (~31s, containers/network
  removed, verified no leftovers) · soak 2/2 on a real worker
  process (~2s) · distribution + enterprise re-verify 16/16 on
  disposable `changeproof-t31` PG16
- Full `pnpm test` at close: 752 passed, 3 failed — the same 3
  pre-existing Python adapter failures (`l1-extraction` 2,
  `t07-acceptance` 1) proven identical on the untouched tree;
  adapter files untouched, all T-33/T-34/T-35 files green
- `build` (`tsc -p tsconfig.build.json`) → 0 +
  `changeproof help/status` CLI smoke green + built verifier
  exports (`freezeSoakPlan`, `freezeRegionPlan`) load from `dist`
- Skill bindings honored: code-security (T-34/T-35 mandatory),
  secret-serialization (T-33 eval surfaces), find-bugs (T-33),
  security-model (T-34/T-35 area binding)
- Missing checks / honest limits: frozen holdout/datasets/oracles
  + live model freeze (T-33 release rows); provisioned regions +
  consistency/RPO/RTO approval (T-34 SC3-10 rows); provisioned
  soak environments + calibrated profiler overhead + horizon
  approval (T-35 SC3-11 rows); paid-cloud provisioning needs
  explicit session auth per AGENTS §3 rule 16 — all recorded as
  phase-7 blockers, never simulated

Changed files this turn (new): `src/core/contracts/schemas/
{soak,regions}.ts` (+ readiness Eval contracts),
`src/modules/evaluation/
{canonical,store,manifest,roles,runner,policy,reduce,index}.ts`,
`src/modules/verifier/{regions,soak}.ts`, `bench/README.md`,
`bench/suites/{dev-functionality,dev-refusal}.json`,
`docs/decisions/t35-horizon-catalog.md`, `tests/evaluation/
t33-*`, `tests/verifier/{t34-regions,t35-soak}.test.ts`,
`tests/native/{regions,soak}.test.ts`,
`tests/native/soak-worker.mjs`; (modified):
`src/core/index.ts` (schema exports),
`src/modules/verifier/index.ts` (module exports),
`tests/contracts/conformance-matrix.test.ts` (Region + Soak
rows). No contract, policy, threshold, or schema semantic
change to existing versioned items; no version bump needed.

## 6. Open phase-5 tasks (T5-4..T5-8 done this turn, see §7–§11)

| Task | WP | Status + remaining phase-7 need |
| --- | --- | --- |
| T5-4 legacy fixtures/recovery | WP3-20 | Allocated task `done`; real domain-owner approval + fixable legacy case campaign stay phase-7 |
| T5-5 finite schedule/model checker | WP3-33 | Allocated task `done`; registered full-model campaigns stay phase-7 |
| T5-6 TB/cross-engine migration | WP3-33 | Allocated task `done`; ≥1 TB dataset + live cross-engine target + independent campaign stay phase-7 (paid storage needs session auth) |
| T5-7 cloud deployment automation | WP3-34 | Allocated task `done`; live AWS/Azure/GCP receipts per profile stay phase-7 (credentials need session auth) |
| T5-8 service operations | WP3-26 | Allocated task `done`; 3-org × 2-identity campaign + payment-provider + license/vendor/SLO decisions stay phase-7 |
| T5-9 organic pilot prep | WP3-14 | Allocated task `done` (see §13); authorized pilot repo + owner access stay phase-7 needs |

**Next dependency-ready task:** phase-6 T6-1 (T-42) design tokens +
responsive shell. Do not start phase-6 automatically.

## 7. T-36 / WP3-20 — legacy fixtures / recovery (`done`)

Task ID / parent WP: T-36 (T5-4) / WP3-20.
Requirement IDs: FR3-28, SC3-09, NEG3-19.
User-visible outcome: trusted corpus/intent/baseline authoring with
content-addressed freezes; observed output without owner validation stays
a hypothesis and exits diagnosis-only (`behavior_contract_unknown`, no
mutation); repair opens only behind owner-approved intent plus an
independent known-valid baseline.
Prerequisite evidence: WP3-15/18 task-level `done`.
Allowed source/config changes: `src/core` legacy contracts,
`src/modules/fixtures/legacy.ts`, tests.
Input snapshots + intended intervention: sanitized corpus pins +
owner approvals; fixture approvals exercise mechanics only.
Acceptance checks: unit 6/6 (self-stamp/baseline/drift negatives);
native 2/2 (read-only probe over `fixtures/sc3-baseline` with
before/after hashing, diagnosis-only without owner, gate opens with
fixture owner + independent validator); conformance matrix +1 row.
Protected oracle / proof scope: authoring mechanics only; real
domain-owner approval + fixable-case campaign stay phase-7.
Artifacts expected: contracts + module + probes — present.
Actual commands + exit codes: see §12.
Status + remaining blocker: allocated task `done`. Full WP3-20 stays
open: real owner intent/corpus + independent baseline + full
native/C/P/R/D campaign on a fixable legacy case (phase-7).
Next dependency-ready task: T-37 (executed same session).

What was built (tests-first):

- `LegacyCorpus/Intent/Baseline/Diagnosis` schemas; intent refuses
  owner == characterizing agent; diagnosis pins reason + `mutations: none`.
- `freeze/verify/record/diagnose/assertLegacyRepairAllowed` with
  digest drift refusal on every freeze.
- Native probe denies side effects by construction (reads only) and
  proves it by hashing the tree before and after.

## 8. T-37 / WP3-33 — finite schedule/model checker (`done`)

Task ID / parent WP: T-37 (T5-5) / WP3-33.
Requirement IDs: MVP §20 (finite model checking), NEG3-40.
User-visible outcome: frozen finite models (states, transitions,
invariants, bounds) with exhaustive within-bound BFS exploration;
counterexamples validated by replay on the actual system; verdicts
`holds_within_bound | violated | bound_incomplete | model_invalid`
with an exact claim scope — no generalization beyond the model.
Prerequisite evidence: WP3-10/18 task-level `done`.
Allowed source/config changes: `src/core` modelcheck contracts,
`src/modules/verifier/checker.ts`, tests + target fixture.
Input snapshots + intended intervention: frozen mutex models;
injected oracle/replayer seams (no simulated oracle in product code).
Acceptance checks: unit 6/6 (dangling refs, drift, holds-only-exhausted,
capped-bound incomplete, confirm/refute); native 2/2 (buggy target
confirms `violated`, fixed target refutes to `model_invalid`);
conformance matrix +1 row.
Protected oracle / proof scope: checker mechanics on small models;
registered full-model campaigns stay phase-7.
Artifacts expected: contracts + checker + target + probes — present.
Actual commands + exit codes: see §12.
Status + remaining blocker: allocated task `done`. Full WP3-33 stays
open: registered bounds + full-volume/horizon proof + independent
reproduction (phase-7).
Next dependency-ready task: T-38 (executed same session).

What was built (tests-first):

- `FiniteModel/Counterexample/Receipt/Report` schemas with
  dangling-state refusal and bound pinning.
- BFS exploration capped by `maxSchedules` (uncapped exhaustion or
  `bound_incomplete`, never holds); oracle restricted to declared
  invariants; replayer must reproduce both end state and invariant.
- Native `checker-target.mjs` mutex (buggy/fixed modes) driven as a
  real child process per replayed schedule.

## 9. T-38 / WP3-33 — TB-scale / cross-engine migration (`done`)

Task ID / parent WP: T-38 (T5-6) / WP3-33.
Requirement IDs: FR3-11, MVP §20 (TB/cross-engine), NEG3-05/40.
User-visible outcome: frozen volume profiles (declared bytes, engine
pair, writer envelope); byte ledger counting actual payload bytes;
cross-engine type mappings checked before any row moves; reconciliation
reusing the migration integrity report; `qualified` only with declared
volume + reconciliation + independent proof together.
Prerequisite evidence: WP3-10/18 task-level `done`.
Allowed source/config changes: `src/core` transfer contracts,
`src/modules/migrations/transfer.ts` (+ integrity-type move from
`index.ts` to avoid a cycle), tests.
Input snapshots + intended intervention: frozen TB profile
(postgresql-16.4 → spanner); small local volume labeled probe-only.
Acceptance checks: unit 9/9 (same-engine refused, drift, small-as-TB
refused, decimal/narrowing refused, tenant/checksum mismatch fails
closed, label table); native 2/2 (2000-row + 50 journaled rows on real
PG with `octet_length` byte sums, crash/resume without double count,
independent per-chunk checksum recomputation, `probe-only` label,
tamper negative); conformance matrix +1 row.
Protected oracle / proof scope: transfer mechanics on a small local
volume; ≥1 TB dataset + live cross-engine target + independent
campaign stay phase-7 (paid storage needs session auth).
Artifacts expected: contracts + ledger/mapping/reconcile + probes —
present.
Actual commands + exit codes: see §12.
Status + remaining blocker: allocated task `done`. Full WP3-33 stays
open per §8.
Next dependency-ready task: T-39 (executed same session).

What was built (tests-first):

- `VolumeProfile/TransferChunk/TypeMapping/TransferReceipt` schemas;
  `ByteLedger` (duplicate chunks refused, declared-volume assertion);
  exact-decimal/widening-integer/utf8-text mapping checks;
  `reconcileTransfer` on counts + tenants + checksums;
  `labelTransfer` enforcing NEG3-40.
- Integrity report/error moved verbatim from `migrations/index.ts`
  to `transfer.ts` (re-exported; no semantic change, no cycle).

## 10. T-39 / WP3-34 — cloud deployment automation (`done`)

Task ID / parent WP: T-39 (T5-7) / WP3-34.
Requirement IDs: FR3-43, NEG3-37/40.
User-visible outcome: frozen AWS/Azure/GCP profiles with pinned image
digests and broker refs only; provision → run → upgrade/rollback →
snapshot/restore → delete/teardown lifecycle through an injected
driver with per-step drift checks and artifact-bound receipts;
out-of-order steps refused; teardown needs confirm == profile id.
Prerequisite evidence: WP3-03/31 task-level `done` + T-37/T-38 task
evidence (WP3-33 preparation).
Allowed source/config changes: cloud schemas in
`src/core/contracts/schemas/distribution.ts`,
`src/modules/distribution/cloud.ts`, catalog doc, tests.
Input snapshots + intended intervention: `[DERIVED]` provider catalog
(`docs/decisions/t39-cloud-catalog.md`); native lifecycle against
real local containers as mechanics, every provider row `probe-only`.
Acceptance checks: unit 6/6 (unqualified blocked, order, full fake
lifecycle, drift + failure receipt, confirm, secret smuggling);
native 1/1 (~28s real docker lifecycle incl. genuine dump/reload
restore + no leftovers, no live credentials present); conformance
matrix +1 row.
Protected oracle / proof scope: lifecycle state machine, drift
checks, receipt chain; live provider receipts per profile stay
phase-7 (credentials need session auth).
Artifacts expected: schemas + driver seam + catalog + probes — present.
Actual commands + exit codes: see §12.
Status + remaining blocker: allocated task `done`. Full WP3-34 stays
open: live AWS/Azure/GCP provision/run/upgrade/rollback/restore/
delete/teardown receipts + full catalog campaigns (phase-7).
Next dependency-ready task: T-40 (executed same session).

What was built (tests-first):

- `CloudProfile/Qualification/Receipt/Step/Provider` schemas
  (strict, digest-pinned, refs-only).
- Single-seam `CloudDriver.execute(step, ...)` — no provider SDK in
  product code; drift writes a failure receipt then throws; state
  machine persisted per workdir.
- Native docker driver proving the whole chain on real containers.

## 11. T-40 / WP3-26 — service operations (`done`)

Task ID / parent WP: T-40 (T5-8) / WP3-26.
Requirement IDs: FR3-34/35/36, NFR3-12..15, NEG3-26/27/36.
User-visible outcome: capacity/fairness/drain/quarantine/outage gates
wired into admit/claim; deletion fences + tombstones wired into
submit/download with tombstone-first restore replay; HMAC-verified
idempotent payment events; frozen `[DERIVED]` HostedServiceProfile;
operator runbook; V11 deploy migration.
Prerequisite evidence: WP3-13 tooling (T-33) + WP3-25/27/29/30
service task evidence (phase-4 `done`) — verified in tree.
Allowed source/config changes: pure cores
(`jobs/operations`, `lifecycle/deletion`, `usage/billing`), durable
stores (`jobs/ops-store`, `lifecycle/deletion-store`,
`usage.recordPaymentEvent`), additive gate wiring in
`jobs/store`, `lifecycle/store`, `infra/postgres/V11`, decision doc,
runbook, tests.
Input snapshots + intended intervention: frozen profile numbers in
`docs/decisions/t40-service-profile.md` (license/vendor/SLO/pricing
explicitly undecided); payment secret arrives per call from the
broker boundary and is never stored.
Acceptance checks: unit 11/11 (caps/fairness/drain/quarantine/outage,
fence/restore/purge, HMAC/duplicate/refund-order, profile parse);
native 3/3 on real PG (3-tenant caps/fairness/drain/quarantine/outage,
fence + tombstoned download + restore survivors + purge timing,
signed billing lifecycle + settle behind receipt ref). No new core
schemas (HostedServiceProfile already in matrix).
Protected oracle / proof scope: operations mechanics on a local
disposable stack; 3-org × 2-identity campaign, payment-provider
selection, and license/vendor/SLO decisions stay phase-7.
Artifacts expected: cores + stores + V11 + docs + probes — present.
Actual commands + exit codes: see §12.
Status + remaining blocker: allocated task `done`. Full WP3-26 stays
open: release campaigns G3-13/14 + UI + license/build readiness
(phase-6/7).
Next dependency-ready task: T5-9 (WP3-14 pilot prep).

What was built (tests-first):

- Pure gates: least-loaded fairness, dual-cap admission, drain,
  quarantine, outage-until-healthy-probe, fence, tombstone-restore
  filter, purge deadline, HMAC verify, payment ordering.
- Durable stores with missing-table-safe gates (pre-V11 databases
  behave exactly as before; proven by unchanged green suites).
- Real enforcement wired into `admitRun`/`claimJob` (drain,
  quarantine, admission/dispatch outages), `submitRun` (fence),
  `downloadArtifact` (tombstone).

## 12. Verification (this turn, actual commands + exit codes)

- `pnpm typecheck` → 0 · `pnpm lint` → 0 (ESLint + depcruise,
  134 modules / 385 deps, zero violations) · `pnpm build` → 0 +
  built exports load (`legacy`, `checker`, `transfer`, `cloud`,
  `ops`, `deletion`)
- New unit: T-36 6/6 · T-37 6/6 · T-38 9/9 · T-39 6/6 · T-40 11/11 ·
  conformance matrix 30/30 (26 + legacy/modelcheck/transfer/cloud rows)
- Full `pnpm test`: 794 passed, 3 failed — the same 3 pre-existing
  Python adapter failures (`l1-extraction` 2, `t07-acceptance` 1)
  from the §1 entry audit; adapter files untouched (verified via
  `git status`)
- Native (`vitest.native.config.ts`, DATABASE_URL on disposable
  `changeproof-t31` PG16 + disposable redis/mailpit, both removed
  after): new probes legacy 2/2 · checker 2/2 · transfer 2/2 ·
  cloud 1/1 (~28s) · service-ops 3/3 — all repeatedly green
- Full native suite: 160/162 green; the 2 failures are proven
  pre-existing/environmental, not this turn's regression:
  `migration-frameworks` alembic (fails identically on the untouched
  tree via `git stash -u` re-run; stale `postgres://` scheme for
  SQLAlchemy 2.x + no psycopg driver in `.venv`) and the soak/regions
  worker timing flakes (each 2/2 green in isolation on this tree;
  soak-leak also fails on the untouched tree under load)
- Skill bindings honored: code-security (T-37..T-40 mandatory),
  find-bugs (T-36), secret-serialization (T-39/T-40 secret surfaces),
  durable-test-collateral (maintained tests kept per task)
- Missing checks / honest limits: live domain-owner approval (T-36);
  registered full-model campaigns (T-37); ≥1 TB + live cross-engine
  (T-38); live cloud credentials per profile (T-39); 3-org campaign +
  payment provider + license/vendor/SLO (T-40); paid/external scope
  per AGENTS §3 rule 16 was never invoked — all recorded as phase-7
  needs, never simulated

Changed files this turn (new): `src/core/contracts/schemas/
{legacy,modelcheck,transfer}.ts` (+ cloud block in
`distribution.ts`), `src/modules/{fixtures/legacy,verifier/checker,
migrations/transfer,distribution/cloud,jobs/{operations,ops-store},
lifecycle/{deletion,deletion-store},usage/billing}.ts`,
`infra/postgres/V11__service_operations.sql`,
`docs/decisions/{t39-cloud-catalog,t40-service-profile}.md`,
`docs/runbook.md`, `tests/{fixtures/t36-legacy,verifier/t37-checker,
migrations/t38-transfer,distribution/t39-cloud,jobs/t40-operations,
lifecycle/t40-deletion,usage/t40-billing}.test.ts`,
`tests/native/{legacy,checker,checker-target.mjs,transfer,cloud,
service-ops}.test.ts`; (modified): `src/core/index.ts`,
`src/modules/{fixtures,verifier,migrations,distribution,jobs,usage,
lifecycle}/index.ts`, `src/modules/migrations/index.ts`
(integrity types moved verbatim to `transfer.ts`),
`src/modules/distribution/deployment.ts` (export-only),
`src/modules/{jobs,lifecycle,usage}/store.ts` (additive gates),
`tests/contracts/conformance-matrix.test.ts` (+4 rows). No contract,
policy, threshold, or schema semantic change to existing versioned
items; no version bump needed.

## 13. T-41 / WP3-14 — organic pilot preparation (`done`)

Task ID / parent WP: T-41 (T5-9) / WP3-14.
Requirement IDs: BR3-11/14; FR3-21; SC3-06; NEG3-28.
User-visible outcome: frozen pilot scope template, owner/domain access
checklist, SC3-06 provenance record template, outcome/active-time
measurement procedure, and owner validation procedure; zero authorized
pilots verified, register empty, concrete phase-7 needs named.
Prerequisite evidence: phase-5 T-33..T-40 task evidence (task-level
`done`); repo search confirming no authorized pilot repo/owner.
Allowed source/config changes: `docs/pilot-prep.md`,
`config/pilot/register.json`, `tests/pilot/t41-register.test.ts` only.
No product source, contract, policy, or threshold changes.
Acceptance checks: unit 2/2 (empty register admits no adoption/repair
claim; `controlled_change` rejected as SC3-06 origin).
Protected oracle / proof scope: preparation only — no pilot run, no
adoption or impact claim (NEG3-28).
Artifacts expected: prep package + register + guard test — present.
Actual commands + exit codes: `pnpm vitest run tests/pilot` → 0 (2/2);
`pnpm typecheck` → 0; `pnpm lint` → 0 (134 modules / 385 deps, zero
violations).
Status + remaining blocker: allocated task `done`. Full WP3-14 stays
open: authorized pilot repo + owner (§6 needs 1–4 in
`docs/pilot-prep.md`), phase-7 G3-10 campaign.
Next dependency-ready task: phase-6 T6-1 (T-42).
