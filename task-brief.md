# ChangeProof AI Team Task Brief

**Plan revision:** 2 (24 October 2026)  

**Coordination status last reconciled:** 2 November 2026 (T-02..T-45 allocated `done`; T6-5..T6-8 / T-46..T-49 `not_started`; T-50..T-60 `tentative`; see §4 and [`docs/phase-reports/phase-6.md`](docs/phase-reports/phase-6.md) §§2–8). History: T-10..T-15 runnable limits turn 5, 31 October 2026 UTC (phase-2 report §10); T-16..T-18 turn 6 and T-19/T-20 phase-3 turn 1, 1 November 2026 UTC; T-27..T-32 phase-4 and T-33..T-41 phase-5, 2 November 2026 UTC; T-42..T-45 phase-6, 2 November 2026 UTC. Allocated-task `done` only — no full WP or G3 gate is recorded as passed.

**Purpose:** Coordinate work between Reyn and Hoang while preserving the repository's dependency order, verification rules, and honest status reporting.  

**Current verified project status:** Phases 1–6 are `in_progress`, not complete: phases 1–5 back-end allocated tasks are recorded `done` in their reports, and phase-6 has T6-1..T6-4 (T-42..T-45) `done` with T6-5..T6-8 (T-46..T-49) `not_started` — see [`docs/phase-reports/phase-6.md`](docs/phase-reports/phase-6.md) §§2–8 alongside the historical Phase-1–5 reports. No full WP or G3 gate is recorded as complete.

**This brief is a coordination document. It does not authorize external changes, paid services, production deployment, or claims that any work package or gate has passed.**

## 1. Team roles

| Person | Role | Main responsibilities |
|---|---|---|
| **Reyn** | Product owner and technical lead | Own prioritization and scope decisions; resolve specification conflicts; approve changes to contracts, policy, security boundaries, thresholds, or proof scope; coordinate access, toolchains, pilots, and vendor decisions; review integration and final task reports. |
| **Hoang** | Engineering contributor | Take explicitly assigned, dependency-ready implementation tasks; add failure-path tests before implementation where required; preserve module boundaries; run and report the applicable checks; raise blockers rather than weakening proof requirements. |

These roles do not imply that either person has authorization to perform an external or irreversible action. Obtain explicit session authorization before paid API use, external repository mutation/publication, sending messages, payments, destructive operations, or production deployment.

## 2. Working agreement

1. **Use the repository as the source of status.** Before taking a task, inspect the current source, `package.json`, tests, reports, and Git state if available. A specification target or an old checkbox is not evidence that a capability exists or passes.
2. **Respect the dependency graph.** Select one dependency-ready task from the current phase. A split task may proceed only when its own inputs are proven. It does not make its full WP or dependent WPs `done`.
3. **Tests first for safety-sensitive work.** For policy, contracts, guards, verifier, identity/grants, jobs/leases, usage, and security boundaries, write the relevant negative/failure-path tests before implementation.
4. **Keep boundaries intact.** Core contracts and ports stay in `src/core`; leaf modules collaborate through core ports; only `src/orchestrator` wires module implementations. Policy stays pure. Do not execute customer-controlled code on the host/control plane.
5. **Never alter the proof to make a candidate pass.** Do not change intent, oracle, budget, support level, thresholds, assertions, or test scope for the candidate under assessment. A changed candidate requires fresh affected proof.
6. **Report evidence, not impressions.** Record exact commands and exit codes; separate mock/replay checks from native/real-runtime checks. Missing checks are written as `missing check` or a specific `blocked` reason, never presented as a pass.
7. **Coordinate overlapping files.** Before editing shared contracts, policy, root configuration, or another active task's files, agree on ownership and integration order. Use small branches/PRs if Git hosting is available; otherwise communicate file ownership and avoid simultaneous edits.
8. **Do not silently start the next phase.** Finish or explicitly hand off the current assigned scope, report blockers, then agree on the next task.
9. **Work by ready task, not by daily quota.** There is no fixed number of tasks or phases to complete per day. Take one dependency-ready assignment at a time; send progress updates through the agreed team channel and raise blockers when they appear.

## 3. Current phase status and remaining work

The latest recorded status is the phase-6 report §§2–8, dated 2 November 2026. Phases 1–6 remain `in_progress`; allocated-task evidence never completes a full WP. Re-run applicable checks after source/config changes. (Phase-1/2 detail now lives in the assignment index §4 and the historical reports.)

| Phase / area | Recorded status | Remaining proof / blocker |
|---|---|---|
| Phases 1–5 back-end allocated (T-02..T-41) | `done` per reports 1–5; every full WP `in_progress` | Full-WP acceptance per MVP §8 stays with phase-7; owner-held gates (frozen oracle/intent, live model, qualified guest, authorized App/orgs, vendors, pilots) remain. |
| Phase-6 front-end T6-1..T6-4 (T-42..T-45) | `done` (phase-6 report §§2–6 + gate §7) | Backend gaps recorded per task (repo onboarding, entitlements/forecast, readiness, review aggregation, streaming, member lists); production hardening; phase-7 acceptance. |
| Phase-6 front-end T6-5..T6-8 (T-46..T-49) | `not_started` (`tentative`) | Evidence/publication/export, notifications/search, support/collaboration, billing/BYOK/enterprise UI. Next ready: T-46 (T6-5). |
| Phase-7 acceptance (T-50..T-60) | `not_started` (`tentative`) | Full WP3-01..34 + G3-01..17 qualification. T-54/T-56 `blocked` without authorized publication repo and organic pilot/owner access. |
| Gates | No G3 gate is recorded as passed | G3-08/G3-10 remain blocked without authorized publication repository and organic pilot/owner access. |

