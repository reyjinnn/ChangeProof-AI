# phase-2 — Back-end baselines, campaigns and hosted foundations

**Plan revision:** 2 — 24 October 2026.

**Allocated back-end tasks:** WP3-15, WP3-16, WP3-17, WP3-06, WP3-21, WP3-22, WP3-28, WP3-23, WP3-24.
**Outcome:** Independent telemetry/campaign/dimension facts and valid baselines, plus durable hosted identity, grants, jobs and accounting services.

**Competition slice:** the Meta hackathon build is a separate bounded playbook, [hackathon-slice](hackathon-slice.md). It is not an eighth release phase and does not change this phase's scope, work packages or gates. A competition demo does not make any WP or G3 gate complete.

## Work and prerequisite evidence

Audit phase-1 task evidence, not its summary. Baseline and hosted tracks follow their own §8 prerequisites.

| WP | Required development and local proof |
| --- | --- |
| WP3-15 | After 02/05: scoped telemetry ingestion, clock/sampling/deploy gaps, characterization/provenance; no correlation-to-cause promotion, no assumed legacy intent. |
| WP3-16 | After 04/15: frozen workload/fault/n/threshold/budget; actual barrier/fault/heal/reset/journal, all-trial receipts and failed injector/cleanup tests; no model required. |
| WP3-17 | After 01/16: deterministic matched-window reducers, quality/uncertainty, separate C/P/R/D validity; functional pass never hides another dimension fail/inconclusive. |
| WP3-06 | After 04/05/16/17: real SC3-01 old valid/new attributed failure on actual app/DB/broker/browser, repeated baseline, domain-approved intent and independently frozen oracle outside agent workspace. CI is authoring input, not an automatic oracle. |
| WP3-21 | After 02: PostgreSQL/RLS, org/session/role/grant/invite/lifecycle/private artifact authority; concurrent tenants and pool context reset, last-owner/revocation/deletion negatives. |
| WP3-22 | After 21: GitHub App API/installation/snapshot/webhook/CI provenance, signatures/dedup/revocation, broker-held credentials; actual authorized integration or specific live blocker. |
| WP3-28 | After 21: email register/verify/reset/session/linking endpoints, purpose-bound expiring single-use challenges; authorized real delivery required for delivery acceptance. Account/identity UI belongs to phase-6. |
| WP3-23 | After 04/21/22: transactional outbox/admission, durable at-least-once jobs, monotonic lease/fence, crash/resume/cancel/orphans/fairness, fresh guests and scoped preparation reuse. |
| WP3-24 | After 21/23: atomic reservations/ledger/settlement/caps, complete-proof forecast, free + paid billing integration and signed reconciliation. Pricing/credit/vendor decisions need evidence; no invented balance. Payment/usage UI belongs to phase-6. |

Read PRD §6/13/15/16/18–20, MVP §5/7/8/12/17/21, architecture §6/7/10/15–20. Scope: BR3-09/13/15..19/21/24; FR3-14..16/25..30/32..35/38; NFR3-04..08/11..15. Relevant NEG3-03/07/10/13/15..28/30/36, oracle/profile/cache poisoning. Local native probes and concurrent DB tests run now. Contributes to G3-02/04/11/13/14; browser/whole-system closure in phases 6–7. No dashboard/auth pages are developed here.

## Skill bindings for this phase

| WP / area | Load before coding | Mandatory |
| --- | --- | --- |
| WP3-15 observability / characterization | `find-bugs` | — |
| WP3-16 campaign / fault injection | `code-security`, `security-model` | ⚠ `code-security` |
| WP3-17 reducers / dimension assessment | `find-bugs` | — |
| WP3-06 fixtures / oracle | `code-security` | ⚠ `code-security` |
| WP3-21 identity / RLS | `code-security`, `semgrep` | ⚠ `code-security`, ⚠ `semgrep` |
| WP3-22 GitHub App / webhooks | `code-security` | ⚠ `code-security` |
| WP3-23 jobs / leases / outbox | `code-security`, `semgrep` | ⚠ `code-security` |
| WP3-24 usage / reservations / billing | `code-security` | ⚠ `code-security` |
| WP3-28 email / sessions / account linking | `code-security` | ⚠ `code-security` |

Full binding matrix: `.claude/SKILL.md` §1 *Skill bindings*.

## Task breakdown — failure-path tests first

**Tests before implementation.** NEG3 IDs map to `.claude/SKILL.md#ref-negative-cases`.

