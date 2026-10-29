# phase-7 — Whole-system testing, qualification and release assessment

**Plan revision:** 2 — 24 October 2026.

**Allocated acceptance tasks:** WP3-01..34, including final closure of WP3-13, WP3-19, WP3-20, WP3-26, WP3-31, WP3-32, WP3-33, WP3-34 and WP3-14.
**Outcome:** Whole-system testing, independent qualification and an honest final release assessment of all G3-01..17, without missing features or fabricated success.

**Competition slice:** the Meta hackathon build is a separate bounded playbook, [hackathon-slice](hackathon-slice.md). It is not an eighth release phase and does not change this phase's scope, work packages or gates. A competition demo does not make any WP or G3 gate complete.

## Readiness and dependency order

Audit actual implementation and slice evidence from phases 1–6 against MVP §8/12/20/21/22, PRD all FR/NFR/DEC and architecture boundaries. Do not assume phase completion implies full-WP acceptance. Reuse valid receipts only when identity/grant/proof requirements still hold; execute all missing or invalidated native proof. Freeze dataset/oracle/arms/config/budgets/workload/fault/schedule/n/thresholds before results. Missing source/features are blockers, not permission to replace them with tests/mocks or silently implement another phase.

One valid full-WP acceptance order (each step still requires real evidence) is:

`WP3-01 → WP3-02 → WP3-03 → WP3-04 → WP3-05 → WP3-15 → WP3-16 → WP3-17 → WP3-06 → WP3-21 → WP3-22 → WP3-28 → WP3-23 → WP3-24 → WP3-07 → WP3-08 → WP3-09 → WP3-10 → WP3-11 → WP3-12 → WP3-18 → WP3-13 → WP3-19 → WP3-20 → WP3-33 → WP3-27 → WP3-25 → WP3-29 → WP3-30 → WP3-31 → WP3-32 → WP3-34 → WP3-26 → WP3-14`.

This is acceptance order, not repeated development of already proven tasks. WP3-26 waits for 13/25/27/29/30; WP3-34 waits for 03/31/33; final 14 waits for 12/13/19/20/26/31/32/33/34. Changes invalidate affected certification/evaluation and require fresh proof/config versions; an opened holdout cannot be relabeled untouched. Phase-7 is testing/qualification, including defect reproduction and bounded fixes followed by affected checks; missing planned feature development returns to its owning phase and remains a blocker until authorized and proven.

## Whole-system test and gate matrix

| Gates | Required testing and artifacts |
| --- | --- |
| G3-01, G3-02 | Versioned contract/identity/policy/import negatives; actual pinned framework builds/services, qualified guest hostile-code probes, credential/network/socket/path escape, cancel/cleanup/quarantine and clean preparation. |
| G3-03 | Full declared six-ecosystem L1/L2/L3 tuple matrix, exact versions/features, conformance and native API/browser/DB cases; no promotion by compilation or extrapolation. |
| G3-04, G3-05, G3-11 | Frozen old/new baseline, independent oracle/approved intent, causality and full candidate/target/edge/invariant/mixed-version scope; real SC3-01..05/07/08/10/11 and separately valid diagnosis/abstention SC3-09. Campaigns have complete all-trial receipts and independently assessed C/P/R/D; no averages or shortened repetition. |
| G3-06, G3-13 | All NEG3-01..40 mapped to actual expected behavior, concurrent-tenant RLS/pooling/streams/search/cache/export/artifacts/jobs, revocation/deletion/fencing, malicious inputs/XSS/injection, payment/BYOK/IdP/provider and guest isolation. |
| G3-07, G3-08 | Independent clean full-campaign reproduction without original chat/workspace/candidate build-result cache; integrity/current reviewer access; authorized actual linked PRs/MRs, lost-response retry/reconciliation and exact-commit CI. No external access/scope → specific blocker. |
| G3-09 | Frozen new dev/holdout B0/B1/B2/Full plus graph/adaptive/mixed-version-planning ablations, same model/config/budget/common final evaluator, all scheduled failed/invalid/censored/not-run outcomes and full cohort gross/net costs. MVP §9/10/21 thresholds unchanged; hidden oracle remains inaccessible to every arm. |
| G3-10 | Actual authorized organic SC3-06 issue and source provenance, before/after native workflow, hosted journey, owner validation/adoption, active/elapsed/domain/review time and accepted-repair economics. Controlled fixture and human reference are not organic AI impact. |
| G3-12, G3-15 | Complete real browser journey from public pages/auth/org/provider/project through readiness/submit/native live-model run/review/private evidence/authorized PR and outcome; every route/control/CTA/settings/export/comment/support/operator/billing action in FeatureCoverageRecord. English, themes/fonts/licenses, keyboard/focus/mobile/zoom, error/empty/offline/reconnect states. No customer clone/install/BYOK required for hosted default. |
| G3-14 | Concurrent independent org capacity/fairness/load/outage/drain/restore, tombstones before serving, durable accepted jobs/outbox/capped usage, actual free+paid test billing lifecycle, calibrated profile/privacy/retention/cleanup and license/build/runbooks. No source distribution/deployment authorization inferred. |
| G3-16 | Hosted/self-host/operator-funded/BYOK, Windows/Linux/macOS binary, AWS/Azure/Google Cloud actual provision/install/run/upgrade/rollback/backup/deletion-aware restore/teardown, SAML/SCIM and GitHub/GitLab/Bitbucket exact-provider publication/CI per frozen profile. Every promised catalog entry has positive/negative evidence. |
| G3-17 | Actual declared multi-region/consensus/partition/consistency/RPO/RTO; long-soak beyond known onset with profilers; complete finite model bounds plus native counterexamples; populated ≥1 TB (10^12 actual logical bytes) and cross-engine migrations with active acknowledged histories; cross-platform and qualified legacy repair, independent full campaigns/reproduction. No small-data/one-host/short-soak substitute. |