**Latest observed verification (2 November 2026):** `pnpm typecheck`, `pnpm lint` (157 modules / 465 deps), `pnpm build`, `pnpm build:ui`, `pnpm test:ui` (79/79), `pnpm vitest run tests/http` (20/20), and `pnpm test:e2e` (4/4 specs) passed with exit code 0; `pnpm test` exited 1 with **815 passed / 4 failed (819)** — 3 pre-existing Python adapter failures plus 1 architecture timeout under parallel load (9/9 in isolation). Native slices re-run: auth-http 11/11, runs-http 10/10. The full native suite was last recorded in the phase-5 report §12 (160/162) and was not re-run. These are results recorded for that change set, not a fresh run for future changes. Earlier notes stand corrected: `scripts/runner-security-probes.mjs` exists (Modal qualification still blocked per its decision record, never a pass); `semgrep` binary still absent.

## 4. Active assignments

The IDs below are team coordination IDs, not replacements for the phase task IDs. An assignment never marks its full WP complete.

### Assignment index (all phases)

Every phase task has exactly one named owner. Owners alternate deliberately (Reyn, then Hoang) so the load stays balanced; an owner is the executor, not new authority — changes to contracts, policy semantics, security boundaries, thresholds, or proof scope still require Reyn's approval (§1). Tasks marked `tentative` are **not dependency-ready**: the owner must confirm exact scope, prerequisite evidence, and file ownership with Reyn before starting, and a §5 task header is recorded at that point. Status values follow §5 and mirror the phase reports; this index changes ownership only, never task, full-WP, or gate status.

