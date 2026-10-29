# ChangeProof AI Team Task Brief

**Plan revision:** 2 (24 October 2026)  
**Purpose:** Coordinate work between Reyn and Hoang while preserving the repository's dependency order, verification rules, and honest status reporting.  
**Current verified project status:** Phase-1 is `in_progress`, not complete. See [`docs/phase-reports/phase-1.md`](docs/phase-reports/phase-1.md) for the recorded evidence and blockers.  
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

## 3. Current phase-1 status and remaining work

Phase-1 covers back-end foundations for WP3-01 through WP3-05. Its current report records local checks as passed at report-writing time, but the phase and the affected full WPs remain incomplete. Re-run required checks after any new source/config changes.

| Area | Recorded status | Remaining proof / blocker |
|---|---|---|
| WP3-01 contracts and policy (T1-1, T1-2) | `in_progress` | Complete contract/conformance and semantic audit; final policy purity and precedence review. |
| WP3-02 toolchain and boundaries (T1-3) | Task `done`; full WP `in_progress` | Complete package/run composition acceptance; revalidate after changes. |
| WP3-03 adapters and registry (T1-4, T1-5) | `in_progress` | Native positive and negative extraction for Go, .NET, and Kotlin is not proven. Existing report says those toolchains were absent. Do not claim all six ecosystem L1 coverage. |
| WP3-04 runner and dependency broker (T1-6, T1-7) | `in_progress`; T1-7 task `done` | Current runner evidence is `container_only`, not qualified VM/microVM-equivalent isolation. Native dependency acquisition/install/build-sandbox proof and trusted resolver/lockfile integration remain missing. |
| WP3-05 detector, analyzer, and graph (T1-8) | `in_progress` | Complete the API/data/event/dependency/config extraction acceptance matrix; preserve unresolved/inferred edges. |
| Gates | No G3 gate is recorded as passed | G3-08 and G3-10 remain blocked without authorized publication repository and organic pilot/owner access. |

**Recorded verification baseline (26 October 2026):** `pnpm typecheck`, `pnpm lint`, `pnpm test` (187 tests), `pnpm test:adapters`, `pnpm test:graph`, `pnpm test:dependencies`, `pnpm test:security`, and `pnpm test:runner-security:native` were reported with exit code 0. The native runner check reported 6/6 denial probes on Docker Desktop 29.0.1, with `boundaryClass=container_only`. Go, .NET, and Kotlin toolchain checks were reported unavailable. These are historical recorded results, not a guarantee after later changes; inspect the report and rerun as needed.

## 4. Suggested assignment split

This is a starting allocation, not permission to bypass prerequisites. Reyn may reassign tasks after checking availability and prerequisites. Hoang should take only one task at a time unless both contributors explicitly agree otherwise.

### Reyn: coordination, decisions, and integration

- Maintain the task board/status table in this file or an agreed tracker, including owner, status, prerequisite evidence, and next action.
- Own specification traceability and decisions that change contracts, policy semantics, threat boundaries, support claims, or proof scope. Record approved technical decisions in `docs/decisions/` and update governing documents when required.
- Coordinate resolution of environment blockers: Go/.NET/Kotlin toolchains, qualified guest runner, and native dependency-resolution/build-sandbox environment. Record what access or decision is required; do not substitute simulations.
- Review Hoang's task header, diff, failure-path tests, boundary impact, and evidence before integration.
- Run or coordinate final integration checks and update `docs/phase-reports/phase-1.md` only after actual execution. Keep allocated task status distinct from full-WP status.

### Hoang: implementation tasks, by readiness

Choose the next task only after Reyn confirms its exact scope and prerequisite evidence:

1. **WP3-05 acceptance-matrix extension (T1-8):** inspect existing detector/analyzer/graph coverage; identify missing API/data/event/dependency/config cases against the PRD/MVP; add failing positive and negative tests first; implement only the missing normalization/provenance behavior; keep `proven`, `inferred`, and `unresolved` distinguishable. Do not claim WP3-05 complete until its full acceptance matrix is proven.
2. **WP3-01 contract/policy audit (T1-1/T1-2):** only with explicit agreement on files and review scope. Verify semantic validation, versioning, identity handling, all required precedence rows, and purity. Any semantic changes require affected tests, version/decision review, and fresh verification.
3. **WP3-03 native adapter cases:** only after the required toolchain is available and pinned. Add one positive and one negative/unsupported native case per assigned ecosystem and pinned tuple. Never raise `provenLevel` based on registration or compilation alone.
4. **WP3-04 native dependency broker proof:** only in an authorized, isolated environment. Exercise real trusted resolution/acquisition and install/build behavior with malicious-script and lockfile-drift negatives. Do not run customer-controlled scripts on the host.

If these tasks are blocked, Hoang should write down the exact missing prerequisite and continue only with an independent task approved by Reyn.

## 5. Task intake and completion template

Copy this header into the task issue/PR description before implementation. Keep the record concise but specific.

```text
Task ID / parent WP:
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

The following scripts were confirmed in the current `package.json`. Run relevant checks after changes and record the actual exit code. Native checks are required when the task touches native execution, isolation, or toolchain behavior.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:adapters
pnpm test:graph
pnpm test:dependencies
pnpm test:security
pnpm test:runner-security:native
```

`pnpm verify` is also defined and runs typecheck, lint, and the full test suite. It does not replace scope-specific native checks. Do not state that a command passed unless it was run against the current change.

## 7. Immediate next actions

1. Reyn confirms whether the team wants to continue phase-1 and assigns one owner for the next task.
2. Agree on exact task scope and inspect current source/tests before coding. A reasonable first candidate is the WP3-05 acceptance-matrix extension, subject to prerequisite review.
3. Check environment/access needed for Go, .NET, Kotlin, qualified VM/microVM-equivalent isolation, and native dependency acquisition. Record each as a concrete blocker until available.
4. Implement the assigned task using the intake template, then review and rerun applicable checks.
5. Update the phase-1 report with actual evidence and keep phase status `in_progress` until every phase criterion is met. Do not begin phase-2 automatically.

## 8. Source-of-truth references

- [`AGENTS.md`](AGENTS.md): collaboration contract, security rules, task/report format, and definition of done.
- [`SKILL.md`](SKILL.md): development workflow, module playbooks, requirements index, negatives, and dependency summary.
- [`phases/phase-1.md`](phases/phase-1.md): phase-1 scope, tasks, prerequisites, acceptance checks, and blockers.
- [`docs/phase-reports/phase-1.md`](docs/phase-reports/phase-1.md): recorded phase-1 results and remaining gaps.
- [`.prepare/BRD.md`](.prepare/BRD.md), [`.prepare/PRD.md`](.prepare/PRD.md), [`.prepare/MVP.md`](.prepare/MVP.md), [`.prepare/architecture.md`](.prepare/architecture.md): normative product and architecture specifications.

When documents conflict, do not guess. Reyn resolves the conflict and records the decision before work depending on it proceeds.
