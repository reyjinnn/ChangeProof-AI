# Phase-1 report — revision 2

**Date:** 26 October 2026  
**Application root:** this repository (`ChangeProof-AI/`)  
**Phase status:** `in_progress` — phase-1 is **not complete**.  
**Plan revision:** 2 (24 October 2026).

## Executive status

Phase-1 has verified task-level foundations for WP3-01, WP3-02, available parts of WP3-03, T1-7,
and portions of WP3-04/WP3-05. The final local verification suite passed after the latest edits:
strict typecheck, lint + dependency-cruiser, all 187 tests, adapter tests, graph tests, dependency
broker tests, runner contract tests, and native Docker probes. The runner boundary remains `container_only`, which is
explicitly **not** a qualified VM/microVM or public hosted execution boundary. Native L1 proof is
blocked for Go, .NET and Kotlin because the required toolchains are absent.

**Phase status remains `in_progress`, not complete.** WP3-01 through WP3-05 are not marked `done`:
WP3-03 lacks required Go/.NET/Kotlin native cases; WP3-04 lacks VM/microVM-equivalent qualification
and native dependency-acquisition/build-sandbox proof; WP3-05 still needs the full API/data/event/
dependency/config extraction acceptance matrix. No G3 gate is passed. G3-08/G3-10 remain blocked
without authorized pilot repositories/owners.

## Task header — phase-level

```text
Task ID / parent WP: P1-20261026 / WP3-01..05
Requirement IDs: BR3-01/02/09/12/13/18/19; FR3-01..06/14..16/22/23;
                 NFR3-01..11/13; DEC3-01..10/17/18; NEG3-02/03/06/07/09/10/13/15/18/20/24;
                 G3-01/02/03/13
User-visible outcome: Versioned contracts, pure policy, enforceable module boundaries, adapter
                      registry and native extraction facts, impact graph, dependency-broker
                      contracts, and runner security/cleanup receipts.
Prerequisite evidence: Current root specification and phase-1 playbook; no prior application source
                       or phase report existed at execution start.
Allowed source/config changes: package/tooling config, src/core, src/modules/{policy,adapters,
                                detector,analyzer,graph,dependencies,verifier}, src/orchestrator,
                                tests, scripts, docs/decisions, docs/phase-reports.
Input snapshots + intended intervention: controlled synthetic TypeScript, Python, Java/Kotlin,
                                          and PHP fixture source authored in this repository;
                                          no customer repository, frozen oracle, or external
                                          service is used.
Acceptance checks (positive, negative, native): contract + policy tests; forbidden imports and
  cycles rejected; adapter native extraction positives/negatives; broker malicious-script and
  lockfile-drift cases; runner isolation denials and cleanup; graph provenance/unknowns preserved.
Protected oracle / proof scope: no protected product oracle was created or changed. Adapter fixtures
                                are development inputs, not oracle evidence or product acceptance.
Artifacts expected: source + tests; runner native probe output; decision records; this report.
Actual commands + exit codes: listed below; latest complete command set must be re-run after final edits.
Status + remaining blocker: phase in_progress; native L1 Go/.NET/Kotlin blocked; qualified VM/microVM
                            boundary blocked; WP3-05 and WP3-04 completion criteria incomplete.
Next dependency-ready task: finish remaining T1-7/T1-8 criteria and resolve lint; then run final
                             verification and update report. Do not start phase-2 automatically.
```

## Allocated task status vs full work-package status