| Assignment | Phase task / WP | Scope | Owner | Status | Readiness / blocker |
|---|---|---|---|---|---|
| — | T1-3 / WP3-02 | Toolchain and boundaries | — | `done` (allocated task) | Full WP3-02 stays `in_progress` (package/run composition acceptance). |
| — | T1-7 / WP3-04 | Dependency broker preparation | — | `done` (allocated task) | Full WP3-04 stays `in_progress` (native acquisition/build-sandbox proof missing). |
| T-02 | T1-8 / WP3-05 | Acceptance-matrix audit and scope lock | **Reyn** | `done` | Recorded below; Reyn owns any scope change. |
| T-03 | T1-8 / WP3-05 | Event-flow acceptance tests | **Hoang** | `done` | Positive/negative event-flow tests are recorded in `tests/graph/detector-analyzer-graph.test.ts`; T-09 is now ready. |
| T-04 | T1-1 / WP3-01 | Contracts: complete conformance matrix + semantic audit | **Reyn** | `done` | Completion confirmed; matrix/tests are in `tests/contracts/`. |
| T-05 | T1-2 / WP3-01 | Policy: final purity/boundary review + precedence audit | **Hoang** | `done` | Completion confirmed; precedence coverage is in `tests/policy/precedence.test.ts`. |
| T-06 | T1-4 / WP3-03 | Registry: resolve six-vs-five ecosystem scope divergence | **Reyn** | `done` | Five-ecosystem decision and governing-document updates are recorded in `docs/decisions/phase1-ecosystem-scope-resolution.md`. |
| T-07 | T1-5 / WP3-03 | Adapter L1 remainder: per-tuple matrix for the decided scope | **Hoang** | `done` | Positive/negative L1 cases are covered for the five decided ecosystems; see `tests/adapters/t07-acceptance.test.ts` and native extraction tests. Kotlin/JVM is out of scope. |
| T-08 | T1-6 / WP3-04 | Runner: qualified VM/microVM-equivalent isolation proof | **Reyn** | `done` | One bounded E1 VM probe has metadata/socket/termination receipts; see `docs/decisions/phase1-runner-qualification-blocked.md`. Limits: single run; no cross-tenant or cancel-mid-workload proof. Full WP remains `in_progress`. |
| T-09 | T1-8 / WP3-05 | Graph acceptance-matrix remainder after T-03 | **Hoang** | `done` | Data and deployment/config positive/negative impact cases are in `tests/graph/detector-analyzer-graph.test.ts`; synthetic evidence only, not database/deployment runtime proof. |
| T-10 | T2-1 / WP3-15 | Observability full acceptance | **Reyn** | `done` | Connector port + file ingestion + normalize loop proven, 15/15 (turn 5); live backends need catalog + access; predecessors pending. |
| T-11 | T2-2 / WP3-16 | Verifier campaign full acceptance | **Reyn** | `done` | Bounded real executor + campaigns 4/4 native (turn 5); barriers/network-faults/budget/qualified-guest + flagship params pending. |
| T-12 | T2-3 / WP3-17 | Measurement reducers full acceptance | **Reyn** | `done` | Real-observation reducers 2/2; sandbox SC3-01 thresholds frozen by DEC3-P3-01; qualified SLO/profile + candidate arm (WP3-07) pending. |
| T-13 | T2-4 / WP3-06 | Fixtures/oracle: frozen oracle + real app/DB/broker proof | **Reyn** | `done` | Rig + dry runs 3/3 incl. real Chrome + intent proposal + ceremony tool (turn 5); awaits owner approval + freeze. |
| T-14 | T2-5 / WP3-21 | Identity/RLS native proof | **Reyn** | `done` (allocated task) | Services implemented + native 24/24 (turn 5). Full WP3-21 `in_progress` (phase-7 + hosted deployment proof remain). |
| T-15 | T2-6 / WP3-22 | GitHub live proof (webhooks, installation, broker) | **Reyn** | `done` | Client + broker + wiring, 22/22 pure incl. `octokit 5.0.5` (turn 5); live proof needs an authorized App. |
| T-16 | T2-7 / WP3-23 | Jobs: durable dispatcher + hosted store | **Reyn** | `done` | V3 + fenced store + wiring, native 17/17 (turn 6). Full WP3-23 `in_progress` (qualified guest, measured fairness campaign). |
| T-17 | T2-8 / WP3-24 | Usage: atomic store + billing settlement | **Reyn** | `done` | V4 + atomic store + settlement + wiring, native 12/12 (turn 6). Full WP3-24 `in_progress`; current owner decision is free-only service plan with no payment integration in this scope. Paid plan/provider remains undecided; free-tier usage caps and frozen service profile remain open. |
| T-18 | T2-9 / WP3-28 | Email/session delivery proof | **Reyn** | `done` | V5 + flows + real Mailpit delivery 14/14 + 3/3 (turn 6). Full WP3-28 `in_progress` (linking needs live GitHub, prod mail vendor). |
| T-19 | T3-1 / WP3-07 | Agent fix loop (hypothesis ledger, candidate revision) | **Reyn** | `done` | Ledger/revision/stopper 18/18 + wiring (phase-3 turn 1). Full WP3-07 `in_progress` (frozen oracle, adapter loop). |
| T-20 | T3-2 / WP3-07 | Model broker + typed mutation gateway | **Reyn** | `done` | Broker/gateway/guard 26/26 + wiring (phase-3 turn 1); official Meta endpoint/model documented; live call `blocked` on fresh host TLS proof + numeric hard cap (phase-3 report §1). |
| T-21 | T3-3 / WP3-08 | JS/TS, Python, JVM L3 adapters | **Reyn** | `done` | Allocated done 1 Nov 2026 (TS/Python L3; JVM out per phase1-ecosystem-scope-resolution). Full WP3-08 open (frozen oracle, live model). |
| T-22 | T3-4 / WP3-09 | Go/PHP L2 adapters | **Reyn** | `done` | Allocated done 1 Nov 2026 (Go Fiber + PHP L2 planFix/guard). Full WP3-09 open (same owner-held gates). |
| T-23 | T3-10 / WP3-10 | Migrations + dependency broker integration | **Reyn** | `done` | Allocated done 1 Nov 2026 (MigrationRunner + broker + SC3-02/03 native). Full WP3-10 open (hosted authority). |
| T-24 | T3-11 / WP3-11 | Orchestrator bundle coordination + recovery | **Reyn** | `done` | Allocated done 1 Nov 2026 (coordinateBundle/coordinateRecovery; NEG3-06 pinned). Full WP3-11 open (multi-system SC3 runs). |
| T-25 | T3-12 / WP3-12 | Evidence store + publication broker | **Reyn** | `done` | Allocated done 1 Nov 2026 (evidence store + broker; NEG3-14/23/39 pinned). Live GitHub row blocked (no authorized App). |
| T-26 | T3-18 / WP3-18 | Complex scenario suite (SC3-03/04/07/08/09) | **Reyn** | `done` | Allocated done 2 Nov 2026 (unit 19/19 + native 15/15; fixtures/tests only). Full WP3-18 open (frozen oracle, live model, guards, cross-system proof). |
| T-27 | T4-1 / WP3-27 | Public site API + content | **Reyn** | `done` | Allocated done 2 Nov 2026 (closed contracts, manifest, two-layer tenant boundary, 24/24 unit). Full WP3-27 open (phase-6 visuals, browser acceptance). |
| T-28 | T4-2 / WP3-25 | Run-lifecycle API | **Reyn** | `done` | Allocated done 2 Nov 2026 (V6 store + wiring, 7/7 unit + 7/7 native; NEG3-22/27/33). Full WP3-25 open (streaming, dispatcher role, browser). |
| T-29 | T4-3 / WP3-29 | Queries + notifications | **Reyn** | `done` | Allocated done 2 Nov 2026 (V7 stores + wiring, 8/8 unit + 11/11 native; NEG3-31/32). Full WP3-29 open (multi-channel delivery, reconnect, browser). |
| T-30 | T4-4 / WP3-30 | Support + collaboration services | **Reyn** | `done` | Allocated done 2 Nov 2026 (V8 stores + wiring, 7/7 unit + 14/14 native; NEG3-34/35). Full WP3-30 open (mail/push fan-out, execution-tree kill, browser). |
| T-31 | T4-5 / WP3-31 | BYOK + self-host deployment tooling | **Reyn** | `done` | Allocated done 2 Nov 2026 (BYOK metadata-only + `changeproof` CLI + V9, 24/24 unit + 7/7 native; NEG3-37). Full WP3-31 open (platform catalog + license, Windows/macOS profiles, live pull-through qualification). |
| T-32 | T4-6 / WP3-32 | SAML/SCIM + GitLab/Bitbucket adapters | **Reyn** | `done` | Allocated done 2 Nov 2026 (SAML/SCIM + provider port + V10, 30/30 unit + 9/9 native; NEG3-38/39). Full WP3-32 open (live IdP + XML/C14N vendor, self-managed/Server matrix, authorized test orgs). |
| T-33 | T5-1 / WP3-13 | Bench harness + evaluation contracts | **Reyn** | `done` | Allocated done 2 Nov 2026 (frozen B0/B1/B2/Full manifests + bench suites, 46/46 unit, native N/A; NEG3-13/15). Full WP3-13 open (frozen holdout/datasets/oracles, live model freeze, phase-7 release evaluation). |
| T-34 | T5-2 / WP3-19 | Multi-region supervisor | **Reyn** | `done` | Allocated done 2 Nov 2026 (frozen region plans + injected seams, 6/6 unit + 2/2 native on 2× real PG16; NEG3-08/17/40). Full WP3-19 region half open (provisioned regions, owner RPO/RTO approval, phase-7 SC3-10). |
| T-35 | T5-3 / WP3-19 | Long-horizon profiler | **Reyn** | `done` | Allocated done 2 Nov 2026 (frozen soak catalog + plans, 14/14 unit + 2/2 native smoke; NEG3-18/40). Full WP3-19 horizon half open (provisioned soak envs, calibrated overhead, horizon approval, phase-7 SC3-11). |
| T-36 | T5-4 / WP3-20 | Legacy fixtures / recovery | **Reyn** | `done` | Allocated done 2 Nov 2026 (corpus/intent/baseline freezes + diagnosis-only gate, 6/6 unit + 2/2 native; NEG3-19). Full WP3-20 open (real owner intent/corpus + independent baseline + fixable-case campaign). |
| T-37 | T5-5 / WP3-33 | Finite schedule/model checker | **Reyn** | `done` | Allocated done 2 Nov 2026 (frozen finite models + replay-validated counterexamples, 6/6 unit + 2/2 native; NEG3-40). Full WP3-33 checker half open (registered bounds + full-volume/horizon proof + independent reproduction). |
| T-38 | T5-6 / WP3-33 | TB-scale / cross-engine migration | **Reyn** | `done` | Allocated done 2 Nov 2026 (volume profiles + byte ledger + reconcile, 9/9 unit + 2/2 native probe-only; NEG3-05/40). Full WP3-33 transfer half open (≥1 TB dataset + live cross-engine target + independent campaign). |
| T-39 | T5-7 / WP3-34 | Cloud deployment automation | **Reyn** | `done` | Allocated done 2 Nov 2026 (frozen cloud profiles + injected driver + receipt chain, 6/6 unit + 1/1 native docker lifecycle; NEG3-37/40). Full WP3-34 open (live AWS/Azure/GCP receipts per profile). |
| T-40 | T5-8 / WP3-26 | Service operations (capacity/drain/restore/billing) | **Reyn** | `done` | Allocated done 2 Nov 2026 (pure gates + durable stores + V11 + runbook, 11/11 unit + 3/3 native; NEG3-26/27/36). Full WP3-26 open (3-org campaign + payment provider + license/vendor/SLO). |
| T-41 | T5-9 / WP3-14 | Organic pilot preparation | **Reyn** | `done` | Allocated done 2 Nov 2026 (frozen scope template + checklists + empty register + guard test, 2/2 unit; NEG3-28; zero authorized pilots). Files + phase-5 report §13 uncommitted at reconciliation. Full WP3-14 open (authorized pilot repo + owner, phase-7 G3-10). |
| T-42 | T6-1 / WP3-27 | Design tokens + responsive shell | **Reyn** | `done` | Allocated done 2 Nov 2026 (dashboard scaffold, token source, shell/components/store, thin `src/http` slice, self-hosted fonts; phase-6 report §§2–3). Full WP3-27 open (phase-7 browser acceptance). |
| T-43 | T6-2 / WP3-27 | Public site front-end | **Reyn** | `done` | Allocated done 2 Nov 2026 (17 manifest routes live, FAQ search, template gate; phase-6 report §4). Full WP3-27 open (phase-7 browser acceptance). |
| T-44 | T6-3 / WP3-21/22/28 | Auth / onboarding / settings UI | **Reyn** | `done` | Allocated done 2 Nov 2026 (17 auth/org endpoints, pages, session event + epoch guards; native 11/11, E2E auth; phase-6 report §5). Full WP3-21/22/28 open (member/invite lists, hardening, phase-7). |
| T-45 | T6-4 / WP3-25 | Run journey UI | **Reyn** | `done` | Allocated done 2 Nov 2026 (10 runs endpoints, lists/form/detail, coverage record, review gate; native 10/10, E2E runs; phase-6 report §§6–7). Full WP3-25 open (workers, review aggregation, streaming, phase-7). |
| T-46 | T6-5 / WP3-12/29 | Evidence / publication / export UI | **Reyn** | `not_started` | `tentative`. |
| T-47 | T6-6 / WP3-29 | Notifications / search UI | **Reyn** | `not_started` | `tentative`. |
| T-48 | T6-7 / WP3-30 | Support / collaboration UI | **Reyn** | `not_started` | `tentative`. |
| T-49 | T6-8 / WP3-24/31/32 | Billing / BYOK / enterprise UI | **Reyn** | `not_started` | `tentative`. |
| T-50 | T7-1 / G3-01, G3-02 | Contract/identity/policy/import negatives + qualified guest probes | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-51 | T7-2 / G3-03 | Six-ecosystem L1/L2/L3 tuple matrix | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-52 | T7-3 / G3-04, G3-05, G3-11 | Frozen baselines, independent oracle, causality, real scenarios | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-53 | T7-4 / G3-06, G3-13 | NEG3-01..40 mapping + concurrent-tenant isolation | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-54 | T7-5 / G3-07, G3-08 | Clean full-campaign reproduction + authorized publication | **Reyn** | `not_started` | `tentative` — blocked without an authorized publication repository. |
| T-55 | T7-6 / G3-09 | Frozen dev/holdout evaluation (B0/B1/B2/Full + ablations) | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-56 | T7-7 / G3-10 | Organic pilot acceptance (SC3-06) | **Reyn** | `not_started` | `tentative` — blocked without organic pilot/owner access. |
| T-57 | T7-8 / G3-12, G3-15 | Full real browser journey | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-58 | T7-9 / G3-14 | Capacity/fairness/outage/restore + billing lifecycle | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-59 | T7-10 / G3-16 | Hosted/self-host/BYOK + provider publication matrix | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-60 | T7-11 / G3-17 | Multi-region/RPO-RTO/long-soak/TB qualification | **Reyn** | `not_started` | `tentative` — acceptance phase. |

