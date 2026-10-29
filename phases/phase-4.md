# phase-4 — Back-end product services, distribution and enterprise

**Plan revision:** 2 — 24 October 2026.

**Allocated back-end tasks (recommended task order):** WP3-27, WP3-25, WP3-29, WP3-30, WP3-31, WP3-32.
**Outcome:** Real service endpoints/storage for every product control, distribution/BYOK and enterprise/provider services, ready for front-end integration.

**Competition slice:** the Meta hackathon build is a separate bounded playbook, [hackathon-slice](hackathon-slice.md). It is not an eighth release phase and does not change this phase's scope, work packages or gates. A competition demo does not make any WP or G3 gate complete.

## Work and prerequisite evidence

This phase owns only back-end tasks of these cross-phase WPs. WP3-25 service tasks need proven 12/22/23/24/28 services; 29 service tasks need proven 25 service tasks; 30 service tasks need 25/29 service tasks; 31 back-end tasks need 24/25 service tasks; 32 needs 22/28 services. Apply the task readiness rule in MVP §22: full-WP dependencies not yet complete allow only independent preparation against versioned contracts, and full-WP statuses remain open. Backend tests cannot stand in for missing browser acceptance.

| WP | Required development and local proof |
| --- | --- |
| WP3-27 | Public content/routes/data/FAQ/templates/sample provenance and public-private API boundary; no public tenant projections. Visual pages, themes and navigation belong to phase-6. |
| WP3-25 | Project/repo/environment/readiness/profile/draft revision APIs, independent invariant approval refs, immutable submit, transactionally reserved/enqueued jobs, stream/poll cursor, cancel/retry, review/evidence/publication/usage/private proxy; all role/revocation/idempotency negatives. |
| WP3-29 | Durable inbox/preferences/outbox/dedup, current-grant search/filter/count/snippet/index/cache, scoped evidence/audit exports and budgeted reproduction jobs, pagination/reconnect/delete invalidation. |
| WP3-30 | Durable tickets/access request + approval/scope/expiry/revoke/audit, candidate-bound discussion/audience/history/outdated and safe sharing, operator incidents/drain/quarantine with actual authority/fenced receipts. Owner is not operator; comments never modify proof. |
| WP3-31 | Self-host install/upgrade/rollback/restore tooling, standalone binary, BYOK broker provisioning/rotation/revoke/accounting; same engine/isolation/proof. Native install/security checks now; complete browser-to-run/PR acceptance remains phase-7. |
| WP3-32 | SAML/SCIM actual configured IdP lifecycle and GitLab/Bitbucket snapshot/events/publication/exact-head CI adapters; issuer/tenant/replay/revoke/provider mismatch/outage negatives. Browser settings/connect pages belong to phase-6. |

Read BRD §16–20, PRD §15/16/18–20, MVP §8/18/20/21, architecture §15–20. Scope: BR3-10/17..24, FR3-18/20/29..45, NFR3-11..15. Relevant NEG3-21..39. Use real PostgreSQL/concurrent tenants, brokers/provider/native installation within authorized scope; no silent mocked backend. Contributes to G3-07/08/12..16. FeatureCoverageRecord maps every control to service owner, browser task and acceptance evidence; no decorative/toast-only actions qualify.

No `apps/dashboard` or `apps/trace-viewer` visual implementation in this phase. Contract examples are development aids only; English runtime UI and final mockup work are in phase-6.

## Skill bindings for this phase

| WP / area | Load before coding | Mandatory |
| --- | --- | --- |
| WP3-27 public site content | `information-architecture-navigation`, `antislop-copywriting` | — |
| WP3-25 run-lifecycle API | `code-security`, `semgrep` | ⚠ `code-security` |
| WP3-29 queries / notifications / export | `code-security` | ⚠ `code-security` |
| WP3-30 support / collaboration | `code-security` | ⚠ `code-security` |
| WP3-31 self-host / BYOK / binary | `code-security`, `security-model` | ⚠ `code-security` |
| WP3-32 SAML/SCIM + providers | `code-security` | ⚠ `code-security` |

Full binding matrix: `SKILL.md` §1 *Skill bindings*.

## Task breakdown — failure-path tests first

**Tests before implementation.** NEG3 IDs map to `SKILL.md#ref-negative-cases`.

