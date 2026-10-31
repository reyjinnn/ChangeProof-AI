# phase-6 — Front-end development from the final mockup

**Plan revision:** 2 — 24 October 2026.

**Allocated front-end tasks:** WP3-12, WP3-14, WP3-21, WP3-22, WP3-24, WP3-25, WP3-26, WP3-27, WP3-28, WP3-29, WP3-30, WP3-31, WP3-32.
**Outcome:** The complete ChangeProof public site, dashboard and trace viewer match the active final mockup and operate through real authorized services.

**Competition slice:** the Meta hackathon build is a separate bounded playbook, [hackathon-slice](hackathon-slice.md). It is not an eighth release phase and does not change this phase's scope, work packages or gates. A competition demo does not make any WP or G3 gate complete.
**Design source:** [.template-ui/mockup.html](../.template-ui/mockup.html), equivalent to `.template-ui/mockup.html` when the package is in ``. Read sections only; do not print embedded fonts/data URIs wholesale. Follow [skill UI guide](../SKILL.md#ref-ui-mockup-guide), PRD FR3-31/37..45 and §20, MVP §20/21/22, architecture §18–20.

## Prerequisites and front-end work

Audit backend task evidence from phases 1–5 and exact API/contracts/authorization/revision identities per screen. A missing backend action blocks the dependent control's integration; continue independent UI tasks and record the owning backend task. Do not mark mocks or local state as successful real-service behavior, and do not silently implement an entire missing backend phase. Browser tasks follow 27 public/auth → 25 workspace → 29 inbox/search/export → 30 support/collaboration, with the associated identity/billing/provider/viewer screens attached as ready. Full WP closure still follows §8 in phase-7.

| Front-end area | Owning WPs | Required behavior |
| --- | --- | --- |
| Design system and public site | WP3-27 | Inspect active/latest mockup skin and extract one token source; shared components, Inter and Plus Jakarta Sans self-hosted + SIL OFL notices, light/dark, responsive and keyboard/focus. All public product/pricing/docs/FAQ/changelog/roadmap/templates/tutorial/sample/legal/integration/impact/verification/evidence/collaboration routes, links and CTA behavior; static samples separate from tenant projections. |
| Identity/onboarding/settings/privacy | WP3-21, WP3-22, WP3-25, WP3-28, WP3-32 | GitHub/email login/register/verify/resend/recovery/session revoke, server-validated return targets, org/provider/project/readiness, roles/invites/ownership/repo access/deletion, SAML/SCIM/GitLab/Bitbucket lifecycle and errors. Backend retains all authority. |
| Dashboard and full run journey | WP3-25 | Projects/repos/environment revisions, six templates, drafts/resume, telemetry validated upload, characterization, assisted CI/invariant readiness, owner confirmation and next action, cold/warm forecast/consent/immutable submit, queue/status/stream/poll/reconnect/cancel/retry, review graph/ledger/diff/all trials/C/P/R/D/unknowns and exact target/bundle states. |
| Evidence, publication, outcomes and evaluations | WP3-12, WP3-14, WP3-25, WP3-26, WP3-29 | Read-only escaped trace viewer, evidence library/audit/index/private download/export/full-campaign reproduction, actual authorized PR/CI state, owner outcome/active-time/review reporting and real evaluation denominators/costs. No UI-generated verdict or success. |
| Shell, notifications/search/filter | WP3-29 | Workspace/account menu, collapsible responsive sidebar, theme, modal/drawer/select/file picker; persisted inbox/read/unread/dismiss/preferences, authorized counts/snippets/deep links, Ctrl/Cmd+K + Enter/Escape, stable cursor/filter/empty/error/reconnect states. |
| Support, collaboration and operator console | WP3-30, WP3-26 | Durable ticket/history/access approval/expiry/revoke, scoped internal/reviewer comments/history/audience/share/resolution/outdated candidate; actual service incidents/queue/worker/drain/quarantine. Owner role cannot access operator actions. |
| Usage, billing, BYOK and distribution | WP3-24, WP3-25, WP3-31, WP3-32 | Reserved/consumed/available, checkout/subscription/invoice/refund/reconciliation, BYOK secure submission/rotation/revoke, enterprise/provider settings and truthful self-host/binary installation guidance/status. Payment success pages do not grant entitlement. |

Runtime UI language is **English**, including aria labels and errors. Mockup numbers/credits/timings/testimonials are illustrative until measured and approved; do not publish them as claims. Support loading/empty/offline/denied/revoked/unsupported/quota/provider/cleanup/inconclusive states. Persist only theme/sidebar/account-scoped non-secret drafts; no file bytes, passwords, sessions, reset tokens, BYOK or API keys. Browser imports only browser-safe core contracts and HTTP, never orchestrator/DB/model/authority modules.

## Local checks and coverage handoff

For every route/form/button/menu/filter/export/collaboration preview, update FeatureCoverageRecord with requirement, owning backend task, actual endpoint/receipt and positive/negative browser case. No decorative controls. Run typecheck/build/lint/boundaries/component tests and targeted browser integration/E2E on the real service stack now, with keyboard/labels/focus/mobile/zoom/light/dark checks. Relevant NEG3-21..39 include XSS, stale cache/grants, deep-link/session/token misuse, current-grant counts/export, duplicate submits, operator escalation, billing/BYOK/provider identity. Scope includes BR3-10/14/17..24, FR3-18..21/24/29..45, NFR3-11..15 and PRD §20.

Contributes to G3-07..10/12..16. Phase-7 performs the complete cross-system regression/security/evaluation/release suite. Local UI pass alone is not completion of those gates. This phase develops the front-end; whole-system defects requiring backend changes must be recorded with ownership, with only explicitly authorized repair scope applied.

## Skill bindings for this phase

**Load before writing any UI code.** Front-end work has the largest skill surface in the project.

| Area | Load | Mandatory |
| --- | --- | --- |
| Design system / tokens / themes | `design-systems-frontend-architecture`, `design-system`, `applying-themes` | — |
| All page implementation | `frontend-ui`, `ui-styling` | — |
| Every page (accessibility gate) | `accessibility-inclusive-design`, `building-accessible-interfaces` | ⚠ NFR3-14/15 acceptance depends on these |
| Forms, billing, BYOK, checkout | `forms-inputs-checkout` | — |
| Navigation, IA, search | `information-architecture-navigation`, `interaction-patterns-components` | — |
| Flow/behaviour, empty/error states | `designing-user-experience`, `ux-usability-foundations` | — |
| Copy, errors, CTAs, empty states | `ux-writing-content-design`, `antislop-copywriting` | — |
| Charts (coverage, C/P/R/D, usage) | `dataviz` | — |
| Visual polish per page | `antislop-ui`, `ui-visual-composition` | — |
| **Final gate before handoff** | `reviewing-interface-quality` | Required — runs after implementation, before the report |

Full binding matrix: `SKILL.md` §1 *Skill bindings*. `.template-ui/mockup.html` remains a **design source, not evidence** — do not copy its layered `!important` CSS; extract tokens into one source (see `SKILL.md#ref-ui-mockup-guide`).

## Task breakdown — browser tests first where the risk is

**Keyboard/label/state tests first.** NEG3 IDs map to `SKILL.md#ref-negative-cases`.

| Task | Surface | Tests FIRST | Then implement / prove |
| --- | --- | --- | --- |
| T6-1 | Design tokens + shell | Contrast, focus ring visible on every interactive control, light **and** dark, responsive at 375/768/1440 | One token source; Inter (body) + Plus Jakarta Sans (headings) self-hosted WOFF2 with SIL OFL notices; no external font requests |
| T6-2 | Public site | Public/private boundary; no tenant projection in any public render | All routes/links/CTAs functional; sample reports from the separate static dataset |
| T6-3 | Auth / onboarding / settings | **29** forged return target, private deep link as guest, stale session · **30** reset replay / enumeration | Server-validated return targets, session revoke, org/provider/role/invite/ownership UI — backend holds all authority |
| T6-4 | Run journey | Offline/empty/loading/denied/revoked/unsupported/cleanup/inconclusive states | Drafts, readiness, forecast/consent, immutable submit, queue/status/stream/reconnect/cancel/retry, graph/ledger/diff/C-P-R-D/unknowns |
| T6-5 | Evidence / publication / export | **33** missing or tampered artifact → explicit integrity error · **14** reviewer cannot reach evidence | Read-only escaped viewer, private download, authorized export, PR/CI state; **no UI-generated verdict** |
| T6-6 | Notifications / search | **31** forged recipient · **32** stale grant on count/snippet/cache | Inbox, preferences, deep links, Ctrl/Cmd+K; only current-grant results |
| T6-7 | Support / collaboration | **34** request ≠ grant · **35** XSS, comments changing verdict, candidate drift | Tickets, threads, audience, operator console; Owner cannot reach operator actions |
| T6-8 | Billing / BYOK / enterprise | **36** forged entitlement · **37** key leakage | Checkout/subscription/invoice/refund UI shows **server** state only; success page never grants entitlement |

## Acceptance commands for this phase

**Open `package.json` first; run only scripts that actually exist.** Absent script = **missing check**.

| Check | Command, if present | Exit 0 means |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | Strict clean, including the app |
| Build | `pnpm build` | App builds against browser-safe contracts only (never orchestrator/DB/model) |
| Lint **+ boundaries** | `pnpm lint` | No server-only import reached the browser |
| Component tests | component test script | Every control renders all data states (loading/empty/error/denied) |
| Browser E2E (**native**) | E2E script against the real stack | Journey passes with keyboard-only, focus order, labels, mobile, zoom, light/dark |

Accessibility and browser E2E are **native** rows — a component-test pass does not substitute for them.

## Definition of done for this phase

- [ ] Every CTA, form, menu, filter, export and collaboration preview has **real** service behaviour — no decorative controls.
- [ ] FeatureCoverageRecord maps each control → requirement → owning backend task → endpoint/receipt → positive **and** negative browser case.
- [ ] Keyboard-only navigation reaches every action; focus always visible; labels and actionable errors present.
- [ ] Runtime UI language is **English**, including aria-labels and error text (FR3-40); no Indonesian leftovers from the mockup.
- [ ] Only theme, sidebar and account-scoped non-secret drafts persist in the browser — no file bytes, passwords, sessions, tokens or BYOK.
- [ ] `reviewing-interface-quality` run and findings addressed or recorded as limitations.
- [ ] `docs/phase-reports/phase-6.md` written to AGENTS §7.1/§7.2; backend defects recorded with ownership rather than silently repaired.

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

During actual execution update `docs/phase-reports/phase-6.md` relative to the application root, substituting this phase number. Do not create an execution report merely for changing these playbooks. Record AGENTS §7.1–7.2 headers/reports, requirement IDs, task and full-WP status separately (`not_started | in_progress | blocked | done`), source/config/schema/policy/evaluation identities, positive/negative results, artifact refs, commands + exit codes, mock vs native, missing checks, limitations, blockers/owners and the exact next ready task.

An allocated task is `done` only with its observable result and required checks. A phase may finish its allocated development tasks while a cross-phase WP remains `in_progress`; report that distinction explicitly. Full WP `done` still requires every §8 dependency and all original acceptance, including pending UI and whole-system proof. Gate contributions are not gate passes. Phase-7 is complete only when all full WPs and G3-01..17 are proven against current identities. Invalid/stale evidence or an unavailable required check cannot be labeled success. Preserve old artifacts and historical reports; on resume use the revision-2 mapping in MVP §22.