The hackathon-slice playbook has no phase task table and is not part of this index; it is scheduled only by its exact prompt and never implies the assignments above.

### Recorded assignments with task headers

Both assignments below sit under T1-8 / WP3-05. T-03 depends on T-02. Neither assignment marks the full WP complete.

| Assignment | Owner | Parent task / WP | Status | Prerequisite / handoff |
|---|---|---|---|---|
| **T-02: WP3-05 acceptance-matrix audit and scope lock** | **Reyn** | T1-8 / WP3-05 | `done` | The current graph-test audit is recorded below. Reyn owns any scope change before Hoang starts. |
| **T-03: WP3-05 event-flow acceptance tests** | **Hoang** | T1-8 / WP3-05 | `done` | Positive and negative event-flow acceptance tests are present in `tests/graph/detector-analyzer-graph.test.ts`; full WP3-05 remains `in_progress`. |

### T-02: Reyn

```text
Task ID / parent WP: T-02 / T1-8 / WP3-05
Owner: Reyn
Requirement IDs: BR3-02; FR3-04/05/06; NEG3-02/06
Outcome: A traceable API/data/event/dependency/config acceptance matrix showing existing coverage, exact gaps, and one bounded event-flow scope for T-03.
Prerequisite evidence: Phase-1 and Phase-2 reports; existing graph/adapters tests; PRD FR3-04..06 and MVP WP3-05 acceptance.
Allowed changes: task-brief.md assignment/matrix section only. No source, policy, contract, threshold, or specification changes.
Acceptance: Each change category maps to an existing test/evidence reference or an explicit gap. The event-flow rows identify positive and negative cases, expected provenance/resolution, and exact files for T-03.
Status: done
Scope authority: Reyn approves any later scope change.
Next: Share the recorded T-03 scope with Hoang.
```

