# ChangeProof AI 1.0 — Scoped Phase Execution Prompts

**Plan revision:** 3 (26 October 2026). **Package:** seven main files + `phases/` (seven phase playbooks + one competition-slice playbook).

This file is a *prompt*, not specification authority. Where it differs from `AGENTS.md`, `SKILL.md`, `.prepare/BRD.md`, `.prepare/PRD.md`, `.prepare/MVP.md`, `.prepare/architecture.md` or the selected `phases/phase-N.md`, those files win and the difference must be recorded.

---

## Shared execution instructions

These instructions apply together with exactly one selected phase request below. The other phase descriptions provide scope boundaries only; they are not authorization to execute those phases. If no single phase is selected, ask which phase to execute before making changes.

### Read and orient before changing anything

Read `AGENTS.md`, `SKILL.md`, then `.prepare/BRD.md` → `.prepare/PRD.md` → `.prepare/MVP.md` → `.prepare/architecture.md`, followed by the selected `phases/phase-N.md` playbook and its relevant references. Follow execution-plan revision 2 and the allocation in MVP §22.

Resolve paths from the actual project layout, never from this document:

- Specification at the project root (the seven main files plus `phases/`) → application root is that root.
- `.prepare/architecture.md` §2 writes the layout as `src/core`, `src/modules/…`. An existing build may instead use `packages/<module>`. Record that divergence as `[DERIVED]` and confirm it before assuming either mapping.

Do not create a duplicate specification tree, and never place product implementation inside `phases/`.

Audit actual source, Git state when available, manifests, lockfiles, installed toolchains, configuration, existing reports and evidence. Do not expose secrets. Specifications describe targets; they do not prove implementation, available credentials or passing capability. Four principles to keep in front of you: *code exists ≠ capability proven; mock/replay pass ≠ real-system success; local target pass ≠ coordinated bundle verified; controlled runtime success ≠ organic user impact.*

Resume unfinished work using evidence that remains valid. Do not repeat proven work without a relevant change, failure or freshness requirement.

### Load the skills bound to this task before implementing

`SKILL.md` §1 *Skill bindings* maps every workflow step, and every §2 change type, to the Claude skills that govern it. Each `phases/phase-N.md` repeats the applicable subset under **Skill bindings for this phase**.

- Load a skill **before** the step it governs (typically Step 4 and Step 5), not after the damage.
- Load only the skills the current task needs. Loading the whole set dilutes attention and burns context.
- A ⚠ in either table is a **must-load**. Either the skill's own description makes it mandatory for that domain (`code-security` for user input/auth/DB/network/crypto, `llm-security` for any agent or tool-using model integration), or the specification's own verification standard requires the check it provides (`semgrep` static analysis, `secret-serialization` for artifact redaction). **Skipping a ⚠ on an in-scope task is a missing check**, recorded as such — not a silent omission.
- **Do not load `claude-api`.** It documents the Anthropic SDK and Claude pricing, while this product's target model is Meta **Muse Spark 1.3** through Meta Model API (`PRD` FR3-07, `BRD` §17/§20). Consulting Anthropic documentation to integrate a Meta model is a wrong-source error.
- The eight `changeproof-*` domain skills (`task-execution`, `contracts-policy`, `detector-analyzer`, `verifier-fixtures`, `fix-agent`, `sandbox-security`, `evidence-publisher`, `benchmark-eval`) live in the build repo at `changeproof/.agents/skills/` and are **absent from this extracted package**. Bind to them only when the working directory is that repo.

### Work the selected phase's task breakdown, tests first

Every `phases/phase-N.md` carries four sections in this order. Use them as the work list instead of re-deriving tasks from prose:

1. **Skill bindings for this phase** — load these first (above).
2. **Task breakdown** — one row per AGENTS §7.1 task header. The *"write these tests FIRST"* column, with its NEG3-xx case IDs, is implemented **before** the *"then implement / prove"* column. **Never reverse that order** for policy, guard, verifier or security rows.
3. **Acceptance commands for this phase** — the checks that apply and what exit 0 means.
4. **Definition of done for this phase** — phase-specific. A checkbox is satisfied only when the negative case actually executed, not when the code path exists.