| Task | Target path | Write these tests FIRST (NEG3-xx) | Then implement / prove |
| --- | --- | --- | --- |
| T2-1 | `modules/observability` | **16** clock skew / sampling gap / stale deploy label → `causality_unproven` | Telemetry normalized to facts + quality gaps only; never a cause |
| T2-2 | `modules/verifier` campaign | **17** no-op injector / failure to heal → `experiment_invalid` · **15** incomplete repetitions | Real barrier/fault/heal, reset + journal receipts, all-trial accounting. Fault authority stays in the supervisor |
| T2-3 | measurement reducers | **18** perf "improved" by dropped traffic or removed timeouts | Deterministic matched-window reducers; algorithm/config digest + raw observations; C/P/R/D assessed separately |
| T2-4 | `modules/fixtures` + oracle | **03** invalid oracle · **19** legacy bug used as oracle | Frozen oracle authored outside the agent workspace; independent freeze; owner-approved intent |
| T2-5 | `modules/identity` + PostgreSQL/RLS | **21** forged tenant ID / stale member · **30** reset replay / account takeover · **38** last-owner lockout | Concurrent-tenant RLS tests with pool context reset; grants checked at read time |
| T2-6 | `modules/github` | **22** revocation mid-run · **23** duplicate webhook · **39** wrong head / provider mismatch | Signature-verified webhooks, durable dedup, secret broker; no unverified webhook is authority |
| T2-7 | `modules/jobs` | **23** stale lease / lost response · **26** outage / cancel-drain race · **22** revocation | Transactional outbox, at-least-once delivery, monotonic fencing epoch, orphan cleanup |
| T2-8 | `modules/usage` | **25** concurrent reservation / double debit · **13** budget never reset · **28** forged entitlement | Atomic admission, idempotent usage events, settlement releases unused reserve; forecast ≠ cap |
| T2-9 | email / session endpoints | **29** forged return target · **30** enumeration / replay / linking | Purpose-bound, expiring, single-use, rate-limited challenges |

## Acceptance commands for this phase

**Open `package.json` first; run only scripts that actually exist.** Absent script = **missing check**, never an assumed pass.

| Check | Command, if present | Exit 0 means |
| --- | --- | --- |
| Strict typecheck | `pnpm typecheck` | Clean across packages |
| Lint **+ boundaries** | `pnpm lint` | No cycles, deep imports or transitive escapes |
| Unit / integration | `pnpm test` | Campaign accounting + RLS negatives pass |
| Concurrent-tenant DB test | database/integration script, once implemented | Two+ tenants in parallel, pool context reset |
| Real DB / broker | native service test, once implemented | Actual PostgreSQL + broker, not a fake — report separately from mock |

Mock and native stay on separate lines. A missing native row blocks `done` for the WP that needs it.

## Definition of done for this phase

- [ ] WP3-15 — a false telemetry join produced `causality_unproven`, not a cause.
- [ ] WP3-16 — a failed injection and a failed cleanup each produced `experiment_invalid`; all-trial counts reconcile (`planned / completed / failed / invalid / censored / not_run`).
- [ ] WP3-17 — a dimension-inconclusive result did **not** become a pass; no averaging anywhere.
- [ ] WP3-06 — oracle unreachable from agent tools; old valid / new attributed failure proven on real app+DB+broker.
- [ ] WP3-21 — concurrent-tenant RLS tests pass; local JSON is not used as authority.
- [ ] WP3-22 / 23 / 24 — revocation, duplicate-effect and double-debit negatives pass with real receipts.
- [ ] Every unavailable access (model, repo, payment, pilot) recorded as a **specific** gate `blocked` — not simulated.
- [ ] `docs/phase-reports/phase-2.md` written to AGENTS §7.1/§7.2.

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

During actual execution update `docs/phase-reports/phase-2.md` relative to the application root, substituting this phase number. Do not create an execution report merely for changing these playbooks. Record AGENTS §7.1–7.2 headers/reports, requirement IDs, task and full-WP status separately (`not_started | in_progress | blocked | done`), source/config/schema/policy/evaluation identities, positive/negative results, artifact refs, commands + exit codes, mock vs native, missing checks, limitations, blockers/owners and the exact next ready task.

An allocated task is `done` only with its observable result and required checks. A phase may finish its allocated development tasks while a cross-phase WP remains `in_progress`; report that distinction explicitly. Full WP `done` still requires every §8 dependency and all original acceptance, including pending UI and whole-system proof. Gate contributions are not gate passes. Phase-7 is complete only when all full WPs and G3-01..17 are proven against current identities. Invalid/stale evidence or an unavailable required check cannot be labeled success. Preserve old artifacts and historical reports; on resume use the revision-2 mapping in MVP §22.
