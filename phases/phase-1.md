# phase-1 — Back-end foundations, discovery and native runner

**Plan revision:** 2 — 24 October 2026.

**Allocated back-end tasks:** WP3-01, WP3-02, WP3-03, WP3-04, WP3-05.
**Outcome:** Versioned contracts/pure policy, strict toolchain/import boundaries, inventory/adapters, qualified runner/dependency broker and evidence-backed impact graph.

**Competition slice:** the Meta hackathon build is a separate bounded playbook, [hackathon-slice](hackathon-slice.md). It is not an eighth release phase and does not change this phase's scope, work packages or gates. A competition demo does not make any WP or G3 gate complete.

## Work and prerequisite evidence

| WP | Required development and local proof |
| --- | --- |
| WP3-01 | Engine + hosted + readiness/reuse/forecast/evaluation contracts/ports; all grants/lease/usage semantics, exact identities and policy precedence. Reject malformed/version-unknown/dangling refs, invalid oracle, mixed candidate and target pass + failed edge. |
| WP3-02 | After 01: executable host/toolchain/CLI/composition root, build and prohibited imports/cycles/transitive escapes; explicit missing-config errors. |
| WP3-03 | After 02: six ecosystems, full L1 structural extraction with pinned version/feature tuples and positive/negative native evidence; new provenLevel starts at none. |
| WP3-04 | After 02: qualified guest runner, real builds/services, dependency broker and preparation reuse; secret/socket/egress/metadata/path/malicious install probes, cleanup/quarantine. Container smoke alone is insufficient. |
| WP3-05 | After 01/03: normalize API/data/event/dependency/config changes; graph provenance, unresolved edges and check-selection coverage facts, with deterministic positive/negative tests. |

Read PRD §3–10/20, MVP §3/7/8/12/21, architecture §2–10/20. Scope includes BR3-01/02/09/12/13/18/19, FR3-01..06/14..16/22/23 and hosted contracts, NFR3-01..11/13. Trace exact requirements per task. Relevant negatives: NEG3-02/03/06..10/24 and forged capability/cache/identity cases. Contributes to G3-01/02/03/13; complete matrix and whole-system gates remain in phase-7.

No product front-end is built here. Real React/Next.js fixture applications and browser probes needed for adapter/runner proof remain back-end engine test inputs, not the ChangeProof dashboard.

## Skill bindings for this phase

| WP / area | Load before coding | Mandatory |
| --- | --- | --- |
| WP3-01 contracts | `code-security`, `secret-serialization` | ⚠ `code-security` |
| WP3-01 policy | `find-bugs` | — |
| WP3-02 toolchain / boundaries | `audit-context-building` | — |
| WP3-03 adapters / capability registry | `supply-chain-risk-auditor`, `semgrep` | ⚠ `semgrep` |
| WP3-04 runner / isolation | `code-security`, `security-model` | ⚠ `code-security` |
| WP3-05 detector / analyzer / graph | `find-bugs` | — |

Full binding matrix: `.claude/SKILL.md` §1 *Skill bindings*.

## Task breakdown — failure-path tests first

One row = one AGENTS §7.1 task header. **Write the tests column before touching implementation.** NEG3 IDs map to `.claude/SKILL.md#ref-negative-cases`.