Read all gate/negative/scenario dossiers in MVP §3–21 and the requirement traceability: BR3-01..25, FR3-01..45, NFR3-01..15, DEC3-01..23, WP3-01..34, G3-01..17, NEG3-01..40, PC3-01..08, SC3-01..11. Tests of documentation are not runtime acceptance. Model/native/provider/browser/payment checks require actual configured services and authorized operations; no guessing endpoints, vendor/license/pricing, calibration, credits or pilot approval.

## Skill bindings for this phase

This phase runs the **release gate**, so load the review/security skills even when the implementation is finished.

| Area | Load | Mandatory |
| --- | --- | --- |
| Whole-repo security review | `claude-security:scan` · `code-security` | ⚠ `code-security` |
| Findings triage / verdict | `fp-check`, `differential-review` | — |
| Secret leakage in artifacts/logs | `secret-serialization` | ⚠ `secret-serialization` |
| Dependency / license readiness | `supply-chain-risk-auditor` | — |
| UI regression sweep | `reviewing-interface-quality`, `accessibility-inclusive-design` | — |
| Final report | `code-review` | — |

Full binding matrix: `SKILL.md` §1 *Skill bindings*.

## Task breakdown — gate by gate, evidence-first

**For each gate: run the negative suite, then the positive suite, then record the gate.** A gate with a missing required check is `blocked` — never "passed with notes".

| Task | Gates | Must produce | Fails when |
| --- | --- | --- | --- |
| T7-1 | G3-01, G3-02 | Contract/identity/policy/import negatives; pinned framework builds; qualified guest hostile-code probes; credential/network/socket/path escape; cancel/cleanup/quarantine | Container-only evidence is claimed as isolation proof |
| T7-2 | G3-03 | Full six-ecosystem L1/L2/L3 tuple matrix with exact versions/features | Any `provenLevel` raised by compilation or extrapolation |
| T7-3 | G3-04, G3-05, G3-11 | Frozen old/new baseline; independent oracle; causality; full candidate/target/edge/invariant/mixed-version scope; real SC3-01..05/07/08/10/11 | Diagnosis (SC3-09) counted as repair success |
| T7-4 | G3-06, G3-13 | All NEG3-01..40 mapped to actual expected behavior; concurrent-tenant RLS/pooling/stream/search/cache/export/artifact/job isolation | Any skipped check counted as pass |
| T7-5 | G3-07, G3-08 | Independent clean full-campaign reproduction; authorized actual linked PR/MR; lost-response retry/reconciliation; exact-commit CI | Reproduction reused the original workspace or candidate build cache |
| T7-6 | G3-09 | Frozen dev/holdout B0/B1/B2/Full + ablations; same model/config/budget/evaluator; all scheduled failed/invalid/censored/not-run counted; full cohort gross/net cost | Hidden oracle reachable by any arm |
| T7-7 | G3-10 | Authorized organic SC3-06 issue, source provenance, before/after native workflow, owner validation/adoption | Controlled fixture or human reference patch presented as organic AI impact |
| T7-8 | G3-12, G3-15 | Complete real browser journey public→auth→org→provider→project→readiness→submit→live-model native run→review→private evidence→authorized PR→outcome | Any route/control missing from FeatureCoverageRecord |
| T7-9 | G3-14 | Concurrent independent org capacity/fairness/load/outage/drain/restore; tombstones before serving; actual free+paid billing lifecycle; license/build/runbooks | Calibrated figures invented, or `blocked` gates reported as passed |
| T7-10 | G3-16 | Hosted/self-host/binary/BYOK; AWS/Azure/GCP actual provision/install/run/upgrade/rollback/restore/delete/teardown; SAML/SCIM + GitHub/GitLab/Bitbucket exact-provider publication/CI | Catalog entry lacks positive+negative evidence |
| T7-11 | G3-17 | Actual multi-region/consensus/partition/RPO/RTO; long-soak beyond known onset with profilers; finite model bounds + native counterexamples; ≥1 TB logical bytes and cross-engine migrations with active histories; qualified legacy repair | Small-data, one-host or short-soak substitute presented as full qualification |