Acceptance-matrix audit:

| Category | Existing implementation/test evidence | Missing acceptance row or gap | Include in T-03? |
|---|---|---|---|
| API | `tests/graph/detector-analyzer-graph.test.ts`: API normalization and `calls`/`serializes` impact traversal. | Broader extraction cases remain outside this event-flow task. | No |
| Data | `tests/graph/detector-analyzer-graph.test.ts`: `data_schema` normalization. | Database table/column relationship and impact cases are not demonstrated by the graph test matrix. | No |
| Event | `tests/graph/detector-analyzer-graph.test.ts`: `event_schema` normalization; `src/core/contracts/schemas/graph.ts` defines `publishes` and `consumes` edges. | No test covers a publisher-to-event-to-consumer/workflow impact path or an unresolved consumer subscription. | Yes |
| Dependency | `tests/graph/detector-analyzer-graph.test.ts`: dependency normalization and impact propagation through `depends_on`. | Broader extraction cases remain outside this event-flow task. | No |
| Config | `tests/graph/detector-analyzer-graph.test.ts`: configuration normalization. | No config/deployment requirement edge or impact path is demonstrated by the graph test matrix. | No |

Shared graph negatives cover unresolved/proven/inferred distinctions, dangling endpoints, and unknowns retained as coverage gaps. T-03 adds the missing event-flow path without duplicating those general cases.

### T-03: Hoang

```text
Task ID / parent WP: T-03 / T1-8 / WP3-05
Owner: Hoang
Requirement IDs: BR3-02; FR3-04/05/06; NEG3-02/06
Outcome: Positive and negative event-flow acceptance tests for the exact gaps confirmed in T-02; graph behavior changes only if a failing test demonstrates they are needed.
Prerequisites: T-02 matrix is recorded; task-level inputs for the affected adapter/graph path. Incomplete full WPs do not become complete through this split.
Allowed source/config changes: tests/graph/detector-analyzer-graph.test.ts; corresponding detector/analyzer/graph implementation only when required by a failing test. No policy/oracle/threshold changes.
Acceptance checks: Tests first. Positive case: an event-schema change traverses publisher -> publishes -> event -> consumes -> consumer/workflow with edge evidence locators; resulting analyzer impacts remain `inferred`. Negative case: an unresolved consumer subscription remains a coverage gap with its reason and is not reported as unaffected or as a proven impact. Run pnpm test:graph, pnpm typecheck, pnpm lint, and pnpm test after source changes; record commands and exit codes. Synthetic tests are not native/runtime proof.
Status: done
Next: T-09 completed the remaining data/config acceptance-matrix rows. Full WP3-05 remains in progress.
```

### T-04: Reyn

```text
Task ID / parent WP: T-04 / T1-1 / WP3-01
Owner: Reyn
Requirement IDs: BR3-01/13; FR3-14/15/16; NEG3-03/06/07/13/15/18/20
Outcome: The contract/conformance matrix is complete and audited: every versioned schema family has positive and negative conformance evidence (dangling references, closed enums, unknown schemaVersion rejected, raw-byte hash kept distinct from canonical structured identity).
Prerequisite evidence: Phase-1 report T1-1 row — versioned Zod schemas, semantic validation, and negative tests already exist under tests/contracts/; complete matrix and final review remain.
Allowed source/config changes: src/core/contracts and tests/contracts only. Any contract semantic change requires a schema version bump and a decision record in docs/decisions/. No policy, oracle, threshold, or specification changes.
Acceptance checks: Failure-path tests first for each uncovered conformance row. Each matrix row maps to an existing or new test reference — no row is closed on inspection alone. Run pnpm typecheck, pnpm lint, pnpm test after changes; record commands and exit codes.
Status: done
Next: T-04 completion is recorded; full WP3-01 remains in progress until all original acceptance criteria are met.
```

### T-05: Hoang

```text
Task ID / parent WP: T-05 / T1-2 / WP3-01
Owner: Hoang
Requirement IDs: FR3-16; NEG3-03/06
Outcome: Final policy purity and precedence review is recorded: policy stays pure (no I/O, model, clock, environment, or framework branches), every precedence row from the phase-1 table (stale+pass, full-pass+unknown, partial+invalid oracle, target-pass+edge-fail, mixed candidate, dimension-inconclusive+functional-pass) has an explicit failing-input test, and inputs reject averaging, voting, and model confidence.
Prerequisite evidence: Phase-1 report T1-2 row — deterministic target/bundle reducer with precedence tests exists under tests/policy/; final purity/boundary review and policy contract audit remain.
Allowed source/config changes: src/modules/policy and tests/policy only. No verdict-rule changes without Reyn's approval and a decision record; adding an adapter/framework must not change verdict rules.
Acceptance checks: Failure-path tests first. Run pnpm typecheck, pnpm lint, pnpm test, and the boundary check after changes; record commands and exit codes.
Status: done
Next: T-05 completion is recorded; full WP3-01 remains in progress until all original acceptance criteria are met.
```

### T-06: Reyn

