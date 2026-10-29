# phase-3 — Back-end autonomous repair, evidence and publication

**Plan revision:** 2 — 24 October 2026.

**Allocated back-end tasks:** WP3-07, WP3-08, WP3-09, WP3-10, WP3-11, WP3-12, WP3-18.
**Outcome:** One guarded reasoning engine, framework remediation, coordinated bundle verification, immutable evidence and publication services.

**Competition slice:** the Meta hackathon build is a separate bounded playbook, [hackathon-slice](hackathon-slice.md). It is not an eighth release phase and does not change this phase's scope, work packages or gates. A competition demo does not make any WP or G3 gate complete.

## Work and prerequisite evidence

WP3-06/16/17 baseline/campaign evidence must be valid before the fixer; WP3-12 also requires WP3-22. Do not substitute reference patches/replay for live-model capability.

| WP | Required development and local proof |
| --- | --- |
| WP3-07 | After 06: actual authorized model/tools, verified Muse Spark 1.3 identity/access/config, allowlisted context, hypothesis ledger, typed probes/gateway/guard, finite budget and no-progress stopper. Model access/paid-call permission gaps remain explicit. |
| WP3-08 | After 07: JS/TS/Python/JVM L3 adapter paths with native API/business/browser fixture proof and negatives per tuple. Fixture UI is customer-system proof, not product dashboard work. |
| WP3-09 | After 07: Go/PHP Gin/Fiber/Laravel L2 valid nontrivial candidates + rejected cases; honest unsupported verification and complete minimum conformance. |
| WP3-10 | After 08: migration/dependency adapters, trusted lockfile resolution, Prisma/SQLAlchemy/Hibernate/Pydantic, active writer/backfill/reconciliation and real SC3-02/03. |
| WP3-11 | After 10/17: SC3-01/04/05 coordinated targets/edges/invariants/mixed versions, actual contradictory evidence and adaptive recovery; no engineered first-proposal failure. New candidate/scope requires fresh affected proof. |
| WP3-12 | After 11/22: immutable private all-trial/C/P/R/D store, deterministic rendering/data contracts, authenticated proxy, full-campaign reproduction jobs, fenced/idempotent PR/CI broker and lost-response reconciliation. Product viewer UI is phase-6; authorized live publication remains an original acceptance obligation. |
| WP3-18 | After 11/17: complex SC3-03/04 variants, SC3-07/08/09, NEG3-15..20 with independent native campaign receipts. Diagnosis-only is not repair success. |

Read PRD §5–10/13/20, MVP §3/5–8/11/17/21, architecture §4/6–10/20. Scope: BR3-03..10/12..16; FR3-07..20/22..28; NFR3-01..11. Relevant NEG3-01..20 plus current-grant/publication negatives. Record Meta input/evidence/probe/result/ledger revisions without hidden chain-of-thought. Contributes to G3-03..08/11; viewer and full evaluation closure in phases 6–7.

## Skill bindings for this phase

| WP / area | Load before coding | Mandatory |
| --- | --- | --- |
| WP3-07 agent / gateway / patch guard | **`llm-security`**, `code-security` | ⚠ `llm-security` |
| WP3-08 / WP3-09 adapters L3/L2 | `supply-chain-risk-auditor`, `semgrep` | ⚠ `semgrep` |
| WP3-10 migrations / dependency broker | `supply-chain-risk-auditor` | — |
| WP3-11 coordinated bundle / recovery | `find-bugs` | — |
| WP3-12 evidence / publication | `secret-serialization`, `code-security` | ⚠ `code-security` |
| WP3-18 complex scenarios | `security-model` | — |

Full binding matrix: `SKILL.md` §1 *Skill bindings*. **Do not** load `claude-api` — the target model is Meta Muse Spark 1.3.

## Task breakdown — failure-path tests first

**Tests before implementation.** NEG3 IDs map to `SKILL.md#ref-negative-cases`.

| Task | Target path | Write these tests FIRST (NEG3-xx) | Then implement / prove |
| --- | --- | --- | --- |
| T3-1 | `modules/agent` fix loop | **01** no replacement / conflicting intent → `unverified` · **04** candidate deletes auth or tests · **19** oracle derived from observed bug · **20** cosmetic retry counted as progress | Hypothesis ledger; no-progress stopper compares *hypothesis/candidate/failure signatures + new evidence* — never token or line counts |
| T3-2 | model broker + typed gateway | **10** model/tool leakage of secrets or egress · **13** budget exhaustion must not reset | Least-context prompts, cost ceiling, credentials never reach tools/tests; mutations only through path allowlist |
| T3-3 | JS/TS · Python · JVM L3 adapters | **02** unresolved dynamic edge · **09** unsupported feature must not return generic `verified` | ≥2 positive regressions with different patterns + 1 negative/ambiguous + 1 no-impact control, on real runtime |
| T3-4 | Go / PHP L2 adapters | **09** rejected/unsupported case | ≥1 non-trivial valid candidate + ≥1 rejected case; **L2 output stays `candidate`, never `fixed`** |
| T3-10 | `modules/migrations` + broker | **05** rows/precision/tenant mapping lost → data-integrity failure · **07** producer/consumer drift | Trusted lockfile resolution; active-writer/backfill reconciliation; SC3-02/03 |
| T3-11 | orchestrator bundle + recovery | **06** local target passes but cross-service/mixed-version fails → bundle not `verified` · **12** some PRs fail | Coordinated targets/edges/invariants/mixed versions; adaptive recovery on **real** contradictory evidence |
| T3-12 | `modules/evidence` + publication | **14** reviewer cannot reach evidence / wrong hash → publication blocked · **23** duplicate publish · **39** wrong head/CI | Content-addressed immutable manifest; fenced idempotent PR/CI broker with reconciliation |
| T3-18 | complex scenario suite | **08** model outage / native timeout / OOM → `unverified` + cleanup · **15** one green run ≠ campaign | Independent native campaign receipts per SC3-03/04/07/08/09; diagnosis-only is not repair success |

