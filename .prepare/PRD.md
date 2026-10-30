# ChangeProof AI 1.0 — Product Requirements Document

**Active scope — 22 October 2026:** all features/modules mentioned in these four documents and `.template-ui/mockup.html` are mandatory in the complete release. No features are deferred to a later stage; implementation order follows dependencies. Design targets and mockup appearance remain no proof of implementation. Earlier scope decisions in MVP §19 history have been superseded.

**Type:** initial implementation brief. **Status:** normative 1.0 design target; not yet executable.  
**References:** [BRD](BRD.md), [MVP](MVP.md), [Architecture](architecture.md).  
**Principles:** one reasoning engine, ecosystem adapters, independent verifier, deterministic policy.

**Specification deepening:** all additions to FR3-25..28 and problem profiles remain **targets**. [Problem classes](PRD.md#17-problem-profiles-and-capability-limits) bind incidents to existing requirements; [acceptance scenarios](MVP.md#17-campaign-protocol-and-acceptance-dossier) govern experiments and evidence. IDs FR3-01..24 remain valid.

## 1. Purpose and scope

Implement a platform that receives change intent or a reported problem, builds a change representation and cross-technology dependency graph, proposes coordinated repair, then proves the results on applications that are actually run.

Primary delivery is hosted SaaS with open-source product source. A browser, organization account and GitHub App form the minimum customer interface; the operator provides model credentials, runtime and storage. Customers do not need to clone/install ChangeProof. The service contract and public readiness are detailed in [hosted SaaS](PRD.md#18-customer-journey-and-hosted-access); all hosted requirements below remain targets.

The minimum user journey covers API breaking changes, dependency upgrades, schema/data changes, event incompatibility, mixed-version rollout, and adaptive recovery. Target support levels per framework are in MVP. Support for a category does not automatically cover every feature of that framework.

Three terms must be distinguished:

- **Target:** a component/repository analyzed or patched; may be a producer, consumer, frontend, worker, or migration project.
- **Repair set:** the set of targets and relationships that must be consistent for the business intent to be achieved.
- **Candidate bundle:** exact base + patch + dependency/data/topology identities for the entire repair set in one proposal.

## 2. User journey

| Journey | Trigger | Expected result |
| --- | --- | --- |
| UJ3-01 Contract change | Producer PR changes response/endpoint/semantics | Impact, intent-preserving patches, verified bundle |
| UJ3-02 Dependency upgrade | Request to upgrade to a specific version | Compatibility analysis, manifest/lock/source changes, native verification |
| UJ3-03 Schema migration | Schema and business mapping change | Expand/backfill/compatibility/recovery evidence on a real DB |
| UJ3-04 Organic incident | Issue/log/trace from a failed workflow | Reproduction, causal diagnosis, repair, outcome validation |
| UJ3-05 Cross-repo coordination | Multiple repos must change together | Patch DAG, mixed-version proof, linked PRs and merge prerequisites |
| UJ3-06 Unsupported/ambiguous | Insufficient framework/semantics/oracle | Specific blocker and `unverified`, without a fabricated fix |
| UJ3-07 Adaptive recovery | First candidate fails a native check | New hypothesis based on failure, bounded retry, full re-verification |
| UJ3-08 No-impact | Change does not affect a particular target | Analysis + coverage + relevant verification or a legitimate workflow skip |
| UJ3-09 Hosted onboarding | New user opens the website | Login, organization, authorized GitHub installation and a ready project without local setup |
| UJ3-10 Hosted lifecycle | Customer submits/cancels/reviews a run or revokes access | Durable job, usage/caps, evidence/PR access and revocation according to grants |

Web dashboard and authenticated API are mandatory for the hosted MVP; CLI/read-only viewer alone is insufficient. The operator/developer CLI uses the same canonical run manifest; convenience flags do not bypass tenant/role/budget checks. Customer inputs on the website are converted by the server into a validated manifest. Final command/API names are determined during implementation.

## 3. Capability registry

### FR3-01 — Onboarding and inventory

Input: repository refs, change intent, environment profile, permissions, manifest/lockfiles, and optional issue/trace.

Acceptance:

1. Pin every source to an immutable identity and record a dirty snapshot if the source is not yet a commit.
2. Detect language/framework/version/build tool/ORM and project locations within multi-project repositories.
3. Distinguish source evidence from inference. Manifest/runtime conflicts or unknown versions produce explicit findings.
4. Repos outside the allowlist are not read/modified; source packages, secrets, and user data follow the access granted.
5. Inventory JSON can be reviewed by the owner and reproduced from the same snapshot.

Assisted readiness must follow [§20](#product-depth-decision): import CI/contracts with provenance, confirm specific invariants, reuse revalidated project profiles, and provide actionable next prerequisites. Import does not automatically make tests a legitimate oracle.

### FR3-02 — Framework adapter contract

Every adapter provides `detect`, `extract`, `analyze`, `planFix`, `applyPatch`, and `verify` capabilities through a versioned contract. Unsupported methods return typed `unsupported`; they must not return empty success.

| Method | Main input/output | Authority holder |
| --- | --- | --- |
| `detect` | Snapshot → identity/version/confidence/evidence | Adapter static analysis |
| `extract` | Snapshot + capability scope → contracts/symbols/dependency edges | Adapter structural extractor |
| `analyze` | ChangeSet + graph → impacts/unknowns/provenance | Adapter analyzer |
| `planFix` | Intent + impacts + diagnostics → framework constraints/transformation options | Shared planner selects the proposal |
| `applyPatch` | Validated patch operations + candidate identity → mutation receipt | Trusted gateway performs writes |
| `verify` | Candidate + capability → native check plan/check IDs | Independent verifier executes and records results |

Adapter `verify` does not decide the verdict. The agent does not receive runner handles, oracle, secrets, or shell from the adapter. `applyPatch` does not provide arbitrary file writes. Adapter executables are trusted-registered platform components, not loaded as plugins from untrusted source repositories.

Acceptance: conformance tests reject version mismatch, missing methods, malformed results, path escape, forged check receipts, and capabilities claiming a level without evidence.

### FR3-03 — Support level and certification

Capability key: ecosystem + language + framework/version range + component kind + change category + feature restrictions + runner profile + adapter version.

The registry stores **targetLevel** separately from **provenLevel**, certification status, evidence refs, limitations, and invalidation reason. The initial proven value is `none`, not L1. L2 requires L1 and patch/guard tests; L3 requires L2 and native independent real-runtime verification.

Adapter/toolchain upgrades, version-range changes, or relevant verifier/oracle changes invalidate related certification until requalification. L3 React/Next.js does not declare L3 for all ORMs or plugins.

## 4. Shared change and impact intelligence

### FR3-04 — Shared representation

Normalize API/schema/event/dependency/config changes into one versioned model without losing raw evidence. A change must retain before/after refs, kind, semantic intent, provenance, severity/unknown, and related entities.

Acceptance: normalized output is deterministic for the same input; unsupported changes are retained; malformed extraction is not passed on as a partially valid graph; rename/semantic equivalence always distinguishes hypothesis from proof.

### FR3-05 — Cross-stack dependency graph

Nodes include repository, component, symbol, endpoint, DTO, DB table/column, event/schema, dependency artifact, cache key/schema, and business workflow. Edges include calls, reads/writes, serializes, publishes/consumes, generates, depends_on, and deployment_requires.

Every edge has an evidence locator, snapshot, extraction method, and resolution `proven | inferred | unresolved`. Runtime traces can supplement the graph; absence of a trace does not prove absence of an edge.

Acceptance: traversal can explain cascading impact from changes to targets/workflows; unresolved dynamic dispatch/reflection/DI/proxy appears as a coverage gap; cycles are found and treated as coordinated groups.

The graph also stores runtime relationships to deployment/config revision, transaction/lock ownership, retry fan-out, and resource pools when telemetry supports them. Nearby timestamps do not automatically form causal edges. Observation paths missing due to sampling are marked as gaps; uninstrumented emitters are not considered unaffected. Extraction uses FR3-25; no second diagnosis engine is built.

### FR3-06 — Impact and scope planning

Impact connects changes, graph edges/nodes, source locations, business invariants, risks, and required verification. Scope planning results contain required targets/edges/checks and unresolved unknowns.

Acceptance: unmapped targets must not disappear from the denominator; owners can see unsupported surfaces; scope is frozen before candidate evaluation; scope changes produce a new revision and revalidation, not silent narrowing after failure.

## 5. Reasoning and remediation

### FR3-07 — One shared reasoning engine

The model broker uses versioned `ModelClient`. Meta Muse Spark is the target integration from the user brief; actual model/API identity, tool-calling capability, and access are proven through smoke during implementation. Do not invent endpoints, versions, prices, or availability. Framework adapters do not create separate AI engines.

The user's chosen target is specified as Muse Spark 1.3, with public model ID `muse-spark-1.3` recorded in [sources and verification limits](BRD.md#hackathon-context). Project access and tool behavior still require authorized smoke. Its role in evidence synthesis, probe selection and diagnosis revision must be traceable according to §20; the model does not become a verifier or verdict authority.

Acceptance: the model receives allowlisted context and structured tools; prompt/config/model IDs are recorded; output is revalidated; responses without tool calls/malformed responses/outages have typed failures; provider fallback is only through explicit, transparent configuration.

### FR3-08 — Causal diagnosis and adaptive planning

The planner maintains a hypothesis ledger: claim, supporting/contradicting evidence, next probe, outcome, and decision changes. Distinguish compilation error, runtime regression, data error, environment failure, and unknown.

Acceptance:

1. Failed candidates produce a diagnosis linked to checks and snapshots.
2. Retry uses new information or an explained strategy change.
3. Duplicate candidate/failure loops are detected; budget is not reset.
4. The planner can expand investigation within the allowlist, but needs a scope revision for new targets/write surfaces.
5. Infrastructure failures are not translated into instructions to remove business behavior.
6. The ledger distinguishes `symptom`, `suspected_cause`, `supported_cause`, and `refuted_hypothesis`. A supported cause requires a mechanism in source/runtime and an intervention or counterfactual probe that distinguishes alternatives; deployment correlation alone is insufficient.
7. Every probe has a predicted observation, competing explanation, cost cap, safety scope, and stop rule before execution. Negative/contradictory results are retained. Root cause may involve multiple factors; do not force a single cause.
8. `[DERIVED]` two consecutive attempts with the same failure signature and causal explanation, without new evidence or objective improvement, stop the hypothesis branch. Continue only if an untried distinguishing probe remains within budget; otherwise, emit a blocker and next investigation.
9. Normalized patch digest, affected behavior, failure/check signature, and hypothesis ID are used to detect repetition. Whitespace/refactors and error-message changes are not progress. Investigation progress is not the same as `partial` repair; `partial` still requires comparable full proof.

### FR3-09 — Framework-aware patch

Patches preserve change intent, layering, generated-code ownership, and conventions proven from source/config. Generated-client changes use a pinned generator when the source of truth is available, then output and reproducibility are verified.

Acceptance: proposals map every edit to impact/intent; do not return the producer to old behavior to cancel a requirement; do not invent APIs; do not delete checks; do not hardcode oracle answers; do not disable auth/validation; unrelated edits are rejected.

### FR3-10 — Coordinated candidate bundle

A bundle contains all base identities and patches, including unpatched targets that must still be tested. A change to one member produces a new bundle digest and invalidates dependent checks.

Acceptance: deployment/compatibility DAG is recorded; a test pass for candidate A cannot be used for B; repo head drift invalidates freshness of the entire related bundle; locking/idempotency prevents concurrent publication for the same identity.

### FR3-11 — Database and schema migration

Support schema structure, ORM mapping, migration scripts, backfill, constraints, and reader/writer compatibility according to adapter capability.

Acceptance:

1. Use the real pinned database engine/version; SQLite substitution does not pass PostgreSQL claims.
2. Run migrations on a populated dataset sanitized/created by a trusted party with edge cases, not only an empty schema.
3. Check identity, nullability, uniqueness, relations, amount precision, tenant isolation, counts and semantic reconciliation.
4. Test expand → backfill → transition → contract if that strategy is chosen, including interruption/resume and idempotency.
5. Test old/new readers/writers in compatibility combinations required by intent.
6. Record locking/runtime under a defined workload; do not promise zero downtime merely because migration completes.
7. An irreversible operation requires a recovery strategy proven in a disposable environment. Production execution is a separate operation with authorization.
8. New migrations may be proposed; applied migration history is not rewritten to hide problems.
9. Migration rehearsals maintain active reader/writer workloads. Acknowledged operation journals, chunk cursors/high-water marks, concurrent updates/deletes, tombstones, transaction isolation, lock waits, and migration checkpoints must be reconcilable.
10. Interruptions are injected before chunk commit, after chunk commit before progress write, while progress persistence is not yet durable, and after a durable checkpoint. Resume selects the last valid checkpoint; it does not lose acknowledged writes, duplicate business effects, or overwrite new updates with old backfill. If chunk and progress are in one atomic transaction, the manifest documents merged windows and tests the commit/abort boundary actually available; do not claim a fault in an impossible state.
11. Snapshot restore alone does not prove recovery when there are acknowledged writes after the snapshot. Test catch-up/reconciliation from a trusted journal, or state that data recovery is unproven. Admission throttling/writer pause is allowed only if frozen intent and SLO permit it.

Prisma documents custom migrations and the expand/contract pattern; this product use case still requires independent data verification. [Prisma documentation](https://www.prisma.io/docs/orm/migrations/editing-a-migration)

### FR3-12 — Dependency and framework upgrade

Target version/range and upgrade rationale become intent input. A trusted dependency broker performs resolution/fetch from allowlisted sources and records integrity/provenance; the model does not freely edit lockfiles.

Acceptance: dependency diff/transitive graph is available; package manifest and lockfile match; install/build/native tests run from pinned artifacts; install scripts are considered untrusted and isolated; rollback/revert compatibility is tested when required; license/security finding changes are reported according to project policy.

### FR3-13 — Event and cache compatibility

For events, record schema version, producer/consumer mapping, delivery/ack/retry semantics. For caches, record key ownership/version, serialization, invalidation, and stale-read constraints.

Acceptance: use real brokers/caches for relevant acceptance; test relevant duplicate, retry, out-of-order/reconnect cases, invalid payloads, old caches, and partial rollout. Exactly-once claims must not be inferred from a single successful request alone.

For partial failure, the contract records end-to-end timeout budget, max retries at each layer, jitter/backoff, cancellation propagation, consistency model and convergence deadline. Test lost response after commit, directed partition, queue backlog, and reconnect. Business exactly-once effects are tested using operation IDs/reconciliation despite at-least-once delivery; do not claim exactly-once transport. Workload/fault details follow FR3-26 and SC3-04.

### FR3-14 — Budget and recovery state

The budget profile covers proposals per target/bundle, model requests/tokens/cost, wall time, CPU/memory/PIDs, output, disk, concurrency, and full verification/evidence reserve.

All values are finite, validated and frozen before the run. No unlimited default. Complex-system profiles are set through development calibration before acceptance and are not changed during evaluation. Resource caps are execution controls, not delivery timelines. Different profiles may be used for different workload classes, with limits and rationale recorded before results are known.

Acceptance: resume preserves usage; full proof is not skipped when budget is nearly exhausted; cancel/timeout cleans up all services; atomic checkpoints record provenance and terminal artifacts; the model cannot raise limits.

Separate **proposal fixer**, **diagnostic probe**, and **verification campaign** budgets within one aggregate accounting; separation must not become a way to reset consumer/run limits. Forecasts include n repetitions, DB cloning/journal, fault teardown, browser warmup, telemetry volume, and full evidence reserve. Profiles unable to fit the entire mandatory campaign are rejected before acceptance or stop `unverified` with a resource blocker. Stricter runtime limits in execution instructions still apply.

## 6. Verification and decisions

### FR3-15 — Independent verification

The verifier compiles/builds real source and runs native tests, contracts, integration, browser flows, and data reconciliation required by scope.

| Stage | Input | Purpose |
| --- | --- | --- |
| `baseline_old` | Pinned working system + old versions/data state | Prove business invariants valid before intervention |
| `baseline_new` | Same original consumers/other targets + exact requested intervention | Reproduce attributed regression |
| `attempt_fast` | Candidate bundle revision + selected checks | Bounded feedback |
| `post_fix_full` | Reconstructed exact bundle + full required/protected suite | Final proof per target and cross-system |

Intervention may be a producer change, dependency version, migration state, or event/schema change. All old/new differences are recorded as an `InterventionManifest`; unexplained environment differences must not be introduced. New expected business intent may have additional acceptance assertions frozen before the agent run; invariants to preserve remain identical.

Every stage/attempt uses a copy of initial data and clean topology matching the manifest; do not use a database already mutated by a previous candidate as baseline. Seeds, clock controls, event schedules, workload, and data digest are recorded when they affect results. Failure injection for retry/interruption is retained as explicit input. Flakiness is not hidden by repeating until pass.

Intermittent bugs that are the experiment's subject are distinguished from unexplained test/harness flakiness. Product variation may be assessed only through a frozen FR3-26 campaign, trigger receipts, operation history, and valid oracle. Unexplained variance, missing mandatory telemetry, failed injectors, and harness instability remain invalid/inconclusive; they must not be labeled intermittent to accept green results.

For trigger changes such as concurrency/load/config, the old baseline is a known-valid state relevant to intent. Lower load may serve as a diagnostic control but does not replace the incident-workload baseline or prove capacity. `baseline_new` and candidate are always compared under identical workload/fault according to the manifest. Absence of failure in a few runs does not enable the no-impact path for an unexplained incident.

For organic incidents, the old baseline must be reproduced from a legitimate last-known-working state. Historical logs alone do not satisfy baseline. If baseline/oracle cannot be established, investigation and remediation plans may be reported with specific blockers; autonomous candidate mutation has not started. The fix loop requires a valid baseline and a ready protected verification plan.

The protected suite is authored by a trusted author/owner, not the runtime fixer. Source, hidden assertions, expected patch, and holdout answers do not enter agent context. Feedback is limited to permitted diagnostics without leaking the oracle.

Native verification application: Next.js acceptance runs a browser against the actual application build; unit tests alone do not replace it. [Next.js Playwright documentation](https://nextjs.org/docs/app/guides/testing/playwright)

FastAPI supports TestClient for tests; real-system gates still run the service and its dependencies according to topology. [FastAPI testing documentation](https://fastapi.tiangolo.com/tutorial/testing/)

### FR3-16 — Deterministic policy

Use `TargetOutcome`: `fixed | no_impact_verified | unverified | partial | failed`. The subject may be a producer, consumer, frontend, worker, or migration component. Every target outcome states its proof scope; all semantic changes follow explicit schema/policy versions.

Precedence:

1. `stale`/`cancelled` withhold an applicable verdict.
2. Invalid/missing evidence, identity mismatch, unresolved blocking risk, unexplained harness flakiness/infra failure, or verifier timeout → `unverified`. Planned application timeouts during fault injection are product observations assessed against the resilience contract, not automatically verifier timeouts.
3. No regression → evaluate no-impact with coverage and relevant checks.
4. Attributed regression + exact patch + full protected proof + intent + scope + guards + fresh identity + all FR3-27 required dimensions pass → `fixed`. For intermittent/concurrency cases, the entire FR3-26 campaign must be complete; one green run is insufficient.
5. Valid full evidence of comparable progress without new protected regression → `partial`.
6. Valid investigation without progress → `failed`.

Guard violations withhold auto-publication; oracle changes invalidate proof. Skipped checks do not mean pass.

Bundles use `BundleAssessment`, **not** a new consumer outcome: `verified | incomplete | blocked | invalid`. `verified` requires adequate evidence for all required targets, all required edges/invariants and mixed-version checks passing, intent fulfilled, all identities fresh, and no blocking risks. No voting/averaging outcomes.

| Bundle state | Condition |
| --- | --- |
| `invalid` | Submitted evidence is corrupt/invalid: identity mismatch, changed oracle, forged result, invalid infrastructure execution |
| `blocked` | A known blocking reason exists: failed required check, unsupported required capability, unresolved blocking risk, unfulfilled intent/rollout |
| `incomplete` | Required proof is not yet available/complete, without invalidity or a known blocker; related targets receive no positive claim |
| `verified` | All proof requirements are complete and none of the above conditions apply |

Bundle evaluation order: stale/cancelled run state withholds an applicable final assessment, then `invalid` → `blocked` → `incomplete` → `verified`. Historical assessments remain stored with their original identity. Publication readiness and owner adoption are separate statuses and do not change archived code evidence.

One `fixed` consumer may be stored as a local-scope fact while the bundle is not yet verified. A PR must not be promoted as a coordinated fix based solely on that local result.

Correctness, performance, resilience, and data integrity have separate results. An `inconclusive` required dimension yields target `unverified` and bundle `incomplete` if no other blocker exists. A valid failed required dimension blocks the bundle; the target follows partial/failed precedence only if all necessary evidence is valid. A `not_applicable` dimension must be approved and justified before the run, not after failure. Invalid evidence still takes precedence over failed/pass dimensions.

### FR3-17 — Cross-system and mixed-version proof

The verification plan defines the combination matrix before execution: old system, requested intervention with old consumers, final bundle, and actually planned intermediate rollout states. Not every Cartesian combination is required; every excluded combination has a rationale and deployment constraint.

Acceptance: actual services communicate in isolated topology; readiness differs from health pass; schema/event compatibility, retry/idempotency, auth/tenant, and data invariants are checked; results bind all component/image/data revisions. Evidence from one container does not prove the bundle.

Scope covers configuration/deployment revision, retry amplification across layers, cache state, DB contention, and downstream backlog. Single-service isolation tests are diagnosis; recovery is claimed after end-to-end workflow and convergence/drain deadlines are met. Expected degraded behavior during fault and recovered behavior after fault removal are defined separately.

## 7. Evidence, publication, and impact

### FR3-18 — Evidence manifest

Store immutable raw artifacts and canonical manifests for configured retention. Required identities: source/base/patch, intervention, adapter/capability, model/prompt/config, oracle, runner images/toolchains, topology, dependency artifacts, dataset/migration, policy/verifier, check plan, and budget profile. Tenant/repository grants control access; deletion follows FR3-35 with tombstones/receipts, not by changing historical content to create new proof.

Includes findings, graph paths, attempts, model usage, diagnostics, full stage results, target verdicts, bundle assessment, risk, skipped/not_run checks, reproduction recipe, and execution mode. Manifest digest is external; artifact refs are verified, secrets/sensitive data are reduced with redaction provenance.

Acceptance: missing blob/hash mismatch/forged result withholds positive claims/publication; renderer output comes from validated data; all terminal paths record available evidence.

For complex cases, the manifest must reference telemetry quality, causal ledger, experiment plan, executed schedule/fault receipts, every-trial observations including failed/censored runs, measurement validity, dimension assessments, and bounded claim text. Aggregate evidence without raw trial histories does not pass the campaign.

### FR3-19 — Multi-repository publication

A trusted broker receives a validated PublicationRequest. Upload artifacts → reviewer access → fresh heads → create/update linked PRs → separate CI attestations.

Acceptance:

1. Idempotent per bundle/member; retries do not create duplicate PRs.
2. PRs contain exact candidate refs, intent, dependencies, merge order, proof scope, failing/not_run checks.
3. Non-draft coordinated fixes require a verified bundle and related target proof.
4. Partial publication is recorded; do not claim atomic multi-repo merge.
5. CI on all required heads must match evidence; changes to any head invalidate bundle readiness.
6. No patch means no PR; guard violation/report-only is handled according to policy.
7. Merge/deploy still follows authorization scope; the publisher does not run consumer source with a token.

### FR3-20 — Review and reproduction UX

CLI/viewer shows change → impact path → candidate → checks → outcomes → limitations. Users can see evidence per target and aggregate, failed/not_run stages, actual resource usage, and suggested next actions.

Acceptance: a fresh isolated environment reproduces results without session memory or undeclared machine-local dependencies; logs are escaped; the viewer is read-only without secrets and does not execute trace content.

### FR3-21 — Real-world outcome validation

Pilot runs have an owner, issue/change origin, repository permission, workload, acceptance invariants, before/after measurement method, and adoption record.

Acceptance: the original problem is reproduced; system-generated patches are actually run; the owner validates workflow recovery in a representative environment; review/integration effort is recorded. Human edits after proposal are stored as a new candidate with attribution and full re-verification. Do not count human-authored replacements as autonomous fixes.

Incidents not yet reproducible still yield a diagnosis with uncertainty and an acquisition plan; owner satisfaction or disappearance after restart does not replace proof. Pilot observation duration/workload and pre-patch onset frequency are set before validation. Do not claim a leak is gone based on observation shorter than the tested horizon.

### FR3-22 — Trust and mutation capability

Source/README/log/model output is considered untrusted. The gateway permits only typed operations on registered targets/paths. Protect policy, verifier, oracle, control-plane config, secrets, and publication authority.

For upgrades/migrations authorized by intent, typed capabilities may change dependency manifests, generated lockfiles through the broker, new migrations, or required application configuration. No blanket permission over package scripts/security controls; every surface is verified by guards and a trusted plan.

Acceptance: traversal/symlink/hardlink/encoding/path collision, malicious scripts, prompt injection, credential exfiltration, oracle discovery, oversized patches, and scope escalation are rejected; tests prove results.

### FR3-23 — Runner and real-service isolation

The trusted supervisor creates disposable sandbox topology. Non-root, resource caps, read-only protected mounts, no Docker socket/secrets for application/test processes. Default network blocks internet and host; allowlisted service-to-service connections on a private per-run network enable real PostgreSQL/Redis/API integration.

Dependency acquisition is performed by a broker/isolated build stage with a registry allowlist and immutable artifacts; runtime tests do not receive arbitrary egress. Test DB credentials are ephemeral and scoped only to disposable datasets.

If using orchestration such as Testcontainers, Docker control remains with the trusted supervisor or isolated infrastructure boundary; do not give the host socket to untrusted test source. Frameworks support integration tests against services in containers, but ChangeProof security integration must follow this boundary.

Acceptance: isolation probes for every runner profile; host/other-run/network escape is denied; crash/cancel cleans up services, volumes, network, temp credentials; required artifacts are persisted before cleanup.

### FR3-24 — Evaluation and support reporting

Evaluation datasets have their own identities and versions. Freeze dev/holdout cases, oracle, fixability labels, resource profile, arm definition, model/config, and metrics before evaluation. Holdout is not used for tuning; results from another dataset version are not evidence for the version being assessed.

B0 = one-shot with basic discovery without verifier feedback; B1 = structured graph + one proposal without retry; B2 = iterative coding agent with repository, terminal in an isolated guest, tests and development feedback; Full = ChangeProof reasoning/recovery in a frozen profile. All use the same primary model/config and independent evaluator, the same aggregate resource ceiling, and report actual consumed resources. B2 and ablation are defined in [MVP §9](MVP.md#9-new-evaluation-design); B0/B1 baselines are retained for component interpretation, not as the only comparators.

Acceptance: reports per ecosystem/category/complexity and scenario/target; actual scheduled/completed/error/incomplete counts; replay/live/organic/controlled separated; unsupported outcomes and negative cases are not counted as repair success. Release thresholds are in MVP.

Trial count differs from unique incident/case count. Fixed-candidate verification may be repeated without calling the model again; this is not additional autonomous repair success. Comparators receive the same workload/fault envelope and total resource ceilings, then are assessed with the same campaign oracle. Fault injection against actual services is controlled real-runtime evidence, not an organic incident.

## 8. Minimum data contracts

All boundaries use Zod schemas in `src/core/contracts/`, schema version, and migration/compatibility rules. The forms below are field requirements; agents must create concrete schemas and semantic validation before wiring.

| Contract | Minimum fields and invariants |
| --- | --- |
| `ProjectInventory` | repo refs, components, language/framework versions, build tools, manifests/lock hashes, owner/scope; unique IDs |
| `CapabilityRecord` | key tuple, target/proven level, certification status, adapter/runner versions, evidence, limitations |
| `ChangeIntent` | desired behavior, preserved invariants, permitted surfaces, target versions, constraints, owner acceptance refs |
| `InterventionManifest` | exact old/new input deltas, source/dependency/data/event/config refs; no unexplained drift |
| `ChangeSet` | normalized changes + raw refs + hypotheses; unknowns retained |
| `SystemGraph` | versioned nodes/edges + provenance/resolution; refs must be valid |
| `VerificationPlan` | required targets/edges/checks, protected suite, combination matrix, workload, expected assertions, scope digest |
| `RepairPlan` | evidence-linked steps, target operations, dependency DAG, capabilities, deployment/recovery prerequisites |
| `CandidateBundle` | per-target bases/patches/lock/data refs, graph/intent/plan revision, bundle digest; ordered canonical set |
| `StageResult` | stage/mode, exact bundle/snapshot/topology, check observations, raw logs, timing, validity, runner identity |
| `TargetAssessment` | subject, outcome/reasons, linked proof, coverage/unknown/risk; explicit subject and policy version |
| `BundleAssessment` | state, required target/edge results, intent/mixed-version proof, blocking reasons; no averaging |
| `ExecutionBudget` | finite numeric limits with units, reserve, usage, profile/config hash; no resume reset |
| `OutcomeValidation` | issue origin, owner, environment/workload, before/after refs, adoption, human-edit attribution |
| `PublicationRequest` | validated bundle/member proof refs, destination allowlist, expected heads, idempotency, desired draft state |
| `IncidentEvidence` | source/deploy/config identities, tenant-safe operation/trace/span IDs, event/observed timestamps, clock uncertainty, sampling/drop/redaction, read-scope receipts, raw refs |
| `HypothesisRecord` | symptom/cause status, mechanism, supporting/contradicting refs, competing causes, predicted probe outcome, failure signature, stop reason; no self-attested proof |
| `ExperimentPlan` | planVersion/hash, subjects, workload/arrival distribution, concurrency/data skew, reset semantics, seeds, intended schedules, faults, observations, n/trial units, warmup/windows, thresholds/statistics, stop/censor rules, forecast |
| `TrialReceipt` | plan+candidate+environment identities, actual seed/schedule resolution, fault applied/removed, operation history, counts/results, validity/exclusion reason, telemetry refs; no silent dropped trial |
| `DimensionAssessment` | correctness/performance/resilience/data_integrity, required flag, metric/invariant IDs, pass/fail/inconclusive/not_applicable, raw refs, uncertainty, claim limits |
| `CharacterizationRecord` | observed behavior, owner/domain interpretation, unknowns, corpus provenance, positive/negative examples, independently approved invariant refs; observed behavior is not automatically desired behavior |

Additional 1.0 reason codes that must be schematized/tested: `adapter_unsupported`, `capability_not_certified`, `intent_not_preserved`, `intervention_invalid`, `bundle_incomplete`, `cross_stack_verification_failed`, `migration_integrity_failed`, `rollout_incompatible`, `dependency_resolution_failed`. A reason code does not determine a verdict by itself; policy precedence and evidence validity remain decisive.

Additional targets for campaign/diagnosis: `telemetry_insufficient`, `causality_unproven`, `experiment_invalid`, `reproduction_inconclusive`, `measurement_inconclusive`, `campaign_incomplete`, `performance_regression`, `resilience_violation`, `behavior_contract_unknown`, `no_information_gain`, `resource_profile_insufficient`. These codes are cataloged and tested before implementation; they introduce no new outcomes.

## 9. Non-functional requirements

| ID | Requirement | Acceptance |
| --- | --- | --- |
| NFR3-01 | Deterministic policy and identity | Same proof input produces the same verdict/digest; model nondeterminism recorded separately |
| NFR3-02 | Modular monolith boundaries | Import matrix enforced; new adapters require no framework-specific verdict-rule changes |
| NFR3-03 | Reproducibility | Rebuild/re-run from artifact manifest in a clean environment |
| NFR3-04 | Resource control | All caps enforced; terminal timeout/OOM/cancel tests and cleanup pass |
| NFR3-05 | Isolation and secret handling | Native probes for every profile; redaction and scoped access tested |
| NFR3-06 | Recovery/idempotency | Crash/resume does not reset budget, duplicate PRs, or use stale proof |
| NFR3-07 | Observability | Run/bundle/target/attempt/check correlation available; actual timing and costs |
| NFR3-08 | Operability | Missing tools/credentials/config become actionable errors, without silent mock fallback |
| NFR3-09 | Measurable performance | Baseline workload/limits pinned before acceptance; p50/p95 and n reported without fictitious targets |
| NFR3-10 | Maintainability | Strict TypeScript host, concrete contracts, native adapter tests, architecture checks, documented ownership |
| NFR3-11 | Data minimization | Only necessary source/data; redaction, retention, deletion lifecycle configured |
| NFR3-12 | Hosted tenant isolation | Cross-tenant/repository/role probes on API, jobs, streams, caches and artifacts all denied without disclosure |
| NFR3-13 | Durable service and capacity | Frozen service profile, fair-queue/load/lease/failover and backup restore drills meet configured SLO/RPO/RTO |
| NFR3-14 | Hosted usability and access | Browser-only customer journey, actionable errors, reconnect, keyboard navigation and labeled forms pass E2E |
| NFR3-15 | Metering consistency | Concurrent admission, retry/cancel/crash do not double reserve/debit/publish; actual usage reconciled |

## 10. Mandatory test design

| Test family | Minimum cases |
| --- | --- |
| Contract/conformance | malformed adapter results, unknown versions, incorrect capability promotion, dangling refs |
| Policy | stale + pass; full pass + unknown; partial + invalid oracle; target pass + edge failure; mixed candidates |
| Runtime security | secrets/socket/network/path escape, malicious dependency scripts, cross-run access, cleanup failure |
| Real system | native build, actual migration, browser/API flow, event consumer, data reconciliation |
| Negative remediation | fabricated endpoint, reverting intent, deleting assertions, fake health success, wrong amount/tenant |
| Recovery | compile failure → new hypothesis; repeated candidate; infra outage; bounded retries; crash/resume |
| Publication | duplicate retry, one PR failure, head drift, inaccessible evidence, mismatched CI |
| Certification | version/capability mismatch, unsupported plugin/feature, invalidation after changes |

Policy/guard/failure-path tests start before implementation. No AC passes merely because a file/class exists or a text snapshot matches.

## 11. Development handoff contract

Execution through prompts `phase-1` to `phase-7` follows [MVP §22](MVP.md#execution-phases) and [AGENTS §18](AGENTS.md#18-pemanggilan-fase-eksekusi). Phases orchestrate development work; they do not add product statuses/verdicts, change schema/policy, or divide features into later releases. All FR/NFR and §20 deepening remain mandatory in their owning WPs. Execution-plan revision 2 (24 October 2026) assigns back-end development to phases 1–5, the full English front-end matching the active final mockup to phase-6, and whole-system testing/qualification to phase-7. Cross-cutting WPs retain separate service/UI/acceptance tasks and original dependencies; local positive/negative/native checks are mandatory during development. A completed service task is not full-WP acceptance.

Every agent task records requirement IDs, dependency readiness, exact observable outcome, scope files, contract/version impact, native/mock/live checks, evidence, and limitations. Use work packages in MVP.

Tasks must not be `done` with only scaffolding, mocked integration, skipped native checks, or model-generated status. Task status may be `not_started | in_progress | blocked | done`; it is separate from product verdict.

Decision changes after run freeze create a new run/config version. Do not change oracle, budgets, support level, or thresholds to pass the candidate being evaluated.

## 12. Initial technical decisions

| ID | Decision | Implementation implications |
| --- | --- | --- |
| DEC3-01 | One modular monolith host, isolated native workers | Single host package; framework tools do not inherit host authority |
| DEC3-02 | One reasoning engine and shared graph | Adapters provide knowledge/capability; do not hold final verdict |
| DEC3-03 | Separate target proof and bundle proof | Local pass does not promote cross-system success |
| DEC3-04 | Intervention manifest for all problem classes | Baseline data/environment remain comparable and all deltas attributable |
| DEC3-05 | Typed mutations for dependency/migration | Guards grant narrow capabilities, not unrestricted writes or shell |
| DEC3-06 | Private actual-service topology | Internal service traffic allowed according to plan; external/host egress denied |
| DEC3-07 | Mandatory real-runtime and organic pilot gates | Mock/replay pass only appropriate development checks |
| DEC3-08 | Versioned finite resource profiles | Calibration before freeze; resume preserves usage |
| DEC3-09 | Protected intent and independent oracle | Model cannot cancel business requirements or change how to pass |
| DEC3-10 | Support based on capability tuple | Untested features/versions/combinations remain unsupported/unproven |
| DEC3-11 | Deepen existing capabilities, add four cross-problem requirements | FR3-25..28 complement FR3-08/11/13/15/17; do not create eight new engines |
| DEC3-12 | Pre-registered repeated experiments | Reruns must not be selected after seeing results; schedule/seed does not automatically mean full replay |
| DEC3-13 | Four evidence dimensions without averaging | Failed/uncertain required dimensions withhold assurance even if functional tests pass |
| DEC3-14 | Legacy characterization precedes repair | Unknown intent/baseline yields an investigation plan, not a self-generated oracle |
| DEC3-15 | Full documented incident envelope mandatory | Single-site, multi-region, long-horizon, TB-scale/cross-engine, model checking and qualified legacy repair all mandatory with frozen proof scope |
| DEC3-16 | Hosted SaaS primary, product source open source | Web onboarding mandatory; self-hosting/CLI do not replace hosted gates |
| DEC3-17 | Transactional hosted state and process roles | PostgreSQL + outbox/leased jobs/private object store replace local JSON authority; one codebase/release |
| DEC3-18 | Tenant grants and hostile-code boundary | Current repository entitlements, role checks and qualified VM/microVM isolation mandatory before public execution |
| DEC3-19 | Operator-funded bounded model/compute minimum | Operator credentials default; BYOK and automated paid billing also mandatory, with separate qualifications that all block completion if not passed |
| DEC3-20 | All documentation and mockup are mandatory scope | No later-phase features; WP3-19/20 and all new features become final-release prerequisites |
| DEC3-21 | Email/password, GitHub and enterprise identity available | Verification/recovery, account linking and SAML/SCIM use the same identity authority; matching email does not automatically merge accounts |
| DEC3-22 | Add service modules, reuse engine | Notifications, queries, support and collaboration use typed ports; do not gain verdict authority or automatic source access |
| DEC3-23 | Mockup is a design source, not evidence | Illustrative copy/numbers/roadmap do not change capability, budgets, certification status or execution results |
| DEC3-24 | Competition build focuses one vertical slice without shrinking product scope | Hackathon demo implements a bounded slice under BRD §21; the complete-release scope, WP DAG and gate criteria are unchanged and remain the product target |

The minimum certification counts, repetitions, and evaluation thresholds in MVP are `[DERIVED]` and become the acceptance baseline after case manifests are frozen. Later changes require a decision record, affected contracts/tests, and a new evaluation version; historical artifacts remain immutable.

<a id="13-cross-problem-class-capabilities--additional-targets"></a>
## 13. Cross-problem-class capabilities — additional targets

### FR3-25 — Incident telemetry and observation-based correlation

Extend FR3-01/05/08/18 and NFR3-07 to read-only ingestion of logs, traces, metrics, operation histories, code diffs, and deployment/config history.

Acceptance:

1. Normalize event time and observed time; retain clock skew/uncertainty. Trace/operation IDs, resource/component ID, deployment digest and source-line mapping form correlation evidence. Timestamp-only correlation is marked ambiguous.
2. Record query scope/time range, source identity, data sampling/drop, missing spans, aggregation resolution, reset counters, redaction, and retention. Telemetry sufficient for diagnosis is not necessarily sufficient for proof.
3. Metrics measure patterns; logs/traces/history help with mechanisms. Collector output is untrusted data; it cannot write verdicts or execute instructions.
4. On labeled diagnosis fixtures, root causes must have an evidence chain and distinguishing probe; downstream symptoms must not be labeled causes without support. Clock-skew, missing-span, stale-deployment-ID, and redacted-key fixtures must produce explicit gaps, not fabricated joins.
5. Live telemetry connectors must be implemented and qualified on logs/traces/metrics/deploy backend profiles in the catalog; actual authorized reads, provenance, redaction, rate/error/revoke paths and query receipts must be tested. Connectors are read-only within scope. New instrumentation may be proposed; by default it is tested on a clone. Record overhead and observer effects before using telemetry for performance/race claims.

Contracts may use TraceId/SpanId and the Timestamp/ObservedTimestamp distinction from [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/). That source defines correlation data; proving causation remains the responsibility of ChangeProof experiments.

### FR3-26 — Reproduction campaigns, concurrency, and fault injection

The verifier manages one immutable `ExperimentPlan` used by baseline/candidate. This deepens FR3-15/17/23, not an unrestricted shell/chaos tool for the model.

Acceptance:

1. Before acceptance, populate workload mix, arrival model, concurrency, key skew, dataset, warmup, observation duration, faults/durations/direction, schedules, seed set, required checks, n repetitions, trial unit, threshold, resource forecast, and stop rules. Missing numeric parameters hold the run.
2. Separate dev exploration from frozen acceptance. Repro harness, scripts/instrumentation, schedule and oracle are reviewed by a trusted author; the fixer may not edit them.
3. Concurrency: capture operation invocation/completion, business IDs, transaction boundaries, commit/abort, lock/wait evidence. Use barriers/interleaving or trusted hooks when available; still test unhooked runtime according to the claim.
4. The supervisor fault injector controls only allowlisted network edges/processes in disposable topology. Receipts prove planned faults were actually applied and removed. Injector failure is an invalid experiment; expected app timeout is a resilience observation.
5. Every trial has reset/restore and clean-data receipts; all results including abort/error/censored are stored. Early stop for invariant violation/budget/safety is allowed, but does not produce a pass. No rerun-until-green.
6. Retain seeds and schedules when observable. Uncontrolled OS/GC/JIT/DB/network scheduling is recorded; same seed ≠ same execution. History-incomplete tests do not claim linearizability or all-interleavings coverage.
7. The original failing state must produce observed attributed failure. If the search does not find the trigger within budget, the result is `reproduction_inconclusive`, not no-impact/fixed.
8. Independent reproduction repeats the full frozen campaign for the claim concerned. Minimum repetitions and bounded-claim rules are in the [acceptance protocol](MVP.md#2-shared-campaign-protocol).

### FR3-27 — Correctness, performance, resilience, and data integrity

Extend FR3-16/NFR3-09. Four-dimensional assessment is decided from validated observations by policy; statistical reducers reside in the trusted verification/evaluation layer with algorithm/config digest.

| Dimension | What is measured | Minimum decision |
| --- | --- | --- |
| Correctness | Business result, authorization, per-operation semantics, bounded progress | Zero mandatory invariant violations across all required trials |
| Performance | Latency distributions including errors/timeouts, successful throughput, resource use/pool waits | Baseline/candidate workload-capacity matched, frozen absolute SLO and relative margins met |
| Resilience | Degraded behavior, retry amplification, recovery/convergence/drain time | Expected failure envelope and recovery deadlines met without amplifying cascade |
| Data integrity | Acknowledged operation journal vs state, uniqueness/precision/tenant relations | Zero lost/duplicate/corrupt acknowledged business effects in tested history |

Acceptance:

1. Required dimensions are selected before the run from impact/risk; those not applicable require a reviewable rationale. Correctness/auth/data must not be traded for better latency.
2. The performance plan freezes warmup/measurement/cooldown, arrival rate/distribution, cache state, dataset, native heap/GC/runtime, resource limits, independent window count, primary metrics and statistical method. All errors/timeouts remain in accounting; goodput includes only successful correct operations.
3. Compare healthy reference, failing original, and candidate: relative improvement over the broken original alone is insufficient. Randomized/interleaved matched measurement blocks and environment-health checks control noise; no extra CPU/pool capacity without an explicit tested config change and cost.
4. Shared-host noise, insufficient samples, telemetry loss, unmeasured instrumentation overhead, or a confidence interval crossing the margin yields `inconclusive`. Do not average per-window percentiles or select the fastest window.
5. Memory-leak claims require retained-heap/native/RSS breakdown when available, workload cycles, plateau/slope criterion, horizon and GC assumptions. Short-run no-OOM proves only bounded resource behavior; long-soak leak certification is mandatory in release qualification.
6. `[DERIVED]` numerical examples/profiles in the acceptance document are calibration targets, not results. Unknown SLO numbers become preflight blockers, not a reason to fill thresholds after results appear.

### FR3-28 — Legacy characterization and unknown business behavior

Extend FR3-01/06/08/15/21; mandatory scope covers discovery, read-only/clone probes, characterization, qualified recovery and useful abstention. Qualified legacy repair is mandatory once a known-valid baseline and intent are obtained; absence of baseline still prohibits mutation, not a reason to remove the capability from release scope.

Acceptance:

1. Inventory entrypoints/jobs/config/DI/reflection, dynamic SQL, dependencies, existing tests, and data/telemetry access. Mark unknown scope not covered.
2. The corpus is sanitized and pinned; capture observed input/output, side effects, and negative examples. Observed output is a behavioral hypothesis, not automatically a correct oracle.
3. Owner/domain evidence confirms intent and invariants. A trusted author freezes independent assertions before the fixer; the runtime agent does not stamp its own characterization tests as correct.
4. Probes default to read-only or isolated clones with external side effects denied. State limitations when data sanitization, missing services, nondeterminism, or inaccessible jobs alter representativeness.
5. Without sufficient invariants/baseline/causal proof, results contain known facts, competing hypotheses, uncertainty, blocked capabilities, minimal additional access/evidence, owner of next decision, and next safe probe; no mutation/fixed.
6. Once all prerequisites are established, repair uses the normal pipeline and the same proof. Successful characterization alone is not counted as repair success.

## 14. Problem catalog and test obligations

[Problem classes](PRD.md#17-problem-profiles-and-capability-limits) define PC3-01..08: incidents, input/access/telemetry, reproduction, diagnosis, mutation limits, verification, acceptance, negative/unsupported, evidence, and cost. [MVP](MVP.md) sets priorities, work packages, and gates; [acceptance scenarios](MVP.md#17-campaign-protocol-and-acceptance-dossier) standardize case variants and failure paths.

## 15. Hosted SaaS requirements

All following requirements are mandatory for hosted minimum according to the [hosted operations brief](PRD.md#18-customer-journey-and-hosted-access). They do not change target/bundle verdict vocabulary or relax real proof.

### FR3-29 — Identity, organizations and repository authorization

GitHub sign-in establishes an authenticated session; organizations have Owner/Admin/Maintainer/Viewer with project/repository grants. GitHub App installation is a separate authority, not automatic proof of membership.

Acceptance: the server checks session, current membership, role, project grants and current repository entitlement for every read/write/download/stream. Invitation expiry/replay, CSRF, session logout/revoke, forged tenant ID, stale role, owner transfer and last-owner removal are tested. The owner sets the cost ceiling; admins cannot raise it. Viewers cannot run/publish. A multi-repo bundle cannot be opened if any repository is not authorized; denied responses do not disclose source, names or findings.

### FR3-30 — GitHub App onboarding, events and revocation

Verified installation callbacks bind tenants to selected repos and minimum permissions per feature. The broker fetches exact commits with short-lived scoped credentials that do not enter guest/browser/model. Signed webhooks are verified over raw bodies, delivery IDs deduplicated and durable receipt/outbox created before acknowledgement.

Acceptance: installation on live authorized repos, duplicate/out-of-order/forged events, suspension/uninstall/repo removal and current grant revalidation are tested. Queue/run/publication is constrained by grant version; revoke withholds new effects and stops jobs with cleanup. In-flight side effects are reconciled. Lost publication responses do not duplicate PRs. GitHub sign-in is not treated as permission to write all user repositories; provider outage does not fail-open.

### FR3-31 — Browser dashboard and customer run lifecycle

The website provides onboarding, projects/readiness, issue/PR/intent input, invariant/data permissions, finite budget, diagnosis-only/repair mode, publication preference, submit/status/cancel, evidence/diff/outcome and usage history. Missing baseline/toolchain/model/data yields an actionable blocker. Operator model credentials are default; customers need not install toolchains or bring keys.

Acceptance: the actual browser journey against the hosted stack from login to actual model/native run and authorized PR is proven; refresh/reconnect/cursor/poll fallback does not lose runs. Resubmission is idempotent. Event streams are authorized per subscription and revalidated when grants change. UI does not fabricate progress/verdicts, does not execute untrusted markdown/logs, and is usable with keyboard and labels/error focus. Publication may be manual per run or preauthorized project policy within valid role/scope; merge/deploy is separate.

### FR3-32 — Multi-tenant isolation and hosted execution security

Tenant identity/grants are mandatory on storage queries, caches, artifacts, jobs, audit and support access. PostgreSQL row-level defense complements application authorization, with pooled context reset. Customer snapshot/build/test source runs only in a qualified isolated execution boundary; host processes do not run customer install scripts.

Acceptance: VM/microVM-per-job or alternative equivalent isolation must prove denial of host sockets/cloud metadata, cross-tenant/run network/volumes/cache, control-plane access, privileged operations and secrets. The trusted supervisor remains outside candidate authority. Container-only smoke does not pass public hosted execution. Malicious dependency/repo/test/log fixtures and operator break-glass audit are tested. Unauthorized enqueue/resource IDs/output receipts are rejected. Cleanup failure/quarantine prevents environment reuse; service is limited to allowlisted pilots until the boundary is qualified.

### FR3-33 — Durable queue, leases and fair scheduling

The PostgreSQL source of truth stores runs/checkpoints/job leases, transactional outbox, reservations and audit; private object store holds bytes. Web/API, dispatcher and supervisors use one modular codebase/release in separate process roles. Local JSON is only an export/reproduction artifact.

Acceptance: at-least-once queue, stable effect IDs, lease heartbeat/expiry and fencing epoch reject writes/publish from stale workers. Crashes after reserve/enqueue/claim/checkpoint/publish are checked; retry/resume preserves budget and candidate identity. Per-tenant concurrency, bounded queue/retry and fairness pass a measured load/noisy-neighbor campaign. Cancel/drain kills the execution tree and cleans up orphans, not merely changes UI. Duplicate physical work does not become duplicate bills/results/PRs. Unknown external side effects are reconciled before retry.

### FR3-34 — Entitlements, reservation, usage and spending caps

The operator sets versioned entitlements and hard cost/concurrency caps; every run receives an atomic reservation and append-only idempotent usage events. Actual model/compute/storage usage is readable by customers with clear units/periods, without exposing secrets. Aggregate proof cost including full campaign/reproduction/cleanup enters the admission forecast.

Acceptance: concurrent submit, duplicated usage events, crash/cancel/outage and period rollover do not double debit/reset budget. Settlement releases unused reserve, reconciles consumed usage and applies the charging policy announced beforehand. Freeze numeric caps and bounded in-flight overshoot allowance; exhausted caps reject new work, not weaken proof. Free capped tier and automated paid subscriptions are both mandatory. Paid billing requires verified signed/idempotent payment events, entitlement reconciliation and failure/refund policy; browser checkout responses do not grant entitlement. Price/provider not yet selected.

### FR3-35 — Customer privacy, private evidence and deletion

Model/data disclosure, region/storage choice, finite retention, encryption/key rotation, source minimization, audit and deletion must be available before production onboarding. The operator verifies model API/data handling; do not promise provider zero retention/no training without evidence. ChangeProof does not use customer data for training/cross-tenant retrieval by default.

Acceptance: download proxy and event/API/export checks verify current tenant+repository rights; public blob URLs/logs/global caches are denied. Evidence is immutable during retention but can be deleted with job fence, purge/tombstone/receipt. Backup restore applies tombstones before access; expiry/purge SLO is pinned and tested. Disconnect/revoke access is not equated with automatic data or PR deletion. Customer-visible deletion status reflects actual blobs/index/cache/backup lifecycle; time-limited support access is audited. Redaction fixtures contain secrets and malicious logs; private artifacts do not leak via PR link previews/analytics.

### FR3-36 — Hosted operations and open-source release

Deployment source/config, migrations, images, secret provisioning, telemetry, operator runbook, incident/support contact and backup/restore are deliverables. Open-source release requires a chosen license/third-party notices and mapping source revision to hosted build. Hosted onboarding requires no clone; self-hosting with installation/upgrade/restore must also pass before completion.

Acceptance: deploy a clean stack; restore DB/object artifacts and deletion state; test worker crash/drain, DB/queue/object-store/model outage and deployment of old/new roles. A `HostedServiceProfile` with finite numeric capacity/SLO/RPO/RTO/retention/purge/cost values is frozen before load acceptance. At least three independent customer orgs with two identities/org and allowed/denied private scopes demonstrate real onboarding/isolation. One organic recovery remains mandatory, all original engine gates still apply. Public execution awaits FR3-32 qualification; local mocks/dashboard screenshots are insufficient. Paid offering awaits FR3-34 billing qualification. No promise of unlimited scale, domain or uptime without actual proof.

## 16. Hosted contracts and failure paths

| Target contract | Minimum field/semantic requirements |
| --- | --- |
| `TenantContext` | Server-derived tenant/user/session/role/project/repository grants, grant version, expiry; not trusted from client/job payload |
| `RepositoryConnection` | Tenant, installation/provider IDs, repository allowlist, permission matrix, status/revocation version, last validation; credentials only as secret refs |
| `HostedRunRequest` | Authorized actor/project/refs/intent, execution mode, invariant/plan refs, cap/reservation, publication consent, idempotency key |
| `JobLease` | Tenant/run/job IDs, image/candidate/plan hashes, epoch/fencing token, owner/heartbeat/expiry, retry/cancel state; receipt mutation compare-and-swap |
| `UsageLedgerEntry` | Tenant/run/reservation/provider receipt, globally unique event/effect ID, measured units/rates/version, period, settlement/reversal, consumed+reserved balances |
| `ArtifactAccessGrant` | Tenant, required repository grants, subject/artifact hash, purpose, expiry/revocation, authenticated proxy receipt; no permanent public URL |
| `DataLifecycleRecord` | Retention version, data categories/locations, fence/tombstone/purge/backup expiry progress, audit minimum, completion evidence |
| `HostedServiceProfile` | Version/environment, load/concurrency/queue/fairness limits, finite SLO/RPO/RTO/retention/deletion values, overshoot cap, cost units, frozen campaign+method |

Hosted contract IDs wrap engine identities, not replace canonical candidate digest or protected oracle authority. All boundary schemas and semantic validation are mandatory before wiring.

Minimum failure-path tests: forged tenant/repo ID, stale membership/installation, viewer mutation, reused invitation/webhook, replayed job/usage event, stale lease write/publish, cancel/revoke race, artifact download after revoke, snapshot token leak, malicious install/guest escape, noisy neighbor, lost enqueue/publish response, orphan cleanup, backup restore of deleted data and paid entitlement forgery. Dashboard outcomes are separate from billing/service status. This test suite is mapped to NEG3-21..28 and G3-12..14 in MVP.

Those capabilities remain targets until actual native execution meets proof scope. Adding requirements does not automatically raise framework L3 certification to concurrency/performance/resilience L3; workload/fault profiles and assertion scope must be recorded in the capability record.


<a id="17-problem-profiles-and-capability-limits"></a>
## 17. Problem profiles and capability limits

**Status of all PC3-01..08:** specification targets, not yet proven capabilities.  
**Normative contract:** [PRD](PRD.md). **Experiments:** [acceptance scenarios](MVP.md#17-campaign-protocol-and-acceptance-dossier). **Priority/dependencies:** [MVP](MVP.md).

**Primary delivery:** [hosted SaaS](PRD.md#18-customer-journey-and-hosted-access). Customers connect repositories through the website/GitHub App, without cloning/installing ChangeProof. Profiles below apply to supported customer applications in isolated execution; ChangeProof service multi-user security/capacity is proven separately through FR3-29..36 and G3-12..14. Customer application tenant isolation does not replace platform tenant isolation.

### 1. Capability review results before expansion

| Area | Already covered | Gaps addressed | Action |
| --- | --- | --- | --- |
| Concurrency | FR3-11 transactions/migration, FR3-13 idempotency | No operation history, schedule, contention proof yet | FR3-26 provides experiments; deepen FR3-11/13 |
| Distributed failure | FR3-13 retry/order, FR3-17 mixed versions | Partial failure, retry amplification, convergence not yet measured | Deepen FR3-13/17; FR3-26/27 provide proof methods |
| Online migration | FR3-11 backfill/resume | Active readers/writers, commit/cursor crash windows, acknowledged journal | Add AC to FR3-11, without a second migration engine |
| Performance | NFR3-09 resource/performance reporting | Not yet an independent dimension; no sample/noise/leak limits yet | FR3-27 |
| Legacy | FR3-01/06 unknowns, FR3-15 baseline | No trusted characterization yet when intent/tests are missing | FR3-28 |
| Cascading | FR3-05 graph, FR3-10 bundle, FR3-17 system proof | Config/deploy/resource edges and symptom/cause insufficient | Deepen all three FRs; use FR3-25 |
| Observation | NFR3-07 correlation IDs | Clock/sampling/provenance and hypothesis evidence quality | FR3-25 |
| Adaptive | FR3-08 ledger, FR3-14 budget | No-progress and informational-gain definitions not yet firm | Add AC to FR3-08/14; no new retry requirement |

Every profile below uses a common protocol; operational threshold numbers must be frozen in `ExperimentPlan` before acceptance. Unavailable values withhold claims, not get filled after tests. “Abstain” means withholding mutation/positive assurance not yet legitimate while providing evidence and next safe investigation.

### 2. PC3-01 — Concurrency and concurrent transactions

| Aspect | Target specification |
| --- | --- |
| Incident/impact | Two checkouts read the last stock simultaneously; a lost update overwrites balance, duplicate delivery creates two reservations, or opposite lock order stalls checkout. Impact: overselling, incorrect money/data, stuck orders. |
| Input/access/telemetry | Source transaction boundaries and lock/idempotency code; native DB isolation/version; disposable populated DB; operation/tenant/idempotency IDs; invocation/completion/commit/abort history; lock-wait/deadlock diagnostics and pool metrics. Missing commit outcome marked unknown. |
| Reproduction before patch | SC3-07: two actors on the same business key with a barrier between read/write; two transactions lock resources in opposite orders; duplicate delivery before/after commit. Canonical failing schedule runs repeatedly from fresh state, then jitter/load variants. Original failure must be visible and attributed. |
| Cause vs symptom | HTTP 500/timeout is a symptom. Read-modify-write without conflict control, inconsistent lock order, or non-atomic dedup/commit are hypotheses. Transaction history + source mechanism + control with altered interleaving support a cause; a deadlock log alone does not explain business loss. |
| Repair/mutation | Scoped transaction boundary, atomic update/constraint, consistent lock ordering, idempotency storage, bounded retry. Must not remove transaction/auth or force all traffic to be serial for correctness without meeting throughput/SLO. Isolation level/config changes require explicit capability. |
| Independent verification/invariant | Trusted history checker checks no oversell, no lost acknowledged update, tenant separation, at-most-one business effect per operation ID, and bounded completion/explicit abort. Full workflow is tested together with contention and pool health. Serializability/linearizability claims only when the model and complete history match; not inferred from final row count. |
| Measurable acceptance | All protocol mandatory schedules and perturbed trials complete; zero safety/data violations; every accepted operation completes or has a defined recoverable terminal state; frozen completion deadline and goodput bounds met. Deadlocks handled with bounded retry are allowed if the contract permits and no effect is lost. |
| Negative/unsupported/abstain | Missing history/DB visibility, unsupported isolation semantics, uncontrolled third-party locks, harness timeout, or incomplete witness → unknown/unverified. Candidates merely raising timeouts, ignoring aborts, or eliminating concurrency must fail guard/behavior/SLO checks. |
| Evidence resolved | Schedule/seed+actual history, lock timeline, affected source lines, transaction/constraint receipts, before/after per-trial reconciliation, four dimensions and bundle result. Do not use one green run as proof. |
| Dependency/resource | WP3-15..18; FR3-11/13/25..27. Calibrate actor count, transaction rate/hot-key skew, DB clones, contention observation overhead, schedule count, deadlock/lock timeouts, native runtime warmup. |

PostgreSQL explains lock modes/deadlocks and isolation behavior; adapters must pin engine/version and test the chosen strategy. [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).

### 3. PC3-02 — Distributed partial failure and eventual consistency

| Aspect | Target specification |
| --- | --- |
| Incident/impact | Order commit succeeds but response is lost; caller, gateway and worker retry simultaneously. Partition/reordering makes inventory stale, queues grow, then a retry storm exhausts the pool. |
| Input/access/telemetry | Service topology and permitted edges; timeout/retry/ack/consistency contracts; end-to-end operation IDs; spans, broker offset/pending/ack histories, per-layer attempts, backlog/lag/error/throughput metrics; supervisor fault access only on clones. |
| Reproduction | SC3-04 deepens lost-response-after-commit, one directed edge partition, out-of-order/double delivery, fault removal and backlog drain. Seed and injected direction/duration recorded. SC3-10 multi-region is also mandatory acceptance. |
| Cause vs symptom | Retry metrics or lag are symptoms. Lost-response vs failed-commit probes distinguish duplicate processing from normal broker redelivery; disabling one retry layer on a diagnostic branch tests amplification mechanism. This branch is not an accepted patch if intent/SLO changes. |
| Repair/mutation | Propagate deadlines/cancellation, bounded retries/jitter, idempotent consumer, outbox/transactional coordination when consistent with intent, ordering/version checks, bounded concurrency/backpressure. Scope does not include replacing broker semantics or removing delivery obligations without a domain decision. |
| Independent verification/invariant | During fault: defined rejection/degradation, no duplicate/cross-tenant/corrupt effects. After fault: acknowledged operations reconcile, backlog/lag converge before deadline, no retry amplification beyond bound. Actual services/brokers and operation history mandatory. |
| Measurable acceptance | Zero data/safety violations; attempts per logical operation ≤ `Amax`; backlog ≤ `Qmax`; recovery/drain/convergence ≤ `Trecover/Tdrain/Tconverge`; goodput returns ≥ lower bound within observation window. All numeric parameters pinned per topology and workload. |
| Negative/unsupported/abstain | Permanent partition without a domain decision on availability/consistency; missing acknowledgments; egress target not permitted; inactive injector; eventual consistency without convergence contract → not verified. Do not promise every request succeeds while network is disconnected. |
| Evidence resolved | Fault applied/healed receipts, per-operation attempts/outcomes, ack/offset history, time-aligned backlog/latency/pool series, reconciled data, recovery timeline and topology-bound claim. |
| Dependency/resource | WP3-15/16/17/18; FR3-13/17/25..27. Calibrate directed-edge fault duration, admission rate, broker storage, retention, retry ceiling, post-heal observation, namespace/network cleanup. Multi-region requires separate budgets/profiles. |

### 4. PC3-03 — Migration with active readers/writers

| Aspect | Target specification |
| --- | --- |
| Incident/impact | Backfill copies an old snapshot while a writer updates rows; a crash after chunk commit before cursor persistence repeats effects. Old/new readers read different representations. |
| Input/access/telemetry | Schema/migration history and intent mapping; populated sanitized dataset; trusted operation journal, chunk checkpoints/high-water marks/tombstones; old/new reader/writer builds; DDL/DML lock waits, lag, row/semantic reconciliation. |
| Reproduction | SC3-03 runs actual readers/writers during expand/backfill/transition. Crash before commit, after commit before progress write, while progress is not durable, and after durable checkpoint; map merged windows when chunk/progress is atomic. Resume from valid checkpoint, concurrent update/delete/create on hot rows. Original mismatch/lock stall must be visible. |
| Cause vs symptom | Equal row counts do not prove correct values. Match acknowledged-write journal, row version, chunk read time and commit; chunk-vs-writer race probes distinguish stale overwrites from faulty mapping or rollback loss. |
| Repair/mutation | Version-aware/idempotent chunk writes, durable cursor, bounded transaction/batch, compatible dual read/write or schema expansion, staged constraints. No rewriting applied history, deleting invalid rows, silently stopping writers, or weakening precision/nullability rules. |
| Independent verification/invariant | Journal-to-state semantic comparison and cross-version reads. Zero loss of acknowledged operations, no duplicate IDs/effects, precision/relations/tenant constraints. Recovery snapshot + journal catch-up tested if chosen; data-loss window not assumed zero. |
| Measurable acceptance | All scheduled crash windows pass resume/reconciliation; monotonic chunk progress with idempotency proof; locks ≤ `Llock`, writer latency/error ≤ frozen SLO; backlog decreases after recovery ≤ `Trecover`; no mismatches in complete tested corpus. |
| Negative/unsupported/abstain | Incomplete journal, unversioned destructive change, ambiguous mapping, sanitization removes trigger, historical corruption not yet understood, rollback loses writes → not repair-verified. Row-count-only verification rejected. |
| Evidence resolved | Dataset/journal/schema hashes, chunk receipts and cursors, active writer history, comparison findings including deleted rows, restored/catch-up proof, actual lock/latency timeline. |
| Dependency/resource | WP3-10 + WP3-16/17/18; FR3-11/15/26/27. Calibrate dataset size/skew, write churn, clone+disk/WAL/journal budget, batch size/lock duration, recovery duration. TB-scale and cross-DB migration must be qualified on frozen profiles. |

### 5. PC3-04 — Performance and resource exhaustion

| Aspect | Target specification |
| --- | --- |
| Incident/impact | Connections are not released on error paths; retries increase concurrent borrows, p95 latency spikes and throughput drops. Retained objects/native allocations grow after several traffic cycles. Impact: timeouts, cost, OOM, failed workflows. |
| Input/access/telemetry | Known-valid reference, failing build and candidate; workload/SLO; fixed hardware/container limits; pool active/wait/timeouts, CPU/RSS/heap/native/GC when available, traces/query latency, successful/error/timeout accounting; profiling permission on clones. |
| Reproduction | SC3-08: matched warmup/load/error/recovery windows, acquisition-release imbalance, sustained contention. Memory-growth screening with bounded cycles is in MVP; SC3-11 long-soak leak proof is also mandatory. |
| Cause vs symptom | Latency is not a cause. Correlate pool occupancy with acquisition/release histories and error paths; ablation fixes release on an authorized branch to separate DB slowness from leaks. RSS alone does not distinguish cache, GC and native leaks. |
| Repair/mutation | Resource lifecycle/finally cleanup, scoped query/index/config, bounded pool/queues/backpressure and timeout propagation. No reducing traffic/samples, raising hardware without accounting/intent, removing auth or relaxing SLO after results. |
| Independent verification/invariant | Correctness/data preserved during load; verifier computes distributions/goodput from raw observations at equal workload/capacity; performance, resilience and resource envelope have separate assessments. |
| Measurable acceptance | Absolute latency/error/resource SLO and relative margins against healthy reference pinned; primary-metric uncertainty does not cross boundary; pool returns to steady state ≤ `Tpool`; no outstanding lease after drain; bounded memory/GC envelope on tested horizon. Short tests must not yield a “memory leak eliminated” claim. |
| Negative/unsupported/abstain | Noisy shared host, too few effective samples, saturated client load generator, missing timeout counts, unequal cache/capacity, uncalibrated profiler overhead → measurement inconclusive. Lower latency with dropped requests does not pass. |
| Evidence resolved | Workload/arrival logs, raw histograms/operation records, paired windows/order, error/censor records, env+pool/heap profiles, statistical method/config, dimension results and explicit tested horizon. |
| Dependency/resource | WP3-15/16/17/18; FR3-27/NFR3-09. Calibrate arrival intensity, warmup/GC, independent sample size, precision/power, profiler cost, soak duration/storage. Long-horizon leaks and cross-platform qualification mandatory; each platform retains its own actual measurements. |

### 6. PC3-05 — Legacy with unknown behavior

| Aspect | Target specification |
| --- | --- |
| Incident/impact | Batch invoicing without tests, dynamic plugins/SQL and old config yield incorrect totals for some tenants; documentation does not explain rounding and side effects. |
| Input/access/telemetry | Allowed source/config/job inventory, available historical builds/data/examples, sanitized logs/outputs, business owner/domain evidence, read-only observability or clone. Record inaccessible schedulers/services and unknown dependencies. |
| Reproduction | SC3-09 uses pinned incident inputs and isolated clones. Characterization probes capture behavior and side effects; hidden dependencies receive typed gaps. If history/trigger is unavailable, do not create an apparently healthy baseline. |
| Cause vs symptom | Observed mismatch is not necessarily a defect: it may be a hidden business rule. Separate observed behavior, confirmed desired intent, suspected dependencies, and unsupported assumptions. Probe divergent examples after the owner explains invariants. |
| Repair/mutation | MVP: read-only diagnosis, trusted instrumentation on clones and characterization proposals. Candidate repair only through the existing pipeline after legitimate baseline, intent/oracle and permissions; not creating tests from current output and calling it correct. |
| Independent verification/invariant | Trusted author/owner validates positive/negative domain examples then freezes a separate oracle. Missing business semantics block the relevant dimension; unknown dynamic edges remain visible. |
| Measurable acceptance | All labeled unknowns/side effects in acceptance fixtures reported; zero unsupported positive claims; every blocker has minimal missing input/access, decision owner and next safe probe. Complete fixtures can enter the pipeline, incomplete fixtures must abstain. |
| Negative/unsupported/abstain | No known-valid baseline/domain owner; external irreversible side effect; unrepresentative sanitized corpus; proprietary unavailable runtime → diagnosis-only. Patches enshrining observed bugs as oracle rejected. |
| Evidence resolved | For diagnosis: inventory/provenance, observed-vs-intended ledger, approved characterization and blockers. “Issue resolved” label becomes legitimate only after actual normal repair proof; completed characterization does not mean bug resolved. |
| Dependency/resource | WP3-15 + WP3-18; FR3-28. Calibrate corpus/redaction cost, capture volume, clone feasibility, business review effort. WP3-20 mandatory for qualified legacy recovery after prerequisites, without removing the baseline gate. |

### 7. PC3-06 — Cross-component cascading failure

| Aspect | Target specification |
| --- | --- |
| Incident/impact | Config rollout enables a new response; stale cache causes retries; old workers write old schema; DB contention and queue lag break order UI and inventory. Every repository can pass its own unit tests. |
| Input/access/telemetry | Pinned source, config flags and deployment order; API/event/cache/schema graph, service spans, retry/pool/DB/queue histories; permissions for all required components or declared gaps. |
| Reproduction | SC3-01 and SC3-04 run frozen mixed-version+config/cache states, triggered with the same workload. Isolated component pass recorded as control; whole workflow must show original failure. |
| Cause vs symptom | Propagation path states trigger → contract/config divergence → retry/resource bottleneck → business failure. Intervene on one link per controlled probe while holding others fixed; inferred-only causal edges are not promoted because final patch passes. |
| Repair/mutation | Coordinated source/config/schema/event/cache changes according to intent; versioned keys, compatibility window and deployment DAG. No expanding repo allowlist, reverting intended change, or hiding downstream errors. |
| Independent verification/invariant | Required target+edge checks, four-dimensional bundle proof, tenant/data/business invariants and deployment-state matrix. Partial publication/local fixed does not prove system recovery. |
| Measurable acceptance | All required states/edges have valid observations; final workflow passes all invariants; bounded queue/cache convergence and SLO recovery achieved; zero required blocking unknowns. Excluded states have tested/enforced deployment prohibitions. |
| Negative/unsupported/abstain | Unavailable downstream, unknown shared DB writers, unpinned flags/TTL, head/config drift, impossible rollout without downtime decision → bundle blocked/incomplete; no average success. |
| Evidence resolved | Config/deploy-aware causal graph, exact bundle, independent full campaign, intermediate state outcomes, convergence receipts, deployment constraints and publication identities if any. |
| Dependency/resource | WP3-05/11 + WP3-15..18; FR3-05/10/17. Calibrate topology/state combinations, total service footprint, clone/cleanup, graph-gap review. Cartesian explosion handled by frozen risk-based selection, not removal of failed states. |

### 8. PC3-07 — Diagnosis from logs, traces, metrics, and history

| Aspect | Target specification |
| --- | --- |
| Incident/impact | Errors rise after two nearby deployments, but clock skew and sampled spans make the victim service look like the cause. Wrong attribution yields patches to healthy services. |
| Input/access/telemetry | Scoped read-only query export, source/deploy/config identities, log event/observed time, trace/span/operation IDs, metrics resolution, sampling/drop/retention and clock uncertainty. No live backend needed if signed/pinned export suffices. |
| Reproduction | SC3-09 diagnosis variants and observation controls in SC3-01/08: complete input, missing spans, wrong deploy labels, clock shift, and data redaction. Expected causal chain frozen by trusted author. |
| Cause vs symptom | Identity and partial-order joins are stronger than timestamps; deployment correlation yields hypotheses. Mechanism evidence + independent intervention/counterexample distinguishes root cause from co-occurring regression. |
| Repair/mutation | Evidence acquisition, read-only queries, clone instrumentation/probes; patch proposals still follow FR3-09 after proof prerequisites. No changing production retention/sampling or enabling live profiling without scope permission. |
| Independent verification/invariant | Separate evaluator checks provenance chain, supported/refuted/unknown labels, gap handling, redaction and leakage. Does not use LLM scores as diagnosis oracle. |
| Measurable acceptance | All mandatory labeled chain links have valid source refs; zero fabricated causal edges/unsupported root-cause claims on ambiguity controls; every missing critical input yields specific next acquisition. Metrics-only correlation does not pass causal proof. |
| Negative/unsupported/abstain | Export without identity, unsynchronized clocks without bounds, opaque aggregated metrics, dropped IDs, indistinguishable multiple causes → uncertainty; do not invent exact replay/history. |
| Evidence resolved | Raw/export digests, query/clock/sampling metadata, correlation mappings, hypothesis/probe ledger and independent diagnosis assessment. “Cause supported” does not automatically mean “repair verified”. |
| Dependency/resource | WP3-15 then WP3-16/18; FR3-25/08. Calibrate query windows, export bytes/cardinality, redaction, storage/retention, ingestion CPU, native profiling perturbation. |

### 9. PC3-08 — Adaptive recovery and stopping

| Aspect | Target specification |
| --- | --- |
| Incident/impact | First patch fixes serialization but load still fails due to a lease leak; agent retries only change timeouts, increasing cost without business recovery. |
| Input/access/telemetry | Candidate/base identities, failure signatures, causal ledger, attempt histories, four-dimensional observations, remaining budget, allowed probes/paths. |
| Reproduction | SC3-05 uses actual candidate failure from a real model; dev controls use pinned traces for duplicate/no-progress policy tests with clear labels. Do not deliberately submit bad patches in acceptance to chase failure. |
| Cause vs symptom | New failures must change/refute a hypothesis or reveal another invariant. A model narrative of “better” without observation is not information gain; many passing tests with new risk are not progress. |
| Repair/mutation | Choose a distinguishing probe, replan a coordinated candidate, invalidate affected proof, rerun the full campaign. Only already legitimate scope/budget; no adding resources, oracle, or retries independently. |
| Independent verification/invariant | Trusted ledger comparator and verifier measure business effects, valid proof and repeated signatures; stop/resume accounting tested. Protected invariants/auth/intent remain the same across candidates. |
| Measurable acceptance | Two non-informative repeated attempts stop the branch according to FR3-08; valid new evidence may open another branch within cap; successful recovery must meet the full campaign, not fast results. All terminal blockers have a next probe or explicit no safe probe. |
| Negative/unsupported/abstain | Cosmetic edits only, repeated equivalent candidate, no distinguishing probe, exhausted cap, missing baseline/telemetry → stop without claim. Infrastructure flakiness does not trigger automatic business patches. |
| Evidence resolved | Complete hypothesis evolution, candidate equivalence/failure signatures, observations changing decisions, stop/resume/cost receipts, exact successful bundle or unresolved blocker report. |
| Dependency/resource | WP3-07/11 + WP3-15/17/18; FR3-08/14/25..27. Calibrate probe utility/cost, model calls, token/cost, repeated native campaign reserve. No additional AI engine per class. |


<a id="18-customer-journey-and-hosted-access"></a>
## 18. Customer journey and hosted access

### 1. How customers use the product

Customers open the website, log in, create an organization, install GitHub App on selected repositories, create a project, then submit an issue/PR/change intent. They do not need to clone ChangeProof source, install native toolchains, set up servers, or provide model API keys for the minimum hosted flow. The provider operates the model broker and execution fleet; unavailable customer-application prerequisites remain honestly displayed.

GitHub is the minimum repository integration. UI shows capabilities per version/feature, required inputs, risks, quotas, and cost estimates labeled as estimates before runs. Owner/maintainer sets invariants and publication scope. Unsupported repositories yield diagnosis/support gaps, not automatic generic repair.

Users can create diagnosis-only or repair runs. Dashboard shows queue/running stages, blockers, actual costs, target/bundle outcomes, evidence and related PRs. History and results must remain accessible after closing the browser. Disconnect, membership removal and deletion can be managed from the website.

Public/marketing websites must not claim all frameworks or all problems are solved. No domain, deployed URL, paid plan or customer count is assumed to exist.


### 2. Accounts, organizations, projects and access

GitHub sign-in and email/password with verification/recovery are mandatory identity paths, separate from GitHub App installation for repository access. SAML/SCIM is also mandatory according to FR3-44. Sessions use server-side validation, expiry and revocation; secure session cookies, CSRF protection on mutations, output escaping and request/upload limits are acceptance criteria. Changing the organization ID in a request does not change authorization scope.

| Role | Minimum rights |
| --- | --- |
| Owner | All organization rights, ownership transfer, members, spending cap, retention/deletion and disconnect |
| Admin | Manage non-owner members, repositories/projects and run configuration within owner ceiling; no organization transfer/deletion or spending-ceiling increase |
| Maintainer | Create/cancel runs and request PRs in assigned projects/repositories and approved scope |
| Viewer | Read results/evidence only in granted projects/repositories; no run/publish/configure |

The last owner must not be removed without transfer or deletion workflow. Invitations must be expiring, single-use and accepted by the intended identity. No public role self-assignment. Membership alone does not grant access to all private repositories: project grants and current GitHub repository entitlement must also pass for related source/evidence data. Multi-repo bundles require access to all members; otherwise, use a denied response without disclosing other repo names/findings. The minimum does not rely on unqualified partial redaction.

All APIs, background jobs, event streams, search, exports, artifacts, caches and support tooling receive server-validated tenant scope. PostgreSQL row-level protection is additional defense above application authorization; pooled connections reset tenant context, with no request using a bypass database role. Operators do not automatically read customer source; support access is scoped, time-limited and audited.


### 3. GitHub integration and access revocation

Installation is bound to an organization through verified callback/state and legitimate installer rights. Permission matrix is pinned per feature: metadata/contents read for snapshots, issue/PR access needed for triggers, and scoped write for branch/PR publication. No merge/admin/deploy authority requested for the minimum workflow. Users see requested permissions; actual provider capabilities are verified during implementation.

Credentials are stored encrypted through a secret manager; installation tokens are created briefly by the broker and not given to browser/model/sandbox/test processes. The snapshot broker fetches exact repository/commit after checking rights and provides the source bundle without tokens. Tokens/signing keys are not included in job payloads, logs or evidence.

Webhooks are verified over the raw request body, delivery IDs deduplicated, size bounded, installation/repository mapping validated, then durable receipt/outbox created before acknowledgement. GitHub payloads are not trusted tenant selectors or agent instructions. Out-of-order events do not revive revoked grants; re-fetch provider state when needed. Duplicate webhooks may add audit receipts but do not duplicate runs or PRs.

Uninstall, suspension, repo deselection, member revocation and project disconnect block enqueue/credential acquisition and new publication. Queued jobs are canceled; active jobs are stopped at a safe boundary with cleanup. Already in-flight network calls are recorded/reconciled; do not promise atomic rollback of external side effects. Before snapshot, publish, download or live stream, revalidate current grant. Provider outage holds operations requiring rights verification; no fail-open. Disconnect does not automatically delete PRs or all evidence: UI offers separate deletion/retention and access follows remaining grants.


### 4. Dashboard and run flow

| User stage | Required behavior |
| --- | --- |
| Create project | Choose approved repositories, service mapping, environment profile and data permissions |
| Readiness | Inventory/capability, baseline/oracle prerequisites, model availability and capacity/budget displayed |
| Submit problem | Select issue/PR/ref or write intent; upload sanitized telemetry through validated uploads, without sending production credentials |
| Review plan | Mutation scope, business invariants, finite budget, data/model disclosure and publication preference |
| Run | Server-side idempotency key, reserve quota, durable queue; accepted request receives a reopenable run ID |
| Monitor | Authorized event stream; polling fallback, reconnect cursor, actual timestamps and stage names; no fake percentages |
| Review | Cause/hypothesis distinction, exact diff, required/not-run checks, C/P/R/D, limitations and authorized private evidence |
| Publication | Maintainer chooses publish or enables project policy beforehand; broker still checks role, grant, freshness and proof |
| Cancel/retry | Cancel stops process tree; retry follows budget/identity rules, not silently reset caps |

Errors include access revoked, unsupported, provider unavailable, quota exhausted, cleanup failure and inconclusive proof. UI does not call queued fixed, or outage no impact. Billing/queue status is separate from run state and target/bundle verdict.


<a id="19-complete-product-features-mockups-and-scope"></a>
## 19. Mockup features and complete product scope

**Local design source:** [interactive mockup](.template-ui/mockup.html), reviewed from route definitions, forms, actions, template data and final overrides on 22 October 2026. All following features are mandatory. Existing mockup pages use browser state, illustrative data and simulated effects; that appearance makes no claim of real backend, email delivery, PR, billing or campaigns. All UI paths must use production APIs/services and persistence at acceptance. Hash routes are design references, not final URL contracts.

### FR3-37 — Public website and product guides

The website provides landing, product, pricing, guides/documentation, changelog, support roadmap, templates, tutorials, sample-report, help/FAQ, privacy-policy, integrations, impact-overview, verification, evidence-overview, collaboration and terms without login. All navbar/footer/CTA items have correct destinations. Workspace, project/repo/members and private evidence still require sessions and current grants on the server; browser route guards are not authorization.

Acceptance: guests can read all public pages, search FAQ and open static sample reports without tenant access, run creation or credit use. Workspace deep links require login and return to a validated destination after authorization. Expired/revoked login does not delete accepted runs. Public templates explain input/invariants/budget and are applied only after login. Changelog separates design from actual releases; roadmap maps support/qualification status for all mandatory scope, not deferred features. Pricing comes from actual entitlement/pricing version. Sample reports do not claim real results; testimonials/case studies require provenance/permission. Old OpenAPI/TypeScript-only copy does not limit agreed polyglot scope. Final terms/privacy, provider disclosure and license are mandatory before release.

### FR3-38 — Email identity and account recovery

Besides GitHub login, provide registration with name/email/password/consent, verify-email/resend, email login, remember-me, forgot-password/check-email, reset-password with confirmation, logout, session list and session revocation. After email verification, users create an organization → connect a repository provider → create a project → readiness. GitHub login and repository installation remain separate authorities. Email-only users still need legitimate provider grants for source/evidence.

Acceptance: auth provider or server manages password hashing, pinned policy, verified email, expiring single-use purpose-bound tokens and secure sessions. Passwords, reset tokens and session secrets are not stored in localStorage/log/evidence or forwarded to models. Resend/reset is rate-limited; responses do not reveal account existence/nonexistence. Token replay/expired/wrong-purpose and email changes tested. Password reset revokes other sessions according to documented policy. Account linking requires authentication of both identities, not merely matching email; GitHub-only accounts are not silently assigned local passwords. Server validation does not depend on the mockup's eight-character minimum. Actual authorized email delivery, invalid links and restart/reopen session tested; simulated verify-email clicks do not pass the requirement.

### FR3-39 — Notification center and preferences

Provide per-user/organization notifications for results needing review, blockers, access changes, quota/reservation and cleanup failures. Dropdown shows unread count, timestamp, read/unread state, mark all read, dismiss, empty state and authorized deep links; category preferences managed through settings.

Acceptance: business events/outbox are the source of durable notifications with idempotent event IDs. Read/dismiss per user persists across sessions and does not delete audit/evidence. Duplicate events do not duplicate notifications; read/dismiss does not trigger run/publish. Access scope is checked on list/count/stream/detail/link, including after revocation; old notifications do not disclose repo names/results whose rights were lost. Other accounts do not receive this user's read state. Minimum channel is in-app; every configured delivery channel must have receipts, retry/caps and preferences. Delivery failure does not change verdicts.

### FR3-40 — Navigation search and authorized data

Command palette Ctrl/Cmd+K, keyboard selection/Enter/Escape, project/run/audit/evidence search/filter and empty states are mandatory. Shell provides workspace switcher, account menu, notification menu, responsive/collapsible sidebar, tooltips and light/dark theme preferences. Main UI is in English according to the final mockup; document language is not runtime locale.

Acceptance: every search performs tenant/project/repository authorization before assembling results, snippets, counts, suggestions or exports. Cache is bound to user/grant version and invalidated after revoke/delete. Server uses pagination/cursor and stable ordering; run type/status/project and audit actor/event/time filters do not hide errors/incomplete. Keyboard focus returns after modal/drawer, menus have labels/expanded state and are not clipped by viewport on mobile/zoom. Browser preferences are non-secret only, separated across accounts, with storage-unavailable fallback; preferences do not become access authority.

### FR3-41 — Support, access requests and service status

Customers can create support requests with summary, category, optional run reference and sanitized context; view ID/status/history, FAQ, dependency/service incidents and request access using opaque resource IDs without discovering forbidden resources. Requests are not grants. Approvers must be authorized for the entire requested scope; decisions, expiry and revoke are audited.

Acceptance: support tickets are durable, tenant-scoped and visible only to requester/authorized team/support. Attachments follow upload validation/retention, without raw source/secrets in general logs. Support access is opt-in by an authorized actor, scope/time-limited, revocable and audited per access. Incident status contains affected component, start/update/resolution and queue/model impact with actual operator data, without customer source. Outage does not change code verdict. Operator console is separate from customer Owner; drain/inspect/quarantine and incident mutations require operator role, revalidation, audit and actual worker receipts. Organization owners are not platform operators. Opening a page does not send external messages; delivery only through service workflows explicitly approved by the user.

### FR3-42 — Internal discussion and reviewer notes

Team discussion and reviewer summaries visible in landing/collaboration mockups are mandatory features, even though comment-submission interactions are not yet available in HTML. Provide threads/comments bound to run, candidate digest/plan revision and optional artifact/diff location; internal or reviewer audience, author/timestamps, edit history, resolution and controlled sharing.

Acceptance: role/project/current repository grants determine read/write/share; audience changes must be reviewed by authorized actors and do not automatically publish to GitHub or create public URLs. Sanitized reviewer summaries still carry unknowns, proof gaps and target/bundle distinction. Comments/approval/resolved do not change verdict, freeze oracle or grant mutation authority. Candidate changes mark comments dependent on old candidates as outdated, not silently move them. Mention notifications follow FR3-39; users without access receive no snippets. Update concurrency uses version checks; duplicate submit is idempotent, XSS rejected, retention/delete/export follows source grants. Actual persistent discussion and reviewer access tested E2E.

### FR3-43 — Self-host distribution, BYOK and multi-cloud

Hosted operator-funded model remains default without customer installation. Self-host installation/configuration, upgrade/rollback, backup/restore, standalone operator binary, BYOK and multi-cloud deployment automation are also mandatory. One engine/contracts/policy is used in all modes; each profile has pinned artifacts, runtime/native prerequisites, license/notices and measured resource limits.

Acceptance: clean install, authentication/secret provisioning, actual model/native run, protected evidence, authorized publication, upgrade, rollback compatibility and deletion-aware restore on every declared deployment/platform profile. BYOK stores keys in encrypted server-side broker, credential refs only in jobs, with rotation/revocation and billing attribution tested; keys do not enter browser persistence, source/model context, guest or evidence. Key/provider failures do not silently fall back or weaken proof. Cloud configuration/drift/teardown tested on every frozen provider catalog; each compute deployment remains qualified according to trust boundary, not merely manifest rendering. Standalone binary runs operator workflows without replacing native tooling or hosted browser journey.

### FR3-44 — SAML SSO and SCIM lifecycle

Enterprise organizations can configure SAML SSO and SCIM provisioning/deprovisioning alongside GitHub/email login. IdP/tenant binding, verified domain, issuer/audience/destination/signature, request correlation, replay/expiry, signing certificate rotation and controlled break-glass owner access are mandatory.

Acceptance: scoped SCIM token, idempotent provisioning/update/disable/group mapping with version/order handling. IdP/SCIM cannot grant platform operator roles or repository entitlement. Deprovision/logout/revocation holds sessions, queued/running work and publication according to current grants. SSO enforcement/account linking does not lock out owners without documented recovery, or take accounts merely because email/domain matches. Use actual configured IdP/provisioning flow plus negative assertions; mocked SAML alone is insufficient.

### FR3-45 — Repository providers beyond GitHub

Non-GitHub providers are mandatory through provider-neutral connection/snapshot/event/publication ports. `[DERIVED]` initial catalog includes GitHub, GitLab and Bitbucket; version/deployment mode, authentication, permissions, webhook verification and CI capabilities of each provider are frozen before implementation. GitHub App remains the mandatory provider-specific adapter.

Acceptance: per provider, actual authorized login/link/connection, selected repo access, exact snapshot, verified/dedup events, revocation, candidate branch/PR or merge request, lost-response reconciliation and exact-head CI attestation. Same secret broker and current grant rules. Cross-provider bundles have stable provider/repo identity and publication DAG; one provider outage does not yield false bundle verified/publication complete. Public repo submission still requires legal access, quotas, validated snapshot and hostile-code isolation. Unsupported provider modes are explicit qualification-catalog blockers, not silent GitHub fallback.

### Feature completeness using existing requirements

| Mockup surface | Existing requirements and mandatory details |
| --- | --- |
| Project/readiness/settings and environment topology | FR3-01/02/23/29/31: components/roles, toolchain conflict, protected-suite prerequisites, dataset/migration/reset/network/resource refs; edits create config revisions, old runs remain pinned |
| Six run templates and drafts | FR3-08/11/12/28/31: contract, dependency, migration, incident, cross-repo and legacy; prefill is reviewable, legacy without baseline selects diagnosis-only; save/resume drafts without secrets/file bytes, revalidate scope/versions/budget/consent on submit |
| Graph, investigation, campaigns, review, publication and outcome | FR3-05/08/10/15..21/25..28: source provenance, hypothesis/probe, valid/excluded trials, C/P/R/D, exact diff, per-target/bundle, publication checks and attribution remain separate |
| Evidence library, index/audit export and reproduction action | FR3-18/20/31/35: authorized lists/filter/download, content hashes, complete all-trial records, scoped index/export receipt; missing/hash mismatch explicit; reproduction is a durable budgeted job from a pinned campaign without model re-proposal |
| Usage, payments and data lifecycle | FR3-34/35: consumed/reserved/available, period/entitlement/pricing version, checkout/subscription/invoice/refund/reconciliation, purge/tombstone/backup expiry and actual status |
| Evaluation reports and operator console | FR3-24/36/41: actual run denominators, B0/B1/B2/Full and ablation, dev/holdout, origin/cost/limits; operator queue/lease/fencing/quarantine/cleanup metadata with separate role |
| Multi-region, long-horizon, model checking, TB/cross-engine, cross-platform and legacy repair | FR3-11/17/26..28: all mandatory, with acceptance profiles in MVP §20; baseline/intent and full independent proof not weakened |

### Additional service contracts

| Contract | Required fields and invariants |
| --- | --- |
| `RequiredCapabilityCatalog` / `FeatureCoverageRecord` | All promised features/routes/actions and profiles, requirement/module/work/gate, required case IDs, versions and actual evidence/status; no deferred exemption |
| `IdentityChallenge` | Purpose, subject/provider binding, token hash, expiry, used/revoked, attempt/delivery limits; plaintext secret only in delivery broker |
| `NotificationRecord` | Tenant/user/event/category, opaque subject refs, created/read/dismissed revision, delivery dedup; metadata resolved after current authorization |
| `ScopedQuery` | Server tenant/actor/grant version, allowed filters, sort/cursor/page limit, projection; cache key does not cross authority |
| `SupportRequest` / `AccessRequest` | Requester, opaque scoped subject, sanitized reason/attachments, status, approver, expiry, decision receipts; request not automatic grant |
| `ReviewThread` | Tenant/run/candidate/plan/artifact refs, audience, authors, comment revisions, resolution/outdated, sharing receipt; not a proof fact |
| `RunDraft` / `EnvironmentProfileRevision` | Owner/tenant/project, template/config version, intent/targets/resources, update version; revalidate before creating frozen run |
| `BillingEvent` | Provider/event/subscription/customer IDs, tenant mapping server-side, signature receipt, invoice/refund/period/rate version; idempotent entitlement reconciliation |
| `DeploymentProfile` / `ModelCredentialRef` | Hosted/self-host/cloud/platform versions, image/binary/source digest, install/restore receipts, scoped secret ref/owner/rotation; no plaintext key included |
| `EnterpriseIdentityBinding` / `ProviderConnection` | Tenant/issuer/provider/subject/domain, identity mapping, grant/SCIM version, revocation and allowed capabilities; no operator authority granted |

All contracts are added to WP3-01/02 and boundary tests before wiring. FR3-37..45 introduce no new outcomes. All features are mandatory; optional inputs, mode/login/provider choices and justified not-applicable in a run remain user choices, not deferred capability development.


<a id="product-depth-decision"></a>

## 20. Assisted readiness, efficiency and AI contribution

**Decision record [DERIVED], 22 October 2026, design revision 1:** user input is translated into deepening FR3-01/06/07/08/14/15/24/28/31/34/35. All following additions are mandatory targets within relevant scope; they do not change verdict rules, old requirement IDs, oracle independence, or release scope. Assessment/credit context in [BRD §20](BRD.md#hackathon-context), acceptance in [MVP §21](MVP.md#product-depth-acceptance), ownership in [architecture §20](architecture.md#product-depth-architecture).

### Assisted readiness and domain confirmation

1. Fetch existing workflow/check configuration, API/event/schema contracts and tests from authorized repositories/CI. Pin repo/commit/workflow/check-run/artifact digest, origin, time and grant; separate test source from CI receipts. Green CI status does not replace native baseline or protected proof. CI YAML/scripts and artifacts remain untrusted, not executed in the control-plane.
2. Compile invariant **proposals** from contracts, domain documents, tests and issues with provenance. Show desired behavior, source evidence, conflicts/unknowns, positive/negative examples, authorized owner and specific confirmation questions. No response or general approval is not confirmation of every invariant. Observed legacy behavior is not automatically correct.
3. Authoring occurs before the fixer run. Owner/domain authority approves meaning; trusted oracle authors review and freeze assertions independently of the patch-generating agent. AI proposals, even when approved as intent, do not automatically become protected tests. Hidden assertions, holdout answers and private oracle-authoring context are not forwarded to the fixer; using the same model in two prompts does not by itself prove independence.
4. Reuse environment/invariant profiles in the same tenant/project only after checking current grants, approval scope, expiry/revocation, source/contract/data/topology/toolchain identities and intent changes. Relevant changes require new review/revision. Every run still receives an immutable manifest and required new baseline/proof; old approval does not grant automatic authority over changed invariants.
5. Readiness displays every prerequisite, available/missing evidence, blocking reason, party who must act and minimum step unlocking discovery, diagnosis or repair. Initial diagnosis may be released when facts suffice with uncertainty and next action; mutation awaits legitimate baseline/oracle and final assurance awaits all proof. Runtime UI uses English.
6. Measure user active time from repository connection to first actionable result, separate wall-clock/queue/operator/domain-review time, new/reused projects, and diagnosis-only/verified repair. First actionable result requires an evidence-backed finding or blocker with next action confirmed useful by the user; queued status or generic summary does not count. Event/idle rules/denominator frozen before study; source/log content does not enter analytics.

### Efficiency that preserves proof

1. `VerificationPlan` maps every required target/edge/invariant/dimension/mixed-version state to checks and coverage rationale. The trusted planner uses graph/provenance and versioned selection rules; the model may propose, but does not remove obligations. Unknown impact expands checks or withholds assurance. `attempt_fast` may select a subset; `post_fix_full` still covers the entire frozen required suite. No failed checks are removed after results are known.
2. Reuse build/dependency artifacts or immutable pre-run environment templates only if tenant/project scope, all source/build-input/lock/toolchain/image/config identities, provenance and integrity match. Snapshot state used by a candidate/trial must not be reused as clean initial data. Current grants, deletion fence and cleanup/quarantine are checked; hash alone is not permission.
3. Cache hits only speed preparation. They do not carry cached passes, verdicts or campaign receipts to new candidates/plans. Mandatory native tests, browser/DB/event interactions and campaigns still execute on the identity assessed; stages/trials use fresh disposable state. Independent reproduction G3-07 still starts from a clean environment without candidate build-result cache or original job state. Pinned dependency/toolchain inputs may be fetched again according to manifest and access policy.
4. Before submit, show cost/duration estimates with uncertainty ranges, cost components, assumptions, calibration/profile/rate version, cold/warm preparation, queue and freshness. Forecast includes diagnosis/proposals, complete verification/reproduction, storage and cleanup reserve. Estimates are not SLAs or bills; if not calibrated, show unavailable and withhold admission requiring a legitimate finite profile. Insufficient budget does not reduce n/thresholds/checks.
5. Measure cost of the entire run cohort including failed/incomplete, retries, native execution, reproduction, storage and human review time. Cost per accepted repair divides gross cohort cost by the number of owner-accepted verified bundles; net after credits reported separately. Human time reported in minutes/hours; monetary conversion only with agreed rates. Zero accepted repairs = N/A with total cost, not zero cost/repair. Separate time to first diagnosis and time to full proof.

### Traceable Meta contribution

| Shared-engine decision | Targeted output | Contribution evidence and limits |
| --- | --- | --- |
| Unify cross-language/service evidence | Hypotheses with source/runtime refs, alternatives and unknowns | Model request/response and ledger linked to exact snapshots; narrative is not causal proof |
| Select distinguishing experiments | Typed probe intent, predicted observation, competing explanation, cap/stop rule | Coordinator validates trusted plan; verifier produces actual receipts; model gets no raw fault control |
| Revise diagnosis after contradictory results | Refuted/revised hypotheses and next proposals using new evidence | Actual SC3-05/ledger traces; no engineering first-proposal failure or inserting human reference patches |
| Form coordinated patches | Proposals with target/dependency/intent refs | Gateway/guard and independent full proof on exact candidates, not model self-assessment |

Store model/provider/API-mode/config/prompt version, allowlisted evidence refs, tool decisions, parsed output/failure, latency/token/usage and next decisions as private redacted traces. No need to store or disclose hidden chain-of-thought; concise rationale and observable steps suffice. Provider fallback, if allowed, becomes an explicit execution/config identity; its results are not labeled the original Meta run.

B2/ablation with the same model measures ChangeProof design contribution. It does not prove the Meta model is superior to other models. Proving Meta's role requires live traces and observed outcomes; vendor-catalog capabilities or sponsor credits do not prove product success. One deeply used shared model is sufficient; multimodal, training and additional providers are not required merely for presentation.

### Contracts, versions and change impact

The following new contracts target `schemaVersion = 1` when first implemented; these are field specifications, not executable schemas already available. All refs must be valid and authorized. If the same contract already exists, audit its actual version and increment according to semantic changes; do not overwrite historical artifacts.

| Contract | Minimum fields / invariants |
| --- | --- |
| `ReadinessAssessment` | Tenant/project/run-draft revision, source/CI refs+digests, prerequisites/evidence/gaps, blocked action, responsible owner, safe next action, current-grant/version refs; not a product verdict |
| `InvariantProposal` | Provenance, desired behavior, positive/negative examples, unknown/conflict, proposing actor/model, domain approval identity/scope/revision/revocation, independent oracle-author receipt; approval cannot be created by fixer |
| `PreparationReuseRecord` | Scoped tenant/project, artifact/source/input/lock/toolchain/image/config/data-template digests, origin/integrity, authorization/deletion/cleanup facts, hit/miss/rejection reason; no proof-pass authority |
| `RunForecast` | Plan/profile/rate/calibration identity, assumptions, component estimates/range/units, cold/warm/queue bounds, gross/net cost, full proof/reproduction/cleanup reserve, validity window; estimate separate from cap/usage |
| `EvaluationArmManifest` | Evaluation/dataset version, arm/ablation definition, model/config, allowed inputs/tools/feedback, common budget/terminal rules, evaluator/oracle identity, case order/repetition policy; freeze before outcomes |

Extend `VerificationPlan` with coverage-selection map/rule identity; `EnvironmentProfileRevision` with readiness/invariant approval refs; `OutcomeValidation` with active-time/review/cohort measurement refs. Semantic changes require new contract versions before wiring. Evaluation design is expanded to **revision 2** for B0/B1/B2/Full and ablation; actual datasets/manifests receive new versions/digests at freeze. Old evaluation results retain old identities and do not prove B2. Verdict policy is unchanged; actual policy version is not fictitiously incremented in a document task.

## Seven-file package consolidation — 22 October 2026

At the user's instruction, the requested final `` package structure contains only `BRD.md`, `PRD.md`, `MVP.md`, `architecture.md`, `SKILL.md`, `AGENTS.md`, and `.template-ui/mockup.html`. Seven references were merged in full into the Integrated references section in SKILL; identical skill copies have been verified. SVG logos, WOFF2 fonts, and OFL license text are stored in HTML; the reports folder was originally empty. Product scope, requirement IDs, schema, policy and acceptance gates are unchanged. Document consolidation is not evidence of implementation or gate passage.

**Deletion status:** consolidation complete, but deletion of source files/folders was denied by automated policy checks. Source folders still exist; the seven-file structure has not been achieved.

**Historical structure update — 22 October 2026 (superseded by MVP §22 revision 2):** the consolidation note above is history. The user's latest request adds a `phases/` folder containing five playbooks; the active package consists of seven main files plus that folder. The old seven-file-only restriction no longer applies. Product scope and WP dependencies are unchanged; see [MVP §22](MVP.md#execution-phases).

<a id="hackathon-competition-compliance"></a>
## 21. Hackathon competition compliance and contribution profile

This section governs the competition build and submission described in [BRD §21](BRD.md#hackathon-build-scope) and [MVP §23](MVP.md#hackathon-build-scope). It **adds obligations** to existing requirements; it never relaxes them and never reduces the complete-release scope in §19/§20.

### Compliance obligations

| Obligation | Binding requirement | Acceptance |
| --- | --- | --- |
| Preserve Meta output provenance; never remove, alter or obscure watermark, labels, metadata or provenance signals | FR3-22, FR3-18 | Any Meta-generated image/text/code shown to a user or distributed with a PR/product keeps its provenance signal. No post-processing strips it. A negative test proves the stripping path is absent/unreachable |
| AI transparency for end users | FR3-31, FR3-35, FR3-37 | The product states that the user interacts with an AI system, explains its limitations and expected error modes, and labels AI-generated content where applicable. Disclosure is present in the demo UI and public copy, not only in internal docs |
| Audience and use restriction | FR3-29, FR3-31, FR3-37 | The demo/product is not targeted at users under 18. Onboarding/copy reflects that. No use case in the showcased slice requires minors, behavioral surveillance, workplace/school emotion recognition, biometric identification or other prohibited categories |
| Human authorization for impactful actions | FR3-22, FR3-08, FR3-09, FR3-30 | Actions that are irreversible, destructive, production-affecting, legally binding, or merge/publish/deploy remain behind an explicit human confirmation. The agent cannot self-authorize them, and no agent configuration disables the checkpoint |
| Data-mode discipline | FR3-35, FR3-07 | Before sending source, telemetry or customer data to a model, the configured service mode is checked. Secret code, credentials and personal data never enter a mode whose terms permit training on content. The mode choice is recorded per request and disclosed to the user |
| No competing training, no key resale, no reverse engineering | FR3-07, FR3-22, FR3-36 | Meta output is not used to train or fine-tune a competing model; no proxy/gateway resells Meta API access; no model-weight extraction or redistribution is implemented |
| Resource accountability | FR3-14, FR3-34 | Credits are used only after entitlement, balance, mode, model, rate, expiry and billing method are verified. A finite cap and reservation exist before a run; unmet need becomes an explicit blocker, not a smaller proof scope or a smaller claim |
| Event eligibility and submission administration | FR3-22, FR3-35, FR3-37 | The submission records one eligible track and theme, one team representative submits and lists all members, and the portal deadline/forms/video requirements are checked against the current Event Waiver. No identity, tax, payment or Team/Project ID secrets are committed to the repository |
| Event IP license and public materials | FR3-22, FR3-35 | Before submission, the team reads the current Event Waiver and confirms what license is granted to Meta/Cerebral Valley, whether event materials are non-confidential, and member authority to publish. No confidential source, secret, personal data or third-party material without rights is included in public demo/submission |
| Prohibited use restrictions | FR3-07, FR3-22, FR3-36 | No competing-model training from Meta output, API-key resale/proxy, weight extraction/reverse engineering, unauthorized deepfake, illegal biometric surveillance, workplace/school emotion recognition, or offensive cyber operation in the product or showcased use case |
| Prize and tax claims | FR3-37 | Prize pool, ranking amounts, bonus prize, transfer/FX fees and non-US tax forms are represented only as event-reported information with a dated source; no winnings, eligibility or tax outcome is promised |

### Meta contribution profile for the competition build

The competition slice must make the model's role observable rather than decorative. The profile below is the minimum demonstration surface; it does not claim that the model is correct, general or sufficient.

| Contribution | What must be observable | What must not be claimed |
| --- | --- | --- |
| Evidence synthesis | The allowlisted evidence set the model received, its structured output, the hypothesis ledger entry it produced, and the sources it cited | That the narrative is causal proof |
| Distinguishing probe selection | The typed probe intent, predicted observation, competing explanation considered, and the coordinator's validation of the plan before execution | That the model controls the runner, oracle or fault injection |
| Coordinated patch proposal | The proposal's target/dependency/intent references, the candidate identity it produced, and the guard/gateway acceptance path | That the model's patch is right because the model produced it |
| Bounded diagnosis revision | Actual trace where new runtime evidence refuted or narrowed an earlier hypothesis, and the resulting next step | That the first proposal failing proves autonomous recovery, or that failure was engineered |

Verdict authority never moves. The verifier executes; deterministic policy decides. A model contribution that cannot be traced to an exact model/API/mode/config/prompt version and a pinned candidate identity does not count toward the "Use of Meta AI Tooling" criterion.

### Event rubric, eligible tooling and service-mode terminology

The competition rubric reported by participants on 26 October 2026 is Impact 30%, Use of Meta AI Tooling 25%, Demo 25%, Technical Depth & Execution 20%; eligible tooling is the Meta Model API family (Muse Spark series, Muse Wonder, Muse Image, Glimmer, SAM 3 / SAM 3.1), the Muse Code coding agent, and Meta open-weights models run directly or through Baseten, Modal, or Fireworks. Full event terms, prize amounts, credit claims, tax forms and the IP license are recorded in [BRD §20](BRD.md#hackathon-context) with their dated provenance.

Two boundaries bind this section:

- **The rubric is a judging criterion, not a verdict source.** A demo that "works" is not proof that a patch is correct, and no criterion authorises weakening policy, oracle, budget, threshold or proof scope. Contribution credit is earned only by a traceable model contribution over a pinned candidate, exactly as the table above describes.
- **Service-mode naming is unresolved by design.** Participant materials label the pair **Standard** vs **Discounted (Diskon)**; Meta documentation read earlier labels it **Standard** vs **Contributor**. The binding rule is behaviour, not the word: a mode whose terms permit training on content must never receive secrets, credentials, personal data or sensitive source; the configured mode is recorded per request and disclosed; and the label shown to users follows the official naming on the current terms page. This is an open naming item to close under [AGENTS §13](AGENTS.md#13-decisions-versions-and-documentation), it must not be silently resolved in code, UI copy or demo narration while both labels remain in circulation.

### Claim boundaries for submission materials

Submission copy, demo narration, video, slides and repository README may state only what the competition slice actually demonstrated: the scenario, the stack and pinned versions, the workload, the assertions executed, the environment, the observed before/after, and the remaining limitations and blockers. They may not state or imply: universal problem-solving, support for all frameworks or versions, production readiness, customer adoption, reliability or performance guarantees, winning probability, or that the complete ChangeProof release exists. Roadmap statements must be labeled roadmap. Sponsors and credits are acknowledged as resources, not as capability or validation.