```text
Task ID / parent WP: T-06 / T1-4 / WP3-03
Owner: Reyn
Requirement IDs: FR3-01/02; NEG3-02/09
Outcome: The six-versus-five ecosystem scope divergence is resolved in favor of five ecosystems; all four governing documents and registry/capability tuples match the owner-directed JVM removal. The decision is recorded in `docs/decisions/phase1-ecosystem-scope-resolution.md`.
Prerequisite evidence: docs/decisions/phase1-jvm-removal.md (owner-directed removal); Phase-2 report recording five ecosystems against the six-ecosystem specification target; tests/adapters/registry.test.ts.
Allowed source/config changes: decision record + governing document updates; src/modules/adapters/registry only if the decision reinstates or removes tuples. New records start with provenLevel = none regardless of the decision.
Acceptance checks: The recorded decision, the documents, and the registered tuples agree. Run pnpm test:adapters, pnpm typecheck, pnpm lint after any registry change; record commands and exit codes.
Status: done
Next: T-07 may proceed against the five-ecosystem scope recorded in the decision; no JVM/Kotlin case is required.
```

### T-07: Hoang

```text
Task ID / parent WP: T-07 / T1-5 / WP3-03
Owner: Hoang
Requirement IDs: FR3-01/02; NEG3-02/09
Outcome: Per-tuple L1 acceptance is complete for the five ecosystems decided by T-06, with positive extraction and negative/unsupported cases on pinned toolchains. JVM/Kotlin is out of scope.
Prerequisite evidence: Phase-1 report T1-5 row and T-06 decision — native positive/negative tests pass for TypeScript, Python, PHP, Go (go1.27.3), and .NET (SDK 10.0.403). Java/Kotlin are out of scope after the five-ecosystem decision.
Allowed source/config changes: src/modules/adapters/* and tests/adapters/* only. No provenLevel promotion without evidence; unsupported cases must not return a generic verified.
Acceptance checks: Failure-path tests first; native toolchain checks run where the toolchain exists and are reported separately from mock/replay results. Run pnpm test:adapters, pnpm typecheck, pnpm lint, pnpm test after changes; record commands and exit codes. A missing toolchain is a recorded blocker, not a skipped check.
Status: done
Evidence: `tests/adapters/t07-acceptance.test.ts` covers the five ecosystem tuples; `tests/adapters/l1-extraction.test.ts` and `tests/adapters/go-dotnet-extraction.test.ts` include native TypeScript, Python, PHP, Go, and .NET extraction cases. Fresh `pnpm test:adapters` passed 75 tests across six files.
Next: Full WP3-03 acceptance remains separate from this allocated task.
```

### T-08: Reyn

```text
Task ID / parent WP: T-08 / T1-6 / WP3-04
Owner: Reyn
Requirement IDs: NFR3-04..08; NEG3-10/24
Outcome: A bounded E1 VM probe was executed and recorded, and its limits are explicit. This closes the allocated T-08 decision/evidence task; it does not qualify hosted readiness or complete full WP3-04.
Prerequisite evidence: Runner profile, guest plan, oracle mount checks, cleanup/quarantine tests, Docker container probes, and the E1 VM probe receipts recorded in `docs/decisions/phase1-runner-qualification-blocked.md`.
Allowed source/config changes: scripts/, modules/verifier runner configuration, and environment/decision records. No weakening of isolation requirements; container smoke remains non-qualifying.
Acceptance checks: Qualified-boundary probes with escape/cancel/cleanup/quarantine receipts on the qualified environment, or a specific recorded blocker. Native results reported separately; record commands and exit codes.
Status: done (one bounded E1 VM probe; no cross-tenant or cancel-mid-workload proof)
Next: Broader runner qualification and native dependency broker proof remain WP3-04 work.
```

### T-09: Hoang

```text
Task ID / parent WP: T-09 / T1-8 / WP3-05
Owner: Hoang
Requirement IDs: BR3-02; FR3-04/05/06; NEG3-02/06
Outcome: The remaining data (table/column relationship and impact) and config (deployment-requirement edge and impact) acceptance rows are covered by positive and negative graph tests. `proven`, `inferred`, and `unresolved` remain distinct; unknowns are not dropped or promoted.
Prerequisite evidence: T-02 acceptance matrix recorded above; T-03 reviewed and integrated; existing tests/graph/detector-analyzer-graph.test.ts coverage.
Allowed source/config changes: tests/graph/* and the corresponding detector/analyzer/graph implementation only when a failing test demonstrates the need. No policy/oracle/threshold changes.
Acceptance checks: Tests first, positive and negative per matrix row. Run pnpm test:graph, pnpm typecheck, pnpm lint, pnpm test after changes; record commands and exit codes. Synthetic tests are not native/runtime proof.
Status: done
Evidence: `tests/graph/detector-analyzer-graph.test.ts` covers data-schema and deployment/configuration impact paths and unresolved-edge gaps. Fresh `pnpm test:graph` passed 22 tests; cases are synthetic, not native database/deployment proof.
Next: Full WP3-05 acceptance remains separate from this allocated task.
```

### T-21: Reyn

```text
Task ID / parent WP: T-21 / T3-3 / WP3-08
Owner: Reyn
Requirement IDs: FR3-07/08; support tuples (typescript react/nestjs/fastify/prisma, python pydantic/sqlalchemy)
Outcome: TS + Python adapters reach L3 (detect/extract/analyze/planFix/applyPatch/verify + planChecks); JVM label stale per phase1-ecosystem-scope-resolution, .NET stays L1.
Prerequisite evidence: T-07 L1 matrix; native toolchains (tsc, next build, prisma validate, django test) on dev machine.
Allowed source/config changes: src/modules/adapters/{typescript,python}, tests/adapters/t21-l3-tuples.test.ts, tests/adapters/{native-exec,fixtures}.ts.
Acceptance checks: tests-first; 19/19 tuple tests; pnpm test:adapters 144/144; native toolchain proofs real (no mocks).
Status: done
Evidence: tests/adapters/t21-l3-tuples.test.ts 19/19; pnpm test:adapters 144/144; pnpm typecheck 0; pnpm lint 0.
Next: Full WP3-08 stays open (frozen oracle ceremony, live model, adapter-loop integration).
```