### Routing

| User prompt | Required playbook |
| --- | --- |
| `phase-1` … `phase-7`, `jalankan phase-N`, `lanjutkan phase-N`, `resume phase-N` | `phases/phase-1.md` … `phases/phase-7.md` (release scope, MVP §22) |
| `hackathon-slice`, `jalankan hackathon-slice`, `competition slice`, `demo hackathon` | `phases/hackathon-slice.md` (competition vertical slice, **not** a release phase) |

The competition-slice request selects **only** `phases/hackathon-slice.md`. It never implies phases 1–7, and those never imply the slice. Explanation, review or scope-design questions do not execute any playbook.

### Strict execution boundaries

Execute only the development, integration, testing and reporting tasks allocated to the selected phase, together with changes directly necessary to satisfy those tasks.

Do not automatically execute earlier or later phases. Do not add unrelated features, refactor unrelated code, change the phase allocation, replace the architecture or make optional improvements outside the selected scope. Record out-of-scope findings without implementing them.

Preserve the full-WP dependency graph in MVP §8. Separate back-end tasks, front-end tasks and full acceptance as required by MVP §22. A completed task does not automatically make its full WP complete. An incomplete predecessor permits only independent preparation with proven task inputs; it does not permit dependent acceptance.

Continue all dependency-ready work within the selected phase. Do not stop after a plan, scaffold or first completed task while legitimate authorized work remains ready. If a task is blocked, continue independent tasks in that phase. If all remaining tasks are blocked, report concrete missing prerequisites and stop without identical retries.

Do not perform paid API calls, external repository mutations, external publication, messages or email delivery, payments, destructive operations, merges or production deployment unless explicitly authorized within the current session. A specification or phase prompt alone does not grant that authorization. Prepare reviewable local work and identify the specific blocked live check when authorization is absent.

Do not create unrelated chats, background automations or scheduled tasks.

### Required technology and architecture

Use the specified stack where relevant to the selected phase:

- Strict TypeScript, pnpm, Zod and explicitly versioned contracts.
- One modular monolith, one package/release, one shared reasoning engine, framework adapters, independent verification and deterministic policy.
- Vitest, integration/security tests, adapter conformance and scope-appropriate native checks.
- ESLint, dependency-cruiser and prohibited-import checks.
- `ts-morph` for TypeScript analysis and `oasdiff` for OpenAPI change analysis.
- GitHub App integration through Octokit and a credential broker.
- PostgreSQL as authoritative hosted state; private content-addressed artifact storage with current-grant authorization.
- A qualified guest VM/microVM per job, or a proven equivalent boundary, for customer code execution.
- Meta Muse Spark 1.3 as the specified model target, through a versioned `ModelClient` and broker. Verify actual access, identity and tool behavior before claiming support.
- JavaScript/TypeScript, Python, JVM, Go, PHP and .NET adapter ecosystems with pinned native toolchains.
- Next.js, Spring Boot, FastAPI, PostgreSQL and Redis Streams/cache as the flagship application topology, according to its frozen profile.
- Browser-safe contracts and authenticated HTTP APIs for the product front-end. Follow the recorded product UI framework decision; do not infer it from the flagship fixture stack.

Inspect actual versions and configuration. Do not automatically upgrade to the latest version, substitute libraries, select paid vendors, invent endpoints or assume target versions are already qualified. Customer Redis is not authoritative platform state.

### Proof and security requirements

Follow the required task-header and task-report formats in AGENTS §7.1–7.2. Identify requirements, observable outcomes, allowed changes, prerequisites, checks and expected evidence before implementation.

Write failure-path tests first where required for policy, guard, verifier and security boundaries.

Preserve protected intent and oracle, deterministic verdicts, typed mutation gateways, tenant isolation, current grants, lease/fencing, idempotency and finite cumulative budgets. Customer code must not execute on the host or control plane. Credentials must remain within trusted brokers.

Do not weaken assertions, remove required checks, narrow proof scope after failure, reset budgets or lower thresholds to obtain a pass. Do not promote inferred or unresolved findings without evidence. Evidence dimensions are never averaged; an inconclusive required dimension withholds assurance.