## Acceptance commands for this phase

**Open `package.json` first; run only scripts that actually exist.** A named-but-absent script is a **missing check** and blocks its gate.

| Check | Command, if present | Note |
| --- | --- | --- |
| Strict typecheck | `pnpm typecheck` | Gate-blocking for G3-01 |
| Lint + dependency boundaries | `pnpm lint` | ESLint **and** dependency-cruiser |
| Unit / integration | `pnpm test` | Must include the negative suite |
| Adapter conformance (**native**) | conformance script | Six ecosystems, pinned versions |
| Security / native runner (**native**) | security script | Hostile-code probes + cleanup |
| Certification | certification script | Frozen matrix |
| Dev evaluation | dev evaluation script | Develop-time only |
| Frozen holdout | holdout script | Once opened, it is not "untouched" |
| Reproduction | reproduction script | Clean environment, no original workspace |
| Real-system E2E | E2E script | Real DB/broker/browser/payment |

Report mock, replay and native **separately** with command + exit code. Do not merge a replay result into a native row.

## Definition of done for this phase

- [ ] Every G3-01..17 has its own evidence row: source/config/evaluation identities, command, exit code, artifact refs.
- [ ] Every NEG3-01..40 has an executed expected-behavior row — none skipped.
- [ ] Every WP3-01..34 reported with full prerequisite status, distinct from per-task status.
- [ ] Missing checks, invalidated receipts and scope limits stated plainly.
- [ ] G3-08/G3-10 marked `blocked` with the concrete access still missing, not simulated.
- [ ] Release thresholds checked against MVP §10 with real denominators — no invented SLO, cost, adoption or performance figures.
- [ ] Passing this phase **does not** authorize publication, merge, payment or production deployment.
- [ ] `docs/phase-reports/phase-7.md` written to AGENTS §7.1/§7.2 as the final release assessment.

## Final assessment

Report every full WP and gate with source/config/evaluation identities and evidence, separate engineering task status from TargetOutcome/BundleAssessment. Include missing checks, supported tuples/proof envelope, failures/limitations, invalidated receipts, specific access/budget/pilot/license blockers and the next safe action. G3-08/G3-10 remain blocked without actual repository/pilot access. Full release acceptance requires every mandatory gate; passing this phase does not automatically authorize publication, merge, payment or production deployment.

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

During actual execution update `docs/phase-reports/phase-7.md` relative to the application root, substituting this phase number. Do not create an execution report merely for changing these playbooks. Record AGENTS §7.1–7.2 headers/reports, requirement IDs, task and full-WP status separately (`not_started | in_progress | blocked | done`), source/config/schema/policy/evaluation identities, positive/negative results, artifact refs, commands + exit codes, mock vs native, missing checks, limitations, blockers/owners and the exact next ready task.

An allocated task is `done` only with its observable result and required checks. A phase may finish its allocated development tasks while a cross-phase WP remains `in_progress`; report that distinction explicitly. Full WP `done` still requires every §8 dependency and all original acceptance, including pending UI and whole-system proof. Gate contributions are not gate passes. Phase-7 is complete only when all full WPs and G3-01..17 are proven against current identities. Invalid/stale evidence or an unavailable required check cannot be labeled success. Preserve old artifacts and historical reports; on resume use the revision-2 mapping in MVP §22.
