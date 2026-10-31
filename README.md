# ChangeProof AI 1.0

ChangeProof AI investigates, fixes, and **independently verifies the impact of software changes** across languages, frameworks, databases, events, caches, and repositories.

This repository is open for development contributions. The hosted customer experience described in the specifications is a product target, not a claim that those hosted features are already available.

```text
intent / issue
  → impact graph
  → diagnosis
  → candidate bundle (coordinated patches)
  → real execution
  → independent verification
  → immutable evidence
  → evidence-based PR
  → outcome validation by the owner
```

**Unit of value:** *a business workflow restored with evidence* — not files changed, languages detected, tool calls made, or a convincing demo.

When the evidence is insufficient, the product must still return a diagnosis, explicit obstacles, and the next safe step. Obstacles are never disguised as success.

---

## Table of contents

- [Why it exists](#why-it-exists)
- [Golden rules](#golden-rules)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Stack](#stack)
- [Contributing and local setup](#contributing-and-local-setup)
- [Commands](#commands)
- [Testing](#testing)
- [Documentation map](#documentation-map)
- [Work order and phases](#work-order-and-phases)
- [Current status](#current-status)
- [License](#license)

---

## Why it exists

A software change rarely stays inside the file that was edited. It crosses service boundaries, schemas, event payloads, cached shapes, and version mix — and the damage usually shows up later, somewhere else.

ChangeProof AI makes that blast radius **explicit, then proven**:

| It does | It refuses to do |
| --- | --- |
| Build an impact graph with explicit edge confidence: `proven`, `inferred`, `unresolved` | Silently promote `inferred` to `proven` |
| Produce a candidate bundle of coordinated patches | Publish a PR backed only by plausible narrative |
| Run real compilers, servers, databases, brokers, browsers | Fall back to mocks or cached green results |
| Evaluate each evidence dimension separately | Average dimensions into one confidence score |
| Keep the model out of the verdict | Let the model grade its own work |

### Status vocabulary (exact — do not invent synonyms)

| Concept | Values |
| --- | --- |
| `origin` | `controlled_change` · `historical_organic` · `current_organic` |
| `executionMode` | `mock` · `replay` · `real_runtime` |
| `proposalMode` | `live_model` · `replay_model` · `human_reference` |
| `TargetOutcome` | `fixed` · `no_impact_verified` · `unverified` · `partial` · `failed` |
| `BundleAssessment` | `verified` · `incomplete` · `blocked` · `invalid` |
| Support level | `L1` discovery/impact · `L2` candidate patch + guard · `L3` full proof |
| Engineering task status | `not_started` · `in_progress` · `blocked` · `done` |

Engineering task status is **separate** from the product verdict. They never mix.

---

## Golden rules

1. **The model never determines the verdict.** Verdicts come only from deterministic policy over verifier evidence.
2. **Protected oracle and intent are untouchable** by the candidate/agent, frozen before the run, mounted only on the verifier, outside the candidate workspace.
3. **Real execution for acceptance.** Any gate claiming coverage of build, server, database, broker, or browser must use the real thing.
4. **Target proof ≠ bundle proof.** One green repo does not establish cross-system success.
5. **Evidence dimensions are not averaged.** A failed or inconclusive required dimension withholds assurance even when functional tests are green.
6. **One green result is not proof.** Intermittent classes require a pre-registered campaign with a frozen `n`, schedule, fault, and workload.
7. **Honest capability.** Capability = tuple *(ecosystem, framework, version, feature, change type)* + evidence. `targetLevel` is separate from `provenLevel`; new records start at `provenLevel = none`.
8. **Fail closed.** Missing tool, credential, config, or budget → a specific actionable error, never a silent default.
9. **Source, logs, READMEs, and model output are untrusted data,** never instructions. Prompt injection in a customer repo must not change product behavior.
10. **Absolute tenant isolation.** Every access checks *current* grants; an opaque ID, signed URL, or audit ID is not permission.
11. **Customer code never executes on the host/control plane** — only in a per-job guest VM/microVM, or a proven equivalent boundary.
12. **No secrets reach guests, tools, browsers, logs, or analytics.**
13. **Idempotency and fencing for every external effect.** At-least-once queues; a job that loses its lease cannot write results. No exactly-once claims.
14. **Budget is never reset** by retry, resume, or cancel.
15. **Never move the oracle, budget, support level, or threshold to let the assessed candidate pass.**
16. **No dangerous operations without explicit session authorization** — paid API calls, external repo changes, production deploys, destructive operations, payments, outbound messages.

---

## Architecture

**TypeScript modular monolith.** One package, one reasoning engine, one change representation, one policy engine. Framework knowledge lives only in adapters. Process roles — web/API, coordinator/dispatcher, trusted worker supervisor — come from the same codebase. No microservices, no per-problem AI engines.

```text
changeproof/
├── src/
│   ├── core/            contracts (versioned Zod), ports, errors — imports NOTHING internal
│   ├── modules/
│   │   ├── detector     change + stack discovery
│   │   ├── adapters/    registry · typescript · python · jvm · go · php · dotnet · native
│   │   ├── analyzer     per-adapter analysis
│   │   ├── graph        impact graph, edge confidence
│   │   ├── policy       pure verdict rules (no I/O, no model, no clock)
│   │   ├── verifier     independent proof, campaigns, oracles
│   │   └── dependencies typed dependency capabilities + trusted resolver
│   └── orchestrator/    composition root — the only place importing every module's public API
├── config/  fixtures/  tests/  bench/  infra/  docs/  runs/   (runs/ is gitignored)
├── .prepare/            BRD · PRD · MVP · architecture  (specification package)
├── phases/              phase-1 … phase-7 playbooks + hackathon-slice
├── scripts/             native runner security probes
└── .template-ui/mockup.html          UI design source (~1.1 MB, embedded fonts)
```

### Boundary rules — enforced by `dependency-cruiser`, ESLint, and prohibited-import tests

- Each module exposes **one public `index.ts`**. No deep imports, no cycles, no re-export escapes.
- **Leaf modules import only `core`.** Cross-module collaboration goes through **ports defined in `core`**; `orchestrator` wires the implementations.
- `http`, `workers`, and `cli` import `core` + `orchestrator` only. The browser imports only browser-safe contracts from `core` plus the HTTP API — never DB/model credentials or authority modules.
- **`policy` is pure:** no I/O, no model, no clock or environment reads, no framework-specific rules.
- Adapters are **not** plugins loaded from untrusted repos; sources are reviewed, versioned, and registered in trusted config. Adapters implement `detect, extract, analyze, planFix, applyPatch, verify` — they do **not** own the final verdict.
- Contracts crossing modules are **validated plain data**, never AST objects or runtime handles. Raw-byte hashes are distinguished from canonical structured identity.
- Adding an adapter or framework must never change verdict rules.

### Ownership summary

- `observability` → facts and quality gaps (never verdicts or causes)
- `agent` → hypothesis ledger
- `verifier` → experiments; the coordinator validates them
- `policy` → precomputed dimension facts + validity + config identity only

Telemetry correlation, causal hypotheses, and independent proof have **different owners** — do not merge them.

### Trust boundary

Customer application code runs in an isolated guest per job. Egress is closed by default; supervisor-allowlisted internal service-to-service traffic is permitted. Model, GitHub, and payment access go through brokers — never direct to guests. The **oracle is frozen before the run and mounted only on the verifier**, outside the candidate workspace.

---

## Repository layout

| Path | Governs |
| --- | --- |
| `.prepare/BRD.md` | Business goals, `BR3-01..25`, priorities, service model — *why* |
| `.prepare/PRD.md` | Behavior, `FR3-01..45`, `NFR3-01..15`, `DEC3-01..23`, data contracts — *what* |
| `.prepare/MVP.md` | Scope, capability matrix, `WP3-01..34`, gates `G3-01..17`, `NEG3-01..40`, `SC3-01..11` — *when done* |
| `.prepare/architecture.md` | Module structure, import matrix, hosted topology — *where and how constrained* |
| `.template-ui/mockup.html` | UI **design source**, not implementation evidence |
| `AGENTS.md` | Working contract for every AI agent in this repository |
| `SKILL.md` | Step-by-step playbook + requirement index (`changeproof-development`) |
| `phases/phase-N.md` | Execution playbooks for the active full release |
| `docs/decisions/` | Decision records; schemas and policies are versioned from the start |

Required reading order for new work: **BRD → PRD → MVP → architecture → a dependency-ready work package.**

Conflicts between documents are *not* guessed at: record the conflict and resolve it in all four documents before implementing anything that depends on it.

> **All specification content is a TARGET.** Capabilities, figures, and gates in the spec package are specification targets, not claims of implementation. Before saying anything "already exists", verify it in the actual repo by reading source and running commands.
>
> Four completion principles:
>
> 1. Code exists ≠ capability proven.
> 2. Mock/replay pass ≠ real-system success.
> 3. Local target pass ≠ coordinated bundle verified.
> 4. Controlled runtime success ≠ organic user impact.

---

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | **TypeScript** (`strict`) | single language for engine, API, workers, CLI |
| Runtime | **Node.js 26.12.1** | pinned in `.node-version` / `engines` |
| Package manager | **pnpm 12.5.1** | pinned via `packageManager` |
| Validation | **Zod 4.6.7** | versioned contracts in `src/core/contracts` |
| Module format | **ESM** (`"type": "module"`) | |
| Unit/integration tests | **Vitest 5.0.5** | suites split per concern |
| Lint | **ESLint 10.13.0** + `@eslint/js` + `typescript-eslint 8.71.2` | flat config in `eslint.config.mjs` |
| Architecture lint | **dependency-cruiser 18.6.0** | rule set in `.dependency-cruiser.cjs` |
| Build | **`tsc -p tsconfig.build.json`** | no bundler in the engine |
| Authoritative state (target) | **PostgreSQL** + private content-addressed object storage | local JSON is not hosted authority |
| GitHub integration (target) | **Octokit** behind a broker | no customer credentials in guests |
| Language toolchains (target) | pinned natively per adapter (ts-morph for TS, native CLIs elsewhere) | interface stays language-neutral |
| UI | `.template-ui/mockup.html` → `apps/dashboard`, `apps/trace-viewer` (phase-6) | Inter + Plus Jakarta Sans, self-hosted WOFF2, SIL OFL 1.1 |

Workspaces, HTML framework, and database driver arrive with their work packages; nothing is added speculatively.

---

## Contributing and local setup

Thanks for helping develop ChangeProof AI. This repository is under active development. Product features described in the specifications are targets, not promises that they are already implemented or ready for customer use.

### Requirements

- Node.js `26.12.1` (pinned in `.node-version`)
- pnpm `12.5.1` (pinned in `package.json`)
- Git, to create a branch and submit a pull request
- Native toolchains only when working on the adapter or runner that needs them. Check that work package's playbook first; missing tools must be reported, not silently replaced with mocks.

On Windows, install Node.js `26.12.1` with nvm-windows or Volta. Then open a terminal in the project and activate the pinned pnpm version with Corepack:

```powershell
corepack enable
corepack prepare pnpm@12.5.1 --activate
node --version
pnpm --version
```

If `corepack enable` reports permission denied, reopen PowerShell as Administrator for that command. Expected versions are `v26.12.1` and `12.5.1`.

### Clone and install

Use the repository URL your team shared with you:

```powershell
git clone <repository-url>
cd ChangeProof-AI
pnpm install --frozen-lockfile
```

For an existing checkout, skip `git clone` and run `git pull` from the project folder before `pnpm install --frozen-lockfile`.

### Verify your setup

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

The `pnpm verify` shortcut runs those same checks in sequence. In the checkout used to update this README, typecheck and lint passed, while the test suite reported 187 passed and 4 failed adapter tests. Run the checks yourself and compare against the latest [phase report](docs/phase-reports/phase-1.md); do not attribute an existing failure to your change without checking its baseline.

### Run the project

This checkout does not yet have an application server, CLI, or dashboard entry point, so there is no `pnpm dev` command to launch a user-facing app. To run the code that exists today, use the build and test commands from the project root:

```powershell
pnpm build          # compile TypeScript into dist/
pnpm test           # run the test suite once
pnpm test:watch     # rerun tests as files change
```

To run the native runner security probes, install and start Docker Desktop first, then run:

```powershell
pnpm test:runner-security:native
```

That command exercises runner security probes; it does not launch the product UI or qualify a VM/microVM boundary.

### Open the project in VS Code

Open the repository folder in VS Code and use its integrated terminal for these commands. The project does not currently define a required extension list or editor launch setup.

### Native tools

The base install does not require every language toolchain. If your task runs native adapter tests or runner security probes, follow the relevant phase playbook and install its pinned tools first. Missing native tools are blockers to report, not a reason to count skipped checks as passing.

### First contribution

1. Read `AGENTS.md` and `SKILL.md` for the working rules, task format, and negative-case index.
2. Read `.prepare/BRD.md`, `.prepare/PRD.md`, `.prepare/MVP.md`, then `.prepare/architecture.md` in that order.
3. Pick a dependency-ready task from the MVP work-package dependency graph. Do not pick by WP number alone. The current next task recorded in the phase report is WP3-01; verify [the latest report](docs/phase-reports/phase-1.md) before starting because task status can change.
4. Before changing code, write down the task scope, requirement IDs, expected behavior, failure cases, and proof checks using the task header in `AGENTS.md`.
5. Add or update positive and negative tests, make the smallest change that meets the task, then run the checks for the affected area and `pnpm verify`.
6. In your pull request, summarize the behavior changed, tests and commands run with results, remaining limitations, and any contract or decision record changes. Never present mock/replay success as real-runtime proof.

Do not add credentials or `.env` files to commits. Do not run paid API calls, change external repositories, deploy to production, send external messages, or perform destructive actions without explicit authorization for that action.

### Current verification status

At the time this README was updated, `pnpm verify` was **not green** in this checkout: typecheck and lint/boundary checks passed, but 4 adapter tests failed across `capability-catalog.test.ts` and `go-dotnet-extraction.test.ts` (187 passed, 4 failed). Treat this as a known baseline issue, not as a failure caused by your contribution. Re-run verification on your checkout and report the current output; this status may become stale as the failures are fixed.

### Reading before coding

1. `AGENTS.md` — the working contract and non-negotiable golden rules.
2. `SKILL.md` — development playbook and requirement index, including negative cases and UI guidance.
3. `.prepare/BRD.md` → `PRD.md` → `MVP.md` → `architecture.md`.
4. One dependency-ready work package from MVP §8, selected by the dependency graph.

---

## Commands

Actual scripts from `package.json`:

| Category | Command | What it runs |
| --- | --- | --- |
| Build | `pnpm build` | `tsc -p tsconfig.build.json` |
| Typecheck | `pnpm typecheck` | `tsc --noEmit -p tsconfig.json` (strict) |
| Lint | `pnpm lint` | `eslint .` **and** `depcruise --config .dependency-cruiser.cjs src` |
| Lint only | `pnpm lint:eslint` | ESLint alone |
| Boundaries only | `pnpm lint:boundaries` | dependency-cruiser alone |
| All tests | `pnpm test` | `vitest run` |
| Watch | `pnpm test:watch` | `vitest` |
| Contracts + policy | `pnpm test:unit` | `tests/contracts`, `tests/policy` |
| Architecture | `pnpm test:architecture` | `tests/architecture` |
| Adapter conformance | `pnpm test:adapters` | `tests/adapters` |
| Impact graph | `pnpm test:graph` | `tests/graph` |
| Dependency capabilities | `pnpm test:dependencies` | `tests/dependencies` |
| Security | `pnpm test:security` | `tests/security` |
| Native runner probes | `pnpm test:runner-security:native` | `node scripts/runner-security-probes.mjs` |
| Full verification | `pnpm verify` | `typecheck && lint && test` |
| Cleanup | `pnpm clean` | removes `dist/` |

Report **mock and native results separately**, always with command + exit code. A check that was not run is recorded as a *missing check* — never silently skipped.

---

## Testing

| Family | Minimum |
| --- | --- |
| Contract / conformance | malformed adapter result, unknown version, incorrect capability promotion, dangling refs |
| Policy | stale+pass · full pass+unknown · partial+invalid oracle · target pass+edge fail · mixed candidates |
| Runtime security | secret/socket/network/path escape, malicious dependency script, cross-run access, cleanup failure |
| Real system | native build, actual migration, browser/API flow, event consumer, data reconciliation |
| Negative remediation | fabricated endpoint, revert intent, delete assertions, fake health success, wrong amount/tenant |
| Recovery | compile fail → new hypothesis · repeated candidate · infra outage · bounded retries · crash/resume |
| Publication | duplicate retry, one PR fails, head drift, inaccessible evidence, CI mismatch |
| Certification | version/capability mismatch, unsupported feature, invalidation after changes |

Hard rules:

- No acceptance passes because a file exists or a text snapshot matches.
- Unit mock/replay is allowed for development, **never** for acceptance gates.
- Hosted tests use **concurrent tenants** (RLS + pooling context reset), not a single tenant.
- The full `NEG3-01..40` list lives in `SKILL.md#ref-negative-cases`; cover the ones relevant to your scope.

---

## Documentation map

| Document | Says |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Contract, golden rules, boundaries, DoD, anti-patterns |
| [`SKILL.md`](SKILL.md) | Playbook, requirement index, UI mockup guide, negative cases |
| [`phases/phase-1.md`](phases/phase-1.md) … [`phase-7.md`](phases/phase-7.md) | The seven execution playbooks of one complete release |
| [`phases/hackathon-slice.md`](phases/hackathon-slice.md) | Competition vertical slice — **not** a release phase |
| [`docs/phase-reports/`](docs/phase-reports/) | Per-phase proof: commands, exit codes, artifacts, blockers |
| [`docs/decisions/`](docs/decisions/) | Decision records, schema/policy versions, license notice |
| [`docs/phase-plan-revision.md`](docs/phase-plan-revision.md) | Plan revision 2 |
| [`.template-ui/mockup.html`](.template-ui/mockup.html) | UI design source (design tokens extracted to one source; layered `!important` skins are not copied) |

**Runtime UI language is English** (FR3-40): Indonesian specification documents do not imply an Indonesian UI.

---

## Work order and phases

One complete release — **no feature is deferred to a later phase.** Missing access, budget, vendor, or license decisions become *specific blockers*, never reasons to cut scope.

Seven playbooks (phases 1–5 back-end, 6 front-end from the mockup, 7 whole-system qualification), invoked by `phase-1` … `phase-7` (also `jalankan` / `lanjut` / `resume`). Work order follows the **work-package dependency graph**, not the calendar.

```text
Engine:  WP3-01 → 02 → 03/04 → 05 → 15 → 16 → 17 → 06 → 07 → 08/09 → 10 → 11 → 12/18 → 13
Hosted:  WP3-21 → 22 → 23 → 24 → 25 → 26 → 14        (plus engine deps per row)
Final:   WP3-14 waits for 12, 13, 19, 20, 26, 31, 32, 33, 34; 19/20 must land before release
Gates:   G3-01 … G3-17   (missing pilot repo access → G3-08/G3-10 = blocked, not passed)
```

A phase completes only **its** allocated tasks with proof. A work package is done only with **all** original prerequisites and acceptance. No automatic next phase follows from a phase prompt — and no paid API call, external publication, message, payment, or production deployment authority is implied by one.

### Task header (required)

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

### Definition of done

- [ ] Observable outcome, proven by checks **actually run** (command + exit code recorded)
- [ ] Positive **and** negative/failure-path tests exist and pass; native checks run where scope touches real execution
- [ ] Boundaries (dependency-cruiser/ESLint) and strict typecheck clean
- [ ] No silent mock fallback, no disguised skipped checks, no model-generated statuses
- [ ] Affected schema/policy/contract versions bumped and recorded
- [ ] Limitations and missing checks reported

**Not done** on: scaffolding, available interfaces, mocked integrations, skipped native checks, matching text snapshots, model-generated statuses, or gates "passing" because of demo data.

---

## Current status

Honest snapshot of the repository — verify anything you intend to rely on:

**Present**

- TypeScript source and toolchain: strict `tsc`, ESLint, dependency-cruiser boundary rules, Vitest suites (`contracts`, `policy`, `architecture`, `adapters`, `graph`, `dependencies`, `security`, `orchestrator`).
- `src/core/contracts`, `src/core/ports`, `src/core/errors`, `src/orchestrator`, and modules for `detector`, `analyzer`, `graph`, `policy`, `verifier`, `dependencies`, and language adapters.
- Specification package in `.prepare/`, phase playbooks in `phases/`, decision records in `docs/decisions/`.
- Latest verification run in this session: typecheck passed; lint and boundaries passed; tests 187 passed and 4 failed. The full `pnpm verify` exited 1.

**Not present / not claimed**

- `src/http`, `src/workers`, `src/cli`, `apps/dashboard`, `apps/trace-viewer` — landing in their work packages (phase-6 owns the front-end).
- PostgreSQL/object-storage wiring, GitHub App integration, hosted job pipeline.
- Hosted gates, pilot repository access, and `G3-08`/`G3-10` evidence.
- Measured SLOs, cost, performance, adoption figures — **none have been measured**.

Publishing `verified` bundle results, or reporting any figure the specification lists as a target, requires live proof on the real system first.

---

## License

Declared in `package.json` as `SEE LICENSE IN docs/decisions/`. Report the exact license status from `docs/decisions/` before redistribution — no license has been chosen by assumption here.

Bundled fonts **Inter** and **Plus Jakarta Sans** are **SIL Open Font License 1.1**, self-hosted with zero external requests, license notices embedded in `.template-ui/mockup.html` under `changeproof-source-assets`.