### T-22: Reyn

```text
Task ID / parent WP: T-22 / T3-4 / WP3-09
Owner: Reyn
Requirement IDs: FR3-07/08; support tuples (go fiber, php)
Outcome: Go/Fiber + PHP adapters reach L2 (planFix + planChecks + guard); fail-closed unknowns for unmodeled routers/interpolation.
Prerequisite evidence: T-21 patterns (reviewPatch/applyAdapterPatch helpers); go build/vet + php -l on dev machine.
Allowed source/config changes: src/modules/adapters/{go,php}, tests/adapters/t22-l2-candidates.test.ts.
Acceptance checks: tests-first; 11/11 candidate tests; native go/php proofs real.
Status: done
Evidence: tests/adapters/t22-l2-candidates.test.ts 11/11; full adapters suite green.
Next: Full WP3-09 stays open (same owner-held gates as WP3-08).
```

### T-23: Reyn

```text
Task ID / parent WP: T-23 / T3-10 / WP3-10
Owner: Reyn
Requirement IDs: FR3-09/10; SC3-02/03
Outcome: MigrationRunner (expand/chunk/integrity) + trusted upgrade planner (planUpgrade, manifest/lockfile match) + composeMigrations wiring; SC3-02 lockfile-upgrade and SC3-03 populated-online-migration proven on disposable Postgres.
Prerequisite evidence: WP3-17 campaign reducers; Prisma/Alembic/Django toolchains; disposable container changeproof-t23.
Allowed source/config changes: src/modules/{migrations,dependencies}, src/orchestrator (composeMigrations), tests/migrations/*, tests/native/migration-*.test.ts.
Acceptance checks: tests-first; unit 15/15; native migration-online 2/2 + migration-frameworks 2/2 + sc3-02 1/1 with real DB writes.
Status: done
Evidence: tests/migrations 15/15; native 5/5 on DATABASE_URL changeproof-t23.
Next: Full WP3-10 stays open (hosted authority wiring WP3-21+).
```

### T-24: Reyn

```text
Task ID / parent WP: T-24 / T3-11 / WP3-11
Owner: Reyn
Requirement IDs: FR3-16/17; SC3-01/04/05 coordination paths; NEG3-06
Outcome: coordinateBundle (coverage + digest binding + edge/invariant/mixed-version/guard folding into policy facts; verdict stays in policy) and coordinateRecovery (contradiction supersede, cosmetic-retry refusal, no-progress stop, intent-conflict blocked).
Prerequisite evidence: policy assessTarget/assessBundle precedence; agent ledger (recordAttempt/attachEvidence/transition/assessBranch); core subjectKey.
Allowed source/config changes: src/orchestrator/bundle.ts, src/orchestrator/{errors,index}.ts, tests/orchestrator/t24-bundle-coordination.test.ts.
Acceptance checks: tests-first; 18/18 (NEG3-06 local-pass/edge-fail blocked; SC3-01-shaped verified; SC3-04 invariant block; SC3-05 recovery trace).
Status: done
Evidence: tests/orchestrator/t24-bundle-coordination.test.ts 18/18; tests/orchestrator 52/52 with T-25.
Next: Full WP3-11 stays open (real multi-system SC3-01/04/05 runs need frozen oracle + runners; T-26 owns the suite).
```

### T-25: Reyn

```text
Task ID / parent WP: T-25 / T3-12 / WP3-12
Owner: Reyn
Requirement IDs: FR3-18/19/20; NEG3-14/23/39
Outcome: modules/evidence (canonical render + golden bytes, content-addressed memory/file stores, key-name redaction, bundle manifest assemble/verify) + github PR extension (branch plan, payload, client methods, real Octokit transport code) + orchestrator publication broker (grant/lease/guard/evidence/head gates, idempotent open, lost-response reconciliation).
Prerequisite evidence: T-24 CoordinatedBundle; jobs fencing (assertLeaseWritable/assertEffectIdUnique); github client broker pattern; core GitSha/Sha256/lease/connection contracts.
Allowed source/config changes: src/modules/evidence/index.ts, src/modules/github/{publication,client,index}.ts, src/orchestrator/{publication,errors,index}.ts, tests/{evidence,github,orchestrator,native}/t25-*.
Acceptance checks: tests-first; evidence 17/17, github 31/31, broker 11/11; native file-durability + real-git branch/push/head-drift 2/2. Live GitHub open stays blocked (no authorized App) and is not faked.
Status: done
Evidence: tests/evidence 17/17; tests/github 31/31; tests/orchestrator/t25-publication 11/11; native t25-evidence-git 2/2.
Next: Full WP3-12 stays open (hosted authority backend WP3-21, durable outbox WP3-14, authorized-App live row, viewer).
```

All remaining work now has a named owner in the assignment index above. The index assigns ownership, not permission to run tasks out of dependency order: starting any task marked `tentative` still requires Reyn to confirm exact scope, prerequisite evidence, and file ownership first, and Hoang should not start a second task without agreement.

### Ongoing responsibilities

### Reyn: coordination, decisions, and integration

- Maintain the task board/status table in this file or an agreed tracker, including owner, status, prerequisite evidence, and next action.
- Own specification traceability and decisions that change contracts, policy semantics, threat boundaries, support claims, or proof scope. Record approved technical decisions in `docs/decisions/` and update governing documents when required.
- Coordinate the resolved five-ecosystem scope, qualified guest runner, native dependency-resolution/build-sandbox environment, and Phase-2 service blockers. Record the specific access or decision needed; do not substitute simulations.
- Review Hoang's task header, diff, failure-path tests, boundary impact, and evidence before integration.
- Run or coordinate final integration checks and update the applicable phase report only after actual execution. Keep allocated task status distinct from full-WP status.