| Task | Allocated-task status | Full WP status | Evidence / remaining acceptance |
|---|---|---|---|
| T1-1 contracts | `in_progress` | WP3-01 `in_progress` | Versioned Zod schemas, semantic validation, raw/canonical identity split and negative tests exist. Hosted contracts are schemas only; complete contract/conformance matrix and final review remain. |
| T1-2 policy | `in_progress` | WP3-01 `in_progress` | Deterministic target/bundle reducer with precedence tests; needs final purity/boundary review and policy contract audit. |
| T1-3 toolchain/boundaries | `done` | WP3-02 `in_progress` | One host package; import negative fixtures; final typecheck/lint/boundary suite passes. Missing-config tests exist; full package/run composition acceptance remains. |
| T1-4 registry | `in_progress` | WP3-03 `in_progress` | Six ecosystem tuples registered; new records use `provenLevel=none`; unsupported lookup tests. |
| T1-5 adapter L1 | `in_progress` | WP3-03 `in_progress` | Native positive/negative tests pass for TypeScript, Python, Java and PHP. JVM Kotlin, Go and .NET native extraction blocked. Java+Kotlin requirement for JVM L1 is therefore not complete. |
| T1-6 runner | `in_progress` | WP3-04 `in_progress` | Runner profile, guest plan, oracle mount checks, cleanup/quarantine tests; Docker native container probes 6/6. Container-only is not VM/microVM equivalence; required guest isolation qualification not met. |
| T1-7 dependency broker | `done` | WP3-04 `in_progress` | Broker allowlist/pinning/install-script/lockfile-drift unit tests pass. Native acquisition/build-sandbox proof remains missing, so full WP3-04 is not complete. |
| T1-8 graph | `in_progress` | WP3-05 `in_progress` | Deterministic detector/analyzer/graph tests pass for preserved unknowns, resolution classes, dangling refs, scope denominator, and API/data/event/dependency/config normalization. Full extraction acceptance matrix remains. |

## Verification results

Latest recorded checks at report drafting time:

| Check | Command | Result | Scope / limitation |
|---|---|---|---|
| Strict TypeScript | `pnpm typecheck` | exit 0 | Static typecheck only. |
| Lint + boundaries | `pnpm lint` | exit 0 | ESLint + dependency-cruiser; 42 modules / 95 dependencies, zero boundary violations. |
| Unit/integration tests | `pnpm test` | exit 0, **187 tests / 13 files** | Full current test suite. |
| Adapter conformance | `pnpm test:adapters` | exit 0, **25 tests / 2 files** | Native extraction uses actual TypeScript compiler API, Python 3.10 `ast`, Java 21 `javac`, and PHP 8.5 tokenizer over temporary synthetic fixtures. It does not certify L3 or customer capability. |
| Graph tests | `pnpm test:graph` | exit 0, **13 tests / 1 file** | Pure/fixture tests; not a real customer graph or gate proof. |
| Dependency broker | `pnpm test:dependencies` | exit 0, **10 tests / 1 file** | Unit tests; no package download/install/build was performed by the broker. |
| Runner security tests | `pnpm test:security` | exit 0, **14 tests / 1 file** | Contract-level tests, not native VM qualification. |
| Native runner probes | `pnpm test:runner-security:native` | exit 0, **6/6 denial probes** | Real Docker Desktop 29.0.1 runtime, `alpine:3.20`; boundary class `container_only`. Does not pass VM/microVM-equivalent qualification or public readiness. |

**Mock/pure:** contracts, policy, broker and graph checks are local unit tests; they are not acceptance
for real hosted dependencies.  
**Native:** adapter tests execute installed language parsers/toolchains; runner probes execute real
Docker containers. Both are constrained synthetic fixtures, not customer applications, pilots, or
cross-tenant hosted tests.

## Toolchain identities and environment blockers

| Component | Observed state | Consequence |
|---|---|---|
| Node | `26.12.1`; pinned exactly in `.node-version` and package `engines` | Matches the version used to develop this project. |
| pnpm | `12.5.1` | Locked host package manager. |
| Java/JDK | `javac 21.0.12.1`; Maven `3.10.0` available | Java L1 native fixture tests ran. |
| Python | `3.10.0` | Python AST fixture tests ran. |
| PHP | `8.5.12` | PHP tokenizer fixture tests ran. |
| Go | absent | Go L1 positive/negative native cases `blocked`; no simulated pass. |
| .NET SDK | absent | .NET L1 positive/negative native cases `blocked`; no simulated pass. |
| Kotlin compiler | `kotlinc` absent | JVM requires at least one Java **and** one Kotlin L1 case; JVM L1 is therefore incomplete. |
| Docker Desktop | server `29.0.1`; Docker Desktop backend reports `containerized` | Six real container probes passed. WSL2-hosted per-job status was not independently confirmed in this check. Boundary remains container-only and unqualified for public execution. |
| PostgreSQL client | `psql` absent | Record as upcoming WP3-21 readiness blocker; not a phase-1 dependency. |