| Task | Target path | Write these tests FIRST (NEG3-xx) | Then implement / prove |
| --- | --- | --- | --- |
| T1-1 | `src/core/contracts` | **03** changed/invalid oracle · **06** local pass + edge fail · **07** identity drift · **13** budget not reset · **15** incomplete campaign · **18** invalid measurement · **20** cosmetic retry | Versioned Zod schemas with *semantic* validation: dangling refs, closed enums, unknown `schemaVersion` rejected; raw-byte hash kept distinct from canonical structured identity |
| T1-2 | `src/modules/policy` | Precedence rows: stale+pass · full-pass+unknown · partial+invalid oracle · target-pass+edge-fail · mixed candidate · dimension-inconclusive+functional-pass | Pure function: no I/O, model, clock, env, framework branch. Input rejects averaging, voting and model confidence |
| T1-3 | `src/orchestrator`, root toolchain | Forbidden import · import cycle · deep re-export · transitive escape · missing config must raise an explicit error, never a silent default | Strict `tsconfig`, ESLint and dependency-cruiser wired so each negative **fails the build** |
| T1-4 | `modules/adapters/registry` | **09** unsupported version or falsified L3 · **02** unresolved dynamic edge | Six ecosystems registered as capability tuples; new records start `provenLevel = none` |
| T1-5 | one adapter per ecosystem (L1) | **02** reflection/DI edge stays `unresolved` · **09** unsupported config must not return a generic `verified` | ≥1 positive extraction **and** ≥1 negative/unsupported case per tuple, on a pinned version/feature |
| T1-6 | `modules/verifier` runner | **10** malicious source/dependency · **24** host/metadata/secret/other-tenant escape | Qualified guest boundary + cancel/cleanup/quarantine receipts. **Container smoke alone is explicitly insufficient** |
| T1-7 | `modules/dependencies` broker | **10** malicious install script · lockfile drift | Pinned trusted resolution; lockfiles produced by the broker, not by candidate code |
| T1-8 | `detector` / `analyzer` / `graph` | **06** edge silently promoted to `proven` · **02** unknown dropped from output | `proven \| inferred \| unresolved` remains visible; deterministic positive **and** negative graph tests |

## Acceptance commands for this phase

**AGENTS §6: script names are targets.** Open `package.json` first and run only scripts that actually exist. A script that does not exist is recorded as **missing check** — never invent one or assume it passes.

| Check | Command, if present | Exit 0 means |
| --- | --- | --- |
| Strict typecheck | `pnpm typecheck` | `--noEmit` clean across every package |
| Lint **+ boundaries** | `pnpm lint` (ESLint **and** `depcruise --config .dependency-cruiser.cjs`) | No cycles, no deep imports, no transitive escapes |
| Unit / integration | `pnpm test`, or the unit/integration scripts actually listed | Policy precedence rows + contract negatives pass |
| Adapter conformance (**native**) | conformance script, once implemented | Real toolchain extraction — reported **separately** from mock |
| Runner security (**native**) | security/native-runner script, once implemented | Isolation probes + cleanup receipts |

Report mock and native as two separate lines in the task report. For WP3-03 and WP3-04, a native row left as `missing check` blocks `done`.

## Environment blockers to clear before this phase (MVP §12 readiness)

Never substitute a simulation for these; mark the affected gate `blocked` and keep working on independent tasks.

- **Six-ecosystem toolchains.** WP3-03 needs JS/TS, Python, JVM, Go, PHP, .NET. On the current Windows 11 Home host (checked 2026-10-25) `go`, `dotnet` and `mvn` were absent. Install them or WP3-03 is `blocked`.
- **Isolation boundary.** WP3-04 requires a guest VM/microVM or a boundary proven equivalent. Windows 11 Home has no Hyper-V and microVMs are Linux-only, so a WSL2 or remote-Linux runner must be chosen and **recorded as a decision** before any isolation evidence is claimed.
- **PostgreSQL.** `psql` was absent on 2026-10-25; required from WP3-21 (phase-2), so record it now rather than discovering it then.
- **G3-08 / G3-10** remain `blocked` without repository/pilot access — by specification, not by omission.

## Definition of done for this phase

