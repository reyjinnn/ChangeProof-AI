# ChangeProof AI 1.0 — Minimum Viable Product and Development Brief

**Active scope — 22 October 2026:** all features/modules mentioned in these four documents and `.template-ui/mockup.html` are mandatory in the complete release. No features are deferred to a later stage; implementation order follows dependencies. Design targets and mockup appearance remain no proof of implementation. Earlier scope decisions in MVP §19 history have been superseded.

**Type:** definition of a minimum product with real impact.  
**Status:** all gates in this document are targets, not claims of passing.  
**References:** [BRD](BRD.md), [PRD](PRD.md), [Architecture](architecture.md).  
**Delivery model:** dependencies and evidence gates; no calendar schedule.

**Primary product:** hosted SaaS with open-source product source; browser/GitHub App onboarding without cloning or installing ChangeProof. The [hosted SaaS brief](PRD.md#18-customer-journey-and-hosted-access) defines service behavior and operations.

**Further detail:** [problem classes](PRD.md#17-problem-profiles-and-capability-limits) and [acceptance scenarios](MVP.md#17-campaign-protocol-and-acceptance-dossier). Additions SC3-07..11, WP3-15..20, and G3-11 remain **targets**. All scope described in the documents and mockup is mandatory before completion.

## 1. MVP definition

MVP is a hosted service with a complete flow: website/login → organization/GitHub App → project/readiness → intent/issue/PR and budget → durable queued run → graph/diagnosis → coordinated patches → real execution → independent verification → evidence-backed PR → outcome validation by the owner. The provider manages infrastructure/model credentials; customers do not need a server/native toolchain or BYOK for the hosted minimum.

The product must prove depth on the flagship across Next.js, Spring Boot, FastAPI, PostgreSQL, and Redis; while also proving that the adapter contract can extend to other ecosystems with honest support levels.

MVP is not complete merely because an engine or adapter can be invoked. MVP is complete when minimum capabilities are certified, complex workflows recover, cases that cannot be proven are handled correctly, and organic problems in pilot applications are genuinely resolved.

Hosted delivery, multi-tenant isolation, capacity/cost controls and operations are also mandatory. CLI-only, local dashboard/mock, a single demo tenant or self-host deployment do not replace hosted release gates.

Minimum numerical decisions in this document are marked `[DERIVED]`: initial design decisions to make acceptance executable, not benchmark results or limits on product ambition.

## 2. Mandatory scope

### Included

- Modular monolith TypeScript host, common contracts, capability registry, and adapter conformance.
- Six ecosystem families: JS/TS, Python, JVM, Go, PHP, and .NET.
- L1/L2/L3 according to the matrix, for frozen versions and change categories.
- Cross-stack graph with API, dependency, database, event, cache, and workflow edges.
- One shared model engine with verified real provider integration.
- Framework-aware patch, producer/consumer coordinated repair, generated-code ownership.
- Actual dependency upgrade and actual schema/data migration in a disposable environment.
- Adaptive recovery, checkpoints, resource caps, native independent verifier.
- Incident telemetry/cause ledger; repeated concurrency/fault campaigns; matched-load performance/pool checks; active-writer migration; legacy characterization and useful abstention on the bounded flagship.
- Mixed-version integration checks, protected business invariants, bundle policy.
- Immutable evidence, multi-repository PR publication, CI attestation, reproduction.
- New evaluation dataset and organic application pilot with owner validation.
- Hosted dashboard/API, GitHub sign-in/App, organizations/roles/project grants and private-repository authorization.
- PostgreSQL authoritative state, durable leased jobs/outbox, isolated execution fleet and private object storage.
- Per-tenant/global admission, finite cost reservations/usage, cancellation/revocation and worker recovery.
- Privacy/model disclosure, encrypted data, retention/deletion, private evidence access and backup restore.
- Actual hosted deployment, multi-organization qualification, service capacity/operations runbook and open-source release readiness.

### All features are mandatory in the same release

There are no later-stage feature categories or post-release backlog in this scope. All capabilities mentioned in the four documents and `.template-ui/mockup.html` must be implemented, connected to real services, tested and proven before the product is declared complete. Work order may be incremental according to dependencies; completion must not use a subset as a substitute for the complete scope.

This includes multi-region/consensus failure, exhaustive schedule/model checking within a finite registered model, long-soak leak qualification, TB-scale/cross-engine migration, qualified legacy recovery, framework/ORM qualification, multi-cloud deployment automation, self-host installation, standalone operator binary, BYOK, SAML/SCIM, non-GitHub repository providers and automated paid subscriptions/invoicing/refund. The public website, all account flows, templates/drafts, notification/search, evidence/audit exports, support/access requests, internal discussions and reviewer notes are also mandatory.

The capability catalog must freeze all promised versions/ranges, frameworks/ORMs, databases/brokers, platforms, providers and deployment profiles before acceptance. The six ecosystems and all frameworks/libraries in the matrix remain covered. General terms such as all versions/databases do not mean unlimited support for undefined versions or products: every published entry must have scope, an adapter, positive/negative cases and evidence. Profiles not yet agreed/tested are blockers for the related completion, not features that may be deferred. Public repository submission is mandatory, with the same rights/admission/isolation checks; not a security bypass for arbitrary code.

There is no day-based cut line. Scope changes only through a recorded product decision before evaluation, and such changes must not disguise failed gates.

<a id="3-target-capability-matrix"></a>
## 3. Target capability matrix

All values below are **targets**, while the initial proven level in a new registry is `none`. L1 for each framework/library in the table requires at least one positive discovery/extraction application and one negative/unsupported configuration case. L2/L3 satisfy all requirements of lower levels.

| Ecosystem | Target components | MVP minimum level | Minimum scope |
| --- | --- | --- | --- |
| JS/TS frontend | React, Next.js | L3 | API consumer/DTO mapping, rendering/business interaction; build + browser verification |
| JS/TS backend | NestJS, Express, Fastify | L3 | Route/validation/serialization and API consumer changes; native tests + actual HTTP |
| Other JS/TS frontend | Vue, Nuxt, Angular, SvelteKit | L1 | Discovery, component/API boundary extraction, impact and unknowns |
| Other JS/TS backend | Hono | L1 | Route/contract extraction and impact |
| JS/TS persistence | Prisma | L3 | Selected schema/mapping/backfill class on PostgreSQL |
| Other JS/TS persistence | TypeORM, Drizzle, Sequelize | L1 | Entities/schema/migrations/dependency extraction |
| Python backend | FastAPI, Django | L3 | Route/schema/consumer behavior; native tests + actual HTTP |
| Other Python backend | Flask | L1 | Discovery, route/dependency extraction |
| Python schema/persistence | Pydantic, SQLAlchemy | L3 | Selected validation/serialization, ORM mapping and migration integration |
| Other Python persistence | Django ORM | L1 | Model/migration extraction; L3 Django API does not automatically cover the migration engine |
| JVM backend | Spring Boot | L3 | API/service mapping and cross-service contracts |
| JVM persistence | Hibernate/JPA | L3 | Selected entity/schema/mapping compatibility on PostgreSQL |
| Other JVM frameworks | Quarkus, Micronaut, Ktor | L1 | Project/version/build, route/contract/dependency extraction |
| Go backend | Gin, Fiber | L2 | API consumer/handler candidate patch and guard validation |
| Other Go backend | Echo, net/http | L1 | Route/dependency/contract extraction |
| Go persistence | GORM, Ent | L1 | Model/schema/dependency extraction |
| PHP backend | Laravel | L2 | Route/service/API consumer patch with framework constraints |
| Other PHP backend/persistence | Symfony, Eloquent, Doctrine | L1 | Discovery, routes/entities/migrations/dependencies |
| .NET | ASP.NET Core, Entity Framework Core | L1 | Project/dependency, endpoint/entity/migration extraction |

JVM coverage must include at least one Java project and one Kotlin project at L1. Java Spring Boot is the minimum L3 path; Kotlin L3 is not implied. JS and TS are distinguished in capability records.

Each L3 framework/component has `[DERIVED]` at least two positive regression cases with different usage patterns, one negative/ambiguous case, and one non-breaking/no-impact control on real-runtime applications. One case may prove several capabilities if each assertion/provenance is separate. A “hello world + rename string” alone does not satisfy positive coverage.

Each L2 has at least one nontrivial valid patch case and one rejected/unsupported case. Without full proof available, L2 output remains a candidate; it is not assigned `fixed` or a verified label. Successful native compilation is limited evidence, not automatic promotion to L3.

Runtime/framework/library versions, supported features, commands, data volumes, and images are selected and pinned during implementation. There is no “all versions” claim. At least one explicit version/range for each record.

Additional complexity certification minimums apply to **flagship profiles**, not all framework combinations in the table. Records include problem class, workload/fault envelope, observation horizon, and required proof dimensions. L3 API on other frameworks still does not advertise concurrency/performance/resilience certification that has not been run.

## 4. Meaning of real implementation

Acceptance runtime uses genuine application source, native compiler/build tools, running servers/processes, actual database/messaging, and test clients/browsers traversing business flows.

The main database or service dependency must not be replaced with a fake for gates claiming coverage of it. Mocks for unit tests remain encouraged; model replay is only for deterministic development/regression. AI repair acceptance requires actual model invocation and tool trace, without replayed proposals or injected reference patches.

Three mandatory labels on cases/runs:

| Field | Values |
| --- | --- |
| `origin` | `controlled_change`, `historical_organic`, `current_organic` |
| `executionMode` | `mock`, `replay`, `real_runtime` |
| `proposalMode` | `live_model`, `replay_model`, `human_reference` |

Labels are not interchangeable. Real-runtime with a human reference patch proves the verifier/fixture, not yet the AI's repair capability. A controlled change in a real application does not yet prove customer adoption.

## 5. Mandatory complex case portfolio

| ID | Scenario | Required complexity | Success evidence |
| --- | --- | --- | --- |
| SC3-01 | Order contract + data + event change | Next.js + Spring Boot + FastAPI, ≥3 repos, PostgreSQL, Redis Streams | Order/reservation workflow recovers, old data correct, final and rollout states valid |
| SC3-02 | Dependency/framework upgrade | Direct+transitive incompatibility, manifest/lock, at least two interacting components | Native build/runtime pass, intended target version installed, no upgrade revert |
| SC3-03 | Populated database migration | Active readers/writers, backfill/chunk commit races, interruption/resume, journal and constraints | No lost acknowledged writes, semantic reconciliation and recovery proven |
| SC3-04 | Event/cache cascading failure | Duplicate delivery, relevant retry/out-of-order, stale serialization/key | No double effect; cache/event consumers compatible |
| SC3-05 | Adaptive recovery | First proposal fails for a nontrivial reason; failure generates a new hypothesis | Later candidate restores flow, bounded trace and full proof |
| SC3-06 | Organic pilot issue | Problem genuinely reported/experienced by the application owner, dependency/semantic complexity | Owner accepts repair from an actual run with before/after evidence |
| SC3-07 | Concurrency and transaction safety | Lost update, lock-order deadlock, duplicate processing on native DB | Repeated schedules/perturbations pass C/P/R/D according to scope |
| SC3-08 | Latency/goodput and pool exhaustion | Error-path lease lifecycle, contention, paired native load | SLO/margins, pool recovery, bounded resource behavior and measurement validity |
| SC3-09 | Legacy/telemetry diagnosis | Sparse docs/tests, dynamic edges, clock/sampling/deploy ambiguity | Correct uncertainty, characterization, no unsupported mutation/claim; not a repair-success case |

SC3-05 must not be engineered by deliberately making the first proposal bad to make recovery look successful. Use a genuinely challenging dev case or infrastructure fault injection to test the mechanism separately; passing adaptive repair requires a real candidate failure and subsequent successful reasoning on the acceptance case.

SC3-01 through SC3-05 may share an application family, but triggers, interventions, oracle, and outcome evidence must be distinguishable. SC3-06 must originate from an organic problem; it must not be replaced with a controlled mutation.

SC3-01..05 and SC3-07..08 are mandatory repair acceptance; SC3-06 is the organic outcome gate; SC3-09 is mandatory diagnosis/safety acceptance. [Dossier and protocol](MVP.md#17-campaign-protocol-and-acceptance-dossier) define workload, faults, repeated trials, thresholds, evidence and failure paths. SC3-10 (multi-region) and SC3-11 (long-horizon leak) are also mandatory acceptance and part of the required case portfolio.

### Detailed SC3-01 contract

1. Source from at least three independent repositories: storefront, orders, inventory. Migration/schema may be owned by a service repo.
2. The old system runs create order → inventory reserve → read status through the browser and APIs.
3. Change intent specifies new identifier/amount representations and data/event compatibility. The source of truth consists of reviewed requirements and contracts.
4. The requested intervention is applied to the producer/data/event version without a candidate consumer patch; baseline_new must reproduce an attributed failure.
5. The candidate may change both producer and consumers on authorized paths, provided intent remains satisfied.
6. The verifier runs actual HTTP, PostgreSQL migration/query, Redis event consumption, and browser flow.
7. Protected assertions include amount precision, tenant isolation, legacy rows, exactly-one business reservation effect under duplicate delivery, error semantics, and idempotent retry.
8. The compatibility matrix tests states required by deployment order. Incompatible states must be blocked by rollout prerequisites.
9. Results consist of a verified bundle, immutable evidence, linked PRs, and CI on exact commits.

## 6. Acceptance gates

| Gate | Passing criteria | Mandatory evidence |
| --- | --- | --- |
| G3-01 Foundation | Concrete contracts, boundary enforcement, policy precedence, capability conformance | Schemas, behavior tests, commands/exit codes |
| G3-02 Native runner | Framework builds and actual services run in isolation; cleanup proven | Per-profile probes, process/container/network receipts |
| G3-03 Support matrix | All minimum L1/L2/L3 §3 achieved on pinned capability scope | Certification records and actual case results |
| G3-04 Baseline/intent | Old valid; intervention failure causal; immutable oracle + intended new behavior | Frozen manifests and baseline artifacts |
| G3-05 Complex repair | SC3-01..05, SC3-07..08 and SC3-10..11 full proof, graph coverage, candidate identity, required dimensions pass | Actual model traces, per-trial histories and target/bundle assessments |
| G3-06 Negative safety | All mandatory negatives and SC3-09 diagnosis/abstention match expected behavior | Fail-closed matrix, uncertainty/gap evidence, rejected mutation receipts |
| G3-07 Reproduction | SC3-01 and mandatory campaign profiles reproduced independently from a clean environment | Full frozen campaign with the same counts/fault/workload; three smoke executions alone are insufficient |
| G3-08 Publication | Authorized live PR bundle and exact-commit CI, retry/idempotency proven | Actual PR URLs/commits/artifacts and CI attestations |
| G3-09 Evaluation | Frozen new dataset/arms, actual runs, denominators/costs, §10 release criteria | Evaluation report and per-case artifacts |
| G3-10 User impact | SC3-06 actual issue reproduced and recovered, owner accepts results in a representative environment | Issue/source provenance, before/after, owner validation/adoption record |
| G3-11 Campaign proof | Pre-registered schedules/load/faults/n, valid telemetry, all required C/P/R/D pass and no unsupported claim | ExperimentPlan, all-trial receipts, causal ledger, measurement/claim limits |
| G3-12 Hosted journey | Actual web login/org/GitHub onboarding through live model/native run, private review and authorized PR without customer local setup | Browser E2E on deployed stack, installation/repo grants, durable status and usage receipts |
| G3-13 Hosted security | Tenant/repo/session/job/artifact isolation, access revocation and hostile-code execution boundary qualified | NEG3-21..40 relevant security paths, real guest escape/cleanup probes, no cross-tenant disclosure |
| G3-14 Service release | Durable queue/accounting, free+paid billing, fairness/capacity, backup/deletion recovery and deployment/runbook/source readiness | Frozen service profile, actual payment lifecycle/load/outage/restore campaigns, independent org receipts and license/build records |
| G3-15 Product experience | All public/account/workspace routes, notifications/search/export, collaboration and support work for real | Authorized browser E2E, delivery/persistence receipts, current-grant negatives and complete UI coverage map |
| G3-16 Distribution and enterprise | Hosted/self-host/binary/BYOK, multi-cloud, SAML/SCIM and non-GitHub providers qualified | Actual per-profile install/upgrade/restore/run/publication, identity/provider/security receipts and full catalog coverage |
| G3-17 Full complex scope | Multi-region/consensus, long-soak, finite model checking, TB/cross-engine, cross-platform and qualified legacy repair pass | Frozen workload/topology/data/model/horizon + full independent native campaigns/reproduction; no deferred profile |

“Independent reproduction” means execution from a manifest by a clean runner without chat context/original candidate workspace; a second human is not mandatory. All re-runs count as executions, not additional unique issues.

G3-11 strengthens evidence, not replaces G3-04..07. Minimum counts and statistical limits follow the shared protocol; all future runs must fill in numeric thresholds before acceptance. Documentation review results do not pass product gates.

The additional detail in [§21](#product-depth-acceptance) is mandatory at the related gates: G3-04 readiness/oracle independence; G3-07 fresh reproduction; G3-09 B2/ablation and economics; G3-12/15 assisted onboarding; G3-13 cache/current-grant isolation; G3-14 forecast/reservation. Sponsor credits and simulated assessment do not pass gates.

G3-08/G3-10 cannot yet pass if repository/pilot access is unavailable. Status must be `blocked` at the specific gate; engineering that does not depend on that access may continue. Do not replace these gates with simulation or example URLs.

## 7. Minimum negative cases

| ID | Condition | Expected behavior |
| --- | --- | --- |
| NEG3-01 | No replacement or conflicting requirements | `unverified`, evidence conflict, no invented API |
| NEG3-02 | Important dynamic/reflection edge unknown | Blocking coverage gap, not verified |
| NEG3-03 | Invalid baseline/oracle or changed oracle source | Invalid evidence; other full passes do not salvage it |
| NEG3-04 | Candidate removes auth/test or cancels intent | Guard reject and report-only |
| NEG3-05 | Data migration loses rows/precision/tenant mapping | No fixed; data integrity failure recorded |
| NEG3-06 | Local target pass but cross-service/mixed-version fails | Bundle not verified |
| NEG3-07 | Producer/consumer/dependency/dataset drift | Invalid/stale according to identity domain; no proof reuse |
| NEG3-08 | Model outage, native timeout/OOM, service unavailable | `unverified`, bounded recovery/cleanup |
| NEG3-09 | Unsupported adapter/version or forged L3 | Explicit unsupported; no silent generic verified fallback |
| NEG3-10 | Malicious package/test/repo instruction | No credential/socket/egress/scope escape |
| NEG3-11 | Duplicate/out-of-order event causes double effect | Behavioral test fails despite green HTTP/build |
| NEG3-12 | Some PRs fail or CI tests a different candidate | Publication incomplete, no coordinated success claim |
| NEG3-13 | Budget exhausted/resume or repeated candidate retries | Usage does not reset, full proof not fabricated |
| NEG3-14 | Protected evidence inaccessible to reviewer/wrong hash | Publication held and explicit artifact error |
| NEG3-15 | Single green, incomplete repetition, or seed treated as exact replay | `campaign_incomplete`/bounded claim, no positive assurance |
| NEG3-16 | Clock skew/drop/stale deploy label produces false causal join | Gap and `causality_unproven`, no fabricated cause |
| NEG3-17 | Fault injector noop or fails to heal | `experiment_invalid`, cleanup; not treated as app recovery |
| NEG3-18 | Perf improved by dropping traffic, removing timeouts, noise/CI overlap | Measurement invalid/inconclusive or behavior fail; no performance pass |
| NEG3-19 | Observed legacy bug used as oracle without domain validation | `behavior_contract_unknown`, diagnosis-only |
| NEG3-20 | Cosmetic retry/no-information credited as progress, cap reset | Stop branch, actual usage retained, explicit blocker |
| NEG3-21 | Forged tenant/repo/artifact IDs, stale member or viewer mutation | Denied without disclosure in API/stream/download/search; correct audit tenant |
| NEG3-22 | Installation/repo access revoked while queued/running/publish | New effects denied, job stopped/cleanup, in-flight effects reconciled |
| NEG3-23 | Duplicate webhook/job, stale lease, lost publish response | Fenced worker denied; one logical effect/usage/PR through dedup+reconciliation |
| NEG3-24 | Malicious customer source/dependency attempts escape or metadata access | Qualified guest denies host/control-plane/secrets/other-tenant access; quarantine/cleanup |
| NEG3-25 | Concurrent reservations, duplicate debit, exhausted quota or retry reset | Atomic capped admission, usage reconciled, no double charge or weakened proof |
| NEG3-26 | Noisy neighbor, queue/DB/worker outage and cancel/drain race | Frozen fairness/recovery bounds satisfied; no lost accepted job/orphan authority |
| NEG3-27 | Public artifact link, revoked download, deletion then backup restore | Current grant enforced, purge/tombstone replay, no customer-data resurrection |
| NEG3-28 | Mock hosted demo, missing capacity/model/license/privacy profile or forged paid entitlement | Specific gate blocked; no public/paid readiness claim or silent fallback |
| NEG3-29 | Guest/private deep link, forged return target or stale session | Login/denied without disclosure; validated return target and data not from public cache |
| NEG3-30 | Reset/verification replay, enumeration or email-based account takeover | Purpose/expiry/single-use/rate limit enforced; no silent linking/session/key leak |
| NEG3-31 | Duplicate notification, forged recipient or revoked grant | One logical inbox item, isolated read/dismiss, current authorized count/snippet/link only |
| NEG3-32 | Search/suggestion/count/cache/export uses stale tenant/grant | Denied or scoped result without forbidden metadata; revoke/delete invalidates cache/index |
| NEG3-33 | Export/reproduction uses missing/tampered artifact or stale candidate | Explicit integrity error/blocker, durable budgeted job; no fabricated download/proof |
| NEG3-34 | Support/access request grants automatic access or Owner opens operator console | Request is not a grant; current approver/scope/expiry/operator roles checked, audited denial |
| NEG3-35 | Internal note shared without permission, XSS, candidate drift or comment changes verdict | Audience enforced, sanitized body, outdated context and immutable proof, idempotent versioned writes |
| NEG3-36 | Payment signature/entitlement forgery, duplicate event, refund/period race | Server-verified reconciliation; no double debit, invoice/refund/entitlement drift |
| NEG3-37 | BYOK/installation/restore leaks key or bypasses host isolation | Secret broker only, revoke/rotation/accounting pass; deployment gate blocked if actual mode not yet qualified |
| NEG3-38 | Wrong SAML issuer/tenant, SCIM replay/deprovision race or domain takeover | Identity binding/replay/revoke checks; no repo/operator grant escalation or last-owner lockout |
| NEG3-39 | Provider mismatch/outage, wrong head/CI or public source instruction | Provider-bound exact identity, fenced publication/reconciliation, explicit partial effects, no instruction execution |
| NEG3-40 | Short soak/one-host geo simulation/small dataset treated as full complex qualification | G3-17 blocked; actual declared horizon/regions/bytes/engines/platforms/model bounds and independent proof mandatory |

## 8. Work packages for agents

Work on one package whose prerequisites are ready. Each package may be broken into small tasks with observable behavior. Decomposition does not change the gate or allow a task to be `done` merely because an interface is available.

| ID | Dependency | Implementation and target location | Done when |
| --- | --- | --- | --- |
| WP3-01 | — | `src/core/contracts`, `src/modules/policy`; engine+hosted schemas/ports, IDs, versioning, outcomes and bundle rules | Contract/precedence/identity tests pass, including target pass + failed edge; hosted grants/lease/usage contracts semantic validation ready |
| WP3-02 | WP3-01 | Root toolchain, `src/orchestrator`, CLI, boundaries | One host package can build/run; forbidden imports rejected; explicit missing-config errors |
| WP3-03 | WP3-02 | `modules/adapters`, inventory, capability registry | Six ecosystems registered; entire L1 matrix has positive/negative extraction proof |
| WP3-04 | WP3-02 | `modules/verifier`, trusted supervisor and dependency broker | Native builds/service topology, security probes and cleanup for all required profiles pass |
| WP3-05 | WP3-01, WP3-03 | `modules/detector`, `modules/analyzer`, `modules/graph` | API/data/event/dependency changes enter shared graph with evidence and unknowns |
| WP3-06 | WP3-04, WP3-05, WP3-16, WP3-17 | `modules/fixtures`, verifier stages, real applications | SC3-01 old valid/new attributed failure without fixer, repeated baseline receipts and approved intent; required dimension assessment available; oracle inaccessible to agent tools |
| WP3-07 | WP3-06 | `modules/agent`, tools/gateway, model broker, planner | Actual model tools run, guarded patch, bounded attempts, Consumer/Target A closed loop |

**Hackathon vertical-slice build mapping (not WP completion):** the competition build may select the dependency-ready portions of WP3-01/02/04/05/06/07/15/17 plus the smallest UI/evidence surface needed to run the BRD §21 demo. Each selected task still proves its own boundaries; no incomplete WP is called done. Do not claim WP3-03's full six-ecosystem matrix, WP3-08/09's remaining adapter matrix, WP3-10/11/18's full scenario portfolio, WP3-12's authorized PR/CI, WP3-13's release evaluation, WP3-14's organic pilot, or hosted WP/gates based on this vertical slice. The work-package DAG and final-release gates remain unchanged. The exact competition slice and acceptance sequence are in [MVP §23](#hackathon-build-scope).
| WP3-08 | WP3-07 | JS/TS, Python, JVM L3 adapter implementations | All minimum L3 framework API/UI cases pass with native runtime |
| WP3-09 | WP3-07 | Go/PHP L2, remaining conformance | Gin/Fiber/Laravel valid candidate + negative cases; honest unsupported verification |
| WP3-10 | WP3-08 | `modules/migrations`, dependency adapters/broker | Prisma/SQLAlchemy/Hibernate/Pydantic capability cases and SC3-02/03 pass |
| WP3-11 | WP3-10, WP3-17 | `modules/graph`, orchestrator bundle/recovery, event adapters | SC3-01/04/05 actual repair, telemetry-supported retry diagnosis, no-progress stopping, mixed-version campaign |
| WP3-12 | WP3-11, WP3-22 | `modules/evidence`, `modules/github`, viewer | Immutable all-trial/4D artifacts + full-campaign repro + authorized actual PR bundle/CI + idempotency |
| WP3-13 | WP3-08, WP3-09, WP3-10, WP3-11, WP3-12, WP3-18 | `bench`, certification, security/regression suites | Complete matrix, mandatory negatives/campaigns, frozen evaluation release criteria pass |
| WP3-14 | WP3-12, WP3-13, WP3-19, WP3-20, WP3-26, WP3-31, WP3-32, WP3-33, WP3-34 | Hosted pilot integration and outcome validation | Organic issue repaired via actual hosted journey; owner validation/adoption; all engine and SaaS gates reviewed |
| WP3-15 | WP3-02, WP3-05 | `modules/observability`, diagnosis/characterization ports | FR3-25/28 schemas and ingestion; labeled complete/missing/skew fixtures have correct provenance, uncertainty and denied unsafe mutations |
| WP3-16 | WP3-04, WP3-15 | `modules/verifier` campaign/schedule/fault execution | FR3-26: real barrier/fault/heal, reset/journal receipts, n enforcement, all-trial accounting, failed injection+cleanup tests; no model required |
| WP3-17 | WP3-01, WP3-16 | Trusted measurement reducers, policy dimension assessment | FR3-27: matched-window/quality/uncertainty calculations; pass+inconclusive/fail precedence tests; no aggregate success masking |
| WP3-18 | WP3-11, WP3-17 | Complex scenario qualification and regression | SC3-03/04 deep variants, SC3-07/08/09 and NEG3-15..20 have actual receipts; G3-11 and independent campaign proof |

ID numbers are retained as identities, not numerical order. Engine subflow: **WP3-01 → WP3-02 → WP3-03/WP3-04 → WP3-05 → WP3-15 → WP3-16 → WP3-17 → WP3-06 → WP3-07 → WP3-08/WP3-09 → WP3-10 → WP3-11 → WP3-12/WP3-18 → WP3-13**. Additional hosted prerequisites follow the table; WP3-12 waits for WP3-22 and final WP3-14 waits for WP3-26. A slash denotes work with available prerequisites, not an instruction to run subagents. WP3-17 reducers must be ready before the baseline is declared valid and the closed loop produces a verdict.

| ID | Dependency | Mandatory implementation | Done when |
| --- | --- | --- | --- |
| WP3-19 | WP3-18 | SC3-10 multi-region + SC3-11 long-horizon profiles | Owner consistency/RPO/RTO or leak horizon approved, native topology/profiling qualified, pre-registered campaigns and cost caps proven; claim scoped per profile |
| WP3-20 | WP3-15, WP3-18 | Qualified legacy recovery on additional corpus/pilot | Missing intent/history resolved by trusted owner, independent invariants/baseline valid, actual repair campaign passes; prerequisites still missing produce blockers |

WP3-19/20 must be final release dependencies. WP3-15/18 discovery/characterization still happens first; qualified recovery waits for a valid oracle/baseline.

### Mandatory hosted work packages

| ID | Dependency | Target implementation | Done when |
| --- | --- | --- | --- |
| WP3-21 | WP3-02 | `modules/identity`, `modules/lifecycle`, PostgreSQL schema/RLS and artifact ports | FR3-29/35 concrete schemas, sessions/roles/grants/invites, tenant query isolation and retention primitives pass; no local JSON authority |
| WP3-22 | WP3-21 | GitHub App sign-in/install/webhooks/snapshot/revocation | FR3-30 live scoped install + durable dedup events; wrong-install/grant/revoke negatives pass; secret broker qualified |
| WP3-23 | WP3-04, WP3-21, WP3-22 | `modules/jobs`, dispatcher/guest supervisor, durable state/outbox | FR3-32/33 actual hostile-code isolation, lease/fence/crash/resume/cancel/orphan cleanup and tenant queues pass |
| WP3-24 | WP3-21, WP3-23 | `modules/usage`, reservations/entitlements/ledger | FR3-34 concurrent atomic admission, actual usage/settlement/cancel caps pass; free tier profile frozen; free and paid billing both qualified before completion |
| WP3-25 | WP3-12, WP3-22, WP3-23, WP3-24, WP3-28 | `apps/dashboard`, `http`, private artifact access proxy | FR3-31/35 browser E2E without clone/BYOK, actual model/native run/PR, role/revocation/evidence/usage UI; G3-12 pass |
| WP3-26 | WP3-13, WP3-25, WP3-27, WP3-29, WP3-30 | `infra`, service capacity/recovery/privacy campaigns and release docs | FR3-36 + NFR3-12..15; G3-13/14 actual multi-org/load/outage/restore/security proof, license/build readiness; no simulated public readiness |

### Mandatory work packages for product completeness

| ID | Dependency | Target implementation | Done when |
| --- | --- | --- | --- |
| WP3-27 | WP3-02 | Public website, docs/FAQ/templates/sample report, theme/navigation | FR3-37 all public routes/links/CTA, public-private boundary and actual content/release provenance pass |
| WP3-28 | WP3-21 | Email registration/verification/recovery, sessions/account linking | FR3-38 actual email delivery/login/recovery, correct onboarding and NEG3-29/30 pass; GitHub path remains available |
| WP3-29 | WP3-25 | Notifications, query/search/filter, evidence/audit exports and reproduction UI | FR3-39/40 + existing FR3-18/20/31/35 actual persistence, authorized query/export/reproduction and NEG3-31..33 pass |
| WP3-30 | WP3-25, WP3-29 | Support/access requests, service/operator UI and internal/reviewer collaboration | FR3-41/42 actual tickets/threads/audience/notifications/support expiry/operator roles, NEG3-34/35 pass |
| WP3-31 | WP3-24, WP3-25 | Self-host/binary/BYOK and deployment foundations | FR3-43 actual install/upgrade/restore, model key rotation/revoke/accounting, complete native run/PR and NEG3-37 pass |
| WP3-32 | WP3-22, WP3-28 | SAML/SCIM and GitLab/Bitbucket provider adapters | FR3-44/45 actual IdP/provisioning and per-provider snapshot/event/publication/CI, NEG3-38/39 pass |
| WP3-33 | WP3-10, WP3-18 | Finite model/schedule checking, TB-scale/cross-engine migration and platform profiling | Full §20 profiles, actual data volumes/engines/native histories, independent reproduction and NEG3-40 pass |
| WP3-34 | WP3-03, WP3-31, WP3-33 | Multi-cloud automation and full capability catalog qualification | Each declared cloud/platform/framework/ORM/database/broker/version/profile has actual positive/negative proof, install/run/restore/teardown receipts; G3-16/17 coverage complete |

The hosted DAG starts after WP3-02: WP3-21 → WP3-22 → WP3-23 → WP3-24 → WP3-25 → WP3-26 → WP3-14, with engine dependencies on each row. WP3-12 requires WP3-22 for live authorized publication; WP3-25 requires ready engine/evidence. One topological order is not a calendar and does not force all engine/hosted tasks to wait for each other when separate prerequisites are already available. WP3-19/20 are mandatory and prerequisites for final WP3-14.

Pilot repositories and owners may be sought/onboarded from WP3-03; final WP3-14 acceptance still depends on complete evidence. Missing pilot data/checks are recorded as real dependencies, not filled with examples.

Further detail on existing WPs in [§21](#product-depth-acceptance) is additional mandatory acceptance, with no new WP or DAG changes. Readiness/reuse/forecast/evaluation contracts belong in WP3-01; behavior belongs in its owning WP after table prerequisites are ready. Design priority does not allow the dashboard/agent to bypass baseline, isolation or grants prerequisites.

### Required task format

```text
Task ID / parent WP:
Requirement IDs:
User-visible outcome:
Prerequisite evidence:
Allowed source/config changes:
Input snapshots + intended intervention:
Acceptance checks (positive, negative, native):
Protected oracle / proof scope:
Artifacts expected:
Actual commands + exit codes:
Status + remaining blocker:
Next dependency-ready task:
```

Before implementing policy/guard/verifier, write relevant failure-path tests. After changes, run strict typecheck, lint/boundaries, unit/integration and native checks according to scope. Mock and native verification are reported separately.

<a id="9-new-evaluation-design"></a>
## 9. New evaluation design

The `changeproof-3` dataset has its own manifest/namespace and version history. Case definitions, labels, oracle, and budget must not be silently changed after evaluation begins. Results from one dataset version do not automatically prove other versions or capabilities.

Before tuning, define capability coverage, complexity dimensions, expected impacted targets/edges, fixability labels, independent oracle, dev/holdout partitions, model identity, resource profiles, and acceptance thresholds.

Minimum `[DERIVED]`: each repair class SC3-01..05, SC3-07..08 and SC3-10..11 has an independent development case and holdout case with data/code/schedule variation; SC3-09 has its own diagnosis holdout and does not enter the fix-success denominator. All mandatory negatives and capability cases are recorded. The SC3-06 pilot is reported separately and not treated as untouched holdout if used during development. Total unique cases are counted from the actual manifest, not trial counts or tables.

Complexity metadata includes number of repos/services/languages, graph depth, dynamic surfaces, persistence/event involvement, deployment combinations, and invariant set. Number of changed files is not the sole complexity proxy.

B0/B1/B2/Full are compared on pinned cases and a common evaluator, according to **evaluation design revision 2 [DERIVED]**. Freeze model/provider/mode/config, the same total resource ceiling, preparation/tools/evaluator costs, attempt policy, repetition/case order and feedback disclosure before the run. Terminal limits apply equally; one-shot B0/B1 remain arm design restrictions, not reasons to give Full extra budget. No hidden oracle, expected patch or Full trace is given to baselines.

| Arm | Capabilities and restrictions |
| --- | --- |
| B0 | Basic discovery, one proposal, no verifier feedback |
| B1 | Structured cross-system graph, one proposal, no retry |
| B2 | Iterative coding agent: all repositories in the same scope, same source/config/issue/public contracts, isolated terminal, native development tests and permitted diagnostic feedback; bounded retry. Not given ChangeProof's internal graph/ledger/rollout planner, but may build its own analysis |
| Full | ChangeProof shared graph, adaptive diagnosis, typed probes/guarded patch and mixed-version planning; mandatory protected proof remains independent |

B2 gets access to all relevant repos, not artificially restricted to one file/repo. The terminal is a bounded tool in a guest of the same isolation class, without credentials, external write authority, hidden assertions or the ability to change protected checks; candidate mutations remain validated by gateway/guard. Freeze the tool/data/feedback access matrix per arm; differences constituting the intervention are recorded, all other privileges equal. The final evaluator runs all required dimensions/edges/mixed-version combinations for **every** arm, even if its planner does not select them. No cached verdict or deliberately bad trajectory.

Mandatory ablation on pre-registered paired cases: Full without supplied cross-system graph; Full without adaptive hypothesis revision (strategy frozen, not given the answer); Full without mixed-version-aware planning/feedback during proposals. Change one component per arm, retain model, data, budget and **final protected mixed-version evaluator**. The last ablation measures the contribution of planning/feedback and regressions caught by transition checks; it does not remove mixed-version checks from the release gate. Report interactions/limitations; three differences are not added into a total causal contribution. Equal budget/case allocation for paired comparisons; additional exploration labeled separately.

G3-09 requires actual B2 and ablation receipts, not merely arm definitions. Report paired outcomes, unsafe claims, required-coverage misses, actual cost/time/review effort, n and uncertainty with a frozen analysis plan. Do not set new winning margins without calibration; better/indistinguishable B2 results are still reported. Insufficient access/budget holds the relevant evaluation, not removes the comparator. A new evaluation revision/dataset manifest does not rewrite historical results.

After holdout is opened, subsequent improvements use development variants; holdout retesting is labeled an exploratory round. Changes to model, prompt, fixture, budget, or policy require a new evaluation version.

## 10. Release thresholds and metrics

Minimum release `[DERIVED]`:

1. All mandatory flagship/complex-repair acceptance cases satisfy expected outcomes; unsupported/negative cases have their own expected safe behavior.
2. All gates G3-01..17 pass; no critical unresolved security/data-integrity findings within the engine or hosted service scope.
3. Zero unsafe positive claims on the executed mandatory safety suite and acceptance dataset; report absolute count and denominator, without universal generalization.
4. Full repair success on the frozen **fixable holdout** is at least 80%, with at least 10 unique eligible cases. This number is an initial product target, not a result; if there are fewer cases, the gate has not met the minimum.
5. All mandatory negative case categories are executed and expected handling passes. Unsupported/ambiguous safe abstention does not enter the repair success numerator.
6. All minimum support records certified; a missing framework is not covered by an aggregate average.
7. At least one organic pilot has observed recovery and owner validation. No automatic production requirement; environment and impact limits are stated.
8. Hosted qualification `[DERIVED]`: at least three independent customer organizations with two identities/org, allowed/denied private repository scopes and real web onboarding. At least one organic repair via hosted remains mandatory. This is minimum proof, not an internet-scale claim.
9. Frozen HostedServiceProfile, operator-funded model access, finite spending/usage controls, qualified hostile-code isolation, backup/deletion recovery and chosen open-source license/build records available. Free capped and paid launch must both be qualified; automated subscriptions, invoicing and payment reconciliation must not be deferred.

When defining the dataset, the minimum ten fixable holdouts must cover SC3-01..05, SC3-07..08 and SC3-10..11 and all three L3 paths JS/TS, Python, JVM. Fixable labels are assigned by a trusted author with an independently validated reference solution before model results are known. The aggregate 80% does not override a failed mandatory repair acceptance, required dimension, or negative safety gate. SC3-09 diagnosis is reported separately from repair success; SC3-10/11 remain mandatory repair acceptance and are recorded in the case manifest/evaluation.

| Metric | Numerator / denominator and rules |
| --- | --- |
| Bundle repair success | Verified fixable bundles / scheduled eligible fixable scenarios; errors/incomplete not removed |
| Target repair success | Fixed targets / eligible impacted targets; target count does not replace scenario count |
| Unsafe assurance | Incorrect positive target/bundle claims / all positive claims, separated by level |
| Safe abstention | Correct unsupported/ambiguous handling / scheduled unsupported/ambiguous cases |
| No-impact false alarm | Unnecessary migration patches / control cases |
| Coverage | Verified required targets/edges/invariants / required scope; unknowns shown separately |
| Reproduction | Successful independent reproductions / scheduled reproductions |
| Native certification | Passed capability records / required records, with matrix version |
| Organic benefit | Recovered owner-approved workflow / affected pilot workflows; actual adoption and human effort |
| Efficiency | Actual calls/tokens/cost/CPU/memory/wall time per arm and complexity class; p50/p95 + n |
| Time to first actionable result | Active user time from repo connection to evidence-backed diagnosis/blocker or verified result judged useful; separate elapsed/queue/operator time, new/reused project and completion/dropout counts |
| Cost per accepted repair | Gross cost of all investigations/failed/incomplete/proof/reproduction in the cohort / verified bundles accepted by owners; net after credits and review minutes separate, zero denominator = N/A |
| Forecast accuracy | Estimated cost-duration components/ranges vs actual on the same plan/profile, cold/warm and queue separated; no numbers filled in when unmeasured |

A zero denominator is N/A. Scheduled, completed, failed, error, timeout, cancelled, and not_run counts must reconcile. Do not claim improvement over a baseline if the sample/statistics do not yet support it; report results as they are, including better baselines.

## 11. Minimum evidence bundle

Each acceptance run produces:

1. Case manifest, business intent, owner/source provenance, and `origin/executionMode/proposalMode`.
2. Pinned source/dependency/image/data/topology identities.
3. Capability records, extracted graph, impacts/unknowns, verification plan.
4. Frozen oracle/input hashes and baseline old/new artifacts.
5. Model request metadata, sanitized tool trace, attempts, candidate bundle digests.
6. Full native results, actual service/browser/data/event observations, resource usage.
7. Target outcomes and bundle assessment from policy.
8. Reproduction recipe and independent reproduction receipts.
9. Actual publication/CI records if executed.
10. Pilot before/after measurement and owner adoption record where applicable.

Evidence of source business behavior must not consist solely of screenshots. Screenshots support review; executable observations, assertions, identities, and raw outputs are required.

## 12. Run readiness before acceptance

Agents check: repo scope, model/provider access, toolchain versions, runner images, actual DB/broker, frozen oracle, dataset permission, dependency artifacts, finite budget profile, evidence storage, and GitHub/pilot authorization for related gates.

Add readiness evidence/CI provenance, invariant approval and independent freeze, reuse identity/grant checks, calibrated forecast and gross/net resource ledger. For hackathon resources, [BRD §20](BRD.md#hackathon-context) distinguishes public offers from account balances: check activation/expiry, model ID/mode/data terms, account limits and session permission before calls. No automatic fallback to partner open-weights when Muse Spark 1.3 access is not yet available.

Missing items produce specific status. No silent fallback to mocks, cached success, or hand-edited reports. Preparation not dependent on missing items may continue.

No live API call, paid run, destructive data operation, or publication is automatically authorized by this document. Development and acceptance perform operations within session/pilot scope actually granted.

## 13. Agent completion checklist

- Every BR3/FR3 constituting the MVP minimum has implementation, check, and artifact.
- Capability `target` and `proven` separate; all required records have evidence.
- Real source/service/database/browser used in relevant acceptance.
- Model genuinely proposes patches in AI acceptance; human edits attributed.
- Business workflow regression reproduced and recovered on the exact final candidate.
- Cross-system checks prove the bundle, including intermediate deployment conditions between versions.
- Negative, drift, integrity, budget, and cleanup behavior proven.
- Reproduction and actual publication/CI complete according to gates.
- Organic pilot impact validated by owner.
- No missing gate disguised as done.
- Workload/schedules/faults/n/thresholds frozen; all-trial receipts and required C/P/R/D available; same seed/single green is not a universal reliability claim.
- Hosted browser journey without customer local setup, private GitHub access, current grants and tenant/job/artifact isolation proven on independent organizations.
- Durable queue/leases/fencing, cancellation/revocation, metering/caps and load/fairness/outage/restore campaign pass on the declared service profile.
- Retention/deletion/privacy/model disclosure, license/build provenance, operator runbook and support/incident ownership ready before public hosted release.

If the entire checklist is satisfied, MVP may be released with a measured capability matrix and limitations. Subsequent language, framework, or problem class additions follow the same adapter + certification + real-outcome gates.

## 14. Traceability for development

| PRD requirement | Business requirement | Work package | Main gate |
| --- | --- | --- | --- |
| FR3-01 | BR3-01 | WP3-03 | G3-03 |
| FR3-02, FR3-03 | BR3-01, BR3-12 | WP3-01, WP3-03, WP3-08, WP3-09 | G3-01, G3-03 |
| FR3-04, FR3-05, FR3-06 | BR3-02 | WP3-05, WP3-06 | G3-04, G3-05 |
| FR3-07, FR3-08, FR3-09 | BR3-03, BR3-08 | WP3-07, WP3-08, WP3-11 | G3-05 |
| FR3-10 | BR3-04 | WP3-11 | G3-05, G3-08 |
| FR3-11 | BR3-05 | WP3-10 | G3-05, G3-06 |
| FR3-12 | BR3-06 | WP3-10 | G3-05 |
| FR3-13 | BR3-07 | WP3-11 | G3-05, G3-06 |
| FR3-14 | BR3-08 | WP3-02, WP3-07, WP3-11 | G3-02, G3-06 |
| FR3-15, FR3-16 | BR3-09 | WP3-01, WP3-04, WP3-06, WP3-11 | G3-01, G3-04, G3-05 |
| FR3-17 | BR3-04, BR3-07 | WP3-11 | G3-05, G3-06 |
| FR3-18, FR3-19, FR3-20 | BR3-10 | WP3-12 | G3-07, G3-08 |
| FR3-21 | BR3-11, BR3-14 | WP3-14 | G3-10 |
| FR3-22, FR3-23 | BR3-13 | WP3-04, WP3-07, WP3-13 | G3-02, G3-06 |
| FR3-24 | BR3-14 | WP3-13 | G3-09 |
| NFR3-01..11 | BR3-09, BR3-10, BR3-13, BR3-14 | Cross-cutting; each engine/hosted WP verifies relevant NFRs | G3-01..17 |
| FR3-25 | BR3-02, BR3-15 | WP3-15, WP3-18 | G3-04, G3-06, G3-11 |
| FR3-26 | BR3-05, BR3-07, BR3-16 | WP3-16, WP3-18 | G3-02, G3-05, G3-07, G3-11 |
| FR3-27 | BR3-09, BR3-14, BR3-16 | WP3-17, WP3-18 | G3-05, G3-09, G3-11 |
| FR3-28 | BR3-15 | WP3-15, WP3-18, WP3-20 | G3-06, G3-10 |
| FR3-29 | BR3-17, BR3-18 | WP3-21, WP3-25 | G3-12, G3-13 |
| FR3-30 | BR3-17, BR3-18 | WP3-22, WP3-25 | G3-12, G3-13 |
| FR3-31 | BR3-17 | WP3-25 | G3-12 |
| FR3-32 | BR3-18 | WP3-21, WP3-23, WP3-26 | G3-13 |
| FR3-33 | BR3-19 | WP3-23, WP3-26 | G3-13, G3-14 |
| FR3-34 | BR3-19 | WP3-24, WP3-26 | G3-12, G3-14 |
| FR3-35 | BR3-18, BR3-20 | WP3-21, WP3-25, WP3-26 | G3-13, G3-14 |
| FR3-36 | BR3-19, BR3-20 | WP3-26 | G3-14 |
| NFR3-12..15 | BR3-17..20 | WP3-21..26 and hosted pilot WP3-14 | G3-12..14 |
| FR3-37 | BR3-21 | WP3-27, WP3-26 | G3-15 |
| FR3-38 | BR3-21 | WP3-28, WP3-25 | G3-12, G3-13, G3-15 |
| FR3-39, FR3-40 | BR3-22 | WP3-29 | G3-13, G3-15 |
| FR3-41, FR3-42 | BR3-23 | WP3-30 | G3-13, G3-15 |
| FR3-43 | BR3-24 | WP3-31, WP3-34 | G3-16 |
| FR3-44, FR3-45 | BR3-21, BR3-24 | WP3-32 | G3-13, G3-16 |
| FR3-34 paid billing | BR3-24 | WP3-24, WP3-26 | G3-14, G3-16 |
| FR3-11, FR3-17, FR3-26..28 full scope | BR3-25 | WP3-19, WP3-20, WP3-33, WP3-34 | G3-05, G3-07, G3-17 |

When creating tasks, agents expand these rows into test IDs and artifact paths that actually exist. A planning matrix does not prove gates have passed.

## 15. Problem → capability → requirement → delivery → evidence

All rows are targets; value/risk/feasibility and priority rationale are in [BRD §15](BRD.md#15-product-depth-priorities). Details of ten aspects of each class are in [problem profiles](PRD.md#17-problem-profiles-and-capability-limits).

| Problem | Capability deepened | Requirement | Mandatory WP | Acceptance evidence | Additional obligations |
| --- | --- | --- | --- | --- | --- |
| PC3-01 Concurrency | Schedule/history verification, transaction/idempotency repair | FR3-11, FR3-13, FR3-26, FR3-27 | WP3-16, WP3-17, WP3-18, WP3-33, WP3-34 | SC3-07 repeated interleavings+operation reconciliation, G3-11 | Exhaustive schedules/cross-runtime memory models |
| PC3-02 Distributed | Bounded faults, retry/deadline control, convergence | FR3-13, FR3-17, FR3-26, FR3-27 | WP3-11, WP3-16, WP3-18, WP3-19 | SC3-04 fault/heal/ack/backlog histories, required dimensions | SC3-10 / WP3-19 |
| PC3-03 Database | Active writer migration, checkpoint/journal recovery | FR3-11, FR3-15, FR3-26, FR3-27 | WP3-10, WP3-16, WP3-18, WP3-33, WP3-34 | SC3-03 commit/progress crash windows and semantic reconciliation | Large-scale/cross-engine profiles |
| PC3-04 Performance | Matched-load measurement and resource lifecycle | FR3-27, NFR3-09 | WP3-15, WP3-17, WP3-18, WP3-19, WP3-34 | SC3-08 distributions/goodput/lease metrics+uncertainty | SC3-11 / WP3-19 |
| PC3-05 Legacy | Trusted characterization, uncertainty, diagnostic-only path | FR3-01, FR3-06, FR3-15, FR3-28 | WP3-15, WP3-18, WP3-20, WP3-34 | SC3-09 owner/corpus/gap/denied-mutation receipts | Qualified recovery WP3-20 |
| PC3-06 Cascading | Config/deploy/resource graph and bundle proof | FR3-05, FR3-10, FR3-17, FR3-25 | WP3-05, WP3-11, WP3-18, WP3-19 | SC3-01/04 causal paths+full-system campaign | Larger multi-region topology |
| PC3-07 Observation | Telemetry normalization, provenance, causal probes | FR3-08, FR3-18, FR3-25 | WP3-15, WP3-18, WP3-20, WP3-34 | SC3-09 + SC3-01/08 quality/clock/source/control evidence | Backend-specific live observability connectors |
| PC3-08 Recovery | Hypothesis update, no-information stopping, budget discipline | FR3-08, FR3-14, FR3-25, FR3-26, FR3-27 | WP3-07, WP3-11, WP3-18, WP3-20 | SC3-05 actual failure→new evidence→campaign or explicit blocker | Wider legacy hypothesis space after proof readiness |

## 16. Calibration and decisions not yet filled in

Design scope has been decided; numeric runtime SLO/load/horizon/profile has not been measured. Before native acceptance, the owner/trusted author must define `Amax/Qmax/Trecover/Tdrain/Tconverge`, lock/pool bounds, arrival distribution, dataset scale, n/measurement method and complete cost budget. Missing values are readiness blockers, not conflicts resolved with guessed values.

Runtime instruction review remains mandatory: the fixer limit of three attempts/30 minutes per consumer in the applicable AGENTS is not automatically increased by the campaign blueprint. WP3-16 performs forecast/calibration within effective limits; if required proof does not fit, report `resource_profile_insufficient` and the need for an execution-policy decision in the appropriate implementation scope. This documentation task does not change runtime policy outside `.improvement`.

The next dependency-ready work from the specification is WP3-01 (extend schemas and policy tests FR3-25..28), then WP3-02. Implementation work that actually exists must be audited before reuse; this documentation report does not declare any WP complete.

Hosted requirements FR3-29..36 add WP3-01 contracts and WP3-02 persistence/interfaces; WP3-21 is ready only after those foundations. Service profile values (capacity/SLO/RPO/RTO/retention/cost), hosting region/provider, chosen open-source license, identity/model integration access and pricing/payment qualification have not been proven. All must be decided or calibrated before related gates; they are not reasons to replace actual hosted acceptance with simulation. CLI-only/local JSON have been replaced as minimum delivery/state, while historical reports are not rewritten.


<a id="17-campaign-protocol-and-acceptance-dossier"></a>
## 17. Campaign protocol and acceptance dossier

**Status:** all scenarios/profiles are targets; this document contains no execution results.  
**Authority:** [PRD FR3-25..28](PRD.md#13-cross-problem-class-capabilities--additional-targets).  
**Release scope/dependency:** [MVP](MVP.md). **Incidents and capability limits:** [problem classes](PRD.md#17-problem-profiles-and-capability-limits).

**Delivery:** all repair claims are presented through a hosted service according to [hosted SaaS](PRD.md#18-customer-journey-and-hosted-access). The customer application tests below remain mandatory, plus hosted-service gates G3-12..14; a single multi-tenant app fixture does not prove ChangeProof customer isolation.

### 1. Proof rules

Acceptance proves a **claim within a specific envelope**: exact code/config/data/topology, workload, event/fault schedule, observation horizon, and invariant set. It does not claim all schedules, all production traffic, or that failure will never occur.

Separate:

- **C — Correctness:** operation results and business/auth semantics.
- **P — Performance:** latency, goodput, error/capacity/resource bounds.
- **R — Resilience:** degraded behavior, recovery, convergence, retry/backlog control.
- **D — Data integrity:** no lost/duplicate/corrupt acknowledged effects.

Required flags are frozen per case. C/R/D are mandatory for the real stateful flagship; P at least has agreed bounded resource and business SLO criteria. Diagnosis-only cases assess evidence/uncertainty, do not produce positive repair claims; unproven required repair dimensions remain `inconclusive`, not N/A to hide missing proof.

<a id="2-shared-campaign-protocol"></a>
### 2. Shared campaign protocol

#### 2.1 Plan before run

A trusted author freezes `ExperimentPlan` before acceptance:

| Group | Mandatory parameters |
| --- | --- |
| Identity | case/revision, origin, source/base/candidate hashes, runtime/image, config/deployment, data/journal/schema, oracle/intent/check plan, topology and instrumentation |
| Workload | operation mix/count, payload/key/tenant distribution, arrival model/rate, concurrent actors, key skew, cache initial state, retry semantics, reader/writer ratio |
| Timing | warmup, steady measurement window, fault injection points/durations, recovery/cooldown horizon; explicit units |
| Schedules | seed list, canonical barriers/interleavings, fault directions/process/crash points, observation-only uncontrolled domains |
| Repetitions | trial definition, subjects, number per schedule/window/stratum, reset method, independent environment count; no “repeat until pass” |
| Criteria | required C/P/R/D, invariants, absolute SLOs and relative margins, convergence/lock/pool bounds, primary metrics, estimator/confidence method if used |
| Integrity | injector/collector health, achieved offered load, missing-data/censor rules, known-noise limits, stop rules, reproduction procedure |
| Cost | proposal/probe/campaign aggregate cap, forecast full replication cost, disk/journal/trace volume, reserve evidence+cleanup, configured execution constraints |

The plan schema rejects empty numeric values, infinity, ambiguous units, exclusions without reasons, and required metrics without thresholds. SLO values come from intent/owner or calibrated development decisions; not determined after acceptance results. Case registration must show sufficient budget, including negative paths. No paid/native acceptance is performed merely by writing this document.

#### 2.2 Reproduction and controls

1. A known-valid baseline runs with the relevant envelope. The original failing state must show attributed failure on the frozen trigger; the candidate receives an equivalent trigger/workload.
2. Construct paired counterfactual controls: trigger on/off, source/config revisions, single-link intervention, or competing-cause probe. Controls separate causes from symptoms; not replace the failing workload with an easier workload.
3. Reset dataset, services, pools, controlled clocks, retry state and cache according to the plan every trial. Ongoing-writer migration trials still contain the entire operation history within the trial.
4. Injector receipts must show the actual failure condition and heal. Tests that bypass faults do not count as resilience successes.
5. Store schedules at the resolution actually available: controlled barriers, observed event order, or partial-order history. Missing kernel/network/GC order is recorded. Same seed does not mean exact replay.
6. Unknown baseline/intent/trigger ends diagnosis with a blocker; not automatic no-impact or “no bug found”.

#### 2.3 Minimum repetition `[DERIVED]`

This is an engineering acceptance floor, **not** statistical proof of freedom from all races. The plan may require more based on risk; reduction requires new scope/decision before freeze.

| Profile | Minimum | Permitted claim |
| --- | --- | --- |
| Schedule/fault-controlled | Each mandatory interleaving/crash/fault schedule: ≥5 reset trials per subject, spread across ≥2 fresh sandbox instances. Original trigger failure observed in ≥2 independent-reset trials; expected failures/control outcomes pinned | Repair on tested schedules/histories and environment; not coverage of all interleavings |
| Perturbed execution | ≥20 preselected perturbed trials per required incident envelope for original/candidate with matched seed/workload set; original no-failure in a particular stratum recorded. Seeds may vary skew/delay/order within bounds | Observed robustness on tested perturbations; no population failure probability claim |
| Performance windows | ≥5 independent-reset paired measurement blocks after warmup; actual n chosen before acceptance based on noise/precision/effect to detect | Performance on that workload/capacity/window, if measurement quality and thresholds satisfied |
| Independent reproduction | Fresh runner repeats the **entire required campaign** for the exact candidate with the counts above; immutable inputs may be reused, observations may not | Campaign reproducibility; three simple smoke runs do not replace this |

One campaign may serve multiple scenarios/capabilities only if the manifest maps each required trigger/assertion and does not claim trials as additional unique issues. Shared trials are not counted as independent samples twice.

For optional probabilistic claims, freeze target failure probability `p_max`, confidence `1-alpha`, trial unit and independence/stationarity justification. If there are zero failures in `n` independent Bernoulli trials, the upper one-sided bound is `1 - alpha^(1/n)`; plan `n >= ceil(log(alpha)/log(1-p_max))`. Mathematical example: a 1% target at 95% confidence requires at least 299 zero-failure trials. This is not a ChangeProof result. Correlated requests within one server run or repeated identical schedules are not automatically independent; without reasonable assumptions, only envelope claims are permitted. [NIST exact binomial confidence limits](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbici.htm)

#### 2.4 Performance and measurement validity

- Record actual offered load, started/completed/success/error/timeout/cancel operations. Goodput counts completed correct operations. Timeouts are not removed from latency/error accounting; reports state censored duration.
- Healthy reference, failing original and candidate use pinned resource capacity, dataset, cache policy, instrumentation and matched workload. Paired block order is frozen/randomized to expose drift. Resource/config changes constituting the patch are assessed together with cost and intent.
- Warmup and steady-state criteria are defined before the run. The client load generator must be able to meet the target; generator saturation makes the run invalid for a target-load claim. Do not measure overload using closed-loop clients then ignore demand never sent.
- Choose histogram/raw sample representation, percentile estimator, unit of analysis, paired/block method and confidence margin beforehand. Resampling correlated requests as independent samples is prohibited. Window percentiles are not averaged into a system percentile.
- `[DERIVED]` default non-regression margin when the owner does not specify stricter criteria: upper bound relative p95 candidate/healthy ≤1.10 and lower bound goodput candidate/healthy ≥0.95, with a pinned one-sided 95% method. Absolute business SLO remains mandatory; this margin does not make a bad baseline acceptable. Multiple primary claims require a pinned correction or joint method.
- Samples too small/noisy for the selected method and precision → inconclusive, not pass based on a point estimate. Results with intervals crossing thresholds do not pass.
- The minimum memory screen is only bounded-growth/limit on a pinned horizon. Heap/native/RSS, post-GC retained trend and plateau must be distinguished where available. A leak-elimination claim requires SC3-11 and a horizon covering onset; it cannot be proven by a quick smoke.

#### 2.5 Stop, failures, and decisions

Fail-fast is allowed for safety/data violations, failed injection, secret leaks, budget, or unstable harness; all remaining trials are marked not_run and the campaign does not pass. Do not discard early results or extend n based on the desired outcome. Subsequent exploration/repairs use a new candidate/plan revision and still report the failed campaign.

Planned application errors during faults are assessed according to the degraded contract. Unplanned verifier/collector timeout or corrupted history invalidates relevant proof. A nonstationary/flaky harness does not become a “valid random test” merely because the sample is large.

Target `fixed`/bundle `verified` requires all required C/P/R/D pass, causal regression, guards, intent, identity and freshness. An inconclusive required dimension withholds assurance. A failed valid dimension is not an infra error; policy assesses partial/failed only with complete valid evidence. Valid diagnostics may still be reported when repair cannot yet be assessed.

### 3. Minimum scenario dossiers

IDs SC3-01..06 are retained and deepened; SC3-07..09 add acceptance obligations not previously present. SC3-10..11 are also mandatory. All use case manifests and numeric thresholds that must be filled in before acceptance.

#### SC3-01 — Coordinated order recovery with config and contention

- **Incident:** new order contract/schema/event, feature flag rollout and stale cache break the frontend and inventory; traffic causes failures to cascade through retry/pool/DB contention.
- **Setup:** existing flagship ≥3 repos, real PostgreSQL/Redis, old/new components, config/flag/cache identities, operation journal, source/trace/deployment mappings.
- **Schedules:** final bundle; every mixed state allowed by the deployment DAG; old-cache/new-schema; hot-key concurrent orders; combined envelope with directed delay from SC3-04 defined before the run.
- **Pre-fix:** original reproduces incorrect order/reservation or broken workflow; single-service green tests retained as insufficient controls.
- **After:** C/P/R/D required; no duplicate/lost/cross-tenant effects, correct amount, expected UI/error semantics, bounded retry/backlog, convergence and business SLO. Deployment exclusions tested as guards/preconditions, not merely notes.
- **Failure paths:** config/head drift; missing downstream; local pass+system fail; patch cancels flag intent; cache cleared every trial despite required warm stale-cache state.
- **Evidence:** config-aware causal graph, complete campaign/history, dimension results per target and bundle, deployment constraints, final exact patches and later publication receipts.

#### SC3-02 — Upgrade preserving behavior and capacity

- **Incident:** dependency upgrade changes serialization or connection lifecycle in ≥2 interacting components.
- **Setup/trigger:** intended target version+transitive graph, old/new lockfiles, actual native build/runtime, load/error path triggering incompatibility.
- **Pre-fix:** failing original shows incompatibility; healthy version is a reference, not an allowed “fix” to cancel the upgrade.
- **After:** source/manifest/resolver output consistent, required C/P/R/D satisfy the plan; upgraded version remains installed. Use a performance campaign if lifecycle/latency is affected.
- **Failure paths:** revert target version, force test pass with skip, unknown transitive binary, unapproved capacity increase, changed workload.
- **Evidence:** resolution/artifact provenance, intervention, compatibility results and paired performance evidence if required.

#### SC3-03 — Active backfill with crash and writer conflict

- **Setup:** populated corpus with nullable/precision/tenant/delete cases, journal of all acknowledged writes, continuous old/new readers/writers, pinned DB/isolation.
- **Mandatory schedules:** crash before chunk commit; after commit before progress write; while progress persistence is not yet durable; after durable checkpoint; concurrent update/delete on a row read by backfill; resume from latest valid durable checkpoint. Expected semantics of each window frozen. If chunk/progress is atomic, map merged windows according to FR3-11 and prove actual commit/abort boundaries; do not force impossible intermediate states.
- **Pre-fix:** original shows stale overwrite, duplicate effect, missing update or lock-induced business failure; row-count match alone is insufficient.
- **After:** C/P/R/D required; full semantic journal reconciliation, no lost acknowledged write, no duplicate effect, compatible old/new reads, bounded lock/writer SLO, backlog recovery. Recovery from snapshot must catch up the journal if acknowledged deltas exist.
- **Failure paths:** incomplete journal, disabling writes without permission, unrepresentative sanitized data, unbounded rollback time, final rows correct but some acknowledged operations lost.
- **Evidence:** per-chunk transaction/progress receipts, journal+dataset hashes, lock/latency time series, independent reconciliation and restored-state proof.

#### SC3-04 — Partial failure, retry storm, and convergence

- **Mandatory schedules:** response dropped after business commit; directed partition on order→inventory or worker→broker edge; out-of-order duplicate messages; heal+backlog drain. Combined faults bounded to enumerated variants; not random chaos without a manifest.
- **Setup:** per-layer retry/deadline budgets, ack/operation IDs, broker pending/offset records, actual offered-load generator, supervisor injector receipts.
- **Pre-fix:** original shows duplicate effect or retry amplification breaking SLO/convergence. Timeout alone is not yet root cause.
- **After:** no unsafe data/auth effects during faults; failed requests have defined semantics; attempts ≤`Amax`, backlog ≤`Qmax`, steady recovery ≤`Trecover`, drain ≤`Tdrain`, consistency ≤`Tconverge`; finite numeric values pinned. Expected partition degradation need not provide 100% availability.
- **Failure paths:** injector noop, hidden poison message, duplicate ack without durable effect, retries at multiple layers not counted, network healed but lag not recovered.
- **Evidence:** fault/heal receipts, causal attempt tree, operation/ack reconciliation, recovery curves and all-trial outcomes.

#### SC3-05 — Adaptive diagnosis and no-progress termination

- **Recovery branch:** actual live-model candidate fails a recorded native/business check; ledger refutes/revises hypothesis, chooses discriminating probe, next allowed proposal tested in full. Latency improvement does not redeem wrong data.
- **Stop branch:** trusted control runs repeated-equivalent/no-information histories; after two attempts without meaningful evidence/progress, branch stops. Output states failure signature, known facts, uncertainty, minimum missing input and next safe probe or no safe probe.
- **Pre-registration:** select challenge portfolio and maximum search/model budget before the run. If the model succeeds immediately, first-attempt success still counts but adaptive recovery has not been exercised; do not deliberately damage the patch. Other cases may run according to the frozen portfolio; all attempts/omissions recorded.
- **Failure paths:** cosmetic changes counted as progress; repeated failure narrated as a new hypothesis; resource cap reset; model changes oracle; infra error triggers business mutation.
- **Evidence:** hypothesis/prediction/contradiction trace, candidate equivalence, budgets, stopper decisions, actual recovery campaign. Replay control proves the stopper, not live adaptive repair.

#### SC3-06 — Organic difficult incident

- **Input:** authorized historical/current issue, pinned last-known-valid and failing states, actual observed symptoms, accessible telemetry/data, owner-reviewed business invariants and workload history.
- **Reproduction:** use an incident-appropriate campaign (concurrency, migration, performance or combinations) and compare source/config/deployment causes. Missing trigger/intent remains a blocker; do not substitute an example mutation.
- **After:** required dimensions pass in a representative environment; owner accepts recovery with known limitations and actual observation horizon. Human edits recorded/reverified.
- **Failure paths:** issue disappears after restart, low traffic replaces incident load, historical logs without executable baseline, unsupported external dependency.
- **Evidence:** origin/permission, before/after observations, independent full campaign and owner adoption. Blocked pilots do not enter the repaired issues numerator.

#### SC3-07 — Race, lost update, deadlock, and double processing

- **Setup:** two-or-more actors, hot business key, stock/counter/ledger invariants, operation journal and DB lock evidence.
- **Mandatory schedules:** read/read/write/write lost update; conflicting lock order; duplicate operation arrives before commit; duplicate arrives after commit before ack. Schedule/fault and perturbed profiles in §2 mandatory.
- **Pre-fix:** original failing schedule produces an attributed safety violation or unacceptable deadlock/liveness failure in ≥2 reset trials.
- **After:** zero oversell/lost/duplicate effect; explicit aborts/retries bounded, completion/pool/SLO criteria pass; normal load not serialized without meeting throughput requirements.
- **Failure paths:** final count looks correct but an operation is lost, debug hooks change ordering, unsupported DB isolation, service killed then test treated as pass.
- **Evidence:** invocation/return/commit histories, lock graph, exact schedules/seed limitations, candidate full campaign and matched workload metrics.

#### SC3-08 — Latency/throughput and pool exhaustion

- **Setup:** healthy reference, failing error-path lease handling, fixed capacity/runtime, pool instrumentation, actual arrival process and paired load windows.
- **Schedules:** normal load; sustained target load; native error path; contention; drain/recovery. Warmup/measurement windows and offered-load acceptance bands defined first.
- **Pre-fix:** reference meets target; original fails SLO or shows acquisition/release imbalance; source/observation probe supports cause.
- **After:** C/D remain correct, R meets pool recovery deadline, P meets absolute SLO and frozen relative margins. No outstanding lease after drain; bounded memory/resource limits on the horizon. n and precision follow §2.
- **Failure paths:** fewer successful requests hidden, missing timeout durations, saturated load client, extra cores without declared change, noise confidence interval crosses margin, short sample turned into a leak-free claim.
- **Evidence:** raw distributions/counts, paired blocks, environment/observer-health, leases+GC/RSS series, uncertainty and bounded claim. Long-term memory leak proof is not a gate for SC3-08.

#### SC3-09 — Sparse telemetry and legacy uncertainty

- **Setup:** actual legacy-style runnable component with dynamic dependency/business rules; trusted labeled exports/corpus. Minimum variants: complete evidence, missing business rule/baseline, missing span/deployment join, clock-skew ambiguity.
- **Pre-fix:** actual failing input attempted if prerequisites available; unavailable trigger remains a finding, not fabricated. Negative variants deliberately test ability to withhold claims.
- **After:** all facts have refs; hypotheses not promoted without mechanism/probe; characterization approved by trusted owner; incomplete variants produce blocker+next acquisition and zero autonomous mutation/positive repair.
- **Failure paths:** expected output copied from observed bug, fabricated span/deploy linkage, production write to find a trigger, unknown side effect ignored.
- **Evidence:** sanitized exports+metadata, observed/intended distinction, provenance/gap ledger, independent diagnosis labels, denied mutation receipts. Success here is diagnostic/safety acceptance, **not** repair success.

### 4. Mandatory multi-region and long-horizon acceptance

#### SC3-10 — Multi-region partitions and consistency trade-offs

Mandatory, after bounded topology prerequisites pass: geo latency/skew, failover/leader changes, replication lag, simultaneous directed partitions, regional data locality and recovery ordering. Requires native topology profiles and an explicit owner consistency/availability/RPO/RTO contract, complete relevant histories, region-like capacity/network model, and calibrated budget. Do not infer production multi-region safety from containers on one host. Missing requirements or uncontrollable external failover → abstain.

#### SC3-11 — Long-horizon memory leak and resource degradation

Mandatory, after measurement validity prerequisites pass: repeated steady/recovery cycles beyond known onset, retained heap/native allocation trend, connection/thread/FD leaks, queue growth, fragmentation/cache/GC confounders. Freeze horizon, slope/plateau method, capacity, sampling overhead, restart policy, acceptable drift and full costs. Process restart before onset or short no-OOM does not pass. Different platforms/allocators/runtimes require their own qualification.

### 5. Evidence completion and claim limits

One incident dossier contains raw telemetry quality, symptom/cause/hypothesis ledger, frozen experiment+intent+oracle, actual schedule/fault/history receipts, complete trial counts, four-dimensional assessments, candidate identities, independent campaign reproduction, and next actions/limitations.

If proof is insufficient, the report still states **what is known**, **what is not yet known**, **why no decision can yet be made**, and **the next minimum probe/access**. Business approval, AI confidence, or local green does not close evidence gaps.

### 6. Additional hosted acceptance

SC3-01..11 still test application problems handled by the engine. ChangeProof service qualification uses a separate hosted-service campaign and does not inflate trial counts into unique organic issues. Frozen HostedServiceProfile includes API/session/event load, tenant/job concurrency, queue/fairness, usage/reservation limits, outage recovery, data deletion and restore bounds.

Browser-to-result acceptance must cover actual deployed web login → organization → live GitHub App/repo → readiness/intent/budget → durable queue → actual model/native execution → private evidence → authorized PR. Customers do not run a CLI, clone ChangeProof or provide a model key. Operator E2E fixtures do not count as independent customers; at least three independent orgs/two identities each follow MVP. G3-10 still requires organic owner-validated recovery.

The security suite tests all NEG3-21..28: forged/current revoked grants, wrong-tenant artifact/stream/repo joins, duplicate events/jobs/usage, stale worker fencing, model/GitHub token leak, VM/guest escape and cleanup/quarantine. The restore campaign attempts access to deleted data to prove tombstone replay. The load campaign records accepted/rejected/queued/running/completed/cancelled/lost counts and per-tenant wait/fairness; no lost accepted work or duplicate effect/charge. In-flight external publication is reconciled, not assumed atomically cancellable.

Hosted service SLO and consumer-app C/P/R/D are separate: a fast dashboard does not prove customer checkout correctness, while green consumer tests do not prove hosted isolation/availability. Mock webhook/dashboard/queue help development but actual integration, hostile-code boundary and deployed load/restore proof are mandatory for release. All numbers and results remain targets until actual receipts are available.


## 18. Hosted service traceability

### 9. Hosted traceability

| Capability | Requirement | Work package | Gate |
| --- | --- | --- | --- |
| Web onboarding and organizations | FR3-29, FR3-31 | WP3-21, WP3-25 | G3-12, G3-14 |
| GitHub integration and revocation | FR3-30 | WP3-22 | G3-12, G3-13 |
| Tenant authorization/isolation | FR3-29, FR3-32 | WP3-21, WP3-23 | G3-13 |
| Durable queue/worker lifecycle | FR3-33 | WP3-23 | G3-13, G3-14 |
| Metering and caps | FR3-34 | WP3-24 | G3-12, G3-14 |
| Privacy/retention and artifact access | FR3-35 | WP3-21, WP3-23, WP3-25 | G3-13, G3-14 |
| Operations/open-source delivery | FR3-36 | WP3-26 | G3-14 |

Implementation follows the MVP DAG. Hosting/auth/payments vendors, fleet size and pricing have not been decided; this specification defines required behavior without inventing access or services already deployed.


## 19. Decision and documentation check history

### Further detail based on simulated assessment — 22 October 2026

```text
Task ID / parent WP: DOC3-20261022-01 / WP3-01 preparation; cross-WP traceability in §21
Requirement IDs: BR3-01/03/08/09/14/17/19; FR3-01/06/07/08/14/15/24/28/31/34/35
User-visible outcome: briefing includes assisted readiness, safe efficiency, B2/ablation, Meta contribution and first-user focus.
Prerequisite evidence: normative sections of four documents read; actual package.json checked; folder contains seven files; Git metadata unavailable.
Allowed source/config changes: BRD.md, PRD.md, MVP.md, architecture.md; SKILL.md only reference index/guidance.
Input snapshots + intended intervention: copies of seven files before editing in temporary workspace; user input and public sources checked 22 October 2026.
Acceptance checks (positive, negative, native): ID/link/DAG/traceability, preservation of scope and proof rules; native not applicable to documentation edits.
Protected oracle / proof scope: no changes to runtime oracle, policy, budget or historical evidence; target specifications only.
Artifacts expected: four synchronized documents and skill index; credit sources/qualifications in BRD §20.
Actual commands + exit codes: node document-check.cjs on temporary snapshot → 0; full command and missing checks below.
Status + remaining blocker: done for documentation changes and structural checks; all additions remain implementation targets. Provider access/balances, calibration and product capabilities not yet proven.
Next dependency-ready task: audit actual contracts/policy conformance to WP3-01 before reuse; no implementation WP declared complete.
```

`[DERIVED]` design decisions and contract/evaluation impacts are in [PRD §20](PRD.md#product-depth-decision). No scope deferred, efficiency figures invented, or gates passed through simulated assessment.

Final documentation task checks:

| Actual command/check | Exit / result | Evidence limits |
| --- | --- | --- |
| `git status --short` | 1 — folder has no Git metadata | Git diff/status unavailable; changes compared against pre-edit copies |
| `node 'C:\Users\user\AppData\Local\Temp\changeproof-doc-review-eb3faf1d215d49688b4575c12865e5f2\document-check.cjs'` | 0 — seven files, five changed files, 94 valid local links, 218 canonical IDs preserved, 34-WP DAG remains cycle-free | Document structure/link/preservation checks; not product behavior acceptance |
| Semantics and public source review | No process exit code; sources/dates/qualifications in BRD §20 | Independent oracle, fresh proof, tenant scope, fair comparator and full release scope retained; account balances not verified |

The initial validator exited 1 because it required a literal phrase that did not match exactly; prose matching checks were replaced with manual review, not treated as behavior proof. Link, ID, DAG and file preservation checks still ran. `AGENTS.md` and `.template-ui/mockup.html` were identical to pre-edit copies; `SKILL.md` only received references/guidance for further detail. No files added to the seven-file package.

**Mock vs native / missing checks:** no mock or native product tests run. `pnpm typecheck`, `pnpm lint`, unit/integration and model/runner/browser/CI/provider acceptance **not run** because changes were documentation-only; no passing results claimed. No paid API, publication or application changes. Runtime contracts/policy not edited; new target schemas and evaluation design revision recorded in PRD §20. All implementation, economics, B2/ablation, onboarding and live Meta evidence still must be produced by related WPs; this review does not change product gate status.

The following reports are historical snapshots that do not determine active scope. All earlier decisions about later stages/extensions/free-only in this section have been superseded by the user's 22 October 2026 instruction: all document and mockup features are mandatory in the complete release.  Document and link counts within them apply at the time of those checks, not the current package structure. Implementation and gate status still require actual evidence.

### Documentation consolidation — 22 October 2026

The user request specified only four Markdown files for project documentation in `.improvement`: BRD, PRD, MVP and architecture. Problem profiles moved to PRD §17; acceptance scenarios and protocol to MVP §17; hosted details split across BRD §17, PRD §18, MVP §18 and architecture §17. The reading guide went into BRD §18, historical reports into this section, and font attribution into architecture §18. Additional source documents were removed after their contents were merged; application source and planning outside this folder were unchanged.

The documentation checker during consolidation was adjusted for four files, new ID locations, links and dependency graph. Consolidation checks passed: four Markdown files, 70 local links/anchors, all IDs and traceability preserved, eight profiles with ten aspects, eleven scenarios, and a cycle-free DAG. Substantive content from seven supporting documents was checked against pre-consolidation source snapshots. This is documentation checking; product gate status is unchanged.

The `scripts` folder was removed on 22 October 2026 as requested by the user. It contained only documentation validators used during drafting/consolidation, with no application dependencies found. Active script references were removed; historical check results remain recorded.

<a id="briefing-preparation--20-october-2026"></a>
### Briefing preparation — 20 October 2026

#### Identity

| Field | Value |
| --- | --- |
| Task | Remake BRD, PRD, MVP and align architecture as an initial briefing |
| Date | 20 October 2026, Asia/Bangkok |
| Status | done for document preparation; product implementation not yet assessed |
| Final scope | Only `.improvement` folder, per direct user instruction |
| Dependencies | User's requirements for polyglot expansion, modular monolith, real implementation and complex problem solving |
| Snapshot | Workspace documents; no commit SHA for these documentation changes |

#### Results

[BRD](BRD.md), [PRD](PRD.md), [MVP](MVP.md), [architecture](architecture.md), and [reading guide](BRD.md#18-document-package-guides) form a self-contained briefing package. No delivery calendar.

#### Preparation acceptance

| AC | Evidence | Status |
| --- | --- | --- |
| Initial modular monolith briefing | Mandate and structure in BRD/architecture | pass |
| Multi-language/framework/stack | Six-ecosystem matrix and L1/L2/L3 capability tuple | pass |
| Complex remediation | SC3-01..06, migration, upgrade, event/cache, multi-repo and adaptive recovery | pass |
| Real implementation success | G3-02..10, real-runtime proof and organic owner-validated pilot | pass |
| Facilitates agent development | FR3-01..24, contracts, WP3-01..14, traceability and task format | pass |
| Focus on requested folder | All final deliverables in `.improvement`; root notes briefly added during this task were withdrawn | pass |

#### Checks

- PowerShell check of five main briefings: exit code 0; 18 valid internal links/anchors, balanced code fences.
- Definition and reference checks: 14 BR, 24 FR, 14 work packages, 10 gates; all FR covered by traceability; no undefined referenced ID.
- Final recursive PowerShell check: exit code 0; six Markdown files, 23 local links/anchors stay within `.improvement`, balanced fences, work package dependencies valid and ordered.
- Semantic review: target support separated from proven support, baseline/intent protected, target proof separated from bundle proof, resource caps separated from delivery timeline.
- Primary technical references on Next.js/Playwright, FastAPI testing, Spring Boot/Testcontainers, and Prisma migration read; links placed in related requirements.
- Build, native tests, model calls, benchmark, pilot, and publication not run. This is specification preparation, not evidence of passed product gates.

#### Decisions and continuation

Thresholds and minimum samples/repetitions are marked `[DERIVED]` in MVP. Actual budgets and toolchain versions are defined and pinned through development calibration before acceptance. No fabricated results, PR URLs, or certification.

The next package with specification dependencies ready is WP3-01: concrete contracts and policy behavior tests. Implementation execution is subsequent work; the briefing preparation task is complete.

<a id="review-complex-failures--20-21-october-2026"></a>
### Review complex failures — 20–21 October 2026

#### Identity and scope

| Field | Value |
| --- | --- |
| Task | Review and deepen specifications for complex/hard-to-reproduce problems |
| Date | 20–21 October 2026, Asia/Bangkok |
| Document status | Complete for specification refinement scope; final checks passed 21 October 2026 |
| New capability status | Target; not yet proven through actual execution |
| Scope | Only `.improvement`; no paid API, production mutation or external publication |
| Input | User instructions, applicable AGENTS, README/BRD/PRD/MVP/architecture and previous reports |
| Snapshot | Local specification files; before/after hashes used to check change boundaries |

The [initial briefing](MVP.md#briefing-preparation--20-october-2026) report is retained as history; requirement/gate counts in that report are snapshots from the earlier preparation.

#### Review findings and resolutions

| Finding | Risk | Change |
| --- | --- | --- |
| Migration/event/graph/adaptive already present | Eight new requirements/engines would duplicate ownership | Deepen FR3-05/08/11/13/14/15/17/18/21/24; add only FR3-25..28 |
| One full pass/three reproduction runs too weak for intermittent cases | False assurance | Frozen campaign, repetition floors, schedule/seed limitations and independent full-campaign reproduction |
| Performance still limited to reporting | Latency pass may hide data loss/drop traffic | Separate C/P/R/D, matched workload/capacity, uncertainty and measurement validity |
| Telemetry correlation does not yet account for clock/drop/deployment | Wrong root cause | IncidentEvidence, quality/provenance, competing hypotheses and intervention probes |
| Migration does not yet explicitly test active writers/cursor crash windows | Lost acknowledged writes | Continuous workload, durable journals, reconciliation and actual recovery |
| Legacy lacks a characterization path | AI creates an oracle that justifies a bug | Trusted domain validation, known-valid baseline gate, diagnosis-only if evidence insufficient |
| No-progress still general | Repeated retries exhaust resources without new evidence | Failure/candidate/hypothesis signatures, two non-informative attempts stop the branch |
| All advanced scope could become minimum | Infeasible gate or shallow claims | Bounded flagship MVP; multi-region/long-soak/qualified legacy expansion separated |
| Baseline may precede measurement reducers in DAG | Closed loop may assess proof without four dimensions | WP3-06 depends on WP3-17; reducers ready before baseline/verdict |
| Crash windows do not yet distinguish progress durability and atomic checkpoint | Fault scenario may claim an impossible state | FR3-11/SC3-03 map actual commit/progress windows and merged atomic boundaries |

#### Deliverables and traceability

- [BRD](BRD.md): BR3-01..14 retained; BR3-15/16 add diagnosis value and bounded recovery; priority/risk/proof-feasibility matrix.
- [PRD](PRD.md): FR3-01..24 retained/deepened; FR3-25..28 for telemetry, experiments, four-dimensional assessment and legacy characterization; DEC3-11..15 record decisions.
- [MVP](MVP.md): SC3-01..06 and WP3-01..14 retained; additions SC3-07..09 and WP3-15..18 minimum, SC3-10/11 and WP3-19/20 later; G3-11 for campaign proof; NEG3-15..20 for new failure paths.
- [Architecture](architecture.md): observability leaf module, shared verifier campaign/reducers, typed probe authority, state/receipt/budget boundaries.
- [Problem profiles](PRD.md#17-problem-profiles-and-capability-limits): eight classes, each with the ten requested operational aspects.
- [Acceptance scenarios](MVP.md#17-campaign-protocol-and-acceptance-dossier): common protocol and dossiers with failure paths and claim limits.
- Historical validator: read-only checks of links, IDs, profile completeness and dependencies; script removed after consolidation.

#### Design decisions

1. No additional AI engine per class/framework; reuse graph, agent, verifier and policy with versioned ports.
2. Known intermittent product failure is not the same as a flaky/invalid harness. Unexplained variation still withholds positive claims.
3. Goodput and correct business effects counted together; performance improvement does not compensate for auth/data/correctness violations.
4. N, seed, fault schedule and thresholds frozen before acceptance. Sample floors do not guarantee freedom from all races; optional statistical claims require valid assumptions.
5. Legacy without intent/baseline/oracle gets no bypass for autonomous mutation.
6. Document scope remains local. Design semantic changes recorded in this package's PRD/decisions/test obligations; no root policy/contracts/runtime changes.

#### Task checks and acceptance

| Check | Command/method | Result |
| --- | --- | --- |
| Links, anchors, IDs/ranges, traceability, profile facets, DAG and minimum scope | Documentation validator at historical check time | Exit 0; 9 Markdown, 56 local links/anchors; all checks passed |
| Semantic consistency | Review across four briefings and both annexes | C/P/R/D, target status, minimum/advanced, repetition, abstention and precedence aligned; reducer dependencies and crash windows corrected |
| Change boundaries | SHA-256 root Markdown and previous reports compared against initial snapshot | 26 root Markdown + 1 historical report identical; all task writes within `.improvement` |
| Native tests, live model, campaign, benchmark, pilot | Not run | Outside specification task; no product gates pass claim |

The validator found 16 BR, 28 FR, 11 NFR, 15 decisions, 20 work packages, 11 gates, 20 negative cases, 8 journeys, 8 problem classes and 11 scenarios. All old IDs remain defined, all FR linked to work/gate, eight profiles contain ten mandatory aspects. Dependency graph acyclic; minimum release reaches WP3-15..18 without requiring WP3-19/20. This is structural validation and specification review, not product acceptance execution.

This workspace has no usable Git metadata (`git status --short` exit 128: not a git repository). Preservation checks therefore use SHA-256 snapshots of files read, not Git diff; hash checking does not claim an audit of the entire filesystem.

#### Conflicts, limitations and calibration needs

- **Execution budget not yet proven sufficient:** applicable AGENTS limits the fixer to three attempts/30 minutes per consumer; repetitions, native startup and observation horizon may require greater cost. The specification does not authorize increased limits. WP3-16 must measure feasibility within the cap; if it does not fit, emit a resource blocker and require a policy decision in the appropriate implementation scope. Do not silently cut n/proof.
- **SLO/data/horizon not yet available:** Amax/Qmax and recovery/pool/lock thresholds, rate/size/skew, performance n and statistical precision do not yet come from application measurements. Values must be frozen before the run; `[DERIVED]` examples/margins are not benchmark results.
- **Reproduction limitations:** recorded seeds and event order do not capture all kernel/GC/JIT/network state. Claims only for the tested envelope; exhaustive schedules and long-term absence of failures not promised.
- **Organic/legacy access:** owner, historical state, journal and business semantics may be unavailable. Diagnosis remains useful; unsupported repair must not be promoted to success.
- **Prior gate breadth retained:** the previous framework matrix was not expanded in this task. New complexity certification is mandatory only on flagship profiles. Do not advertise all L3 frameworks as concurrency/performance certified.

No internal rule conflict was deliberately hidden by choosing the loosest rule. Budget feasibility and operational values remain uncertain without calibration/access; both are implementation acceptance blockers, not reasons to invent numbers or results.

#### Next work

WP3-01 is ready from the specification side: implement concrete schemas for six additional contracts, four-dimensional policy facts and precedence tests. Audit actual code before reuse; the document does not declare the work package implemented.

Subsequent order follows the MVP DAG: WP3-02..05 → observability/characterization WP3-15 → native campaign executor WP3-16 → measurement reducers WP3-17 → baselines WP3-06 → bounded repair → full campaign qualification. WP3-19/20 do not block minimum release.

<a id="hosted-saas-alignment--21-october-2026"></a>
### Hosted SaaS alignment — 21 October 2026

#### Identity and scope

| Field | Value |
| --- | --- |
| Date | 21 October 2026, Asia/Bangkok |
| Request | Change documents to hosted SaaS, retaining the open-source direction from the conversation |
| Scope | Specifications and validator in `.improvement`; no changes to application source/root planning |
| Capability status | Target; no hosted deployment or real provider run in this task |
| Documentation status | Complete for specification alignment scope; document validation passed |

#### Results and decisions

[README](BRD.md#18-document-package-guides), [BRD](BRD.md), [PRD](PRD.md), [MVP](MVP.md) and [architecture](architecture.md) now establish hosted SaaS as primary delivery. [Hosted SaaS brief](PRD.md#18-customer-journey-and-hosted-access) details customer flow, authorization, GitHub App, durable queues, isolated execution, quota/usage, privacy, operations and open-source release. [Problem classes](PRD.md#17-problem-profiles-and-capability-limits) and [acceptance scenarios](MVP.md#17-campaign-protocol-and-acceptance-dossier) connect engine proof to hosted gates without weakening them.

- Customers open website/login/connect GitHub; do not clone ChangeProof, install native runtimes/servers or bring a model key for the hosted minimum.
- One modular monolith codebase remains in use; web/API/dispatcher/supervisor are process roles, not separate AI engines or leaf microservices.
- CLI-only minimum and local JSON authority replaced with mandatory dashboard, transactional PostgreSQL, outbox/leased jobs and private object storage.
- FR3-29..36, BR3-17..20, NFR3-12..15, DEC3-16..19, WP3-21..26, G3-12..14 and NEG3-21..28 add hosted acceptance; old IDs retained.
- Final hosted pilot WP3-14 depends on engine evaluation and hosted qualification. WP3-19/20 remain later-stage; customer self-host/BYOK/payment automation not required for the free capped hosted minimum.
- Public customer-code execution requires qualified VM/microVM-per-job or equivalent isolation. The old controlled-fixture boundary is not assumed automatically suitable for untrusted customer repositories.
- Product source open source, customer repositories/artifacts private. License choice/third-party notices mandatory before public distribution; no license chosen or public repo availability claimed in this task.
- Evidence immutable during retention, but deletion/tombstones and backup expiry mandatory; no promise that deleted data remains stored forever.

#### Document acceptance

| Criterion | Document target evidence |
| --- | --- |
| Hosted browser journey without clone/local setup | PRD FR3-29..31, hosted brief §1–4, G3-12 |
| Tenant/repository/current-grant isolation | FR3-29/30/32/35, qualified guest boundary, G3-13 |
| Durable service and bounded usage | FR3-33/34, transactional persistence, lease/fencing, caps and reconciliation |
| Operations/privacy/open-source readiness | FR3-35/36, finite service profile, retention/deletion/restore, G3-14 |
| Dependency and release traceability | MVP hosted WPs/traceability, existing gates retained, validator updated |
| Real execution remains mandatory | Original native/model/organic gates and hosted browser/live acceptance; mock is not release proof |

#### Actual checks

Method: documentation validator available at historical check time. Exit code **0**: 11 Markdown files, 77 local links/anchors, balanced code fences; 20 BR, 36 FR, 15 NFR, 19 decisions, 26 work packages, 14 gates, 28 negative cases, 10 journeys, 8 problem classes and 11 engine scenarios. All FR linked to work/gate, references/ranges defined, DAG acyclic, hosted WP3-21..26 become ancestors of final acceptance, advanced WP3-19/20 remain non-prerequisites for the minimum.

Semantic review checked CLI-only/JSON conflicts, hosted-versus-consumer isolation, revocation/in-flight races, budget accounting, privacy disclosure and retention-versus-immutability. Publication and final hosted pilot dependency changes recorded in tables and reading order; validator not treated as proof of security/runtime behavior. The validator also rejects two old CLI-only/local-JSON rules in the active briefing and checks the hosted requirement map.

No application build, model API, native campaign, live GitHub operation, deployment, billing or security load drills run. This task drafts specifications; no engine/hosted product gate pass claimed. Previous reports retained as historical snapshots, not rewritten as current status.

#### Readiness and continuation

Not yet decided/proven: domain/hosting provider/region, specific license, actual model API/access/data handling, auth/GitHub App provisioning, numeric capacity/SLO/RPO/RTO/retention/cost limits, and price/payment path if paid. Minimum three independent orgs/two identities is a `[DERIVED]` qualification floor, not actual customer count or a scale promise.

New product scope comes from user instructions, not permission to deploy/use paid APIs/change external repos. Root AGENTS/planning still contains controlled-fixture/P0 limits; this package records additional hosted design that must be reconciled during root implementation tasks. No silent lowering of runtime limits, oracle or proof requirements. The next work package remains WP3-01 then WP3-02 after actual code readiness is audited; hosted WP3-21 follows those foundations.


## 20. Acceptance of all documentation and mockup features

All work packages WP3-01..34 and gates G3-01..17 are mandatory. No free-only, single-provider, hosted-only or bounded-flagship-only subset passes completion. Build order may follow the DAG; production claims still await each profile's evidence. §19 history retains old results and grants no exception to this active scope.

### Mockup → requirement → work → gate coverage

| Surface/route group in `.template-ui/mockup.html` | Requirement | Work | Gate / evidence |
| --- | --- | --- | --- |
| landing, product, pricing, guides, changelog, roadmap, templates, tutorials, sample-report, help/FAQ, privacy-policy, integrations, impact-overview, verification, evidence-overview, collaboration, terms | FR3-37 | WP3-27 | G3-15: every public route/CTA and static sample separate from private tenant data |
| login, register, verify-email, forgot-password, check-email, reset-password, session-expired, account | FR3-29, FR3-38, FR3-44 | WP3-21, WP3-28, WP3-32 | G3-12/13/15/16: actual auth/email/IdP, invalid/replayed tokens and session revocation |
| create-org, onboarding, repositories, invite, team, access-denied, settings, privacy | FR3-29/30/35/41/45 | WP3-21/22/25/30/32 | G3-12/13/15: identities, current grants, invites, transfer owner, access request and deletion |
| dashboard, projects, project-detail, new-project, environments, telemetry, project-settings | FR3-01/23/25/28/31 | WP3-03/15/21/25 | G3-03/12/15: actual inventory, revisioned profile, grants/baseline readiness and upload validation |
| new-run, six change templates, draft/resume, run-created, queued, running, runs, cancelled, unsupported, diagnosis, no-impact | FR3-08/14/28/31/33/34 | WP3-07/11/23/24/25 | G3-05/06/12/15: durable jobs, finite budget, correct expected status, reconnect/cancel/cleanup |
| review, impact, investigation, campaigns, evidence | FR3-05/08/15..18/25..28 | WP3-05/11/12/16/17/18/19/20/33 | G3-05/07/11/17: graph/ledger/diff/all-trial/4D identities and actual independent proof |
| publication, outcome | FR3-19/21/30/45 | WP3-12/14/22/32 | G3-08/10: authorized provider PR/CI receipts and owner adoption without changing proof |
| evidence-library, audit, index/download/export/reproduce actions | FR3-18/20/31/35/40 | WP3-12/21/25/29 | G3-07/13/15: current authorized projection/export plus queued full-campaign reproduction |
| notifications, read/dismiss/preferences, command palette, search/filter, shell/sidebar/theme | FR3-39/40, NFR3-14 | WP3-29 | G3-13/15: durable per-user state, no revoked snippets/counts, keyboard/mobile/zoom |
| support, service-status, incident, request-access, support-access, operations | FR3-36/41 | WP3-26/30 | G3-13/14/15: durable ticket/request, expiring scope, actual service receipts and operator isolation |
| internal team discussion and reviewer notes in collaboration preview | FR3-42 | WP3-30 | G3-13/15: real threads, version/audience/history, stale candidate and safe share |
| usage, checkout/subscription/invoice/refund, evaluations and ui-states | FR3-24/31/34/36/40 | WP3-13/24/25/26/29 | G3-09/14/15: actual billing/evaluation counts, error/empty/loading/offline/denied states |
| Self-host, standalone binary, BYOK, SAML/SCIM, non-GitHub and multi-cloud | FR3-43..45 | WP3-31/32/34 | G3-16: actual installation/provider/identity/native execution and restoration per profile |

Backend-specific live observability connectors are mandatory through WP3-15/34, including actual source read, permission/revocation, telemetry quality and rate/outage handling. Cross-runtime memory models and wider legacy hypothesis space belong in WP3-33/34 and WP3-20 with explicit supported model/semantic bounds; no expansion column excludes acceptance.

Every visible action/form/control is mapped to a behavior test and actual endpoint/receipt, including actions in modals/drawers/menus. Placeholder/fallback/toast-only actions do not pass acceptance. Public templates must produce a draft reviewable in the workspace; selecting a template does not auto-run or lower proof. Export, notify, comment/share and support workflows perform only side effects explicitly selected by users or preauthorized project policy. All features must be implemented; optional input or selectable mode does not mean optional development.

### Qualification of previously deferred complex scope

| Mandatory capability | Contract and execution acceptance |
| --- | --- |
| Multi-region/consensus — SC3-10 / WP3-19 | Native multi-region/provider topology matching the catalog, declared replication/leader/failover, directed/simultaneous partitions, clock/latency skew, acknowledged journals, consistency/availability/RPO/RTO, recovery ordering; actual environment receipts and full independent repetition |
| Long-horizon leak — SC3-11 / WP3-19 | Horizon beyond known onset with frozen cycles/workload/GC/runtime/allocator/profiler; heap/native/RSS/FD/thread/pool/queue histories, slope/plateau uncertainty, restart policy and actual resource/cost receipts; short no-OOM does not pass |
| Exhaustive schedule/model checking — WP3-33 | Trusted finite state/transition model, scheduler/operation bound and checked invariants pinned; all reachable schedules within registered bound explored, counterexamples checked on native system if applicable; no unbounded/exhaustive-production claim |
| TB-scale/cross-engine migration — WP3-33 | `[DERIVED]` one populated dataset of at least 1 TB (10^12 actual logical bytes) on a registered TB profile, plus an actual cross-engine profile selected from the catalog; active writers, crash/resume/backfill/precision/types/constraints/journal reconciliation, recovery and independent campaign. Compression/sparse file apparent size does not count |
| Qualified legacy repair — WP3-20 | Owner/domain-approved intent/corpus and independent known-valid baseline first; actual model patch and full native/C/P/R/D campaign on a fixable legacy case; ambiguous cases remain safe diagnosis, insufficient to pass repair capability |
| Framework/ORM/database/broker/platform catalog — WP3-03/08/09/10/34 | All names and support levels in the matrix and declared profiles have exact version/range, adapter/toolchain/runtime, native cases and limitations. Cross-platform requires evidence for each platform; upgrade certification not inferred from manifest edits |

All resource limits must be measured and approved within implementation scope before acceptance; additional requirements do not authorize automatic runtime cap increases. Insufficient budget means a blocked gate and a need to define a valid profile, not reduce repetitions/data/horizon. Safety abstention for a run remains correct, but does not replace actual successful capability qualification on supported fixable cases.

### Mandatory distribution and integration catalog

WP3-01/02 freeze `RequiredCapabilityCatalog` and `FeatureCoverageRecord`: feature/source route, required behavior, owner module, requirement/work/gate IDs, version/profile, positive/negative/reproduction cases, actual evidence and status. No priority/later field excludes a feature from release. Catalog reviewed against all four documents and all mockup routes/actions; catalog changes must not remove requirements to avoid failed gates.

`[DERIVED]` baseline providers: GitHub, GitLab, Bitbucket; cloud deployment profiles: AWS, Azure, Google Cloud; standalone operator binary profiles: Windows, Linux and macOS; self-host profile must state OS/architecture/runtime/storage/secret management. Database/broker/framework/ORM coverage starts with all names/version ranges in the matrix then freezes each promised addition before acceptance. Provider/mode/version selections requiring actual access remain qualification blockers until available. All three clouds run actual clean provision, native run, evidence, recovery/deletion replay and teardown; one provider with config files for the other two is insufficient.

SAML/SCIM tested on the configured IdP and tenant lifecycle; BYOK and operator-funded model both tested, including revoke/key rotation/cost attribution. Free and paid tiers mandatory with an actual authorized payment-provider test environment, signatures/webhook retries, invoices, cancellation/downgrade/refund and settlement; live charges only within explicit scope, not a requirement to charge in a documentation session. Final billing offer/terms and chosen license are required decisions, not deferred features.

### Completion and traceability

Final WP3-14 waits for WP3-19/20/26/31/32/33/34 in addition to core/evaluation/publication. WP3-26 waits for public site, notification/query, support/collaboration and paid billing qualification. Because WP3-25 waits for email identity, no hosted journey is considered complete based only on simulated sign-in. WP3-34 waits for actual multi-cloud/distribution plus full platform/capability catalog.

Release checks must verify all BR3-01..25, FR3-01..45, NFR3-01..15, decisions DEC3-01..23, WP3-01..34, G3-01..17, NEG3-01..40, PC3-01..08 and SC3-01..11 are defined/linked, the entire DAG acyclic and all work packages ancestors of final WP3-14. Actual count/status must come from artifacts, not planning tables. Methodologically optional tests run only when assumptions hold; the ability to produce justified statistical claims must still be implemented, and invalid assumptions not falsified for completion.

### Alignment note — 22 October 2026

User instructions replace all minimum-versus-later divisions with full mandatory scope. Mockup source review found email auth/recovery, public pages, notifications/query, exports/drafts/templates, operator/evaluation surfaces and collaboration previews; all mapped without treating browser simulation as a completed backend. Features already covered by earlier requirements deepened; nine new FR, eight work packages, three gates and twelve negative cases fill gaps. Package remains four Markdown files; scripts folder not recreated. Documentation checking is not actual application/security/payment/campaign acceptance. Final structural checks passed: 25 BR, 45 FR, 15 NFR, 23 decisions, 34 work packages, 17 gates, 40 negative cases, 8 problem classes and 11 scenarios; all FR linked to work/gate, 74 valid local links/anchors, all work packages ancestors of final WP3-14 and DAG acyclic. Scripts folder still absent.


<a id="product-depth-acceptance"></a>

## 21. Acceptance for deeper product readiness and economics

All following rows are `[DERIVED]` targets, not execution results. They complement existing IDs, work packages and negative families; [PRD §20](PRD.md#product-depth-decision) governs semantics, [architecture §20](architecture.md#product-depth-architecture) constrains authority. Credit limitations do not reduce mandatory campaigns or release scope.

| Focus / requirement | Owning WP (dependencies remain §8) | Positive + negative acceptance and proof artifact | Relevant gate / family |
| --- | --- | --- | --- |
| CI-assisted readiness; BR3-01/17, FR3-01/15/28/31 | WP3-01 contracts; WP3-03 inventory; WP3-06 oracle; WP3-22 CI access; WP3-25 UI | Existing contracts/tests with provenance become review material, owner confirms specific invariants, trusted author freeze and native baseline; stale CI/forged artifact/unsupported workflow/missing approval remain blockers, no mutation | G3-04/12/15; NEG3-02/03/10/19/21 |
| Scoped project reuse; BR3-01/17, FR3-01/28/31/35 | WP3-01, WP3-21, WP3-22, WP3-25 | Valid profile reduces repeated input; changed intent/source, expired/revoked approval, wrong tenant, revoked repo and deletion fence reject reuse. Browser flow shows reason and next step; approval receipt + profile revision | G3-12/13/15; NEG3-03/07/19/21/22/27 |
| Auditable check selection; BR3-09/19, FR3-06/14/15/17 | WP3-01, WP3-05, WP3-06, WP3-11 | Coverage map links required targets/edges/invariants/dimensions/transitions to checks; unknown impact not removed; failed check not excluded; fast subset not promoted to full. Exact full native receipts mandatory | G3-04/05/06/11; NEG3-02/04/06/07/15 |
| Preparation reuse; BR3-19, FR3-14/15/32/35 | WP3-01, WP3-04, WP3-06, WP3-23 | Valid build cache hit reduces measured preparation, runtime proof remains fresh; change source/lock/toolchain/config/template one at a time → miss/reject; poisoned/cross-tenant/cache-pass injection/dirty data/quarantined environment rejected; G3-07 clean reproduction | G3-02/07/13; NEG3-07/08/10/21/24/27/33 |
| Forecast + economics; BR3-14/19, FR3-14/24/34 | WP3-01, WP3-16, WP3-24, WP3-25, WP3-26 | Cold/warm estimate vs actual full campaign+cleanup, concurrent reserve/cap, gross/net credit distinction; uncalibrated/expired credit/insufficient reserve/no accepted repair does not yield a successful estimate, unlimited cap or zero cost-per-fix | G3-09/12/14; NEG3-13/20/25/26/28 |
| B2 + component ablation; BR3-14, FR3-24 | WP3-01 manifest; WP3-13 harness | §9 complete frozen arms/cases/access/budgets and actual all-run receipts; hidden evaluator, same model/guard; oracle leakage/unequal caps/omitted failed runs/missing final mixed-version checks invalidate the related comparison | G3-09; NEG3-03/06/07/13/15 |
| Meta decision trace; BR3-03/08, FR3-07/08 | WP3-07, WP3-11, WP3-13 | Live synthesis → typed discriminating probe → runtime contradiction → revised ledger/plan when it occurs; raw observed trace linked to identity. Malformed tool/outage/silent provider substitution/replay/human-patch injection not counted as live autonomous recovery | G3-05/09; NEG3-08/09/20/28; SC3-05 |
| First-user journey; BR3-14/17, FR3-21/31 | WP3-25, WP3-14 | Multi-service transactional application owner connects repos through actionable result; record active/elapsed/domain-review time, blocker/abandonment and repeat project. Queued/generic summary not counted as benefit; diagnosis and accepted repair separate | G3-10/12/15; SC3-01/06/09 |

The family list above is a risk reference; each new test case still has its own expected behavior, exact inputs and receipts. It does not replace all NEG3-01..40. Qualification must include native CI artifact fetch/import in a sandbox, actual clean-vs-reused preparation, fresh native full proof, concurrent-tenant authorization and browser readiness journey. Unit mocks may test validators but do not pass those gates.

The metrics study freezes event definitions, idle handling, observation window, cohort inclusion, dropout/blocked counts and reviewer-time collection before runs. First-use vs repeat-use reported separately; savings claimed only from matched comparisons with the same case/profile/evidence scope. No calibrated numerical savings, duration or cost per accepted repair targets yet. B2 benchmark measures technical outcomes; organic benefits and user time still require pilot SC3-06.

<a id="execution-phases"></a>

## 22. Seven development and testing phases

**Active decision — 24 October 2026, execution-plan revision 2:** the user's restructuring request replaces the five-phase allocation. Phases 1–5 focus on back-end development, phase-6 develops the entire front-end from [.template-ui/mockup.html](.template-ui/mockup.html), and phase-7 performs whole-system testing and qualification. This edit does not execute any phase. One complete release still includes every feature, WP and gate; no scope, threshold, policy, schema, budget or full-WP dependency changes.

The specification directory is the directory containing this MVP and its sibling documents. Conventionally it is ``, with the application root above it; in this extracted ChangeProof-AI package it is the project root itself. All Markdown links resolve relative to their files. `phases/` is alongside this MVP; implementation and `docs/phase-reports/` belong at the application root. Do not create duplicate specification trees.

### Development tasks versus full work packages

`[DERIVED]` split cross-cutting WPs into back-end tasks, front-end tasks and acceptance tasks; these are engineering task scopes, not new WP IDs or product statuses. The §8 full-WP DAG and original Done when criteria remain normative. Backend task completion never means a UI-bearing WP is done. Phase-7 owns acceptance closure/revalidation of all WPs, reusing earlier valid evidence rather than blindly repeating it.

For a task to start, list its exact input contracts/services/authority and prove the required predecessor tasks. Where a full-WP predecessor is incomplete, only independent preparation permitted by AGENTS §7 / skill Step 2 may proceed; explicitly record the unfinished prerequisite and withheld full acceptance. In particular, 25 back-end services follow 12/22/23/24/28 service evidence; 29 service tasks follow 25 services; 30 services follow 25/29; 31 distribution preparation follows 24/25 services; 34 automation preparation follows 03/31/33; 26 operations preparation follows 13 tooling and 25/27/29/30 services. No task may consume missing UI/whole-system evidence or infer predecessor `done` from an interface/mock. If it cannot be independent, it remains blocked.

Phases 1–5 never build ChangeProof dashboard/trace-viewer pages. Native React/Next.js fixture/browser tests needed to prove engine/adapter behavior still run in those phases; customer fixture UI is not product front-end development. Phase-6 integrates real backend services and runs local browser checks. Phase-7 is dedicated to whole-system testing, independent qualification, organic outcome validation and final gate review. Bounded fixes of discovered defects require fresh affected proof; missing planned capabilities remain assigned to their development phase. Local positive/negative/typecheck/lint/boundary/unit/integration/native checks remain mandatory in every phase, not postponed to phase-7.

| Phase / prompt | Allocated tasks, recommended order | Outcome |
| --- | --- | --- |
| [phase-1](phases/phase-1.md) | WP3-01, WP3-02, WP3-03, WP3-04, WP3-05 back-end | Contracts/policy, toolchain, inventory, runner, graph |
| [phase-2](phases/phase-2.md) | WP3-15, WP3-16, WP3-17, WP3-06, WP3-21, WP3-22, WP3-28, WP3-23, WP3-24 back-end | Telemetry, campaigns, reducers, baseline, identity/provider/email, jobs, usage/billing |
| [phase-3](phases/phase-3.md) | WP3-07, WP3-08, WP3-09, WP3-10, WP3-11, WP3-12, WP3-18 back-end | Reasoning/adapters, migrations, coordinated repair, private evidence/publication services |
| [phase-4](phases/phase-4.md) | WP3-27, WP3-25, WP3-29, WP3-30, WP3-31, WP3-32 back-end | Public/workspace APIs, inbox/query/export/support/collaboration, distribution/BYOK/enterprise/providers |
| [phase-5](phases/phase-5.md) | WP3-13, WP3-19, WP3-20, WP3-33, WP3-34, WP3-26, WP3-14 back-end/preparation | Evaluation tooling, complex profiles, cloud/catalog automation, operations and pilot preparation |
| [phase-6](phases/phase-6.md) | All product front-end tasks, detailed below | Complete public site/dashboard/trace viewer, English UI, active mockup design, real APIs and local browser checks |
| [phase-7](phases/phase-7.md) | Acceptance of WP3-01..34 in §8 order | Whole-system regression/security/native/browser/evaluation/campaign/pilot qualification; G3-01..17 final review |

### Complete WP allocation

Every WP has exactly one back-end task owner, optional front-end tasks in phase-6 and acceptance ownership in phase-7. The front-end column covers product UI contributions; other engine WPs supply API facts consumed by WP3-25 UI rather than separate product front-ends. This table does not claim completion.

| WP | Back-end tasks | Front-end tasks | Full acceptance |
| --- | --- | --- | --- |
| WP3-01 | phase-1 | via WP3-25 UI | phase-7 |
| WP3-02 | phase-1 | via WP3-25 UI | phase-7 |
| WP3-03 | phase-1 | via WP3-25 UI | phase-7 |
| WP3-04 | phase-1 | via WP3-25 UI | phase-7 |
| WP3-05 | phase-1 | via WP3-25 UI | phase-7 |
| WP3-06 | phase-2 | via WP3-25 UI | phase-7 |
| WP3-07 | phase-3 | via WP3-25 UI | phase-7 |
| WP3-08 | phase-3 | via WP3-25 UI | phase-7 |
| WP3-09 | phase-3 | via WP3-25 UI | phase-7 |
| WP3-10 | phase-3 | via WP3-25 UI | phase-7 |
| WP3-11 | phase-3 | via WP3-25 UI | phase-7 |
| WP3-12 | phase-3 | phase-6 | phase-7 |
| WP3-13 | phase-5 | via WP3-25 UI | phase-7 |
| WP3-14 | phase-5 | phase-6 | phase-7 |
| WP3-15 | phase-2 | via WP3-25 UI | phase-7 |
| WP3-16 | phase-2 | via WP3-25 UI | phase-7 |
| WP3-17 | phase-2 | via WP3-25 UI | phase-7 |
| WP3-18 | phase-3 | via WP3-25 UI | phase-7 |
| WP3-19 | phase-5 | via WP3-25 UI | phase-7 |
| WP3-20 | phase-5 | via WP3-25 UI | phase-7 |
| WP3-21 | phase-2 | phase-6 | phase-7 |
| WP3-22 | phase-2 | phase-6 | phase-7 |
| WP3-23 | phase-2 | via WP3-25 UI | phase-7 |
| WP3-24 | phase-2 | phase-6 | phase-7 |
| WP3-25 | phase-4 | phase-6 | phase-7 |
| WP3-26 | phase-5 | phase-6 | phase-7 |
| WP3-27 | phase-4 | phase-6 | phase-7 |
| WP3-28 | phase-2 | phase-6 | phase-7 |
| WP3-29 | phase-4 | phase-6 | phase-7 |
| WP3-30 | phase-4 | phase-6 | phase-7 |
| WP3-31 | phase-4 | phase-6 | phase-7 |
| WP3-32 | phase-4 | phase-6 | phase-7 |
| WP3-33 | phase-5 | via WP3-25 UI | phase-7 |
| WP3-34 | phase-5 | via WP3-25 UI | phase-7 |

Full-WP acceptance order is listed in [phase-7](phases/phase-7.md); §8 is the authority. Specifically 26 still waits for 13/25/27/29/30, 34 for 03/31/33, and final 14 for 12/13/19/20/26/31/32/33/34. Requesting a phase proves no prerequisite. Continue independent tasks within that phase and name concrete blockers; never silently run all earlier phases.

### Gate allocation and closure

All gates are finally reviewed in phase-7; earlier phases produce required local evidence. A contributor column is not a pass declaration.

| Gate | Development contributors | Closure |
| --- | --- | --- |
| G3-01 | phase-1 | phase-7 |
| G3-02 | phase-1, phase-2 | phase-7 |
| G3-03 | phase-1, phase-3, phase-5 | phase-7 |
| G3-04 | phase-1, phase-2 | phase-7 |
| G3-05 | phase-3, phase-5 | phase-7 |
| G3-06 | phase-1, phase-2, phase-3, phase-4, phase-5, phase-6 | phase-7 |
| G3-07 | phase-3, phase-4, phase-5, phase-6 | phase-7 |
| G3-08 | phase-2, phase-3, phase-4, phase-6 | phase-7 |
| G3-09 | phase-3, phase-5, phase-6 | phase-7 |
| G3-10 | phase-5, phase-6 | phase-7 |
| G3-11 | phase-2, phase-3, phase-5 | phase-7 |
| G3-12 | phase-2, phase-3, phase-4, phase-6 | phase-7 |
| G3-13 | phase-1, phase-2, phase-3, phase-4, phase-5, phase-6 | phase-7 |
| G3-14 | phase-2, phase-4, phase-5, phase-6 | phase-7 |
| G3-15 | phase-2, phase-4, phase-6 | phase-7 |
| G3-16 | phase-2, phase-4, phase-5, phase-6 | phase-7 |
| G3-17 | phase-3, phase-5 | phase-7 |

### Routing, status and report migration

Follow [AGENTS §18](AGENTS.md#18-pemanggilan-fase-eksekusi) and [skill](SKILL.md). Valid prompts are phase-1 through phase-7. Save reports only on actual execution as `docs/phase-reports/phase-N.md`. Record task scope separately from full-WP status, plan revision 2, commands/exit codes, source/config/evaluation identity, evidence, missing checks and exact next dependency-ready task. Phases finish allocated tasks only; full WPs/gates require all original acceptance. No phase automatically starts its successor or authorizes paid APIs, external changes/messages, payments or deployment.

Any old phase-4 experience work maps to backend phase-4 plus front-end phase-6; old phase-5 qualification maps to backend/preparation phase-5 plus whole-system phase-7. Older phase-1..3 UI contributions also move to phase-6. Preserve historical reports and immutable artifacts; do not bulk relabel prior results or infer new completion. Audit old tasks against current identities and record the migration in the next actual execution report. No existing execution report was present in this extracted package during this document change.

### Historical five-phase preparation — superseded allocation

The following 22 October 2026 task note is retained as historical provenance, not the current allocation or evidence for this revision. Its five-file counts/check commands were reported in the original package and have not been rerun here. Current validation and limitations are in [the revision note](docs/phase-plan-revision.md).

### Phase preparation task note

```text
Task ID / parent WP: DOC3-20261022-02 / execution preparation for WP3-01..34
Requirement IDs: all existing WP/BR3/FR3 mappings; no product requirements added
User-visible outcome: phase-1..5 prompts routed to five implementation playbooks with dependencies, acceptance and resume.
Prerequisite evidence: MVP §8/21, source instructions and actual package.json read; Git metadata unavailable.
Allowed source/config changes: phases/*.md; AGENTS.md/SKILL.md; references in four documents; root AGENTS.md only 1.0 phase routing.
Input snapshots + intended intervention: pre-change snapshot in temporary workspace; user's request to add phases supersedes the seven-file-only structure limit.
Acceptance checks (positive, negative, native): completeness of exactly 34 WP without duplication, dependency order/DAG, local links/anchors, root+folder routing; native not applicable to documentation.
Protected oracle / proof scope: oracle, model, product source, thresholds and historical evidence unchanged; implementation phases not yet run.
Artifacts expected: phase-1.md through phase-5.md, routing and §22 matrix.
Actual commands + exit codes: node temporary check-phases.cjs → 0; git status --short → 1 (Git metadata unavailable); details below.
Status + remaining blocker: done for document preparation and validation; implementation phases not yet run and each WP's status needs auditing when invoked.
Next dependency-ready task: when user requests phase-1, audit actual contracts/policy against WP3-01 then execute ready tasks.
```

Actual checks: `node 'C:\Users\user\AppData\Local\Temp\changeproof-phases-0a2a459697554d54a0e8c0a1ea570519\check-phases.cjs'` → **exit 0**. Five phase files contain exactly 34 WP without duplication; phase matrix matches playbooks; each dependency precedes its dependent in the chosen order; WP DAG unchanged from pre-edit snapshot; 174 valid local links/anchors; mockup identical. Root and `AGENTS.md` routing reviewed so old phases do not take over new prompts. This is document validation, not end-to-end testing of agent behavior in future sessions.

Mock/native: not run. Missing application checks: strict typecheck, lint/boundaries, unit/integration, native/model/provider/browser not run because product source unchanged; no passing results claimed. Schema/policy/evaluation semantics unchanged, only development orchestration added. No phase marked complete, external effect or automation created. Operation authorization and actual prerequisites still checked when playbooks invoked.

## Seven-file package consolidation — 22 October 2026

Per user instruction, the requested final `` package contains only `BRD.md`, `PRD.md`, `MVP.md`, `architecture.md`, `SKILL.md`, `AGENTS.md`, and `.template-ui/mockup.html`. Seven references merged in full into the Unified references section in SKILL; identical skill copies verified. SVG logo, WOFF2 fonts, and OFL license text stored in HTML; reports folder originally empty. Product scope, requirement IDs, schema, policy and acceptance gates unchanged. Document consolidation is not proof of implementation or passed gates.

**Deletion status:** consolidation complete, but deletion of source files/folders denied by automated policy check. Source folders still exist; seven-file layout not yet achieved.

**Historical structure update — 22 October 2026 (superseded by §22 revision 2):** the consolidation note above is history. The user's latest request adds a `phases/` folder containing five playbooks; the active package consists of seven main files plus that folder. The old seven-file-only restriction no longer applies. Product scope and WP dependencies unchanged; see [MVP §22](MVP.md#execution-phases).

<a id="hackathon-build-scope"></a>
## 23. Hackathon build scope — focused vertical slice, full product value

The competition build uses the dedicated scope and demo contract in [BRD §21](BRD.md#hackathon-build-scope). It is **not a replacement or reduction** of MVP §2, the complete-release scope in §20, any WP3/G3 acceptance requirements, or the existing dependency DAG. It determines what the team prioritizes for the hackathon submission and what that submission may claim; all other capability remains unfinished product scope unless independently implemented and proven.

**Demo target:** one reproducible, real-runtime order-to-inventory contract break across a frontend and one selected backend. Pin the backend choice only after auditing available fixtures/toolchains. Preserve the distinctive value: a human-frozen business intent/oracle, evidence-attributed failure, visible Meta model contribution to diagnosis/structured repair proposal, narrow authorized patch, native execution, independent business-invariant verification, and a reproducible evidence dossier. Reduce number of ecosystems and problem classes, not proof integrity or business meaning.

The vertical slice must demonstrate a controlled before/intervention/after case. It is not the organic owner-validated pilot SC3-06, and cannot pass G3-10 by itself. It does not establish SC3-01's complete three-repository footprint, the required SC3-01..05/07..08/10..11 portfolio, the complete capability matrix, hosted release, or any gate not actually satisfied. Use explicit capability/status labels and mark missing checks `blocked` or `unverified`; never substitute mocks/replays for claims of real execution/live Meta.

Keep all stated human authorization, security, privacy, training-mode, AI transparency, provenance/watermark, 18+ audience, spend cap and resource reservation rules. No paid API calls, publication, destructive operation, external message, deployment, or merge is authorized by this scope alone; require explicit session authorization. Resource credits are unavailable until actual entitlement/balance/mode/expiry are verified. Submission track is a team eligibility decision, not a product-scope decision; BRD recommends Indie only conditionally and selects Push the Frontier as a proposed theme, subject to actual eligibility and portal rules.

See BRD §21 for the exact in-scope/out-of-scope demo matrix, sequence, claim limits and submission checklist.

### Competition submission readiness and acceptance

Before external submission, record a dated readiness checklist against the live portal/Event Waiver: (1) eligibility and exactly one selected track/theme; (2) Indie team-size limit or Startup representative employment requirement; (3) one representative and complete member list; (4) official submission route, deadline/time zone, required fields and demo/video format; (5) current judging rubric and eligible Meta tooling; (6) claim-form deadline, account entitlement, payment-method/billing risk, model/service mode and finite spend cap; (7) current IP license, non-confidentiality and permission to publish every included asset; (8) payment/tax obligations including W-8BEN where applicable; (9) AI disclosure, age/use restrictions, provenance/watermark and human-authorization checks; and (10) final submission owner confirmation. Keep personal tax/payment data and Team/Project IDs out of source control.

**Acceptance rule:** the checklist is submission-readiness evidence only; it does not certify legal eligibility, credit balance, product capability, competition score or a prize. If the current portal/waiver differs from the participant-reported values summarized in BRD §20, update the dated source record and affected copy before submission. Do not change product verdict policy, proof thresholds or spend cap to optimize a judging score. Keep the mockup's visual design, embedded assets, fonts, layout and CSS unchanged; any future update is restricted to user-facing content and must not turn illustrative sample credits/metrics into claims of awarded credit or actual service entitlement.