## Acceptance commands for this phase

**Open `package.json` first; run only scripts that actually exist.** Absent script = **missing check**.

| Check | Command, if present | Exit 0 means |
| --- | --- | --- |
| Strict typecheck | `pnpm typecheck` | Clean across packages |
| Lint **+ boundaries** | `pnpm lint` | No boundary violations from agent/evidence wiring |
| Unit / integration | `pnpm test` | Guard, gateway and precedence negatives pass |
| Adapter conformance (**native**) | conformance script | Real framework builds + HTTP/browser/DB cases |
| Model smoke (**live**) | model smoke script | **Live** Meta call with tool trace — `replay_model` does not satisfy AI-repair acceptance |
| Campaign (**native**) | campaign/bench script | Pre-registered plan, all-trial receipts |

Mock, replay and live must be labelled distinctly (AGENTS §4: `executionMode` and `proposalMode` are not interchangeable).

## Definition of done for this phase

- [ ] WP3-07 — a real model call produced a proposal; the guard rejected at least one forbidden mutation (NEG3-04), report-only.
- [ ] WP3-08 / 09 — capability records promoted only through conformance + real evidence; no `provenLevel` raise from "it compiled".
- [ ] WP3-10 — migration negative proved data integrity holds, on a real database.
- [ ] WP3-11 — a local-pass/edge-fail bundle evaluated to `incomplete`/`blocked`, not `verified`.
- [ ] WP3-12 — evidence manifest carries the exact candidate digest; a changed candidate required fresh proof.
- [ ] WP3-18 — a single green run reported `campaign_incomplete`, not a positive claim.
- [ ] Live-model vs replay results reported separately with command + exit code.
- [ ] `docs/phase-reports/phase-3.md` written to AGENTS §7.1/§7.2.

## Execution contract

This is a target playbook, not proof of execution. A direct `phase-N`, `jalankan phase-N`, `lanjutkan phase-N` or `resume phase-N` request selects that phase (case-insensitive, N = 1–7). Explanation/review or restructuring requests do not execute phases.

1. Read [AGENTS](../AGENTS.md), [skill](../SKILL.md), then [BRD](../.prepare/BRD.md) → [PRD](../.prepare/PRD.md) → [MVP](../.prepare/MVP.md) → [architecture](../.prepare/architecture.md), followed by this playbook. The specification directory is the directory containing these files. If it is ``, the application root is its parent; in this extracted package it is the current project root. Do not create a second specification tree or implement product source in `phases/`.
2. Audit Git (if available), actual source, `package.json`, relevant AGENTS, source/config identities, scripts, artifacts and the existing engineering report. Documents/old checkboxes are not proof. Revalidate reused results when relevant identities or grants change.
3. Use [MVP §22](../.prepare/MVP.md#execution-phases) for back-end/front-end/acceptance task allocation and §8 for the unchanged full WP DAG. Write AGENTS §7.1 task headers including prerequisite evidence and allowed changes. A slice may progress with proven task prerequisites; an incomplete full-WP dependency permits only independent preparation, not full WP completion or acceptance.
4. Write failure-path tests first for policy, guard, verifier and security. Preserve protected intent/oracle, independent deterministic verdicts, typed gateway, current grants, tenant isolation, qualified guests, lease/fencing and finite cumulative budget. No source execution on the host/control plane.
5. Run strict typecheck, lint/boundaries, unit/integration and scope-appropriate native checks during every development phase, using actual available scripts. Phase-7 does not defer local tests. Record commands + exit codes and mock/replay separately from real runtime. Missing checks prevent completion of the scope requiring them.
6. Continue all authorized dependency-ready tasks within this phase. Block only affected tasks/gates for missing access, domain decisions, calibration, license or resources; continue independent work. If all remaining tasks are blocked, state concrete needs and next safe action. Do not silently implement other phases or automatically start the next phase.
7. The phase prompt does not authorize paid APIs, external repository mutation/publication, external messages/email, payments, destructive operations or production deployment. Use existing explicit session scope; absent scope, prepare the reviewable result and report the precise dependent live check as blocked. No simulation replaces acceptance.

## Reporting and completion

During actual execution update `docs/phase-reports/phase-3.md` relative to the application root, substituting this phase number. Do not create an execution report merely for changing these playbooks. Record AGENTS §7.1–7.2 headers/reports, requirement IDs, task and full-WP status separately (`not_started | in_progress | blocked | done`), source/config/schema/policy/evaluation identities, positive/negative results, artifact refs, commands + exit codes, mock vs native, missing checks, limitations, blockers/owners and the exact next ready task.

An allocated task is `done` only with its observable result and required checks. A phase may finish its allocated development tasks while a cross-phase WP remains `in_progress`; report that distinction explicitly. Full WP `done` still requires every §8 dependency and all original acceptance, including pending UI and whole-system proof. Gate contributions are not gate passes. Phase-7 is complete only when all full WPs and G3-01..17 are proven against current identities. Invalid/stale evidence or an unavailable required check cannot be labeled success. Preserve old artifacts and historical reports; on resume use the revision-2 mapping in MVP §22.
