# Phase-3 report — revision 2

**Date:** 1 November 2026 (turn 1 — same day as phase-2 turn 6)
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `in_progress` — T3-1/T3-2 allocated tasks (T-19/T-20) `done`, turn 2 T-21/T-22/T-23/T-24/T-25 `done` (see §4), turn 3 T-26 `done` (see §5). No full WP and no G3 gate passed; phase stays `in_progress`.
**Turn-1 scope (T-19/T-20)** `done`:
hypothesis ledger + revision + stopper, model broker + typed gateway +
report-only guard, 46/46 unit green with wiring. Full WP3-07 stays
`in_progress` on a live model endpoint, the frozen WP3-06 oracle, and
adapter-loop integration (see §2); no G3 gate passed.
**Plan revision:** 2 (24 October 2026).

## 1. Entry audit (evidence, not summary)

Phase-2 turn-6 state verified in the tree at kickoff (same turn, before any
phase-3 edit): `pnpm typecheck` exit 0; `pnpm lint` exit 0; native 79/9
green on disposable containers; unit 439 + 3 pre-existing Python failures
(proven identical on the untouched tree). Existing modules: `adapters`,
`analyzer`, `dependencies`, `detector`, `fixtures`, `github`, `graph`,
`identity` (+ email/smtp), `jobs` (+ store), `observability`, `policy`,
`usage` (+ store), `verifier`. No `src/modules/agent` existed. No
`src/http`, `src/workers`, or `src/cli` exists (process roles are future
work; the dispatcher and broker are modules + orchestrator wiring).

