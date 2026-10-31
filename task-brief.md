# ChangeProof AI Team Task Brief

**Plan revision:** 2 (24 October 2026)  

**Coordination status last reconciled:** 31 October 2026 (T-03..T-06 completion confirmed; see §4)

**Purpose:** Coordinate work between Reyn and Hoang while preserving the repository's dependency order, verification rules, and honest status reporting.  

**Current verified project status:** Phases 1 and 2 are `in_progress`, not complete. Use the latest recorded evidence in [`docs/phase-reports/phase-2.md`](docs/phase-reports/phase-2.md), alongside the historical Phase-1 report. No full WP or G3 gate is recorded as complete.

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

The latest recorded status is Phase-2 report revision 2, dated 30 October 2026. Phase-1 and Phase-2 remain `in_progress`; preparation evidence does not complete a full WP. Re-run applicable checks after source/config changes.

| Phase / area | Recorded status | Remaining proof / blocker |
|---|---|---|
| Phase-1: WP3-01 contracts and policy (T1-1/T1-2) | `in_progress` | Complete contract/conformance and semantic audit; final policy purity and precedence review. |
| Phase-1: WP3-02 toolchain and boundaries (T1-3) | T1-3 `done`; full WP `in_progress` | Full package/run composition acceptance remains. |
| Phase-1: WP3-03 adapters and registry (T1-4/T1-5) | `in_progress` | T-06 resolves scope to five ecosystems and updates the governing documents. Per-tuple L1 acceptance remains before the adapter matrix is complete. |
| Phase-1: WP3-04 runner and dependency broker (T1-6/T1-7) | `in_progress`; T1-7 preparation `done` | Runner evidence is `container_only`, not qualified VM/microVM-equivalent isolation. Native dependency acquisition and build-sandbox proof remain missing. |
| Phase-1: WP3-05 detector, analyzer, and graph (T1-8) | `in_progress` | Some normalization coverage exists across API/data/event/dependency/config. The full acceptance matrix is not complete; preserve `proven`, `inferred`, and `unresolved`. |
| Phase-2: WP3-15/16/17 (T2-1/T2-2/T2-3) | Preparation `done`; full WPs `in_progress` | Full acceptance depends on incomplete predecessors and required native proof. |
| Phase-2: WP3-06 (T2-4) | Preparation `done`; full WP `blocked` | No frozen oracle or real application/database/broker proof. |
| Phase-2: WP3-21 (T2-5) | Preparation `done`; native proof `blocked` | RLS migration and native test exist, but PostgreSQL container startup did not complete. `pnpm test:identity:native` remains unrun. |
| Phase-2: WP3-22/23/24/28 (T2-6..T2-9) | Preparation `done`; live/durable/billing/delivery proof `blocked` | GitHub authorization, durable hosted store, pricing/vendor decisions, and email delivery infrastructure are unavailable. |
| Gates | No G3 gate is recorded as passed | G3-08/G3-10 remain blocked without authorized publication repository and organic pilot/owner access. |