## Decision records

- `docs/decisions/phase1-scope-and-root.md` — application root and no cross-directory source reuse.
- `docs/decisions/phase1-toolchain-pins.md` — exact Node `26.12.1` and toolchain identities.
- `docs/decisions/phase1-isolation-boundary.md` — `container_only` boundary and pilot-only/public-readiness restriction.

## Missing checks and blockers

1. **Required VM/microVM or proven-equivalent boundary:** not available on Windows 11 Home in this
   session. Docker container probes are useful native evidence but do not satisfy public hosted
   isolation. Public readiness is withheld; WP3-04 remains `in_progress`/blocked for this criterion.
2. **Go, .NET and Kotlin toolchains absent:** six ecosystems are registered, but Go/.NET and Kotlin
   L1 native positive+negative extraction is not proven. WP3-03 remains `in_progress`.
3. **Final verification:** completed after the latest source/config edit; the command log below records
   the actual current suite and exit codes. Re-run after any subsequent edit.
4. **Native dependency broker acquisition/install sandbox:** no registry resolution, artifact download,
   or isolated build/install probe has been run. Broker unit tests do not replace that check.
5. **Trusted dependency lockfile creation:** current broker creates a structured lockfile contract;
   integration with a real immutable artifact resolver and lockfile writer has not been proven.
6. **G3-08/G3-10:** blocked without authorized publication repository and organic pilot/owner access.

## Final command log

Commands were run against the final source/configuration before this report was written.

| Command | Exit | Notes |
|---|---:|---|
| `node --version` | 0 | `v26.12.1`; matches exact `.node-version` and `engines` pin. |
| `pnpm --version` | 0 | `12.5.1`. |
| `pnpm typecheck` | 0 | Strict TypeScript check. |
| `pnpm lint` | 0 | ESLint + dependency-cruiser; 42 modules / 95 dependencies, zero violations. |
| `pnpm test` | 0 | 187 tests / 13 files. |
| `pnpm test:adapters` | 0 | 25 tests / 2 files; native fixtures for TypeScript, Python, Java and PHP. |
| `pnpm test:graph` | 0 | 13 tests / 1 file. |
| `pnpm test:dependencies` | 0 | 10 tests / 1 file. |
| `pnpm test:security` | 0 | 14 tests / 1 file. |
| `pnpm test:runner-security:native` | 0 | 6/6 denial probes on Docker Desktop 29.0.1; `boundaryClass=container_only`. |
| `go version` | 127 | `go` executable absent. Go L1 blocked. |
| `dotnet --version` | 127 | .NET SDK absent. .NET L1 blocked. |
| `kotlinc -version` | 127 | Kotlin compiler absent. Kotlin L1 blocked; JVM L1 requires both Java and Kotlin. |

## Next dependency-ready task

**Completed in this phase:** T1-7 broker implementation and tests; T1-8 detector/analyzer/graph implementation and tests; final local verification re-run after report changes (typecheck/lint/test/native probes all exit 0).

**Next dependency-ready tasks:** (1) complete the WP3-05 acceptance matrix beyond the implemented
normalised-change fixtures; (2) resolve Go/.NET/Kotlin toolchain blockers if authorized; (3) obtain a
qualified VM/microVM-equivalent runner; and (4) run native dependency acquisition/build-sandbox
proof. The existing container probes do not satisfy that runner requirement. Reassess phase status
after those checks. Do not start phase-2 automatically.
