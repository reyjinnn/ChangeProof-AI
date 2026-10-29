# phase-5 — Back-end complex capabilities and operational readiness

**Plan revision:** 2 — 24 October 2026.

**Allocated back-end tasks:** WP3-13, WP3-19, WP3-20, WP3-33, WP3-34, WP3-26, WP3-14.
**Outcome:** All remaining complex capability implementations, operational controls, distribution automation and qualification tooling exist with local/native proof; system-wide acceptance is prepared for phase-7.

**Competition slice:** the Meta hackathon build is a separate bounded playbook, [hackathon-slice](hackathon-slice.md). It is not an eighth release phase and does not change this phase's scope, work packages or gates. A competition demo does not make any WP or G3 gate complete.

## Work and prerequisite evidence

WP3-13 tooling uses 08/09/10/11/12/18 task evidence; 19 needs 18; 20 needs 15/18; 33 needs 10/18. WP3-34 automation preparation uses 03/31/33 back-end task evidence, while full qualification still waits for full WP3-31. WP3-26 operational development uses 13 tooling and 25/27/29/30 service evidence; full WP dependencies await UI/testing. WP3-14 here is only authorized pilot onboarding/data permissions/measurement preparation, not final impact acceptance. Preserve full §8 DAG; incomplete full-WP prerequisites allow independent preparation only.

| WP | Required development and local proof |
| --- | --- |
| WP3-13 | Certification/evaluation harness, versioned dev/holdout boundaries, frozen B0/B1/B2/Full/ablation definitions, identical model/budget/final evaluator, denominator/cost/error accounting and security/regression fixtures. Develop and test on dev material; final frozen evaluation is phase-7. |
| WP3-19 | Implement qualified multi-region/consensus/partition/failover and long-horizon profiler/schedule support, real fault/heal/journal checks, approved consistency/RPO/RTO/horizon and finite budgets. Full SC3-10/11 campaigns in phase-7; shorter local runs do not prove full scope. |
| WP3-20 | Trusted domain/intent/corpus authoring, independent known-valid legacy baseline/oracle and actual supported repair path; unknown behavior stays diagnosis-only. No invented domain approvals; broader qualified recovery accepted in phase-7. |
| WP3-33 | Finite model/schedule exploration, native counterexample validation, TB-scale/cross-engine migration support, active writer/recovery/reconciliation and platform profiling; bounds and physical data requirements preserved. Local probes now; registered full-volume/full-horizon proof in phase-7. |
| WP3-34 | AWS/Azure/Google Cloud provision/restore/delete/teardown automation and full framework/ORM/DB/broker/platform catalog tooling; Windows/Linux/macOS binary profiles. Config rendering alone does not prove deployment. Real local/native checks per changed profile now; full per-catalog campaigns in phase-7. |
| WP3-26 | Capacity/fairness/drain/quarantine/outage/recovery, backup + tombstone-before-traffic restore, privacy/deletion/retention, free+paid billing operations, service calibration and runbooks/license/build provenance. No silent license/vendor/SLO/pricing choice. Local concurrent-org/security/recovery tests now; release campaigns in phase-7. |
| WP3-14 | Prepare authorized organic pilot scope, owner/domain access, SC3-06 source provenance, outcome/active-time/review/cohort cost measurement and validation procedure. No owner adoption or production impact claimed from preparation. |

Read BRD §9/10/13/19/20; PRD §7/9/13/17/19/20; MVP §3/5–21 and all gates; architecture §11/15–20. Scope: all remaining BR3/FR3/NFR3 requirements, specifically FR3-11/17/21/24/26..28/36/43..45. Relevant NEG3-01..40, especially 26..28/36..40, unequal B2 budgets/oracle leakage and selective omissions. No whole-system release acceptance is claimed here. If local changes invalidate earlier receipts, record affected identities and requalification requirements before phase-7; an opened holdout cannot be called untouched.

## Skill bindings for this phase

| WP / area | Load before coding | Mandatory |
| --- | --- | --- |
| WP3-13 evaluation / B0-B1-B2-Full | `changeproof-benchmark-eval` in build repo; otherwise `find-bugs` + `secret-serialization` | — |
| WP3-19 multi-region / long-soak | `code-security`, `security-model` | ⚠ `code-security` |
| WP3-20 legacy recovery | `audit-context-building`, `find-bugs` | — |
| WP3-33 model checking / TB migration | `code-security`, `semgrep` | ⚠ `code-security` |
| WP3-34 multi-cloud / catalog | `supply-chain-risk-auditor`, `code-security` | ⚠ `code-security` |
| WP3-26 operations / recovery / billing | `code-security`, `semgrep` | ⚠ `code-security` |
| WP3-14 organic pilot | `audit-context-building` | — |

The repo-local `changeproof-benchmark-eval` skill was inspected in `changeproof/.agents/skills/`; it is unavailable when only this spec folder is open. Full binding matrix: `SKILL.md` §1.

