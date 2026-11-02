# Phase-5 report — revision 2

**Date:** 2 November 2026
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `in_progress` — allocated tasks T5-1/T5-2/T5-3
(T-33/T-34/T-35) `done` (see §2–§4). T5-4..T5-9 (WP3-20/33/34/26/14)
explicitly open with named owners/blockers (§6). No full WP and no G3
gate passed; phase stays `in_progress`.
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

## 6. Open phase-5 tasks (explicitly not started)

| Task | WP | Blocker / owner |
| --- | --- | --- |
| T5-4 legacy fixtures/recovery | WP3-20 | Trusted domain owner + corpus/intent decision (owner: Reyn); unknown behavior stays diagnosis-only |
| T5-5 finite schedule/model checker | WP3-33 | Registered state-space bounds + native counterexample harness (phase-7 volume) |
| T5-6 TB/cross-engine migration | WP3-33 | ≥1 TB populated dataset + cross-engine target + active-writer rig (phase-7 volume, paid storage needs session auth) |
| T5-7 cloud deployment automation | WP3-34 | AWS/Azure/GCP provision/run/teardown credentials + per-profile qualification (session auth) |
| T5-8 service operations | WP3-26 | Concurrent-org/outage/payment-test-environment access + license/vendor/SLO decisions |
| T5-9 organic pilot prep | WP3-14 | Authorized pilot repo + owner access for SC3-06 provenance |

**Next dependency-ready task:** T5-4 (WP3-20) preparation —
trusted intent/corpus authoring design — gated on the domain-owner
decision above; otherwise T5-5 bounded checker design. Do not
start phase-6 automatically.
