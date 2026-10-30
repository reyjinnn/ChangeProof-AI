# ChangeProof AI 1.0: Business Requirements Document

**Active scope, 22 October 2026:** Every feature and module named in these four documents and `.template-ui/mockup.html` is required for the complete release. No feature is deferred to a later phase; implementation order follows dependencies. Design targets and mockup appearance are not evidence of implementation. The former scope decision in MVP §19 has been superseded.

**Document type:** Initial product-development brief.  
**Status:** Target specification; not a claim that any capability has been implemented.  
**Architecture:** Modular monolith with ecosystem adapters, hosted web/API, and isolated execution workers.  
**Delivery:** Hosted SaaS is the primary service; product source is open source, and self-hosting must be available.  
**Related documents:** [PRD](PRD.md), [MVP](MVP.md), [Architecture](architecture.md).

**Capability deepening:** [Problem classes](PRD.md#17-problem-profiles-and-capability-limits) and [acceptance scenarios](MVP.md#17-campaign-protocol-and-acceptance-dossier). All new capabilities remain **targets**, with explicit proof envelopes; existing requirement IDs are retained.

## 1. Business mandate

Build ChangeProof AI as a platform for investigating, repairing, and verifying software changes across languages, frameworks, data, and repositories. The product must help teams resolve business failures that arise when multiple parts of a system evolve together.

The provider operates the product as a hosted SaaS. Customers use a browser and connect repositories through the GitHub App; they do not need to clone ChangeProof, prepare a runtime/server, or bring their own model API key. Open-source delivery applies to the product source and documentation; private customer code and evidence remain protected. See the [hosted SaaS](PRD.md#18-customer-journey-and-hosted-access) section for service details.

The product's unit of value is **a business workflow restored with evidence**, not the number of files changed, languages detected, tool calls made, or how convincing a demo looks.

The product is designed for complex problems: contract changes that propagate across services, dependency incompatibilities, data migrations, event changes, and staged deployment requirements. It addresses complexity through decomposition, evidence-based investigation, cross-component planning, and independent verification.

For failures that are difficult to reproduce, product work starts with observation and experiment design. A race condition, retry storm, writer/backfill conflict, pool exhaustion, or dynamic behavior cannot be adequately handled by running a test just once. A claim that a “workflow is restored” must specify the workload, failure envelope, observation horizon, and uncertainty limits.

The ambition is to expand the classes of problems that can be solved sustainably. A promise that “every problem will definitely be solved” cannot be an acceptance criterion: some problems require a business decision, unavailable access, or information that does not exist. In those cases, the product must provide a diagnosis, evidence of the obstacle, and an actionable next step. Obstacles must never be disguised as success.

## 2. Customer problems

A change in one service can break a consumer without immediately appearing in the producer repository's CI. A local build may pass while checkout fails, inventory is deducted twice, old data cannot be read, or an older service version cannot run alongside a newer one.

Teams must combine information scattered across source code, OpenAPI, runtime traces, dependency manifests, migration history, deployment configuration, and domain knowledge. Coding AI that works on only one file or repository often misses this context.

Problems to address:

| Problem | Business impact | Product need |
| --- | --- | --- |
| Breaking changes across APIs and frameworks | A user workflow fails after a change | Cross-stack impact graph and coordinated patches |
| Schema/data changes while multiple application versions are active | Data loss, misinterpretation, or downtime | Migration plan and compatibility checks against safe, real data |
| A dependency upgrade changes transitive behavior | CI fails or a new regression appears | Dependency-change analysis and native verification |
| Events arrive late, are duplicated, or change shape | Inventory/payment/order state becomes inconsistent | Idempotency, ordering, retry, and integration checks |
| A patch looks correct but passes only shallow tests | Reviewers receive false assurance | Protected oracle and business-workflow evidence |
| Changes across repositories are not applied in sync | Intermediate version combinations break | Dependency-aware rollout plan and mixed-version verification |
| Manual investigation is repeatedly duplicated | Engineering effort and recovery cost increase | Reusable adapters, evidence, and recovery history |

## 3. Users and stakeholders

| Persona | Primary responsibility | Decision supported |
| --- | --- | --- |
| Application maintainer | Keep business workflows working and review patches | Is the repair correct, relevant, and maintainable? |
| API/service owner | Evolve contracts without breaking other systems | Which consumers are affected, and in what order should changes land? |
| Platform engineer | Manage runtime, CI, dependencies, and integrations | Can the run be reproduced and operated? |
| Data owner/DB engineer | Maintain data consistency and migration safety | Do old and new data remain correct, and is recovery viable? |
| Tech lead/reviewer | Approve changes across repositories | Were the full bundle and intermediate version combinations tested? |
| Engineering manager | Assess usage benefits and costs | Is effort reduced with measurable quality? |

One person may hold multiple roles. Scope ownership, business invariants, and approval to apply changes must remain recorded.

**Initial user focus [DERIVED]:** teams that own transaction applications with multiple services and regularly change API contracts, events, and schemas. The initial flow uses an order-to-inventory workflow: orders are correct, reservations are not duplicated, and data reads remain compatible during transitions. Other personas and the full release scope remain required; this focus informs onboarding language, examples, and benefit measurement, not the removal of enterprise or framework features.

## 4. Product vision and principles

1. **Framework-agnostic through adapters:** one reasoning engine, one shared change representation, and one policy; framework knowledge belongs in adapters.
2. **Business outcomes first:** verification tests user-visible behavior and the data integrity that must be preserved.
3. **Real execution:** application source is built and run with actual toolchains and supporting services.
4. **Independent proof:** the model does not determine verdicts, modify the protected oracle, or fabricate test results.
5. **Coordinated repair:** a patch in one repository is evaluated in the context of the full repair set and deployment sequence.
6. **Bounded autonomy:** investigation, proposals, and retries may be automated only within a scope and resource profile set before the run.
7. **Honest capability:** support is a combination of framework, version, feature, change type, and evidence, not a global marketing label.
8. **Evidence-driven delivery:** work is completed against acceptance gates, not a calendar or target number of days.

## 5. Business requirements

| ID | Requirement | Business success criteria | Traceability |
| --- | --- | --- | --- |
| BR3-01 | Accurately onboard polyglot systems | Owners can review components, versions, boundaries, and unsupported areas before remediation | FR3-01..03 |
| BR3-02 | Find cascading impact | The impact graph connects source/config/deployment/resource changes to affected workflows with provenance; symptoms are distinguished from causes | FR3-04..06, FR3-25 |
| BR3-03 | Repair according to the framework and change intent | Patches preserve business intent and follow application structure, rather than merely replacing strings | FR3-07..09 |
| BR3-04 | Coordinate changes across repositories | Bundles have pinned snapshots, dependency order, and cross-component compatibility evidence | FR3-10, FR3-17 |
| BR3-05 | Handle schema and data migrations | Data integrity and transition/recovery are proven with active readers/writers, interruption/resume, and acknowledged-write reconciliation | FR3-11, FR3-26 |
| BR3-06 | Handle dependency upgrades | Source, manifests, and lockfiles are consistent; native builds and behavioral checks prove the result | FR3-12 |
| BR3-07 | Handle events, caches, and mixed-version conditions | Concurrency/partial failure does not cause unsafe effects; retries/backlog/convergence meet defined bounds | FR3-13, FR3-17, FR3-26..27 |
| BR3-08 | Perform adaptive recovery | Hypotheses update from actual evidence; repeated lack of progress stops with a blocker and next probe | FR3-08, FR3-14 |
| BR3-09 | Produce trustworthy assurance | Positive claims come only from policy and independent evidence matching the patch | FR3-15..16 |
| BR3-10 | Provide reviewable, reproducible results | Reviewers can open evidence, reproduce the result, and see limitations before merging | FR3-18..20 |
| BR3-11 | Prove impact on user applications | An organic issue in a pilot repository is actually resolved and validated by its owner | FR3-21 |
| BR3-12 | Expand ecosystems without rewriting the engine | New adapters pass the same conformance and capability certification | FR3-02..03 |
| BR3-13 | Protect repositories, data, and credentials | Scope and runtime capabilities constrain every mutation, process, connection, and publication | FR3-22..23 |
| BR3-14 | Measure benefits and weaknesses honestly | Reports distinguish real pilots, controlled runtime, replay, failures, costs, and support gaps | FR3-21, FR3-24 |
| BR3-15 | Provide trustworthy diagnoses when information is limited | Owners can see facts, causal/competing hypotheses, telemetry gaps, and safe next investigations; legacy behavior is not assumed correct | FR3-25, FR3-28 |
| BR3-16 | Prove recovery under realistic failure conditions | Correctness, performance, resilience, and data integrity meet a pre-registered campaign; the product does not promise freedom from all intermittent failures | FR3-26, FR3-27 |
| BR3-17 | Provide service access through a website | Independent customers can log in, connect GitHub, run investigations, and review results without installing ChangeProof or a native toolchain | FR3-29..31 |
| BR3-18 | Securely serve multiple organizations | Source, credentials, jobs, and evidence do not leak across tenants; revoked access actually stops working | FR3-29, FR3-30, FR3-32, FR3-35 |
| BR3-19 | Operate within controlled capacity and cost | Durable jobs, fair admission, metering, and caps are proven for the offered capacity tier | FR3-33, FR3-34, FR3-36 |
| BR3-20 | Distribute trustworthy open-source products and services | Public source has a clear license; hosted deployment/recovery/privacy and customer-facing limits are proven | FR3-35, FR3-36 |
| BR3-21 | Help users understand the service and manage their identity | All public website, email/GitHub login, verification/recovery, and enterprise identity flows work with correct access | FR3-37, FR3-38, FR3-44 |
| BR3-22 | Make work and evidence easy to find | Search/filter, notification center, evidence library, and authorized exports reduce review effort without exposing unauthorized data | FR3-18, FR3-20, FR3-31, FR3-39, FR3-40 |
| BR3-23 | Make collaboration and support actionable | Internal discussion, reviewer notes, tickets/access requests, and service incidents are durable and scoped; approval does not replace proof | FR3-41, FR3-42 |
| BR3-24 | Complete distribution, integration, and monetization options | Hosted/self-hosted, BYOK, binary, multi-cloud, SAML/SCIM, non-GitHub providers, and paid billing are all qualified | FR3-34, FR3-43..45 |
| BR3-25 | Make all documented capabilities available at completion | No feature is deferred; multi-region, long-horizon, model checking, TB/cross-engine, and legacy repair have actual proof | FR3-11, FR3-17, FR3-26..28 |

## 6. Ecosystem scope

All items below are **product targets**. An achieved level is recorded only after executable evidence exists. For MVP target acceptance details, see [MVP §3](MVP.md#3-target-capability-matrix).

| Ecosystem | Target framework/runtime | Target persistence/schema | Toolchain the adapter must understand |
| --- | --- | --- | --- |
| JavaScript/TypeScript | React, Next.js, Vue, Nuxt, Angular, SvelteKit; Express, NestJS, Fastify, Hono | Prisma, TypeORM, Drizzle, Sequelize | Manifest/lockfile, compiler/build, native test runner, browser E2E |
| Python | FastAPI, Django, Flask | SQLAlchemy, Django ORM, Pydantic | Environment/lock, pytest or project runner, Ruff/mypy when configured |
| Java/Kotlin | Spring Boot, Quarkus, Micronaut, Ktor | Hibernate/JPA | Maven/Gradle, compiler, native tests |
| Go | Gin, Fiber, Echo, net/http | GORM, Ent | Modules, compiler, go test |
| PHP | Laravel, Symfony | Eloquent, Doctrine | Composer, PHPUnit/Pest according to the project |
| C#/.NET | ASP.NET Core | Entity Framework Core | SDK/project graph, native build, xUnit/NUnit according to the project |

React is a UI library, Pydantic is a validation/schema library, JPA is a specification/API, and net/http is a standard library. The registry distinguishes those categories; a single “framework” label must not erase capability differences.

### Support levels

| Level | Meaning | Claim limit |
| --- | --- | --- |
| L1 Analyze | Detect stack/version, extract contracts and relations, analyze registered change categories | Does not promise patches or runtime correctness |
| L2 Remediate | L1 plus a plan and candidate patch through the gateway for registered categories | The patch is not automatically verified; evidence status must be explicit |
| L3 Verify | L2 plus native independent verification and a real-runtime regression suite for that capability | Still limited to the tested versions, categories, topology, and proof scope |

L3 for a specific framework does not automatically give L3 for every ORM, plugin, configuration, or other framework combination. A cross-stack combination has its own certification record.

The product direction is to carry the framework and problem-class combinations users need up to L3 through real evidence. L1/L2 in the MVP are the minimum levels for the first delivery; adding further capabilities does not require a new AI engine.

## 7. Core business capabilities

### 7.1 Cross-framework impact and remediation

Identify the chain API → generated client → service logic → UI, including shared schemas, serialization, auth context, and data mapping. The system must explain why a location is relevant, which evidence it used, and which parts remain unknown.

### 7.2 Dependency upgrade intelligence

Compare versions/dependency graphs and relevant API/behavior changes. A proposal may include source migration and validated dependency changes. “Install latest,” deleting dependencies, or disabling checks are not acceptance strategies.

### 7.3 Schema migration intelligence

Handle changes to data structure and meaning, including backfills, constraints, reader/writer compatibility, and staged migrations. Deleting data or weakening assertions must never be used to make a test pass.

### 7.4 Autonomous repair and adaptive recovery

Autonomy means the system performs permitted investigative and repair steps without repeatedly asking for routine decisions. It may replace a hypothesis after a failure, update the graph, and form a new candidate bundle. It does not automatically gain permission to merge, deploy to production, or mutate user data from the ability to produce a patch.

### 7.5 Evidence-backed adoption

Results include patches, causal explanations, per-target and per-bundle evidence, application order, residual risk, and recovery procedures. Owners must be able to distinguish “tested in an isolated environment,” “accepted by a maintainer,” and “already used by customers.”

### 7.6 Incident investigation and the four recovery dimensions

Logs/traces/metrics plus source and deployment history help identify candidate causes. Correlation is not causal proof. The product must retain alternative explanations and test probes that can distinguish them. When telemetry is insufficient, the useful result is proven facts, uncertainty, and the access or observability needed next.

Correctness, performance, resilience, and data integrity are four different conditions. Lower latency caused by dropped requests does not mean the workflow is restored; a database that finally looks correct does not prove an acknowledged operation was not lost; a restart that removes the symptom does not prove a memory leak was fixed.

## 8. Flagship scenario: cross-stack order-to-inventory

Build and use a real application consisting of:

- Next.js/TypeScript as the frontend for creating and reading orders.
- Spring Boot as the order service.
- FastAPI as the inventory service.
- PostgreSQL for business state and migrations.
- Redis Streams for event delivery, plus Redis cache if the application actually uses one.

Redis is not treated as a generic messaging label; topology, delivery semantics, consumer groups, acknowledgment, and retry must be explicit.

A change in the order domain alters the response contract, identifier/amount representation, persistence schema, and event payload. Failures propagate to frontend rendering, inventory reservation, reads of old orders, and older-version consumers.

Expected result: ChangeProof finds those relationships, forms coordinated patches, runs the actual migration, checks old/new and mixed-version combinations, exercises duplicate delivery/retry, and produces a PR bundle that references exactly the evidence for that candidate.

Example invariants: order totals stay correct, tenants do not leak, one order produces at most one active reservation, old order data stays readable, and retries do not cause double decrementing. Domain details and expected behavior are agreed and frozen before the run.

## 9. What counts as real success

| Evidence type | Use | Can it alone pass the MVP? |
| --- | --- | --- |
| Unit tests, mocks, replayed models | Development, contracts, failure paths, response reproduction | No |
| Controlled real-runtime application | Real source/services/database/browser; changes can be intentional | No; it is required but does not prove user benefit |
| Historical organic issue | A problem that occurred in an application repository, reproduced from the original commit | Can form part of a pilot gate with owner validation |
| Current authorized pilot | A real user problem, with the candidate run on representative infrastructure and the outcome accepted by the owner | At least one pilot proof is required per the MVP |
| Production observation | Evidence of deployment and effect on users in a permitted environment | Recorded if available; never assumed from staging |

Safe or sanitized test data may be used. A simulation cannot replace the business source, main execution path, dependency that caused the problem, or measurement of results. External service calls outside scope may be stubbed with explicit claim limits; a service that is the subject of proof must run for real.

## 10. Impact measures

| Metric | How it is measured |
| --- | --- |
| Business recovery | Workflows that again satisfy the invariant / workflows defined as failing before the repair |
| Repair success | Fixable cases with a verified bundle / all scheduled fixable cases; errors and incomplete cases stay visible |
| Cross-repository completeness | Required target/edge checks proven / all required target/edge checks |
| Unsafe assurance | Incorrect positive claims / all positive claims, reported with absolute counts |
| Maintainer adoption | Patches accepted by owners / patches submitted in the pilot |
| Human effort | Actual recorded active time for investigation/review/integration; manual comparison only when a baseline was measured |
| Operational effect | Success/error rate, goodput, latency distributions including timeouts, recurrence, and recovery/convergence under a frozen workload/horizon; the four dimensions are assessed separately |
| Resource cost | Calls, tokens, cost, CPU/memory, storage, runtime, retries, and cleanup |
| Preparation effort | Active user time from repository connection to the first useful result; separate waiting time, operator/domain-owner work, and new projects from reuse |
| Cost per accepted repair | Total investigation, failure, verification/reproduction, and review cost across a cohort / repairs with a verified bundle that the owner accepted; costs before promotional credit and actual payment are separated |

Do not extrapolate small samples into universal percentages. An abstention is reported as a safety success, not a repair success. Release targets and minimum evidence are defined in the MVP; this document contains no fabricated measurement results.

A diagnosis with incomplete telemetry is assessed on provenance, uncertainty calibration against labeled cases, and actionable next steps, not repair hit rate. Repeated trials are not unique customer incidents; reports name both.

## 11. Decision and application boundaries

Product scope covers multi-repository patch generation and integration verification. Production rollout, destructive migrations, and merges require operation-specific authorization and appropriate operational readiness. Decisions already covered by the run scope do not need to be asked again.

Onboarding records the repository allowlist, write scope, business owner, data permissions, environment, package acquisition policy, publication targets, and resource caps. A repository that does not yet support safe execution can still be analyzed within available scope, with explicit coverage gaps.

## 12. Business risks and mitigations

| Risk | Impact | Mitigation/indicator |
| --- | --- | --- |
| The framework list outruns the evidence | Users assume every stack is safe | Capability tuples and evidence certification |
| The system optimizes for shallow tests | Patches pass while the business breaks | Independent workflow/data oracle |
| Complex repairs consume excessive resources | Uncontrolled cost | Pre-run caps, reserve for full proof, resumable checkpoints |
| The producer patch removes the requested change | The “repair” ignores the business need | Change intent as a protected acceptance input |
| Database mutations are irreversible | Data loss | Disposable rehearsal, backfill validation, recovery plan |
| Multi-repo PRs are not applied simultaneously | Intermediate version states fail | Mixed-version checks and a deployment DAG |
| Oracle or dependency unavailable | The claim cannot be proven | Specific blocker, partial evidence, no positive claim |

## 13. Business acceptance

The product may be declared MVP-compliant when all gates in the [MVP](MVP.md) are met, including the real-runtime flagship, capability certification per the matrix, negative cases, and an organic pilot accepted by its owner.

The primary release is hosted SaaS: web onboarding, tenant isolation, and service-operations gates are mandatory alongside the engine gates. `[DERIVED]` At least three independent customer organizations, each with two identities, must demonstrate hosted access/roles and private-repository separation; at least one organic recovery remains mandatory. This is a minimum qualification, not a claim of unlimited capacity. A free capped tier and paid subscriptions with checkout, invoicing, refund, and entitlement reconciliation must be available; quotas, model-usage disclosure, and hard cost caps remain mandatory.

A demo video, adapter scaffold, generated report, or replayed benchmark does not replace these gates. If pilot access or model credentials are unavailable, independent development continues, but real-world impact remains unproven.

## 14. Reading guide for development agents

Read in this order: BRD → PRD → MVP → architecture → a dependency-ready work package. The PRD defines behavior; the MVP sets minimum gates; the architecture defines boundaries. Each task must name requirement IDs, observable outcomes, proof artifacts, and checks.

Mark all derived decisions `[DERIVED]`. There is no calendar target; work order follows dependencies and evidence quality. Do not describe an unimplemented requirement as an available capability.

<a id="15-product-depth-priorities"></a>
## 15. Product-depth priorities

The `[DERIVED]` order is to reduce user setup effort, improve verification efficiency, then sharpen evaluation comparisons and Meta AI contribution. These are design priorities within the dependency graph, not new release phases. BR3-01/17 call for help extracting contracts/tests from CI, provenance-backed invariant proposals for owner-specific confirmation, safe reuse of still-valid configuration, and a minimum prerequisite list for the next step. BR3-19 calls for cost/duration forecasts and safe reuse of preparation, while retaining the targeted hard-cap controls. BR3-14 calls for an iterative-agent comparator and ablation, not only a one-shot baseline. Acceptance details are in [PRD §20](PRD.md#product-depth-decision) and [MVP §21](MVP.md#product-depth-acceptance).

Ordinal assessment `[DERIVED]`: value means impact on the flagship workflow; risk means the consequence of false assurance; proof feasibility means whether the capability can be demonstrated on an allowed native topology. These dimensions are not summed into a score that hides dependencies.

| Problem class | Value / risk | Initial proof feasibility | Scope decision and rationale |
| --- | --- | --- | --- |
| PC3-07 Observation | High / high | High with pinned exports and real-service receipts | MVP foundation: without telemetry provenance, diagnoses in other classes are easy to get wrong |
| PC3-08 Adaptive recovery | High / high | High for stopping behavior, medium for live recovery | Deepen MVP ledger/progress/budgets; reuses FR3-08 |
| PC3-01 Concurrency | High / critical | Medium; selected DB interleavings can be controlled | MVP: lost update/deadlock/double processing in the flagship, not all memory models |
| PC3-02 Distributed failure | High / critical | Medium; bounded directed faults can be reproduced | Required: single-site and multi-region partition/timeout/retry/order/convergence plus geo/leader failover |
| PC3-03 Active migration | High / critical | Medium; DB/journal/active writers available on a clone | Required: active migration, TB-scale and cross-engine cases with journal/reconciliation |
| PC3-06 Cascading failure | High / critical | Medium; graph and bundle are core product concepts | MVP: source/config/cache/resource propagation on a defined topology |
| PC3-04 Performance | High / high | Medium for pool/latency; low for general long-lived leaks | Required: matched-load latency/goodput/pool, bounded resource screen, and long-soak leak qualification |
| PC3-05 Legacy | High / critical | High for diagnosis, low when intent/history are missing | MVP: characterization/uncertainty/abstention; qualified repair only after a valid baseline/oracle exists |

All variants in this package must meet release acceptance. Work order follows dependencies, with no features moved to a post-release phase. The agreed ecosystem matrix remains a target; L3 API/UI does not automatically establish concurrency/performance L3 without profile-specific proof.

## 16. Hosted business model and service

Customer journey: website → identity/organization → selected GitHub App/repository → project/readiness → issue/PR/intent → budget/scope → queued real run → evidence/PR review. The provider is responsible for infrastructure, model access, isolated execution, security updates, storage, and recovery. The customer is responsible for repository/data rights, domain intent, acceptance invariants, and merge/deploy decisions.

Hosted minimums include a dashboard, role-based repository access, customer support/incident channel, usage/caps, and data lifecycle. CLI/self-hosting does not replace the web experience. Specific monetization and license choices must be made before the relevant offer or publication; this document sets no price, payment vendor, or unapproved license. Paid plans require billing qualification before sale; both the free capped tier and automated paid offering must pass before the complete release.

Hosted business measures include onboarding completion on supported repositories, independent active organizations, time to first actionable result, run recovery/accounting, quota accuracy, and wrong-tenant access findings. Define events, observation windows, and denominators before evaluation; do not count demo accounts as customer adoption. Promote availability, concurrency tiers, and costs only within capacity evidence.

## 17. Hosted model quotas and commercialization

### 6. Quotas, models, and commercialization

The hosted minimum uses provider credentials owned by the operator. Meta Muse Spark remains a target integration under FR3-07; verify production access, capabilities, and data-handling terms before hosted AI acceptance. If access is unavailable, the relevant gate is blocked; do not silently substitute another model or replay. Alternative models require an explicit configuration/version record and must be disclosed to customers. BYOK must be available as a safe option; hosted onboarding must also work with operator credentials without requiring customers to bring a key.

Each organization has an entitlement version, period, credit/spending ceiling, and concurrent-job limit; each run has a finite resource envelope. Reserve usage atomically before enqueue; make usage events idempotent; settlement records actual usage and releases unused reserves. Duplicate callbacks/retries must not double-charge. Provider failure/cancellation is not automatically free or fully charged: define and disclose the charging policy before the offer, while retaining raw consumed usage. Do not present a price estimate as a final bill.

The operator sets a hard ceiling, bounded in-flight overshoot allowance, and billing currency/unit before acceptance. Forecast the full campaign/reproduction/evidence cost. Admission rejects runs that cannot fit. When quota is exhausted, stop new work and clean up using the reserve; do not reduce proof or change the verdict to success. Resumption accounts for prior consumption.

The SaaS minimum may use a free capped tier with operator-funded model/compute. This document sets no price or payment provider. Automated payment checkout/subscription is required for the complete release, along with qualified signature/idempotency for payment events, subscription/entitlement reconciliation, payment-failure/downgrade/refund policy, and customer-visible invoices/usage. Frontend checkout success alone cannot grant entitlement.

<a id="18-document-package-guides"></a>
## 18. Documentation package guide

This package defines ChangeProof as a **hosted SaaS with open-source product source** for software-change remediation and verification across languages, frameworks, data, and repositories. Users visit the website, log in, connect GitHub, and run work without cloning ChangeProof source or providing a model API key/server. The provider operates the service, model broker, and execution fleet. Work is ordered by dependencies and evidence, not a calendar schedule.

### Reading order

1. [BRD](BRD.md): business goals, priorities, service model, commercialization, and documentation guidance.
2. [PRD](PRD.md): requirements, contracts, problem profiles, customer journey, and hosted access.
3. [MVP](MVP.md): minimum scope, work packages, gates, acceptance scenarios, traceability, and decision history.
4. [Architecture](architecture.md): module structure, runtime boundaries, hosted operations, security, data, and asset attribution.

These four files remain the primary specifications. Agent instructions are in `AGENTS.md`/`SKILL.md`; the user's 24 October 2026 request established seven playbooks in `phases/` as specified by [MVP §22](MVP.md#execution-phases). Phases 1–5 develop the back end, phase-6 develops the full front end from the active mockup with an English UI, and phase-7 tests and qualifies the whole system. Local tests remain mandatory during development; separating service/UI/acceptance tasks does not change dependencies or WP completion criteria. All work leads to one complete release, without deferring scope or changing business criteria.

### Primary service model

A hosted web dashboard and installation-free onboarding are minimum release requirements. The CLI supports operators/developers; CLI-only or a demo viewer does not qualify as SaaS. Customer repositories may be private; open-source product code does not mean customer source/evidence is public. Self-hosting must be available and tested, while hosted customers can use the service without installing it. Choose a license before distributing public source.

Hosted state uses transactional PostgreSQL, durable jobs, and private object storage. The former local-JSON/CLI-only rule was replaced for the hosted 1.0 target; protected proof, bounded autonomy, and real-runtime acceptance still apply. Hosting does not automatically authorize merges or deployment of customer applications.

### Complete required scope

The flagship MVP deepens selected concurrency/partial-failure/migration/performance profiles. Legacy cases without sufficient intent/baseline produce a diagnosis with uncertainty and a next investigation. Multi-region partitions, long-horizon leak certification, and broader qualified legacy recovery are all required before product completion.

All additional capabilities remain **targets until proven through execution**. Existing IDs are retained; the problem → capability → requirement → work package → evidence matrix is in [MVP §15](MVP.md#15-problem--capability--requirement--delivery--evidence). Scope decisions and unresolved calibration are recorded in the [review report](MVP.md#review-complex-failures--20-21-october-2026).

### Decision sources

For 1.0 design, the BRD governs goals, the PRD governs behavior and contracts, the MVP governs minimum release, and the architecture governs structure. Record and resolve conflicts across all four documents before implementing work that depends on them.

Problem classes define domain profiles without creating new verdict rules. Acceptance scenarios provide the normative experiment details referenced by the PRD/MVP; freeze actual numeric SLO/profile values in the manifest before a run. Older reports are historical records, not the current status of product gates.

Hosted SaaS details FR3-29..36, WP3-21..26, and G3-12..14, all required for hosted release. The [hosted SaaS change report](MVP.md#hosted-saas-alignment--21-october-2026) records the superseded decision and readiness that remains unproven. This specification does not claim that the website, model integration, or tenant isolation is already operational.

All capabilities and threshold figures are **specification targets**, not implementation status. Contracts, policy, budget, and evaluation profiles for this project are defined in the PRD and MVP in this folder. The briefing package can be read without relying on planning documents outside `.improvement`.

The user's direct instruction is the basis for expanding this product. This briefing package does not automatically authorize paid API calls, changes to external repositories, production deployment, or destructive operations.

### Completion principles

Code exists ≠ capability proven. Mock/replay pass ≠ real-system success. Local target pass ≠ coordinated bundle verified. Controlled runtime success ≠ organic user impact.

An agent selects a work package in the MVP whose dependencies are ready, names requirement IDs and proof scope, then records actual checks/artifacts. Prove all minimum gates before claiming the MVP is complete.

Document checks cover links/anchors, ID consistency, traceability, and the dependency graph. Earlier check results are retained as history in MVP §19; the old validation scripts were removed after consolidation.

## 19. Scope from the documentation and mockup

The user's 22 October 2026 instruction makes every feature in the four documents and the [mockup](.template-ui/mockup.html) mandatory product scope. No expansion list may be deferred until after the product is declared complete. Delivery order still follows dependencies and readiness; missing access, budget, vendor/pricing/license decisions, or qualification results become specific blockers, not reasons to remove features from acceptance.

The complete product experience includes the public website; GitHub/email/SAML identity and recovery; organizations/members/grants; projects/environments/templates/drafts; hosted runs through independent evidence/PR/outcome; notifications/search/audit; internal discussion/reviewer notes; support/access requests and incident/operator operations; free and paid subscriptions; privacy/deletion; self-host/BYOK/binary/multi-cloud; and repository providers frozen in the catalog. Behavior and mapping to the existing engine are in [PRD §19](PRD.md#19-complete-product-features-mockups-and-scope).

Complex capabilities previously deferred are also required: multi-region/consensus, long-horizon leak, exhaustive model checking on a finite-state model, TB-scale/cross-engine migration, and qualified legacy recovery. Each claim remains bounded by profile, version, workload, horizon, and measured evidence; the product does not promise to fix every incident or automatically support every undefined version. Diagnosis-only/abstention remains required when a run lacks sufficient evidence.

All public CTAs, account forms, menus, filters, exports, and collaboration previews need real service behavior before acceptance. Mockup copy mentioning credits, time, upload size, retention, or support level is design input only until the service profile is calibrated and approved. Placeholder testimonials and demo data do not count as adoption. Additional KPIs include public-to-account/onboarding completion, recovery success, notification/action completion, authorized search usefulness, review/support turnaround, cross-mode installation success, and billing correctness. Freeze event definitions, denominators, and windows before measurement.

Business completion requires all [MVP gates](MVP.md) to pass, including the complete main scope. This document does not authorize payments, deployment, or external messages during documentation work.

<a id="hackathon-context"></a>

## 20. Hackathon context, simulated assessment, and resources

On 22 October 2026, the user assessed ChangeProof at approximately **8.5/10** and considered it a potential **top-five** shortlist proposal, **assuming the demo succeeds and all described capabilities work**. This is a simulated judge assessment supplied by the user, not a Meta endorsement, competition result, probability of winning, product benchmark, or evidence that any gate passed. The assumption informs design assessment; implementation status still requires proof.

| Aspect in the user's simulated rubric | Score / 10 |
|---|---:|
| Problem relevance and potential impact | 9 |
| Technical depth | 9.5 |
| Solution novelty | 8.5 |
| Use of Meta AI | 8 |
| Product focus and ease of adoption | 7.5 |

The overall score is the user's estimate, not an official formula or weighting. Differentiators to demonstrate with evidence are cross-system workflow recovery, separation of AI/verifier/policy, checks across transition states, and diagnosis updates based on runtime results. Improvements include reducing setup effort, measuring repair economics, strengthening comparisons, clarifying Meta's contribution, and focusing onboarding on multi-service transaction users.

The [Meta Global AI Developer Hackathon](https://dev.meta.ai/events/global-hackathon) page, checked on 22 October 2026, describes software challenges under the **Push the Frontier** theme. The Indie track emphasizes creativity, technical ambition, and functionality; Startup emphasizes technical execution and production resilience. ChangeProof's fit with that theme is a design interpretation, not an organizer decision. The project track has not been selected; participant eligibility criteria must not be confused with project judging criteria.

<a id="hackathon-event-terms"></a>

### Official event terms as reported by a participant, 26 October 2026

This section records organizer terms **reported by a participant** from the event page, official rules, credit terms, and service terms, received on 26 October 2026. They are **participant-sourced planning input**, not independently verified and not proof of account entitlement. Re-check the current portal/waiver before using them in submission claims or demo narration; the current portal terms take precedence if they differ. These figures are not operating budget, SLOs, or guarantees of results.

**Project judging rubric (100% total),** as reported by the participant; the weighting has not been re-verified on the portal:

| Criterion | Weight | What is assessed |
|---|---:|---|
| Impact | 30% | Real potential, user benefit, viability as a product people will use, theme fit |
| Use of Meta AI Tooling | 25% | Creative use of Meta AI tooling, integration depth, exploration of new capabilities |
| Demo | 25% | A demo that actually works during a live test, plus demo-video quality |
| Technical Depth & Execution | 20% | Engineering quality, technical maturity, code execution |

This rubric does not replace product verdicts: verdicts still come from deterministic policy over verifier evidence (golden rule 1 in §3). A working demo is not proof that a patch is correct. “Use of Meta AI Tooling” counts only when the model's contribution can be traced to model/API/mode/config/prompt identity and the pinned candidate ([PRD §21](PRD.md#hackathon-competition-compliance)).

**Eligible Meta tooling**, as reported by the participant: Meta Model API (**Muse Spark** series, **Muse Wonder**, **Muse Image**, **Glimmer**, **SAM 3 / SAM 3.1**); coding agent **Muse Code**; or **Meta open-weight models** run independently or through inference partners (Baseten, Modal, Fireworks). This catalog concerns submission eligibility, not product capability. ChangeProof still targets Muse Spark 1.3 for the slice and must not claim support for tooling that was not actually integrated and run.

**Prizes**, as reported by the participant, total US$1,000,000. They are not project revenue or an incentive to change scope, budget caps, or proof requirements:

| Place | Indie Developer Track | Startup Track |
|---|---:|---:|
| 1st | US$150,000 | US$250,000 |
| 2nd | US$100,000 | US$150,000 |
| 3rd | US$75,000 | US$75,000 |
| 4th | US$50,000 | US$50,000 |
| 5th | US$25,000 | US$25,000 |
| Track total | US$400,000 | US$550,000 |

**Reported eligibility and restrictions:** participants must be at least 18, provide a GitHub profile, and build with qualifying Meta AI tooling. The participant reported restrictions on offensive cyber activity, reverse engineering, competing-model training using Meta output, resale/proxy access to API keys, unauthorized deepfakes, illegal biometric surveillance, workplace/school emotion recognition, and other prohibited use. Confirm the current rules and waiver before relying on this summary.

**Reported API credit terms:** a claim form, account eligibility, valid payment method, credit application, expiry, model/mode, rates, and out-of-credit charges all require verification. A valid payment method may incur real charges after credits run out. No amount in this section is treated as available project budget until account evidence and applicable terms confirm it.

Operational consequences apply regardless of this summary's status:

- Credits become resources **only after** the claim, balance, expiry, model/mode, rate, data terms, and cap are verified. Until then, the relevant gate is `blocked`, not passed (§12).
- A valid payment method means usage beyond credits may create **real charges**. A finite cap and reservation for full proof/reproduction/cleanup cost remain required before a run (golden rule 14); report gross and net cost separately.
- **Team ID, Project ID, credentials, and account details are account data**, not specification sources. Do not put their values, tokens, or billing references in the repository, documents, mockup, logs, or evidence ([AGENTS §9](AGENTS.md#9-security--what-must-not-be-in-the-code)).

**Service billing-mode terminology.** <a id="hackathon-service-mode-naming"></a>The participant's summary uses **Standard Service** versus **Discounted Service**; Meta documentation reviewed earlier used **Standard** versus **Contributor**. Both labels refer to the same distinction: whether the provider uses content for training. This naming conflict is **recorded, not resolved unilaterally**. Behavior, not the label, governs: a mode that permits training use **must not receive** secrets, credentials, personal data, or confidential code (FR3-35); record and disclose the mode per request; and use the official label from the current page/terms when the slice runs. Resolve naming according to [AGENTS §13](AGENTS.md#13-decisions-versions-and-documentation). Until then, do not present either label as settled fact.

**IP and submission materials**, as reported by the participant: participants retain IP in their project and API Input/Output; they grant the organizer (Meta and Cerebral Valley) a royalty-free, perpetual, worldwide license to use, display, modify, and demonstrate the project, including for promotion. Materials shared during the event were reported to be **non-confidential**. Therefore, do not put trade secrets, sensitive code, credentials, or personal data in demo/video/form/repository materials, and check every team member's publication permission before submitting. This is provenance and risk guidance, not proof of eligibility or a guaranteed interpretation of the license. Review the current waiver before relying on it.

**Reported usage prohibitions**, in addition to [AGENTS §9](AGENTS.md#9-security--what-must-not-be-in-the-code): do not use Meta output to train/fine-tune competing models; create a proxy/gateway that resells API-key access; reverse-engineer or extract weights; create deepfakes without permission; conduct illegal biometric surveillance; perform emotion recognition in workplaces/schools; or conduct offensive cyber operations. The slice must not include any of these use cases.

### Resources mentioned by the user

The following partner offers were confirmed on the [Cerebral Valley organizer page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon), checked on 22 October 2026, and summarized again by a participant on 26 October 2026. The [Event Waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) is the source for event, IP, and submission terms and must be reviewed before claiming credits or submitting. A public offer does not prove that credits were applied to the project account.

| Provider | Offer/information | Status and planning limit |
|---|---|---|
| [Baseten](https://www.baseten.co/) | US$100 and a rate limit of 2 million tokens/minute for Meta open-weight models | Offer to selected participants; project-account eligibility, activation, balance, expiry, and model coverage have not been checked |
| [Modal](https://modal.com/) | US$100 for selected participants; open weights through Endpoints plus GPU, sandboxes, and training tools | Offer reported as confirmed; available models, credit terms, and project runner qualification remain unproven |
| [Fireworks](https://fireworks.ai/) | US$25 for selected participants using Meta open-weight models; workshop with Sinan Ozdemir | Offer reported as confirmed; project balance/access and redemption details have not been checked |
| Meta Model API | US$150 development credit per participant/account for Muse Spark 1.3; claimed via a Claim Form before 4 November 2026, 9:00 PM ET; once per participant, not pooled across team members | Offer/claim reported by participant; **project-account claim and entitlement are unknown**. Account balance, expiry, mode, rates, and billing still require account evidence/organizer confirmation. Account requires a valid payment method, so out-of-credit use is charged at standard rates |

[Muse Spark 1.3](https://dev.meta.ai/models/muse-spark) and model ID `muse-spark-1.3` appear in [Meta documentation](https://dev.meta.ai/docs/pricing-rate-limits). This verifies the public catalog, not a live smoke test or project quota. The documentation distinguishes Standard and Contributor modes; Contributor permits content use for training. The participant summary on 26 October 2026 uses **Standard Service vs Discounted Service** for the same distinction; see [the terminology conflict](#hackathon-service-mode-naming). Select a mode based on FR3-35 disclosure and data permissions, not only the lowest cost; do not assume every mode has the same data policy.

[Modal Endpoints](https://modal.com/docs/guide/endpoints), [GPU](https://modal.com/docs/guide/gpu), [Sandboxes](https://modal.com/docs/guide/sandboxes), and [training](https://modal.com/docs/guide/training-quickstart) are resources the team may evaluate. Their availability does not select a runtime vendor, prove equivalent isolation, or require training/multimodal/additional models. An open-weight offer does not mean Muse Spark 1.3 is available through every partner.

Credits are provider-specific and conditional. Do not add them up as an available operating budget or treat rate limits as throughput guarantees. Before a run, verify entitlement, balance, expiry, model/mode, rates, data terms, and a finite cap; reserve resources for full proof/reproduction/cleanup. Report gross resource cost before promotions separately from net paid cost. This note authorizes no budget allocation or spending. Target Meta integration remains through the shared engine; mentioning additional providers as sponsors does not make them required dependencies.

## Seven-file package consolidation, 22 October 2026

At the user's request, the intended final `` package contained only `BRD.md`, `PRD.md`, `MVP.md`, `architecture.md`, `SKILL.md`, `AGENTS.md`, and `.template-ui/mockup.html`. Seven references were merged into the unified references section in SKILL; identical skill copies were verified. The SVG logo, WOFF2 fonts, and OFL license text were stored in HTML; the reports folder was initially empty. Product scope, requirement IDs, schema, policy, and acceptance gates did not change. Document consolidation is not evidence of implementation or passing gates.

**Deletion status:** consolidation was complete, but an automated policy check denied deletion of the source files/folders. Those source folders remained; the seven-file layout was not achieved.

**Active structure update, 24 October 2026:** the consolidation note above is historical. The user's later request established a `phases/` folder containing seven playbooks; the active package consists of seven main files plus that folder. The earlier seven-file-only restriction no longer applies. Product scope and WP dependencies are unchanged; see [MVP §22](MVP.md#execution-phases).

**Local-copy provenance, 24 October 2026:** BRD was absent from the ChangeProof-AI package during the audit. This file was supplied from `../changeproof/BRD.md`, then only phase-allocation references were aligned. The source project was not changed. This records document provenance, not product capability or acceptance evidence.

**Competition-build boundary, 26 October 2026:** [BRD §21](#hackathon-build-scope) and [MVP §23](MVP.md#hackathon-build-scope) define one *vertical slice* for the Meta Global AI Developer Hackathon submission. This bounds implementation and submission claims; it does **not** change the ChangeProof AI 1.0 release scope in §19 or the active prior decision. Other features remain complete-release targets and are not claimed as complete by the hackathon demo.

<a id="hackathon-build-scope"></a>
## 21. Hackathon build boundary: one vertical slice, full product value

### Goal and product position

The submission focuses on one real problem: **an order-contract change across services can break order creation and inventory reservation even when each repository's local tests pass**. ChangeProof maps the impact, proposes a coordinated repair, runs it on a real system, and provides independent evidence that business invariants still hold.

The slice reduces **breadth** (number of stacks, incident classes, deployment modes, and platform features in the demo), not core value: protected business intent, cross-component repair, native execution, independent proof, visible uncertainty, and traceable Meta contribution remain. This frames the competition build/submission; it does not replace the complete product scope in BRD §19.

### Track and theme

- **Proposed track: Indie Developer.** This applies only if the actual team consists of an individual/student/team of at most four people. For Startup, the representative must qualify as an active employee of the relevant startup and provide evidence. The team registers for one track only.
- **Proposed primary theme: Push the Frontier** through software engineering and verification of changes across services. “Build for Your World” may also fit if the team has a real domain it knows, but the submission must use a framing and track allowed by the portal.
- This recommendation does not mean registration or eligibility has been confirmed.

### Submission, team representation, and deadline

Participant-reported schedule: virtual event from **26 October 2026, 12:00 PM ET, through 4 November 2026, 9:00 PM ET**; kickoff on 26 October at 12:00 PM ET; workshops/office hours from 27 October to 4 November; project and API-credit claim deadline **4 November 2026 at 9:00 PM ET**; judging from 4–8 November; closing ceremony/final/grand-prize announcement on 9 November; bonus prizes around 10 November. This is participant-provided information, not a verified server clock; check the portal for the applicable timezone and deadline.

Submit through the official Cerebral Valley portal, with instructions linked to the [Event Waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver). For a team, appoint **one representative** to submit, list every member in the form, and receive prize payment if the team wins. Startup Track requires the representative to be an active employee of the relevant startup; Indie Developer Track is for an individual/student/team of up to four people. Each participant/project may enter one track only. The team/portal determines the actual track and eligibility; the Indie recommendation above does not confirm eligibility.

Before submission: read the current waiver and terms, verify usage/publication permissions for all materials and members, remove secrets/personal data from public materials, check demo/video format, and prepare the representative and payment/tax details. Winners are responsible for taxes and transfer/conversion fees; non-US participants were reported to complete W-8BEN. Confirm payment terms with the portal; do not store tax documents, addresses, bank details, or identity data in the repository.

### Competition demo/MVP boundary

| Keep in the core flow | Exclude from hackathon demo claims |
|---|---|
| One order → inventory case reproducible from a clean state | Full six-ecosystem/framework coverage and generic version support |
| TypeScript/Next.js storefront plus **one** backend/service stack actually run; choose Spring Boot or FastAPI after verifying toolchains and available time | Repair across three repositories and Java + Python + TypeScript simultaneously, unless all are genuinely available and stable without compromising proof |
| An order API/contract change that breaks one consumer and has an observed initial failure | Complex online migration, dependency-upgrade portfolio, multi-region/consensus, TB/cross-engine, long-soak, and the full SC3 portfolio |
| A small dependency/impact graph with clear provenance: contract → producer/consumer → business workflow | Full multi-tenant SaaS dashboard, billing, SAML/SCIM, BYOK, multi-cloud, self-host/binary, and all provider integrations |
| Human-authored/reviewed intent and oracle before the run; patch limited to allowlisted files | Autonomous merge/deploy or production mutation |
| One bounded repair proposal generated with Muse Spark through verified model access; visible model decision, permitted input, structured output, and contribution | Claims that all changes can be repaired, all stacks are supported, or the Meta model itself proves patch correctness |
| Native build/test and one end-to-end business workflow in a disposable environment; an independent verifier checks order-amount, one active reservation per order, and retry idempotency for the selected scenario | Universal reliability/performance/data-integrity claims, chance-of-winning claims, or organic-pilot results without evidence and owner approval |
| Concise evidence dossier: failing baseline → candidate identity/diff → checks actually run → verdict/limits → clean reproduction | Credits, rate limits, runtime, customer adoption, or integrations not confirmed as available capabilities |
| Simple demo UI that preserves AI disclosure, limitations, run status, evidence, and Meta attribution/provenance | Removal/concealment of watermark, labels, metadata, or provenance signals from Meta outputs |

This document does **not** choose Spring Boot or FastAPI. Choose one based on the available fixture/repository and native toolchain; do not implement both backends just for breadth. Use OpenAPI/a fixed contract as an explicit boundary. If a stack cannot run, narrow the fixture or show the blocker; do not substitute mock results and claim they are native.

### Demo sequence and evidence

1. Show support limits, AI disclosure, input sources, permitted repository/file scope, and human-approved invariants.
2. Run the old version and show that the workflow succeeds.
3. Apply one requested contract change; run the new version without repair and show an attributable consumer failure.
4. Ask Muse Spark to analyze allowlisted evidence and propose a structured patch. Show a concise observable rationale/decision trace, not hidden chain-of-thought, and preserve human choices and access limits.
5. Run the patch against a candidate with a pinned identity; a separate verifier runs builds/tests and business assertions against real services and fresh disposable state.
6. Show each assertion result, diff, provenance, scope limits, and remaining blockers/unknowns. If an important gate is unproven, the demo result is `unverified`/`blocked`, not false success.
7. Repeat from a clean checkout/state or provide a reproduction command that generates new evidence; do not replay an old report as a live execution.

Evidence must show **causality and one cross-component business outcome**, not merely a chatbot generating code: valid old workflow → intervention breaks the consumer → candidate change restores the workflow → independent oracle checks the invariant. Do not promise production deployment; each publication/merge/irreversible action still requires specific human authorization.

### Meta, privacy, safety, and submission

- Record model/API/mode, time, configuration/prompt version, sanitized request/response, usage, and failures/fallbacks. If Muse Spark is unavailable, do not describe a simulation or open-weight provider as live Muse Spark; use fallback only when transparently configured and labeled.
- Before submitting code/telemetry, confirm data classification and service mode. Do not send secrets, personal data, or confidential code to a mode that permits content use for training. State only verified retention/data-handling limits, not assumptions.
- Do not remove/change Meta watermarks or provenance; disclose that AI features can be wrong. Do not target users under 18.
- Stop for clear human authorization before high-impact, destructive, production, merge, or legally binding actions.
- One team representative submits through the official portal, names all members, and checks publication permissions/non-confidential materials before submission. Follow current portal instructions for the demo/video and forms.
- API/partner credits become resources only after claims, balance, expiry, mode, model, billing, and caps are verified. Credits do not change proof scope, budget caps, or evaluation.

### Permitted claims

Limit demo claims to the **scenario, candidate commit, stack, version, workload, assertions, and environment actually run**. Distinguish live model from replay, real runtime from mock, controlled scenario from organic issue, and roadmap target from proven capability. One strong vertical slice does not prove the complete ChangeProof 1.0 release or every capability in the BRD/PRD/MVP.