Run strict typecheck, lint/boundary checks, unit/integration tests, adapter conformance and appropriate native checks during development. Local testing is required in phases 1–6; phase-7 does not postpone it.

**Use commands that actually exist.** Read `package.json` before running anything (AGENTS §6): script names are *targets* until they are present and proven to run. A named-but-absent script is recorded as a **missing check**, never as a pass. Record exact commands, exit codes, evidence paths and source/config identities. Separate mock, replay and live results from real-runtime results.

### Reporting and stopping

During actual execution, maintain `docs/phase-reports/phase-N.md` at the application root for the selected phase. **Create `docs/phase-reports/` if it does not exist** — a fresh checkout has an empty `docs/`.

Include:

- Execution-plan revision and task/requirement IDs.
- Actual stack and pinned versions.
- Task status separately from full-WP status.
- Source/config/schema/policy/evaluation identities and relevant changes.
- Positive, negative and native results.
- Exact commands, exit codes and artifact references.
- Proven outcomes, unfinished work, limitations and missing checks.
- Concrete blockers, responsible parties and the next dependency-ready task.

Use `not_started`, `in_progress`, `blocked` and `done` for engineering status. Do not confuse these with product outcomes or bundle assessments.

Complete only the selected phase's allocated scope. Do not declare a full WP, gate or release complete without all original prerequisites and acceptance evidence.

---

## Hackathon slice — focused competition build