### Hoang: assigned implementation tasks

- Execute owned assignments from the index above, one dependency-ready task at a time, and record a §5 task header before implementation.
- Write failure-path tests first for safety-sensitive scope (policy, contracts, guards, verifier, identity/grants, jobs/leases, usage, security boundaries).
- Run and record the applicable §6 checks with exact commands and exit codes; report mock/replay and native results separately.
- Raise blockers instead of weakening proof requirements; never start a `tentative` task before Reyn confirms scope and prerequisites.
- Peer-review Reyn's implementation PRs (task header, diff, boundary impact, evidence) before integration.

### Future work

Phase-2 native/live acceptance and all Phase 3–7 tasks now have named owners in the assignment index, but remain gated by their recorded blockers and the dependency graph. Before any of them starts, Reyn confirms exact scope, prerequisite evidence, and file ownership, and the owner records the §5 task header.

## 5. Task intake and completion template

Copy this header into the task issue/PR description before implementation. Keep the record concise but specific.

```text
Team assignment ID / task ID / parent WP:
Owner:
Requirement IDs:
User-visible or system outcome:
Prerequisite evidence and identities:
Allowed source/config changes:
Input snapshot and intended intervention:
Acceptance checks (positive, negative, native):
Protected oracle / proof scope:
Artifacts expected:
Actual commands + exit codes:
Mock/replay result:
Native/real-runtime result:
Missing checks / blockers:
Allocated task status:
Full-WP status (separate):
Next dependency-ready task:
Reviewer:
```

Task status must use exactly: `not_started`, `in_progress`, `blocked`, or `done`. Product verdicts and engineering task statuses are different and must not be mixed.

A task may be marked `done` only when its observable outcome is proven by the required checks, positive and negative tests pass, strict typecheck and lint/boundaries are clean, required native checks are run, and limitations/missing checks are stated. Do not mark a full WP `done` unless its original dependencies and acceptance criteria are all met.

## 6. Repository verification commands

The following scripts are declared in the current `package.json`. Run relevant checks after changes and record the actual exit code. Native checks are required when the task touches native execution, isolation, or toolchain behavior.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:adapters
pnpm test:graph
pnpm test:dependencies
pnpm test:security
pnpm test:ui
pnpm test:e2e
pnpm test:identity:native
```

`pnpm verify` is also defined and runs typecheck, lint, and the full test suite. `pnpm test:identity:native` runs the whole native config (needs `DATABASE_URL`; last full run recorded phase-5 report §12, 160/162). `pnpm test:runner-security:native` targets the existing `scripts/runner-security-probes.mjs`; Modal qualification stays blocked per its decision record. `pnpm test:negative` is declared but `tests/negative/` does not exist, so it exits 1 (missing check). `pnpm dev` / `pnpm build:ui` serve and build the dashboard (no API proxy in dev). No command may be reported as passing until it was run against the current change.

## 7. Immediate next actions

1. T-42..T-45 are recorded `done` as allocated tasks with phase-6 report evidence (§§2–8); T6-5..T6-8 (T-46..T-49) are `not_started` and `tentative`.
2. Next dependency-ready task: T-46 (T6-5, evidence/publication/export UI). Reyn confirms exact scope, prerequisite evidence, and file ownership before it starts; the owner records a §5 header at that point.
3. Keep every full WP and all of phases 1–6 `in_progress` until their complete acceptance criteria are independently proven. Allocated UI evidence never passes a full WP or a G3 gate.
4. `tentative` tasks do not start without Reyn confirming scope and prerequisites. Record actual commands, exit codes, mock/native distinction, blockers, and the next dependency-ready task.
5. Phase-7 stays ahead: T-54 needs an authorized publication repository and T-56 needs organic pilot/owner access before either can start. Missing access is a recorded blocker, never a reason to simulate.
6. Do not set a daily task or phase quota or start the next phase automatically.

## 8. Source-of-truth references

- [`AGENTS.md`](AGENTS.md): collaboration contract, security rules, task/report format, and definition of done.
- [`SKILL.md`](SKILL.md): development workflow, module playbooks, requirements index, negatives, and dependency summary.
- [`phases/phase-1.md`](phases/phase-1.md): phase-1 scope, tasks, prerequisites, acceptance checks, and blockers.
- [`docs/phase-reports/phase-1.md`](docs/phase-reports/phase-1.md): recorded phase-1 results and remaining gaps.
- [`phases/phase-2.md`](phases/phase-2.md): phase-2 scope, task breakdown, prerequisites, and acceptance checks.
- [`docs/phase-reports/phase-2.md`](docs/phase-reports/phase-2.md): recorded preparation work, verification, and blockers.
- [`docs/phase-reports/phase-3.md`](docs/phase-reports/phase-3.md), [`phase-4.md`](docs/phase-reports/phase-4.md), [`phase-5.md`](docs/phase-reports/phase-5.md), [`phase-6.md`](docs/phase-reports/phase-6.md): later recorded results; phase-6 is the latest.
- [`docs/feature-coverage.md`](docs/feature-coverage.md): phase-6 control → requirement → endpoint → browser-case record.
- [`docs/decisions/phase1-jvm-removal.md`](docs/decisions/phase1-jvm-removal.md): initial owner-directed JVM removal, superseded for the spec mismatch by [`docs/decisions/phase1-ecosystem-scope-resolution.md`](docs/decisions/phase1-ecosystem-scope-resolution.md).
- [`.prepare/BRD.md`](.prepare/BRD.md), [`.prepare/PRD.md`](.prepare/PRD.md), [`.prepare/MVP.md`](.prepare/MVP.md), [`.prepare/architecture.md`](.prepare/architecture.md): normative product and architecture specifications.

When documents conflict, do not guess. Reyn resolves the conflict and records the decision before work depending on it proceeds.