## Task breakdown — tests before implementation

| Task | Target path | Write these tests FIRST (NEG3-xx) | Then implement / prove |
| --- | --- | --- | --- |
| T5-1 | `bench`, evaluation contracts | Holdout/oracle inaccessible to fixer · unequal arms rejected · omitted failures still counted (**13**, **15**) | Freeze B0/B1/B2/Full + ablation manifests; same evaluator, model/config/budget; exact denominator + gross/net cost |
| T5-2 | multi-region supervisor | **40** geo simulation on one host ≠ real region | Actual provisioned regions; frozen partition/failover plan, receipts, approved consistency/RPO/RTO — otherwise `blocked` |
| T5-3 | long-horizon profiler | **40** short soak ≠ long-soak qualification | Measure beyond known onset; resource/leak profiles and cleanup receipts; short local smoke is only a smoke |
| T5-4 | legacy fixtures / recovery | **19** observed bug becomes oracle without owner validation | Trusted domain owner establishes intent + independent baseline; no approval → diagnosis-only `behavior_contract_unknown` |
| T5-5 | finite schedule/model checker | **40** finite-state bounds silently generalized beyond model | Record state-space bounds + counterexample; validate counterexamples on actual runtime; claims limited to declared model |
| T5-6 | TB/cross-engine migration | **05** precision/data loss · **40** small dataset presented as TB proof | Actual ≥1 TB logical data, cross-engine target, active writers/history/journal and independently reconciled result |
| T5-7 | cloud deployment automation | **37** restore leaks BYOK · **40** config rendering called a deployment | Real AWS/Azure/GCP provision→run→upgrade/rollback→restore→delete/teardown, per declared profile |
| T5-8 | service operations | **26** outage/drain race · **27** deletion tombstone absent on restore · **36** forged billing event | Real concurrent-org capacity/fairness, backup/restore, deletion fence, signed payment lifecycle, runbook |
| T5-9 | organic pilot prep | **28** pilot/demo mistaken for user impact | Authorized real issue, source provenance, before/after workflow, owner acceptance method; do not claim adoption until owner validates |

## Acceptance commands for this phase

**Read `package.json` before running anything; use only scripts actually present.** Missing script or missing vendor/access is a **missing check/blocker**, never a simulated pass.

| Check | Command, if present | Evidence required |
| --- | --- | --- |
| Strict typecheck | `pnpm typecheck` | Exit code |
| Lint + dependency boundaries | `pnpm lint` | ESLint + dependency-cruiser output |
| Unit / integration | `pnpm test` | Negative tests, failures included |
| Evaluation | actual bench/certification script | Frozen manifest + reconciled denominator/cost |
| Cloud / payment / multi-region | profile-specific native scripts | Real receipts; no config-only or replay substitution |
| Full-volume / long-soak | registered campaign runner | Actual logical bytes / elapsed horizon + all-trial receipts |

Separate mock/replay/native; record exact command, exit code, source/config/plan identities.

## Definition of done for this phase

- [ ] WP3-13 — evaluation arms and holdout frozen before outcomes; model sees no protected oracle; every scheduled case reconciled.
- [ ] WP3-19 — multi-region and long-soak each proved on declared real profile; otherwise record concrete blockers, not completion.
- [ ] WP3-20 — legacy repair only claimed where domain intent and independent oracle are valid; otherwise diagnosis-only.
- [ ] WP3-33 — actual declared volume + cross-engine migration reconciled; model-checker claims bounded to its registered model.
- [ ] WP3-34 — every advertised cloud/platform entry has native install/run/restore/teardown receipts.
- [ ] WP3-26 — actual outage/restore/deletion/payment evidence and calibrated service profile; unknown figures remain unfilled blockers.
- [ ] WP3-14 — pilot outcome remains `not_started`/`blocked` until a real owner validates; preparation is not adoption evidence.
- [ ] `docs/phase-reports/phase-5.md` written to AGENTS §7.1/§7.2; name exact next dependency-ready task.

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

During actual execution update `docs/phase-reports/phase-5.md` relative to the application root, substituting this phase number. Do not create an execution report merely for changing these playbooks. Record AGENTS §7.1–7.2 headers/reports, requirement IDs, task and full-WP status separately (`not_started | in_progress | blocked | done`), source/config/schema/policy/evaluation identities, positive/negative results, artifact refs, commands + exit codes, mock vs native, missing checks, limitations, blockers/owners and the exact next ready task.

An allocated task is `done` only with its observable result and required checks. A phase may finish its allocated development tasks while a cross-phase WP remains `in_progress`; report that distinction explicitly. Full WP `done` still requires every §8 dependency and all original acceptance, including pending UI and whole-system proof. Gate contributions are not gate passes. Phase-7 is complete only when all full WPs and G3-01..17 are proven against current identities. Invalid/stale evidence or an unavailable required check cannot be labeled success. Preserve old artifacts and historical reports; on resume use the revision-2 mapping in MVP §22.