| Task | Target path | Write these tests FIRST (NEG3-xx) | Then implement / prove |
| --- | --- | --- | --- |
| T4-1 | public site API + content | **21** tenant projection leaking into public content · sample provenance | All routes/links/CTAs backed by real behaviour; sample data from a **separate static dataset** |
| T4-2 | run-lifecycle API | **22** repo access revoked mid-flight · **27** artifact download after revoke · **33** export of a tampered artifact | Project/repo/environment revisions, immutable submit, queue/status/stream cursor, cancel/retry; every read re-checks current grants |
| T4-3 | `queries` + `notifications` | **32** stale tenant/grant on search/count/cache · **31** duplicate or forged-recipient notification | Authorized counts/snippets/deep links only; revoke/delete invalidates cache and index |
| T4-4 | `support` + `collaboration` | **34** request ≠ grant; Owner cannot open operator console · **35** shared without rights / XSS / comments changing a verdict | Durable threads, audience, expiry, revocation; comments never modify proof |
| T4-5 | BYOK + deployment | **37** install/restore leaking keys or bypassing isolation | Secret broker only; rotate/revoke/accounting; deployment gate `blocked` while a mode is unqualified |
| T4-6 | SAML/SCIM + GitLab/Bitbucket | **38** wrong issuer/tenant, SCIM replay, deprovision race · **39** provider mismatch | Real IdP lifecycle, per-provider snapshot/event/publication/exact-head CI; identity binding never grants repo or operator permission |

## Acceptance commands for this phase

**Open `package.json` first; run only scripts that actually exist.** Absent script = **missing check**, never an assumed pass.

| Check | Command, if present | Exit 0 means |
| --- | --- | --- |
| Strict typecheck | `pnpm typecheck` | Clean across packages |
| Lint **+ boundaries** | `pnpm lint` | No boundary violations from the new API modules |
| Unit / integration | `pnpm test` | Grant, revocation and dedup negatives pass |
| Concurrent-tenant API test | integration script, once implemented | Two+ orgs in parallel, zero cross-tenant disclosure |
| Real IdP / provider | native integration script, once implemented | Actual IdP and provider lifecycle, not a stub |
| Install / upgrade / restore (**native**) | self-host script, once implemented | Real install→upgrade→restore→teardown |

Mock and native stay on separate lines. A missing native row blocks `done` for the WP that needs it.

## Definition of done for this phase

- [ ] WP3-27 — every public route, link and CTA does something real; no tenant data in public content.
- [ ] WP3-25 — a revoked grant blocked a read **and** a download; grants re-checked at read time, not at login.
- [ ] WP3-29 — a stale-grant search returned nothing (no error leaking existence); cache invalidated on revoke/delete.
- [ ] WP3-30 — an access request did **not** grant access; an Owner role could not reach operator actions.
- [ ] WP3-31 — a real install→upgrade→restore cycle succeeded; keys never left the broker.
- [ ] WP3-32 — a wrong-issuer SAML response and a replayed SCIM event were both rejected.
- [ ] Every unavailable vendor/payment/pricing/licence decision recorded as a **specific** blocker — never a guessed price or licence.
- [ ] `docs/phase-reports/phase-4.md` written to AGENTS §7.1/§7.2.

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

During actual execution update `docs/phase-reports/phase-4.md` relative to the application root, substituting this phase number. Do not create an execution report merely for changing these playbooks. Record AGENTS §7.1–7.2 headers/reports, requirement IDs, task and full-WP status separately (`not_started | in_progress | blocked | done`), source/config/schema/policy/evaluation identities, positive/negative results, artifact refs, commands + exit codes, mock vs native, missing checks, limitations, blockers/owners and the exact next ready task.

An allocated task is `done` only with its observable result and required checks. A phase may finish its allocated development tasks while a cross-phase WP remains `in_progress`; report that distinction explicitly. Full WP `done` still requires every §8 dependency and all original acceptance, including pending UI and whole-system proof. Gate contributions are not gate passes. Phase-7 is complete only when all full WPs and G3-01..17 are proven against current identities. Invalid/stale evidence or an unavailable required check cannot be labeled success. Preserve old artifacts and historical reports; on resume use the revision-2 mapping in MVP §22.