**Latest recorded verification (Phase-2 report, 30 October 2026):** `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed with exit code 0; the full suite recorded 290 tests across 25 files. These are results recorded for that report's change set, not a fresh run for future changes. The report records native RLS as not run and no native proof for Phase-2. The current `package.json` declares `test:runner-security:native`, but its target `scripts/runner-security-probes.mjs` is absent, so do not report that command as passing until the target is implemented and run.

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
| T-07 | T1-5 / WP3-03 | Adapter L1 remainder: per-tuple matrix for the decided scope | **Hoang** | `not_started` | T-06 resolved scope to five ecosystems; Kotlin/JVM is out of scope. Per-tuple L1 acceptance remains. |
| T-08 | T1-6 / WP3-04 | Runner: qualified VM/microVM-equivalent isolation proof | **Reyn** | `done` | E1 VM probes pass (metadata/socket/cleanup receipts); see `docs/decisions/phase1-runner-qualification-blocked.md`. Limits: single run, no cross-tenant. |
| T-09 | T1-8 / WP3-05 | Graph acceptance-matrix remainder after T-03 | **Hoang** | `not_started` | Ready; T-03 event-flow tests are complete and remaining rows are scoped by the T-02 matrix. |
| T-10 | T2-1 / WP3-15 | Observability full acceptance | **Reyn** | `in_progress` | Preparation `done`; needs WP3-02/04/05 completion + native proof. |
| T-11 | T2-2 / WP3-16 | Verifier campaign full acceptance | **Hoang** | `in_progress` | Preparation `done`; same predecessor and native-proof requirements. |
| T-12 | T2-3 / WP3-17 | Measurement reducers full acceptance | **Reyn** | `in_progress` | Preparation `done`; same predecessor and native-proof requirements. |
| T-13 | T2-4 / WP3-06 | Fixtures/oracle: frozen oracle + real app/DB/broker proof | **Hoang** | `blocked` | No frozen oracle and no real application/database/broker target. |
| T-14 | T2-5 / WP3-21 | Identity/RLS native proof | **Reyn** | `blocked` | PostgreSQL container startup did not complete; `pnpm test:identity:native` unrun. |
| T-15 | T2-6 / WP3-22 | GitHub live proof (webhooks, installation, broker) | **Hoang** | `blocked` | No GitHub authorization/installation; no `octokit` integration yet. |
| T-16 | T2-7 / WP3-23 | Jobs: durable dispatcher + hosted store | **Reyn** | `blocked` | Durable hosted store pending. |
| T-17 | T2-8 / WP3-24 | Usage: atomic store + billing settlement | **Hoang** | `blocked` | Pricing/vendor decisions pending. |
| T-18 | T2-9 / WP3-28 | Email/session delivery proof | **Reyn** | `blocked` | Authorized delivery infrastructure unavailable. |
| T-19 | T3-1 / WP3-07 | Agent fix loop (hypothesis ledger, candidate revision) | **Hoang** | `not_started` | `tentative` — needs Phase-2 predecessors + authorized model/tools. |
| T-20 | T3-2 / WP3-07 | Model broker + typed mutation gateway | **Reyn** | `not_started` | `tentative` — model credential and security-boundary decisions required. |
| T-21 | T3-3 / WP3-08 | JS/TS, Python, JVM L3 adapters | **Hoang** | `not_started` | `tentative` — after WP3-07 and full WP3-03. |
| T-22 | T3-4 / WP3-09 | Go/PHP L2 adapters | **Reyn** | `not_started` | `tentative` — after WP3-07. |
| T-23 | T3-10 / WP3-10 | Migrations + dependency broker integration | **Hoang** | `not_started` | `tentative` — after WP3-08. |
| T-24 | T3-11 / WP3-11 | Orchestrator bundle coordination + recovery | **Reyn** | `not_started` | `tentative` — after WP3-10/17. |
| T-25 | T3-12 / WP3-12 | Evidence store + publication broker | **Hoang** | `not_started` | `tentative` — after WP3-11/22. |
| T-26 | T3-18 / WP3-18 | Complex scenario suite (SC3-03/04/07/08/09) | **Reyn** | `not_started` | `tentative` — after WP3-11/17. |
| T-27 | T4-1 / WP3-27 | Public site API + content | **Hoang** | `not_started` | `tentative` — after WP3-25 services proven. |
| T-28 | T4-2 / WP3-25 | Run-lifecycle API | **Reyn** | `not_started` | `tentative` — needs proven WP3-12/22/23/24/28 services. |
| T-29 | T4-3 / WP3-29 | Queries + notifications | **Hoang** | `not_started` | `tentative`. |
| T-30 | T4-4 / WP3-30 | Support + collaboration services | **Reyn** | `not_started` | `tentative`. |
| T-31 | T4-5 / WP3-31 | BYOK + self-host deployment tooling | **Hoang** | `not_started` | `tentative`. |
| T-32 | T4-6 / WP3-32 | SAML/SCIM + GitLab/Bitbucket adapters | **Reyn** | `not_started` | `tentative`. |
| T-33 | T5-1 / WP3-13 | Bench harness + evaluation contracts | **Hoang** | `not_started` | `tentative` — uses WP3-08/09/10/11/12/18 task evidence. |
| T-34 | T5-2 / WP3-19 | Multi-region supervisor | **Reyn** | `not_started` | `tentative` — needs WP3-18. |
| T-35 | T5-3 / WP3-19 | Long-horizon profiler | **Hoang** | `not_started` | `tentative` — needs WP3-18. |
| T-36 | T5-4 / WP3-20 | Legacy fixtures / recovery | **Reyn** | `not_started` | `tentative` — needs WP3-15/18. |
| T-37 | T5-5 / WP3-33 | Finite schedule/model checker | **Hoang** | `not_started` | `tentative`. |
| T-38 | T5-6 / WP3-33 | TB-scale / cross-engine migration | **Reyn** | `not_started` | `tentative` — after WP3-10/18. |
| T-39 | T5-7 / WP3-34 | Cloud deployment automation | **Hoang** | `not_started` | `tentative` — after WP3-03/31/33. |
| T-40 | T5-8 / WP3-26 | Service operations (capacity/drain/restore/billing) | **Reyn** | `not_started` | `tentative`. |
| T-41 | T5-9 / WP3-14 | Organic pilot preparation | **Hoang** | `not_started` | `tentative` — needs owner/pilot access decisions. |
| T-42 | T6-1 / WP3-27 | Design tokens + responsive shell | **Reyn** | `not_started` | `tentative` — phase-6; extract tokens from the active mockup skin. |
| T-43 | T6-2 / WP3-27 | Public site front-end | **Hoang** | `not_started` | `tentative`. |
| T-44 | T6-3 / WP3-21/22/28 | Auth / onboarding / settings UI | **Reyn** | `not_started` | `tentative`. |
| T-45 | T6-4 / WP3-25 | Run journey UI | **Hoang** | `not_started` | `tentative`. |
| T-46 | T6-5 / WP3-12/29 | Evidence / publication / export UI | **Reyn** | `not_started` | `tentative`. |
| T-47 | T6-6 / WP3-29 | Notifications / search UI | **Hoang** | `not_started` | `tentative`. |
| T-48 | T6-7 / WP3-30 | Support / collaboration UI | **Reyn** | `not_started` | `tentative`. |
| T-49 | T6-8 / WP3-24/31/32 | Billing / BYOK / enterprise UI | **Hoang** | `not_started` | `tentative`. |
| T-50 | T7-1 / G3-01, G3-02 | Contract/identity/policy/import negatives + qualified guest probes | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-51 | T7-2 / G3-03 | Six-ecosystem L1/L2/L3 tuple matrix | **Hoang** | `not_started` | `tentative` — acceptance phase. |
| T-52 | T7-3 / G3-04, G3-05, G3-11 | Frozen baselines, independent oracle, causality, real scenarios | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-53 | T7-4 / G3-06, G3-13 | NEG3-01..40 mapping + concurrent-tenant isolation | **Hoang** | `not_started` | `tentative` — acceptance phase. |
| T-54 | T7-5 / G3-07, G3-08 | Clean full-campaign reproduction + authorized publication | **Reyn** | `not_started` | `tentative` — blocked without an authorized publication repository. |
| T-55 | T7-6 / G3-09 | Frozen dev/holdout evaluation (B0/B1/B2/Full + ablations) | **Hoang** | `not_started` | `tentative` — acceptance phase. |
| T-56 | T7-7 / G3-10 | Organic pilot acceptance (SC3-06) | **Reyn** | `not_started` | `tentative` — blocked without organic pilot/owner access. |
| T-57 | T7-8 / G3-12, G3-15 | Full real browser journey | **Hoang** | `not_started` | `tentative` — acceptance phase. |
| T-58 | T7-9 / G3-14 | Capacity/fairness/outage/restore + billing lifecycle | **Reyn** | `not_started` | `tentative` — acceptance phase. |
| T-59 | T7-10 / G3-16 | Hosted/self-host/BYOK + provider publication matrix | **Hoang** | `not_started` | `tentative` — acceptance phase. |
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
Next: T-09 is ready to address the remaining data/config acceptance-matrix rows. Full WP3-05 remains in progress.
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
Outcome: Per-tuple L1 acceptance is complete for every ecosystem in the scope decided by T-06: at least one positive extraction and one negative/unsupported case per (ecosystem, framework, version, feature) tuple on a pinned version, including the unresolved Kotlin/JVM case or its recorded removal.
Prerequisite evidence: Phase-1 report T1-5 row — native positive/negative tests pass for TypeScript, Python, Java, PHP, Go (go1.27.3) and .NET (SDK 10.0.403). The historical Kotlin toolchain blocker is no longer applicable: T-06 removed JVM/Kotlin from scope.
Allowed source/config changes: src/modules/adapters/* and tests/adapters/* only. No provenLevel promotion without evidence; unsupported cases must not return a generic verified.
Acceptance checks: Failure-path tests first; native toolchain checks run where the toolchain exists and are reported separately from mock/replay results. Run pnpm test:adapters, pnpm typecheck, pnpm lint, pnpm test after changes; record commands and exit codes. A missing toolchain is a recorded blocker, not a skipped check.
Status: not_started
Next: Start per-tuple L1 acceptance for the five ecosystems and report native results separately; no Kotlin/JVM toolchain is required.
```