- [ ] WP3-01 — precedence and contract negative tests existed *before* implementation; any semantic change bumped a schema/policy version and has a decision record.
- [ ] WP3-02 — a deliberately forbidden import fails the build (negative proven, then reverted).
- [ ] WP3-03 — all six ecosystems have ≥1 positive **and** ≥1 negative native case; no `provenLevel` above `none` without that evidence.
- [ ] WP3-04 — isolation probe and cleanup receipt exist, and container-only evidence is explicitly **not** claimed.
- [ ] WP3-05 — `proven / inferred / unresolved` edges are distinguishable in real output.
- [ ] Mock and native reported separately with command + exit code; absent scripts listed as `missing check`.
- [ ] `docs/phase-reports/phase-1.md` written to AGENTS §7.1/§7.2, with full-WP status kept separate from allocated-task status.

## Execution contract

This is a target playbook, not proof of execution. A direct `phase-N`, `jalankan phase-N`, `lanjutkan phase-N` or `resume phase-N` request selects that phase (case-insensitive, N = 1–7). Explanation/review or restructuring requests do not execute phases.

1. Read [AGENTS](../.claude/AGENTS.md), [skill](../.claude/SKILL.md), then [BRD](../.prepare/BRD.md) → [PRD](../.prepare/PRD.md) → [MVP](../.prepare/MVP.md) → [architecture](../.prepare/architecture.md), followed by this playbook. The specification directory is the directory containing these files. If it is ``, the application root is its parent; in this extracted package it is the current project root. Do not create a second specification tree or implement product source in `phases/`.
2. Audit Git (if available), actual source, `package.json`, relevant AGENTS, source/config identities, scripts, artifacts and the existing engineering report. Documents/old checkboxes are not proof. Revalidate reused results when relevant identities or grants change.
3. Use [MVP §22](../.prepare/MVP.md#execution-phases) for back-end/front-end/acceptance task allocation and §8 for the unchanged full WP DAG. Write AGENTS §7.1 task headers including prerequisite evidence and allowed changes. A slice may progress with proven task prerequisites; an incomplete full-WP dependency permits only independent preparation, not full WP completion or acceptance.
4. Write failure-path tests first for policy, guard, verifier and security. Preserve protected intent/oracle, independent deterministic verdicts, typed gateway, current grants, tenant isolation, qualified guests, lease/fencing and finite cumulative budget. No source execution on the host/control plane.
5. Run strict typecheck, lint/boundaries, unit/integration and scope-appropriate native checks during every development phase, using actual available scripts. Phase-7 does not defer local tests. Record commands + exit codes and mock/replay separately from real runtime. Missing checks prevent completion of the scope requiring them.
6. Continue all authorized dependency-ready tasks within this phase. Block only affected tasks/gates for missing access, domain decisions, calibration, license or resources; continue independent work. If all remaining tasks are blocked, state concrete needs and next safe action. Do not silently implement other phases or automatically start the next phase.
7. The phase prompt does not authorize paid APIs, external repository mutation/publication, external messages/email, payments, destructive operations or production deployment. Use existing explicit session scope; absent scope, prepare the reviewable result and report the precise dependent live check as blocked. No simulation replaces acceptance.

## Reporting and completion

During actual execution update `docs/phase-reports/phase-1.md` relative to the application root, substituting this phase number. Do not create an execution report merely for changing these playbooks. Record AGENTS §7.1–7.2 headers/reports, requirement IDs, task and full-WP status separately (`not_started | in_progress | blocked | done`), source/config/schema/policy/evaluation identities, positive/negative results, artifact refs, commands + exit codes, mock vs native, missing checks, limitations, blockers/owners and the exact next ready task.

An allocated task is `done` only with its observable result and required checks. A phase may finish its allocated development tasks while a cross-phase WP remains `in_progress`; report that distinction explicitly. Full WP `done` still requires every §8 dependency and all original acceptance, including pending UI and whole-system proof. Gate contributions are not gate passes. Phase-7 is complete only when all full WPs and G3-01..17 are proven against current identities. Invalid/stale evidence or an unavailable required check cannot be labeled success. Preserve old artifacts and historical reports; on resume use the revision-2 mapping in MVP §22.