Execute only `phases/hackathon-slice.md` and its shared rules. This is **not** one of the seven release phases and does not alter the complete product scope, WP DAG or G3 gates. Follow [BRD §21](.prepare/BRD.md#hackathon-build-scope), [PRD §21](.prepare/PRD.md#hackathon-competition-compliance), [MVP §23](.prepare/MVP.md#hackathon-build-scope) and the architecture's competition slice. Preserve the core value — real cross-component business impact, visible Meta contribution, protected intent, independent verification and evidence — while limiting breadth to one reproducible scenario and one selected backend.

Do not implement the full dashboard, every framework, full hosted platform, billing, enterprise integrations or all scenario campaigns for the competition slice. Do not claim full-product completion, organic pilot, framework certification, production readiness or a gate pass from this demo. Keep `mockup.html`'s visual design and CSS unchanged; only update text, route content and behavior required to explain and show the focused competition slice. Preserve the disclosure, limitations, human approval, data-mode, audience and Meta provenance/watermark obligations.

Use commands actually present, keep mock/replay separate from live model/native runtime, do not call paid APIs or perform publication/deployment without explicit authorization, and report exact blockers. Build/demo completion does not complete a full WP or G3 gate.

Before submitting, work through the event administration items in [BRD §20](.prepare/BRD.md#hackathon-event-terms): one eligible track and theme, one representative who lists every member, the current portal deadline and required formats, the credit claim state (entitlement, balance, expiry, model/mode, billing method, finite spend cap), the current IP license and publish permissions, and prize/tax ownership. Judge-facing figures (rubric weights, prize amounts, credit amounts) carry their dated source label and are never presented as verified entitlement, eligibility, or a probability of winning. Keep Team/Project IDs, tax forms, addresses, and payment details out of source control. The service-mode label shown to users follows the current provider terms; the Standard/Discounted vs Standard/Contributor naming conflict is recorded, not silently resolved.

---

## Phase 1 — Back-end foundations, discovery and native runner

Execute ChangeProof AI 1.0 `phase-1` according to `phases/phase-1.md` and the shared instructions above. **Work its four sections in order: skill bindings → task breakdown → acceptance commands → definition of done.**

Implement the allocated back-end tasks for **WP3-01, WP3-02, WP3-03, WP3-04 and WP3-05**, following their dependencies:

1. Versioned engine and hosted contracts, ports, identities, semantic validation and pure deterministic policy.
2. Strict toolchain, composition root, CLI and enforced module/import boundaries.
3. Six-ecosystem inventory, capability registry and the required L1 extraction paths.
4. Qualified native runner, dependency broker, scoped preparation reuse, hostile-code isolation and cleanup.
5. Shared change representation, detector/analyzer and evidence-backed cross-system impact graph.

Include readiness, reuse, forecast and evaluation contracts required by the specification. Reject malformed contracts, unknown versions, dangling references, forged capabilities, stale or mixed identities, invalid oracles and target-pass/edge-fail cases.

Prove extraction and runner behavior using the required positive, negative and native checks. Keep `targetLevel` separate from `provenLevel`; new capability records start at `none`.

**Clear the readiness blockers before claiming WP3-03 or WP3-04 done** (playbook section *Environment blockers*, MVP §12):

- All six ecosystem toolchains present. As checked on 2026-10-25, the current Windows 11 Home host lacked `go`, `dotnet` and `mvn`.
- A chosen isolation boundary, recorded as a decision. Windows 11 Home has no Hyper-V and microVMs are Linux-only, so a WSL2 or remote-Linux runner must be selected before any isolation evidence is claimed; a non-root container is explicitly insufficient.
- PostgreSQL available (`psql` was absent on 2026-10-25; required from WP3-21, phase-2).

Missing items make the affected WP `blocked`. They are never replaced by simulation.

Do not develop the ChangeProof public site, dashboard or trace viewer. Customer fixture applications and browser probes may be used only where required for engine/adapter/runner proof.

Save progress in `docs/phase-reports/phase-1.md`. Do not start phase-2.

---

## Phase 2 — Back-end baselines, campaigns and hosted foundations

Execute ChangeProof AI 1.0 `phase-2` according to `phases/phase-2.md` and the shared instructions above. **Work its four sections in order: skill bindings → task breakdown → acceptance commands → definition of done.**

Validate actual prerequisite evidence from phase-1. Implement the allocated back-end tasks for **WP3-15, WP3-16, WP3-17, WP3-06, WP3-21, WP3-22, WP3-28, WP3-23 and WP3-24** according to their dependencies.

Cover:

- Scoped observability ingestion, provenance, quality gaps and safe legacy characterization.
- Frozen native campaigns with actual schedules, fault/barrier/heal/reset behavior and complete trial receipts.
- Deterministic measurement reducers and separate correctness, performance, resilience and data-integrity assessments.
- Real old/new baselines, approved intent and independently frozen protected oracles.
- PostgreSQL/RLS identity, sessions, organizations, roles, grants, invitations and lifecycle services.
- GitHub App installation, snapshots, verified webhooks, CI provenance and revocation.
- Email registration, verification, recovery and account/session service endpoints.
- Durable jobs, transactional outbox, leases/fencing, crash/resume/cancel and cleanup.
- Atomic reservations, usage, caps, forecasts and free/paid billing service integration.

Test concurrent tenants and connection-pool context reset. Preserve usage across retries and resume. A correlation is not a proven cause; a green CI result is not automatically a protected oracle.

Do not develop product authentication pages, dashboard screens or billing UI. Do not activate the fixer before its required baseline/oracle evidence is valid.

Save progress in `docs/phase-reports/phase-2.md`. Do not start phase-3.

---

## Phase 3 — Back-end autonomous repair, evidence and publication

Execute ChangeProof AI 1.0 `phase-3` according to `phases/phase-3.md` and the shared instructions above. **Work its four sections in order: skill bindings → task breakdown → acceptance commands → definition of done.** `llm-security` is a ⚠ must-load before any agent or model-broker task.

Validate baseline/campaign evidence and the specific hosted prerequisites required by each task.

Implement the allocated back-end tasks for **WP3-07, WP3-08, WP3-09, WP3-10, WP3-11, WP3-12 and WP3-18**:

- One shared reasoning engine with a hypothesis ledger, typed tools/probes, guarded mutations, bounded attempts and no-progress stopping.
- Required JS/TS, Python and JVM L3 paths and Go/PHP L2 paths.
- Framework-aware dependency upgrades, trusted lockfile resolution and actual migrations/backfills.
- Coordinated candidate bundles, mixed-version checks and evidence-driven adaptive recovery.
- Immutable private evidence services, authenticated artifact access, full-campaign reproduction jobs and fenced/idempotent publication/CI services.
- Required complex scenario and negative-case development proof.

The model proposes changes; independent verification produces facts and deterministic policy determines assessments. Do not count replay or human-reference patches as live autonomous repair. A target pass does not prove a verified bundle.

Do not manufacture an initial failure to demonstrate recovery. Candidate changes require fresh affected proof. Record observable model/tool/evidence decisions without requesting hidden chain-of-thought.

Product evidence-viewer UI belongs to phase-6. Actual model calls and external publication remain subject to explicit session authorization.

Save progress in `docs/phase-reports/phase-3.md`. Do not start phase-4.

---

## Phase 4 — Back-end product services, distribution and enterprise

Execute ChangeProof AI 1.0 `phase-4` according to `phases/phase-4.md` and the shared instructions above. **Work its four sections in order: skill bindings → task breakdown → acceptance commands → definition of done.**

Implement only the allocated back-end tasks for **WP3-27, WP3-25, WP3-29, WP3-30, WP3-31 and WP3-32**.

Provide real services for:

- Public content, templates, documentation/sample provenance and public/private data boundaries.
- Projects, repositories, environment revisions, readiness, drafts, immutable submission, status streams/polling, cancel/retry, review, evidence and usage.
- Notifications/preferences, authorized search/filter/count/snippets, exports and reproduction jobs.
- Support tickets, access requests, scoped approvals, collaboration threads, audience/history/outdated handling and privileged operator actions.
- Self-host installation/upgrade/rollback/restore, standalone binaries and broker-managed BYOK.
- SAML/SCIM and GitLab/Bitbucket provider integrations.

Follow the service-task prerequisites in MVP §22 while preserving full-WP dependencies. An unfinished UI-bearing WP must remain open even if its back-end tasks pass.

Run relevant real database, concurrent-tenant, authorization, service integration, security and native distribution checks. Configuration rendering or mocked providers do not establish live qualification.

Do not implement visual public pages, dashboard screens, trace-viewer screens, product themes or navigation in this phase. Those belong to phase-6.

Save progress in `docs/phase-reports/phase-4.md`. Do not start phase-5.

---

## Phase 5 — Back-end complex capabilities and operational readiness

Execute ChangeProof AI 1.0 `phase-5` according to `phases/phase-5.md` and the shared instructions above. **Work its four sections in order: skill bindings → task breakdown → acceptance commands → definition of done.**

Implement only the allocated back-end and preparation tasks for **WP3-13, WP3-19, WP3-20, WP3-33, WP3-34, WP3-26 and WP3-14**.

Cover:

- Certification/evaluation tooling, dev/holdout separation and B0/B1/B2/Full plus ablation definitions.
- Multi-region, partition/failover and long-horizon profiling capabilities.
- Qualified legacy repair paths with independently validated intent/baselines.
- Finite model/schedule checking, native counterexample checks, TB-scale/cross-engine migration capabilities and platform profiling.
- Multi-cloud/full-catalog automation and distribution qualification tooling.
- Capacity/fairness, recovery, backup/deletion-tombstone restore, privacy, billing operations and release runbooks/build provenance.
- Authorized organic-pilot preparation, source permissions and outcome/time/cost measurement procedures.

Run all local and scope-appropriate native development checks now. Preserve full-scale, full-horizon and independent campaign obligations for phase-7. Short probes, small datasets or configuration-only cloud profiles do not prove those capabilities.

Do not perform final frozen evaluation, whole-system release qualification or final organic-impact acceptance as part of this phase. Do not implement product UI. Do not invent owner approval, resource availability, pricing, licensing or service limits.

Record affected evidence invalidation whenever implementation/profile identities change. An opened holdout cannot become untouched again.

Save progress in `docs/phase-reports/phase-5.md`. Do not start phase-6.

---

## Phase 6 — Complete front-end development from the final mockup

Execute ChangeProof AI 1.0 `phase-6` according to `phases/phase-6.md` and the shared instructions above. **Work its four sections in order: skill bindings → task breakdown → acceptance commands → definition of done.** Its skill bindings are broader than any other phase — load them before writing UI, and run `reviewing-interface-quality` as the final gate before reporting.

Implement all allocated product front-end tasks for **WP3-12, WP3-14, WP3-21, WP3-22, WP3-24, WP3-25, WP3-26, WP3-27, WP3-28, WP3-29, WP3-30, WP3-31 and WP3-32** (the front-end column of MVP §22).

Use the actual `mockup.html` as the design source and PRD/MVP as the behavior specifications. Inspect relevant sections without printing embedded font data wholesale.

Build the complete public website, authentication/onboarding, dashboard/run journey, trace viewer, evidence/publication/outcome/evaluation surfaces, notifications/search, support/collaboration/operator console, billing/BYOK and enterprise/provider settings.

Extract the active final mockup skin into one coherent token source — do not copy its layered skins or `!important` overrides. Provide shared components, light/dark themes, responsive layouts, keyboard navigation, accessible labels/focus behavior and self-hosted Inter/Plus Jakarta Sans with their OFL notices. Runtime UI, including errors and accessibility labels, must be English (FR3-40).

Connect every route, CTA, form, menu, filter, export and collaboration action to real authorized service behavior. Maintain `FeatureCoverageRecord` with endpoint/receipt and positive/negative browser-case mappings. Do not substitute placeholder controls, toast-only actions or local/mock state for real integration.

Audit each screen's back-end prerequisites. Missing services block the dependent integration; record their owning back-end task and continue independent front-end work. Do not silently implement missing back-end phases.

Keep authority and secrets server-side. Browser persistence is restricted to theme, sidebar and account-scoped non-secret drafts.

Run build/typecheck/lint/boundaries, component checks and targeted real-stack browser integration/E2E, including accessibility, responsive layouts, errors, revoked access and reconnect behavior.

Save progress in `docs/phase-reports/phase-6.md`. Do not start phase-7.

---

## Phase 7 — Whole-system testing, qualification and release assessment

Execute ChangeProof AI 1.0 `phase-7` according to `phases/phase-7.md` and the shared instructions above. **Work its sections in order: skill bindings → task breakdown (T7-1…T7-11) → acceptance commands → definition of done → final assessment.**

Audit actual implementation and evidence from phases 1–6. Perform full acceptance closure/revalidation for **WP3-01..34** in the dependency order specified by MVP §8 and the phase-7 playbook.

Test and review all **G3-01..17**, all required **NEG3-01..40**, the complete capability catalog and all required scenario dossiers **SC3-01..11**.

Include:

- Contracts/policy/boundaries, native runner security and complete adapter capability proof.
- Protected baselines/intent, causal attribution and coordinated/mixed-version repair.
- Complete registered campaigns with separate correctness, performance, resilience and data-integrity assessments.
- Concurrent-tenant isolation, revocation, fencing, cleanup and deletion-aware restore.
- Independent clean reproduction, actual authorized publication and exact-commit CI.
- Frozen B0/B1/B2/Full evaluation and ablations with equivalent ceilings and a common independent final evaluator.
- Complete real browser journeys and every required product control.
- Capacity/outage/recovery and actual authorized free/paid billing qualification.
- Full distribution, BYOK, enterprise/provider and multi-cloud/platform qualification.
- Actual multi-region, long-horizon, bounded model-checking, populated TB-scale/cross-engine and qualified legacy campaigns.
- Authorized organic-pilot workflow recovery and owner outcome validation.

Freeze required identities, oracles, budgets, workloads, faults, schedules, repetitions and thresholds before outcomes. Include every scheduled outcome and cost, including failures and incomplete runs.

Reuse only valid evidence; run all missing or invalidated proof. Do not replace missing planned capabilities with mocks or silently develop another phase. Reproduce defects and apply only bounded fixes directly necessary for this testing scope, then rerun affected checks.

G3-08/G3-10 remain `blocked` without the required real repository/pilot access. Missing resources, calibration, licensing or authorization remain specific blockers. Documentation review results do not pass product gates.

Save commands, exit codes, artifact identities, every WP/gate assessment, limitations and next safe actions in `docs/phase-reports/phase-7.md`.

Declare full release acceptance only when every mandatory requirement and gate is proven. Qualification does not authorize payment, publication, merge or production deployment. Stop after the requested testing and assessment scope.
