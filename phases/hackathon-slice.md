# hackathon-slice — Competition vertical slice (Meta Global AI Developer Hackathon)

**Plan revision:** 3 — 26 October 2026. **Scope authority:** [BRD §21](../.prepare/BRD.md#hackathon-build-scope), [PRD §21](../.prepare/PRD.md#hackathon-competition-compliance), [MVP §23](../.prepare/MVP.md#hackathon-build-scope), [architecture competition slice](../.prepare/architecture.md#hackathon-build-architecture).

**Not a release phase.** This playbook selects a bounded vertical slice of the existing work-package DAG for the competition submission. It does **not** replace phases 1–7, does not change the §8 full-WP DAG, and completes no full WP or G3 gate by itself. The complete ChangeProof AI 1.0 release scope in [MVP §2/§20](../.prepare/MVP.md#2-mandatory-scope) is unchanged; a slice that ships is still not the product.

**Submission clock (event times, ET):** kickoff 26 Oct 12:00 PM · **submission deadline 4 Nov 9:00 PM** · judging 4–8 Nov · ceremony 9 Nov · bonus prizes ~10 Nov. Event runs virtually 26 Oct 12:00 PM – 4 Nov 9:00 PM ET. This playbook is for building the demo inside that window; it grants no portal, track or eligibility determination. The same 4 Nov 9:00 PM ET cutoff applies to the Meta Model API credit claim form.

**Outcome:** one real-runtime order-to-inventory contract break, attributable before/intervention/after, with a visible and traceable Muse Spark contribution to diagnosis and structured repair proposal, an independently verified business invariant, and a reproducible evidence dossier.

## Work and prerequisite evidence

The slice is **vertical**, not a subset of phases executed in order. Pull the dependency-ready portion of each work package that the slice needs; each selected task still proves its own boundaries.

| Needed capability | Source WP (dependency-ready portion only) | What this playbook actually requires |
| --- | --- | --- |
| Versioned contracts, pure policy, verdict precedence | WP3-01, WP3-02 | Enough contracts + policy for the slice's target/bundle outcomes, identity checks and fail-closed behavior. No hosted grant/usage/lease breadth claimed |
| Real disposable execution with isolation | WP3-04 | One disposable topology running the fixture frontend + selected backend + datastore, with a qualified boundary, cancel/cleanup receipts. Container-smoke-only is **not** sufficient evidence and must not be described as isolation |
| Impact graph and shared change representation | WP3-05 | Change → producer/consumer/workflow edges with `proven \| inferred \| unresolved` and evidence locators on the slice's own components |
| Baseline, protected intent, independent oracle | WP3-06 | A human author/freeze of business assertions **before** the model run; baseline_old passes, baseline_new reproduces an attributed failure; oracle unreachable to the fixer |
| Model broker, guarded tools, structured proposal | WP3-07 | Live Muse Spark through the versioned client; allowlisted evidence in, structured proposal out; bounded attempts; no runner handles/oracle/secrets/shell to the model |
| Telemetry and dimension facts for the slice | WP3-15, WP3-17 | Only what the slice's assertions need. Do not claim campaign/portfolio qualification the slice did not run |
| Evidence manifest and clean reproduction | WP3-12 (evidence portion only) | Pinned identities, diff, executed-check receipts, verdict + limitations, one clean re-run producing **new** receipts |
| Minimal UI surface | WP3-25 (slice surface only) | Disclosures, run status, diff, per-assertion result, blockers, provenance/trace. Not the full dashboard |

**Excluded from any claim:** WP3-03's six-ecosystem matrix · WP3-08/09 adapter matrix · WP3-10/11/18 scenario portfolio · WP3-12's authorized PR/CI (unless separately authorized) · WP3-13 evaluation · WP3-14 organic pilot · WP3-19/20/33/34 complex scope · hosted WP3-21..26/27..32 breadth. Absence of these is stated as `blocked`/out-of-scope, never as passed.

### Environment blockers to clear first (MVP §12 readiness, slice-specific)

Never substitute a simulation for these; mark the affected claim `blocked` and continue independent tasks.

- **Model access.** Live Muse Spark through Meta Model API must be verified (model ID, mode, tool-calling behavior, account balance/billing) before any "live model" label. No access → the demo is `replay_model` and must be labeled as such; open-weights partner endpoints are **not** a substitute for Muse Spark. Credits are not balance until claimed and confirmed.
- **Backend choice.** The flagship topology is Next.js + Spring Boot + FastAPI + PostgreSQL + Redis Streams. For the slice, pick **one** backend (Spring Boot *or* FastAPI) based on installed toolchain and fixture availability. Record the choice as `[DERIVED]` with the inspected toolchain versions. Do not build both for breadth; do not silently drop the datastore the assertion needs.
- **Isolation boundary.** Windows 11 Home has no Hyper-V and microVMs are Linux-only; a WSL2 or remote-Linux runner must be chosen and **recorded as a decision** before isolation evidence is claimed. Without it, "real execution" claims stay local-development-qualified and are labeled with their actual boundary.
- **Datastore/streams.** PostgreSQL and Redis must actually run if the assertion covers migration, duplicate delivery or idempotent retry. If they are unavailable, narrow the assertion and say so — do not replace the check with a mock while calling the result native.
- **Fixture repos.** Three-repository footprint (storefront, orders, inventory) is the full SC3-01 contract. The slice may use fewer repos if it still shows a real cross-component business failure; state the reduced footprint explicitly.
- **Credit claim and billing risk.** The reported US$150 Meta Model API credit is claimed once per participant account, is not shareable across team members, and must be claimed before 4 Nov 9:00 PM ET. The account is expected to carry a valid payment method, so any usage past the credit bills at standard rates. Confirm entitlement, balance, expiry, model/service mode, rate and billing before the first call, and keep the finite cap. Until confirmed, treat the credit as absent and mark the dependent claim `blocked`, never as available budget.
- **Event administration.** One track only (Indie: individual/student/team ≤ 4; Startup: representative must be an active employee), one theme, one representative who submits and lists every member. Submission goes through the official Cerebral Valley portal per the Event Waiver. Read the current waiver before submitting: it governs the IP license granted to Meta/Cerebral Valley, non-confidentiality of event materials, prize/tax handling and permitted content. Do not commit Team/Project IDs, tax forms, addresses, bank details or credentials to source control.
- **Service-mode naming.** Participant materials say Standard vs Discounted; Meta documentation says Standard vs Contributor. Treat the *behaviour* as binding (a training-permitted mode never receives secrets, credentials, personal data or sensitive source; record and disclose the mode used) and use the official label from the current terms page in user-facing copy. Do not silently pick one name in code, UI or narration while both are in circulation.

## Skill bindings for this phase

| WP / area | Load before coding | Mandatory |
| --- | --- | --- |
| Contracts / policy for the slice | `code-security`, `secret-serialization` | ⚠ `code-security` |
| Model broker / agent tools / any tool-using model integration | `llm-security` | ⚠ `llm-security` |
| Fixture app, oracle authoring, protected assertions | `code-security` | ⚠ `code-security` |
| Disposable runner / isolation | `code-security`, `security-model` | ⚠ `code-security` |
| Detector / analyzer / graph | `find-bugs` | — |
| Evidence manifest / artifact redaction | `secret-serialization` | ⚠ `secret-serialization` |
| Slice UI (disclosure, run surface) | `design-systems-frontend-architecture` | — |
| Final slice review before recording the demo | `code-review` | — |

Full binding matrix: `SKILL.md` §1 *Skill bindings*. Load only what the current task needs.

## Task breakdown — failure-path tests first

One row = one AGENTS §7.1 task header. **Write the tests column before touching implementation.** NEG3 IDs map to `SKILL.md#ref-negative-cases`.

| Task | Target path | Write these tests FIRST (NEG3-xx) | Then implement / prove |
| --- | --- | --- | --- |
| T-S1 | slice contracts | **03** invalid/changed oracle · **07** identity drift · **13** budget not reset | Versioned contracts for the slice's target/bundle identities; semantic validation rejects dangling refs; raw-byte hash distinct from canonical identity |
| T-S2 | slice policy | Stale+pass · full-pass+unknown · partial+invalid oracle · target-pass+edge-fail · mixed candidate | Pure decision over verifier facts; rejects averaging, voting and model confidence as proof |
| T-S3 | `modules/fixtures` + oracle | **03** invalid oracle · **19** legacy bug used as oracle · self-approved invariant | Business assertions authored and **frozen by a human before the model run**; oracle mounted outside the candidate workspace; fixer has no approval/freeze capability |
| T-S4 | baseline / intervention | baseline_new not attributable · failure not reproducible · fixer present during baseline | baseline_old passes on the real app; one requested contract intervention; baseline_new reproduces the consumer failure with the same workload |
| T-S5 | `modules/agent` + model broker | **08/09** malformed tool output, outage, silent provider substitution | Live Muse Spark via versioned client; allowlisted context only; structured proposal; typed failures; recorded model/API/mode/config/prompt identity; fallback only if explicitly configured **and labeled** |
| T-S6 | mutation gateway | **22** scope escalation · path escape · oversized patch | Only scenario-scoped candidate paths and typed ops; no write to policy/oracle/verifier/config/secrets; no self-authorization of merge/deploy/irreversible action |
| T-S7 | disposable runner | **10** malicious source/dependency · **24** host/metadata/secret/other-tenant escape | Qualified boundary + cancel/cleanup receipts; no API keys/host socket/control-plane secrets/unrestricted egress to the guest. **Container smoke alone is explicitly insufficient** |
| T-S8 | independent verifier + policy | Model verdict attempted · oracle mutated post-freeze · dimension hidden | Verifier executes native checks and business assertions on a fresh candidate identity; deterministic policy returns the verdict; model receives no verdict authority |
| T-S9 | evidence + reproduction | Receipt fabricated/edited · replay labeled as live | Pinned identities, exact diff, executed/not-run check list, verdict + limitations, and **one clean re-run producing new receipts** |
| T-S10 | slice UI / disclosure | Disclosure absent · watermark/provenance stripped · hidden AI interaction | Visible AI disclosure, limitations, model/mode identity, per-assertion result, blockers, provenance attribution; no path that removes Meta output provenance |
| T-S11 | compliance sweep (PRD §21) | Training-mode content sent · under-18 audience · prohibited use case | Data mode checked and recorded before sending source/telemetry; secrets/personal data never into a training-permitted mode; no prohibited category in the showcased slice |
| T-S12 | submission administration and claim | credit treated as balance before confirmation · personal/tax data or Team-ID committed · rubric narrated as verdict · track/eligibility assumed | Dated readiness checklist against the live portal/Event Waiver: one track/theme, representative + full member list, deadline/form/video format, credit claim status with entitlement/balance/mode/expiry/billing risk and finite cap, current IP/non-confidentiality and publish permission, tax/payment ownership (W-8BEN where applicable). Personal data and IDs stay out of source control. Unverified items are recorded `blocked`, never assumed |
| T-S13 | submission copy and claim audit | full-product claim · prize/winning-probability claim · illustrative mockup credit restated as awarded credit · rubric optimisation of verdict policy | Submission copy, README, video narration and slides cite only demonstrated scenario/stack/versions/workload/assertions/environment/limitations; rubric and prize figures carry a dated source label; no product policy, oracle, threshold or spend cap is changed to optimise a score |

## Demo sequence (what the recording must show)

1. Disclosures, boundary of support, allowed repository/file scope, and the human-approved invariants.
2. baseline_old — order workflow succeeds end to end.
3. Requested contract intervention, **no** consumer fix → attributed consumer failure on baseline_new.
4. Muse Spark: allowlisted evidence in → structured diagnosis/repair proposal out, with the observed decision trace and the human's retained choice. Label `live_model` or `replay_model` truthfully.
5. Candidate applied on a pinned identity; independent verifier runs build/tests/business assertions on real services in a disposable environment.
6. Per-assertion results, exact diff, provenance, scope limits, and any remaining blocker/`unverified`. A gate that did not prove stays `blocked` — never narrated as success.
7. Clean re-run or a single documented reproduction command producing **new** evidence. Replaying an old report is not an execution.

Each step keeps the value chain visible: *old workflow valid → intervention breaks it → coordinated proposal → real execution → independent proof.* A chatbot writing code is not the story; a business workflow restored with evidence is.

## Acceptance commands for this phase

**AGENTS §6: script names are targets.** Open `package.json` first and run only scripts that actually exist. An absent script is a **missing check**, never a pass.

| Check | Command, if present | Exit 0 means |
| --- | --- | --- |
| Strict typecheck | `pnpm typecheck` | `--noEmit` clean across the packages the slice touches |
| Lint + boundaries | `pnpm lint` (ESLint **and** `depcruise --config .dependency-cruiser.cjs`) | No cycles, no deep imports, no transitive escapes |
| Unit / integration | the unit/integration scripts actually listed | Policy precedence rows + contract + gateway negatives pass |
| Slice native run | a real script once implemented | Actual services + assertions on the disposable topology — reported **separately** from mock |
| Isolation probe | security/native-runner script, once implemented | Boundary probes + cleanup receipts; container-only evidence explicitly not claimed |
| Reproduction | documented reproduction command | A **fresh** run produces new receipts matching the frozen manifest |
| Submission readiness | dated readiness checklist + copy audit, once implemented | Every in-scope item verified against the live portal/waiver, or explicitly recorded `blocked`; no unverified eligibility, credit, prize, IP-license or full-product claim in submission copy |

Report mock/replay and native as separate lines. For T-S6/T-S7, a native row left as `missing check` blocks `done`.

## Definition of done for this phase

- [ ] One backend selected as `[DERIVED]` with inspected toolchain versions; the reduced repo footprint is stated.
- [ ] Invariants frozen by a human **before** the model run; oracle unreachable to the fixer; self-approval test present.
- [ ] baseline_old passes and baseline_new reproduces the attributed consumer failure on the real workload.
- [ ] Live (or honestly labeled replay) Muse Spark contribution traceable to exact model/API/mode/config/prompt identity and to the pinned candidate.
- [ ] Mutation gateway negatives prove no scope escalation, no oracle/policy/config write, no self-authorized irreversible action.
- [ ] Disposable runner proves a qualified boundary with cleanup receipts; container-smoke-only is explicitly **not** claimed.
- [ ] Independent verifier + deterministic policy produce the verdict; no model-authored verdict anywhere in the path.
- [ ] One clean reproduction yields new receipts; limitations and any `unverified`/`blocked` outcomes are stated in the dossier.
- [ ] PRD §21 compliance sweep passes: AI disclosure present, provenance/watermark preserved, data mode recorded, audience and use restrictions respected.
- [ ] Submission readiness checklist matches the live Event Waiver/portal: eligibility, one track/theme, representative/member list, deadline and required formats, credit claim state, billing-risk cap, IP/non-confidentiality/publish permissions, prize/tax details; no account or personal identifiers committed.
- [ ] Judging rubric (Impact 30%, Meta tooling 25%, Demo 25%, Technical 20%) and eligible tooling are labeled as participant-reported until checked against current official material; no judging criterion changes verifier policy or verdict.
- [ ] Service-mode behavior is verified from current terms; the correct official UI label is used. Until the Standard/Discounted vs Standard/Contributor naming conflict is resolved with a cited current source, no label is presented as authoritative.
- [ ] Submission copy avoids unverified prize, credit, eligibility, IP-license, production-readiness or winning-probability claims; claims are bounded to measured slice evidence.
- [ ] `docs/phase-reports/hackathon-slice.md` written to AGENTS §7.1/§7.2, with task status separate from full-WP status.

## Execution contract

This is a target playbook, not proof of execution and not portal authorization.

1. Read [AGENTS](../AGENTS.md), [skill](../SKILL.md), then [BRD](../.prepare/BRD.md) → [PRD](../.prepare/PRD.md) → [MVP](../.prepare/MVP.md) → [architecture](../.prepare/architecture.md), then [BRD §21](../.prepare/BRD.md#hackathon-build-scope), [PRD §21](../.prepare/PRD.md#hackathon-competition-compliance), [MVP §23](../.prepare/MVP.md#hackathon-build-scope). The specification directory is the directory containing these files; in this extracted package it is the current project root. Do not create a second specification tree or implement product source in `phases/`.
2. Audit actual source, `package.json`, toolchains, credentials and existing evidence. Documents and mockups are not proof of implementation.
3. Write AGENTS §7.1 task headers including prerequisite evidence and allowed changes. Write failure-path tests first for policy, guard, verifier and security rows. Preserve protected intent/oracle, deterministic verdicts, typed gateway, qualified guests, lease/fencing and finite cumulative budget.
4. Run strict typecheck, lint/boundaries, unit/integration and scope-appropriate native checks. Record commands + exit codes; keep mock/replay separate from real runtime.
5. **This playbook authorizes no paid API call, no external repository mutation or publication, no external message, no payment, no destructive operation, no merge and no production deployment.** Those need explicit session authorization or the team's own submission action. Absent authorization, prepare the reviewable work and report the dependent live check as `blocked`.
6. Do not execute phases 1–7 by implication, do not mark a full WP or G3 gate complete, and do not silently reduce the product scope documented in [MVP §2](../.prepare/MVP.md#2-mandatory-scope).

## Reporting and completion

During actual execution create `docs/phase-reports/hackathon-slice.md` at the application root. Do not create an execution report merely for changing these playbooks.

Record: task headers and requirement IDs; the `[DERIVED]` backend and boundary decisions with inspected versions; task status separate from full-WP status (`not_started | in_progress | blocked | done`); source/config/schema/policy/model identities; positive, negative and native results with exact commands + exit codes; artifact references; the actual `proposalMode`/`executionMode` labels used; compliance-sweep result; limitations, missing checks, blockers/owners; and the exact next ready task.

The slice completes only its own tasks with proof. Full WP `done` still requires every [§8](../.prepare/MVP.md#8-work-packages-for-agents) dependency and all original acceptance. Gate contributions are not gate passes. A submission built here is a competition demo of one vertical slice — it does not declare ChangeProof AI 1.0 complete, and it must not be described as such.