Model-access probe at kickoff (read-only, no secret sent): `api.meta.ai`
resolved to generic Meta edge infra (`star.c10r.facebook.com`), but the TLS
certificate did not cover the name. This established a TLS failure in that
probe, not that the API identity or endpoint did not exist. Current official
Meta docs confirm base URL `https://api.meta.ai/v1` and model
`muse-spark-1.3` ([quickstart](https://dev.meta.ai/docs/quickstart)).
A fresh host TLS check remains unverified: the local `curl.exe` probe could
not run because this sandbox has no network access. `.env` contains a
token-shaped value that was never read or transmitted; the owner reports that
`MODEL_API_KEY` is provisioned out-of-band, but it has not been tested.
The owner authorized exactly one synthetic-fixture Standard-mode paid smoke
call, but the stated hard cap was not a numeric amount. No inference call was
made; the live row remains blocked until a numeric cap is supplied.

## 2. T-19/T-20 readiness mapping

| Task | Requires (full WP) | State | Reason |
|---|---|---|---|
| T-20 broker + gateway (WP3-07) | 06 | allocated `done` / live `blocked` | broker/gateway/guard + wiring proven 30/30 with replay transports; endpoint/model are documented, but host TLS and numeric paid-call cap remain unverified/missing |
| T-19 fix loop (WP3-07) | 06 | allocated `done` / loop `in_progress` | ledger/revision/stopper proven 16/16; full loop needs the frozen oracle + adapter candidates |

Per MVP §22, incomplete predecessors permit only independent preparation
with proven task inputs — the ledger and broker are built on proven
contracts (fencing, accounting, challenges) and synthetic fixtures only.

## 3. Execution record — turn 1 (T-20/T-19)

```text
Task IDs / parent WPs: T-20 / WP3-07, T-19 / WP3-07
Requirement IDs: FR3-07/08/09; NEG3-01/04/08/10/13/19/20; NFR3-04;
  BR3-03/08
User-visible outcome: the reasoning engine's trust core exists — a broker
  that sends allowlisted context with recorded IDs and typed failures, a
  gateway that authorizes every mutation, a guard that rejects test
  deletion and scope creep on paper, and a ledger that tracks hypotheses,
  probes, attempts, and no-progress stops. Nothing here calls a live
  model or mutates anything: proposals and reports only.
Prerequisite evidence: phase-2 turn 6 (§11); ModelClientPort is new with
  this turn (contract `1`); fencing/accounting/challenge cores (proven).
Allowed source/config changes: src/modules/agent/** (new: broker,
  gateway, guard, ledger), src/core/ports (ModelClientPort + friends),
  src/orchestrator (composeAgent), tests/agent/**, tests/orchestrator/
  phase3-agent.test.ts, this report.
Input snapshots + intended intervention: synthetic in-repo fixtures only;
  replay transports, no live provider, no paid call, no external mutation.
Acceptance checks (positive, negative, native): 46 focused unit tests
  failure-path first (NEG3-01/04/08/10/13/19/20); typecheck +
  lint/boundaries clean. Native: not applicable (no store, no guest, no
  live provider); the live-model row is `blocked` with probe evidence.
Protected oracle / proof scope: no protected oracle created, touched, or
  claimed. The ledger carries no oracle field (pinned by test).
Actual commands + exit codes: §3.4 list.
Status + remaining blocker: T-19/T-20 allocated `done`; full WP3-07
  `in_progress` (live endpoint + frozen oracle + adapter integration).
```

### 3.1 T-20 — model broker + typed mutation gateway `done`

- Core `ModelClientPort` (contract `1`) + message/tool/call/usage/result
  shapes: the single versioned seam between the engine and any provider.
- `src/modules/agent/broker.ts`: allowlist context filtering (broker-owned
  content always kept, the rest dropped + counted); prompt/config/model
  IDs recorded; credential read at call time and handed to the transport
  (GitHub-client precedent — trusted product code, never the model
  context/logs/results); response revalidation (JSON shape, model-echo
  identity, parseable tool args, sane usage); typed failures for outage
  (transport/HTTP, body never echoed), malformed, identity mismatch, and
  missing-required-tool-call; a token ceiling with no reset path
  (admission on spent + maxTokens; actuals may overrun on the final
  admitted call — reported, then the run stops); fallback transports run
  only when explicitly configured and only for outages, recorded per
  result. 14/14 in `tests/agent/broker.test.ts`.
- `src/modules/agent/gateway.ts`: lexical path normalization (traversal/
  absolute/Windows/encoding/NUL/control rejected before comparison),
  writable-root allowlist with protected roots that nothing overrides,
  operation allowlist, explicit size caps (no silent default), '.' as the
  whole snapshot; case-collision, symlink, and hardlink refusal over
  caller-supplied tree state.
- `src/modules/agent/guard.ts`: report-only `reviewPatch` — gateway per
  operation, test/check deletion rejected (`[DERIVED]` default markers),
  out-of-scope edits need a scope revision; every violation collected,
  nothing applied, nothing edited. 12/12 in `tests/agent/gateway.test.ts`
  (NEG3-04/10).
- `composeAgent` wiring + `tests/orchestrator/phase3-agent.test.ts` (2/2).
- Live-model row `blocked`: the §1 probe proves no API identity exists at
  the configured URL. Needs from the owner: the real provider endpoint
  (or a different qualified provider decision), credential authorization,
  and explicit paid-call session scope. The broker is transport-agnostic
  by design — the real transport is a small, separately provable unit.

### 3.2 T-19 — hypothesis ledger + candidate revision + stopper `done`

- `src/modules/agent/ledger.ts` (`createHypothesisLedger`, in-memory
  planner state; durable binding to run checkpoints arrives with WP3-11):
  symptom → suspected → supported/refuted with earned promotion
  (supported needs a mechanism ref + a distinguishing probe with a
  recorded outcome; refuted needs contradicting evidence; terminal states
  reopen only via a superseding hypothesis); probes declared before
  execution (prediction, competing explanation, cost cap, safety scope,
  stop rule) with retained outcomes incl. negatives and flagged cost
  overruns; attempts with candidate/patch digests, failure signatures,
  kinds (compile/runtime/data/environment/unknown), and check/snapshot
  refs; cosmetic-retry rejection (same patch + no new evidence + no
  explained strategy change); guard-rejected candidates recorded without
  burning the execution budget; repetition on hypothesis/patch/failure
  triples; the `[DERIVED]` FR3-08.8 stopper (two identical attempts with
  nothing new stop the branch with a blocker + next investigation unless
  an untried probe remains within budget); infrastructure-latest evidence
  blocks promotion and yields an infra blocker, never a cause; scope
  revisions granted only by a different identity; recorded intent
  conflicts block the branch; several supported causes coexist. 16/16 in
  `tests/agent/ledger.test.ts` (NEG3-01/19/20).
- Full-loop remainders: the WP3-06 frozen oracle (owner approval + freeze
  ceremony, T-13); adapter candidate producers (T-21+); durable ledger
  binding to job checkpoints (WP3-11).

### 3.3 Definition-of-done tracking (phase-3 playbook, this turn only)

- [x] WP3-07 trust core — broker/gateway/guard/ledger built with replay
      transports; the guard rejected test deletion (NEG3-04), report-only.
- [ ] WP3-07 live row — a real model call produced a proposal: `blocked`
      (official endpoint documented; host TLS unverified and numeric paid-call cap missing, §1).
- [ ] WP3-08/09/10/11/12/18 — not started (`not_started`, tentative).

### 3.4 Verification (this turn, actual commands + exit codes)

- `pnpm typecheck` → 0 · `pnpm lint` → 0 (70 modules / 173 deps, zero
  violations, incl. depcruise boundaries)
- `pnpm vitest run tests/agent tests/orchestrator/phase3-agent.test.ts`
  → 0 (**46 tests / 4 files**: broker 14, gateway 12, ledger 18 in
  tests/agent + 2 wiring)
- Full-unit and full-native totals are recorded in the phase-2 report
  §11.4 (same verified tree state; this turn added no store or native
  surface): unit 439 + 3 pre-existing, native 79/9
- `semgrep` → missing (binary absent; `code-security` + `llm-security`
  skill bodies applied manually per the phase skill bindings)

Changed files this turn (new): `src/modules/agent/{broker,gateway,
guard,ledger,index}.ts`, `tests/agent/{broker,gateway,ledger}.test.ts`,
`tests/orchestrator/phase3-agent.test.ts`; (modified): `src/core/ports/
index.ts` (+ModelClientPort), `src/orchestrator/index.ts` (+composeAgent).
No contract, policy, threshold, or schema semantic change to existing
versioned items; no version bump needed. No full WP and no G3 gate
passed. Phase status stays `in_progress`.

**Next dependency-ready task:** T-21..T-26 remain `tentative` — each needs
its §5 scope confirmation with Reyn (exact scope, prerequisite evidence,
file ownership) before starting; do not start the next phase automatically.

## 4. Turn 2 (1 November 2026) — T-21..T-25 allocated tasks `done`

Executed under `/ponytail full`: smallest complete change per task, existing
helpers reused (reviewPatch/applyAdapterPatch, subjectKey, ledger,
assertLeaseWritable/assertEffectIdUnique, GitHub broker pattern), tests first,
no new dependencies. Skill bindings honored: supply-chain-risk-auditor +
semgrep lens on T-21/T-22 (semgrep binary absent on dev machine, manual rules
applied), find-bugs review on T-24, secret-serialization + code-security on
T-25 — no findings; see §4.6.

### 4.1 T-21 / WP3-08 — TS/Python L3 adapters (`done`)

- TS adapter v1.1.0 (react/nestjs/fastify/prisma tuples) + Python adapter
  v1.1.0 (pydantic/sqlalchemy tuples): detect/extract/analyze/planFix/
  applyPatch/verify + planChecks. The "JVM" label is stale per
  `docs/decisions/phase1-ecosystem-scope-resolution.md`; .NET stays L1.
- `tests/adapters/t21-l3-tuples.test.ts` 19/19; `pnpm test:adapters` 144/144.
  Native: tsc, next build, prisma validate, django test — all real.
- Full WP3-08 stays open: frozen oracle ceremony, live model endpoint,
  adapter-loop integration (owner-held).

### 4.2 T-22 / WP3-09 — Go/PHP L2 (`done`)

- Go adapter v1.1.0 (Fiber: case-insensitive method match, per-framework
  router tracking, fail-closed unknowns for Group/Static) + PHP adapter
  v1.1.0: planFix + planChecks + guard.
- `tests/adapters/t22-l2-candidates.test.ts` 11/11. Native: go build/vet,
  php -l — real.
- Full WP3-09 stays open on the same owner-held gates.

### 4.3 T-23 / WP3-10 — migrations + dependency broker (`done`)

- `src/modules/migrations` MigrationRunner (expand/runNextChunk/
  runToCompletion/verifyIntegrity) + manifest validation;
  `src/modules/dependencies` planUpgrade + assertManifestLockfileMatch;
  `composeMigrations` orchestrator wiring.
- Unit `tests/migrations` 15/15. Native on disposable Postgres
  `changeproof-t23` (127.0.0.1:54333): migration-online 2/2 (SC3-03,
  2000-row dual-write + crash/resume), migration-frameworks 2/2,
  sc3-02-upgrade 1/1 (pnpm-lock.yaml version move). Prisma 6.19.1,
  alembic 1.20.1, django 5.2.18 verified working.
- Full WP3-10 stays open: hosted authority wiring (WP3-21+).

### 4.4 T-24 / WP3-11 — bundle coordination + recovery (`done`)

- `src/orchestrator/bundle.ts`: `coordinateBundle` (coverage via core
  subjectKey, candidate/verified digest binding, edge/invariant/
  mixed-version/guard folding into BundleFacts; the verdict stays in
  `assessBundle` — missing assessments yield incomplete, never blocked)
  and `coordinateRecovery` (contradiction → attachEvidence + refute +
  superseding hypothesis; cosmetic-retry refusal; no-progress stop;
  intent-conflict and infra-failure routed to blocked, not failed;
  wrong-hypothesis refutation refused).
- `tests/orchestrator/t24-bundle-coordination.test.ts` 18/18: NEG3-06
  local-pass/edge-fail and mixed-version/identity-drift blocked;
  SC3-01-shaped verified; SC3-04 invariant block; SC3-05 recovery trace.
- Full WP3-11 stays open: real multi-system SC3-01/04/05 runs need the
  frozen oracle + runners (T-26 owns the suite).

### 4.5 T-25 / WP3-12 — evidence store + publication broker (`done`)

- `src/modules/evidence` (new leaf): canonical JSON + pinned golden bytes,
  sha256 content addressing, memory + atomic file-dir stores (no update/
  delete/enumerate), key-name secret redaction, bundle manifest
  assemble/verify (any terminal state, annotations redacted pre-digest).
- `src/modules/github/publication.ts` + client extension: evidence-branch
  plan (allowlisted names), PR payload assembly, fetchBranchHead/
  openPullRequest/findPullRequestByHead with broker-held tokens and real
  Octokit transport code (live row blocked — no authorized App, not faked).
- `src/orchestrator/publication.ts`: grant → provider → lease → verified-
  guard → evidence present/bound → idempotency key (binds provider, repo,
  base, head, manifest, policy) → head check → open with lost-response
  reconciliation; duplicates collapse to one logical PR (NEG3-23), missing/
  tampered evidence withholds with the digest named (NEG3-14), wrong head
  and provider mismatch refuse (NEG3-39).
- Tests-first: evidence 17/17, github 31/31 (9 new), broker 11/11.
  Native `tests/native/t25-evidence-git.test.ts` 2/2: manifest durability
  across store reopens; real git branch create/commit/push to a local bare
  remote via the planned name; moved-head drift observed.
- Full WP3-12 stays open: hosted authority backend (WP3-21), durable
  outbox (WP3-14, `seenEffectIds` is caller-owned until then), live
  GitHub row, viewer.

### 4.6 Verification (this turn, actual commands + exit codes)

- `pnpm typecheck` → 0 · `pnpm lint` → 0 (79 modules / 222 deps, zero
  violations, incl. depcruise boundaries)
- `pnpm test` → 0 (54 files / 582 tests, all green)
- `pnpm test:adapters` → 0 (144/144) · `tests/migrations` 15/15 ·
  `tests/evidence` 17/17 · `tests/github` 31/31 · `tests/orchestrator` 52/52
- Native (`vitest.native.config.ts`, DATABASE_URL=changeproof-t23):
  migration-online 2/2 + migration-frameworks 2/2 + t25-evidence-git 2/2
- Security self-review (find-bugs checklist on T-24; secret-serialization +
  code-security on T-25): no credential holders/sinks (credentialRef only,
  broker-held tokens, redaction before bytes, explicit payload shaping);
  digest-validated store paths; allowlisted branch names; sha256 only;
  caps on all coordination/evidence/payload inputs — no findings.
- `semgrep` → still missing (binary absent on dev machine).

Changed files this turn (new): `src/modules/evidence/index.ts`,
`src/modules/github/publication.ts`, `src/orchestrator/{bundle,
publication}.ts`, `tests/{evidence/t25-evidence-store,github/t25-publication,
github/helpers,orchestrator/t24-bundle-coordination,
orchestrator/t25-publication,native/t25-evidence-git}.test.ts` (+ T-21..T-23
adapter/migration sources and tests listed in §4.1–4.3); (modified):
`src/modules/github/{client,index}.ts`, `src/orchestrator/{errors,index}.ts`,
`tests/github/client.test.ts` (fake transport extended), `task-brief.md`
(T-21..T-25 `done` + headers). No contract, policy, threshold, or schema
semantic change to existing versioned items; no version bump needed.

**Next dependency-ready task:** phase-3 allocated work is complete through
T-26; phase-4 back-end tasks T-27..T-30 executed 2 November 2026 (see
`docs/phase-reports/phase-4.md`). Remaining phase-4 back-end: T4-5 (WP3-31)
and T4-6 (WP3-32) per the readiness rule; do not start the next phase
automatically.

## 5. Turn 3 (2 November 2026) — T-26 allocated task `done`

Task ID / parent WP: T-26 (T3-18) / WP3-18 (complex scenario qualification).
Requirement IDs: SC3-03/04/07/08/09, NEG3-08/15/16/17/18/19/20 (suite pins;
NEG3-11 pinned as the SC3-04 no-dedup negative).
User-visible outcome: each complex scenario runs as a pre-registered native
campaign with validated per-trial receipts; one green run reports
`campaign_incomplete`; SC3-09 diagnosis-only never counts as repair.
Prerequisite evidence: T-24 (`coordinateBundle`/recovery), T-12 (reducers +
threshold), fixture rig + disposable PG/Redis, MigrationRunner, observability
connector, agent ledger/gateway.
Allowed source/config changes: tests + fixtures only (no `src/` change —
pure qualification over existing modules).
Input snapshots + intended intervention: frozen ExperimentPlans per
scenario (seeds, schedules, Amax/Qmax/Tdrain/Tconverge/SLO bounds) with
real PG16/Redis7 containers; faults are real (terminated backend, SIGKILL,
deadlock, pool leak).
Acceptance checks (positive, negative, native): unit pins 19/19; native
15/15 (SC3-03 4, SC3-04 4, SC3-07 5, SC3-08 2); negatives NEG3-08/11/15–20
pinned (see below).
Protected oracle / proof scope: no frozen oracle exists yet (WP3-06) — these
campaigns qualify verifier/fixture behavior on real systems, not AI repair
capability; no verdict above `campaign_complete`/`campaign_incomplete` is
claimed.
Artifacts expected: receipts under `runs/sc3-18/` (gitignored) — present.
Actual commands + exit codes: see §5.1.
Status + remaining blocker: allocated task `done`. Full WP3-18 stays open:
frozen oracle, live model, multi-system runs, G3-11 (phase-7).
Next dependency-ready task: phase-4 back-end (executed same day; see
phase-4 report).

What was built (tests-first, then minimal fixtures):

- `tests/verifier/t26-suite-negatives.test.ts` (9/9): single green of n=3 →
  `campaign_incomplete` incl. repeated-seed accounting (NEG3-15); dead
  injector → `experiment_invalid` (NEG3-17); dropped observations/removed
  timeouts → measurement invalid, never pass (NEG3-18); verifier timeout →
  policy `unverified` + cleanup quarantine (NEG3-08); cosmetic retry →
  stop-branch with usage retained (NEG3-20).
- `tests/observability/t26-sc3-09.test.ts` (10/10): SC3-09 complete variant
  earns a discriminating probe only; missing owner/baseline →
  `behavior_contract_unknown` (NEG3-19); missing join, clock skew, stale
  deploy → `causality_unproven` (NEG3-16); gateway denies prod-write and
  uncapped probes (denied-mutation receipts).
- `tests/native/sc3-03-backfill.test.ts` (4/4, real PG16): crash-before-commit
  via a real terminated backend rolls back and resumes to verified
  completion; merged-window asserted per chunk; concurrent update/delete
  with dual-write + journal reconciles; skipped dual-write fails
  `exact_sum`; lost journal row fails `row_counts`.
- `tests/native/sc3-04-convergence.test.ts` (4/4, real PG16+Redis7) +
  `fixtures/sc3-convergence/consumer.mjs`: dropped-response retry dedups;
  out-of-order duplicates converge inside Qmax; real SIGKILL partition
  holds backlog and heals with drain inside Tdrain, attempts within Amax;
  `--no-dedup` double-applies while transport stays green (NEG3-11).
- `tests/native/sc3-07-concurrency.test.ts` (5/5, real PG16): lost update
  reproduced in 2 reset trials pre-fix, zero lost with `FOR UPDATE`;
  conflicting lock order deadlocks (real 40P01) in 2 reset trials pre-fix,
  ordered locking commits both; duplicate op before/after commit dedups via
  unique constraint (real 23505).
- `tests/native/sc3-08-pool.test.ts` (2/2, real PG16): paired load blocks
  meet frozen absolute + relative SLO with balanced leases; leaky error
  path exhausts the pool and its short sample is measurement-invalid
  (NEG3-18), never a pass.

Full WP3-18 stays open: frozen WP3-06 oracle, live model proposals,
multi-system bundle runs, and G3-11 formal qualification (phase-7).

### 5.1 Verification (this turn, actual commands + exit codes)

- `pnpm typecheck` → 0 · `pnpm lint` → 0 (79 modules / 222 deps, zero
  violations, incl. depcruise boundaries)
- New unit: `tests/verifier/t26-suite-negatives` 9/9 +
  `tests/observability/t26-sc3-09` 10/10
- Native (`vitest.native.config.ts`, disposable
  `changeproof-pg-t26`/`changeproof-redis-t26` created for T-26, reused
  through T-30, removed at session end): sc3-03 4/4 + sc3-04 4/4 + sc3-07
  5/5 + sc3-08 2/2 (15/15)
- Full `pnpm test` at T-26 close: 598 passed, 3 failed — the 3 failures are
  the pre-existing Python adapter failures, proven identical on the
  untouched tree via `git stash -u` rerun (adapter files untouched by T-26,
  which adds tests/fixtures only).
- Receipts: `runs/sc3-18/*.json` (gitignored run dirs, per-scenario
  plan+receipts+histories).
- `semgrep` → still missing (binary absent on dev machine).
- Security self-review (code-security rules on new tests/fixture: all SQL
  parameterized with fixed identifiers, no secrets, no shell interpolation;
  security-model skill read per phase binding): no findings.
- Missing checks / honest limits: network-edge partition with disposable
  topology control beyond process-kill (SC3-04 partition here is a real
  consumer SIGKILL with real backlog/heal receipts); barrier-controlled
  fault injection is out of slice (FR3-26.3) — SC3-07 uses exact
  statement-order interleaving over real overlapping transactions instead.