### T-08: Reyn

```text
Task ID / parent WP: T-08 / T1-6 / WP3-04
Owner: Reyn
Requirement IDs: NFR3-04..08; NEG3-10/24
Outcome: A decision and evidence path for qualified guest isolation: either a host with VM/microVM capability is provisioned and the qualification probes run there, or the requirement is recorded as blocked with the exact missing environment. Includes implementing the missing scripts/runner-security-probes.mjs target or removing the dangling script declaration.
Prerequisite evidence: Phase-1 report T1-6 row — runner profile, guest plan, oracle mount checks, cleanup/quarantine tests, Docker native container probes 6/6; container-only is explicitly insufficient; no Hyper-V on the current host.
Allowed source/config changes: scripts/, modules/verifier runner configuration, and environment/decision records. No weakening of isolation requirements; container smoke remains non-qualifying.
Acceptance checks: Qualified-boundary probes with escape/cancel/cleanup/quarantine receipts on the qualified environment, or a specific recorded blocker. Native results reported separately; record commands and exit codes.
Status: done (E1 VM probes pass with receipts; limits recorded in the decision)
Next: None for T-08. WP3-04 remainder (native dependency broker proof) stays separate.
```

### T-09: Hoang

```text
Task ID / parent WP: T-09 / T1-8 / WP3-05
Owner: Hoang
Requirement IDs: BR3-02; FR3-04/05/06; NEG3-02/06
Outcome: The remaining rows of the T-02 acceptance matrix are closed: data (table/column relationship and impact cases) and config (deployment-requirement edge and impact path) acceptance tests, plus any rows T-03 leaves open. proven, inferred, and unresolved stay visible; unknowns are never dropped or silently promoted.
Prerequisite evidence: T-02 acceptance matrix recorded above; T-03 reviewed and integrated; existing tests/graph/detector-analyzer-graph.test.ts coverage.
Allowed source/config changes: tests/graph/* and the corresponding detector/analyzer/graph implementation only when a failing test demonstrates the need. No policy/oracle/threshold changes.
Acceptance checks: Tests first, positive and negative per matrix row. Run pnpm test:graph, pnpm typecheck, pnpm lint, pnpm test after changes; record commands and exit codes. Synthetic tests are not native/runtime proof.
Status: not_started (ready; T-03 event-flow acceptance is complete)
Next: Open a reviewable PR with the task header, matrix rows closed, and test results. Reyn reviews before integration.
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
pnpm test:identity:native
```

`pnpm verify` is also defined and runs typecheck, lint, and the full test suite. `pnpm test:identity:native` is declared but has not passed; the Phase-2 report records its PostgreSQL startup blocker. `pnpm test:runner-security:native` is declared but its target script is missing. Neither command may be reported as passing until the target is runnable and the check succeeds. Do not state that a command passed unless it was run against the current change.

## 7. Immediate next actions

1. T-03 through T-06 are recorded `done`; T-03 event-flow tests, T-04 contract matrix, T-05 policy audit, and the T-06 five-ecosystem decision have corresponding repository evidence.
2. T-09 is ready for the remaining WP3-05 data/config acceptance-matrix rows. T-07 is ready for per-tuple L1 acceptance across the five ecosystems; JVM/Kotlin is out of scope per T-06.
3. Keep full WP3-01, WP3-03, WP3-05 and both phases `in_progress` until their complete acceptance criteria are independently proven. T-08 remains `blocked` on qualified guest isolation.
4. `tentative` tasks do not start without Reyn confirming scope and prerequisites. Record actual commands, exit codes, mock/native distinction, blockers, and the next dependency-ready task.
5. Track Phase-2 blockers separately. T2-5 RLS (T-14, Reyn) is the next documented native candidate and should only be resumed if the Docker container-start issue can be addressed safely; do not treat preparation tests as native proof.
6. Do not set a daily task or phase quota or start the next phase automatically.

## 8. Source-of-truth references

- [`AGENTS.md`](AGENTS.md): collaboration contract, security rules, task/report format, and definition of done.
- [`SKILL.md`](SKILL.md): development workflow, module playbooks, requirements index, negatives, and dependency summary.
- [`phases/phase-1.md`](phases/phase-1.md): phase-1 scope, tasks, prerequisites, acceptance checks, and blockers.
- [`docs/phase-reports/phase-1.md`](docs/phase-reports/phase-1.md): recorded phase-1 results and remaining gaps.
- [`phases/phase-2.md`](phases/phase-2.md): phase-2 scope, task breakdown, prerequisites, and acceptance checks.
- [`docs/phase-reports/phase-2.md`](docs/phase-reports/phase-2.md): latest recorded preparation work, verification, and blockers.
- [`docs/decisions/phase1-jvm-removal.md`](docs/decisions/phase1-jvm-removal.md): initial owner-directed JVM removal, superseded for the spec mismatch by [`docs/decisions/phase1-ecosystem-scope-resolution.md`](docs/decisions/phase1-ecosystem-scope-resolution.md).
- [`.prepare/BRD.md`](.prepare/BRD.md), [`.prepare/PRD.md`](.prepare/PRD.md), [`.prepare/MVP.md`](.prepare/MVP.md), [`.prepare/architecture.md`](.prepare/architecture.md): normative product and architecture specifications.

When documents conflict, do not guess. Reyn resolves the conflict and records the decision before work depending on it proceeds.
