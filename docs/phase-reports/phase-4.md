# Phase-4 report — revision 2

**Date:** 2 November 2026
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `in_progress` — allocated back-end tasks T-27..T-32
(T4-1..T4-6) `done` (see §2–§5, §7–§8). No full WP and no G3 gate passed;
phase stays `in_progress` pending phase-6/7 UI and whole-system proof.
**Plan revision:** 2 (24 October 2026).

## 1. Entry audit (evidence, not summary)

Phase-3 turn-3 state verified in the tree at kickoff (same day, before any
phase-4 edit): `pnpm typecheck` exit 0; `pnpm lint` exit 0 (79 modules /
222 deps, zero violations); T-26 native 15/15 green on disposable
containers; unit 598 passed + 3 pre-existing Python adapter failures
(proven identical on the untouched tree). Task-level prerequisites present:
T-25 (evidence/publication), T-15 (github), T-16 (jobs), T-17 (usage), T-18
(email), T-12 (verifier), T-24 (bundle). No `src/http`, `src/workers`,
`src/cli`, or `apps/` exists — this phase builds back-end modules +
orchestrator wiring only, no visual UI (phase-6 owns dashboard /
trace-viewer). Full-WP dependencies (frozen oracle, live model, GitHub App,
qualified guest) remain open, so every task below is independent preparation
against versioned contracts; full-WP statuses stay open per MVP §22.

## 2. T-27 / WP3-27 — public site API + content (`done`)

Task ID / parent WP: T-27 (T4-1) / WP3-27.
Requirement IDs: FR3-37, NEG3-21.
User-visible outcome: all seventeen public routes, FAQs, templates, sample
report, changelog, roadmap, and pricing served from one versioned manifest
with a enforced public/private boundary; template apply gates on login.
Prerequisite evidence: WP3-02 contracts (allocated `done`).
Allowed source/config changes: `src/core/contracts/schemas/publicsite.ts`,
`src/modules/publicsite/`, `config/publicsite/manifest.json`, orchestrator
wiring, tests.
Input snapshots + intended intervention: static versioned manifest
(`contentVersion 2026-11-02`); no tenant input is accepted anywhere on this
surface.
Acceptance checks: unit 24/24 (contract 6, boundary+behavior 17, wiring 1);
shipped manifest asserts 17/17 FR3-37 routes, zero broken destinations,
synthetic-only samples, versioned releases, sourced pricing, no em dashes.
Protected oracle / proof scope: static public content — no persistence, no
execution; native checks not applicable (stated, not skipped).
Artifacts expected: manifest + module + wiring — present.
Actual commands + exit codes: see §6.
Status + remaining blocker: allocated task `done`. Full WP3-27 stays open:
phase-6 visual pages/themes/navigation + phase-7 browser acceptance.
Next dependency-ready task: T-28 (executed same day).

What was built (tests-first):

- Closed Zod contracts: routes/CTAs, FAQs, templates (`requiresLogin`
  literal), synthetic-only sample provenance, design/release changelog
  entries (releases need semver), roadmap statuses, versioned pricing
  snapshot. Tenant-shaped fields rejected at parse (NEG3-21, layer 1).
- `src/modules/publicsite/`: route/FAQ/template/sample accessors,
  deterministic FAQ search (question > topics > answer, id tiebreak,
  explicit no-results recovery, empty-query refusal), login-gated template
  apply, same-site destination checker, and `assertPublicSafe` — a second
  boundary layer refusing tenant/grant/secret-shaped keys in any outgoing
  DTO, nested included (NEG3-21, layer 2).
- `config/publicsite/manifest.json`: honest English copy, no invented
  customers/figures/dates; pricing `free-only-draft-0` with unfrozen caps
  stated; changelog carries design notes only (no release shipped);
  roadmap marks public-site `in-qualification`, rest `planned`.
- `composePublicSite()` wiring; no-orphan boundary holds.

## 3. T-28 / WP3-25 — run-lifecycle API (`done`)

Task ID / parent WP: T-28 (T4-2) / WP3-25.
Requirement IDs: FR3-31/35, NEG3-22/27/33 (+ role/idempotency negatives).
User-visible outcome: project/draft revisions, immutable submit with real
usage reservation + real jobs enqueue, run reads, event cursor polling,
cancel, retry, and grant-checked artifact download — every call re-deriving
current grants.
Prerequisite evidence: T-25/T-15/T-16/T-17/T-18 service tasks (task-level
`done`).
Allowed source/config changes: `infra/postgres/V6__lifecycle.sql` (+ V7
`projects.created_at` column, added under T-29), `src/core` runlifecycle
contracts + lifecycle ports, `src/modules/lifecycle/`, orchestrator wiring,
tests.
Input snapshots + intended intervention: HostedRunRequest-based submits
with draft refs, invariant refs, expected grant version, sha256
idempotency keys; real PG16 with RLS (`app_user`) + two tenants.
Acceptance checks: unit 7/7 (validation 6, wiring 1); native 7/7
(journey, idempotent duplicate, cross-tenant denial, viewer
read/mutate split + operator denial, NEG3-22/27/33).
Protected oracle / proof scope: no frozen oracle yet — lifecycle behavior
and grant enforcement only; no repair verdicts claimed.
Artifacts expected: migration + store + wiring — present.
Actual commands + exit codes: see §6.
Status + remaining blocker: allocated task `done`. Full WP3-25 stays open:
streaming transport, dispatcher role, browser acceptance (phase-6/7).
Next dependency-ready task: T-29 (executed same day).

What was built (tests-first):

- V6 tables (drafts append-only, runs with idempotency unique + CAS
  version + immutable submit JSONB, ordered events), RLS + `app_user`
  grants; grants stay in V1 tables, checked at effect time.
- `LifecycleStore`: per-call fresh `deriveContext`; role split
  (owner/admin/member mutate, viewer reads, operator denied without a
  T-30 support grant); stale-grant-version refusal; reserve→enqueue→insert
  submit with race-safe duplicate collapse (one run/reservation/job);
  CAS state transitions; cancel with job-cancel fan-out; retry from
  terminal states reusing the immutable submit digest;
  `applyRepoRevocation` cancelling queued runs + recording revocation;
  artifact download with run linkage + digest recomputation.
- NEG3-22: mid-flight repo revoke stops submits/downloads and cancels
  queued runs. NEG3-27: revoked sessions deny downloads. NEG3-33:
  digest-mismatched bytes refused.
- Core ports (`LifecycleSession/Usage/Jobs/Evidence/Repro`) bound by
  `composeLifecycle()` to the identity/usage/jobs/evidence stores.

## 4. T-29 / WP3-29 — queries + notifications (`done`)

Task ID / parent WP: T-29 (T4-3) / WP3-29.
Requirement IDs: FR3-39/40, NEG3-31/32.
User-visible outcome: durable per-user inbox + preferences + transactional
outbox with event dedup; grant-filtered project/run/audit search with
version-bound cache invalidation; digest-stamped audit exports; budgeted
reproduction through the lifecycle retry path.
Prerequisite evidence: T-28 service tasks (task-level `done`, this turn).
Allowed source/config changes: `infra/postgres/V7__engagement.sql`,
`src/core` engagement contracts + repro port, `src/modules/notifications/`,
`src/modules/queries/`, orchestrator wiring, tests.
Input snapshots + intended intervention: real PG16 + RLS + two tenants;
resubmitted business events; real lifecycle runs as search corpus.
Acceptance checks: unit 8/8 (validation 6, wiring 2); native 11/11
(inbox/dedup/forgery/prefs/revoke/outbox + search/stale-grant/
isolation/export/reproduction).
Protected oracle / proof scope: engagement behavior and grant
enforcement only.
Artifacts expected: migration + stores + wiring — present.
Actual commands + exit codes: see §6.
Status + remaining blocker: allocated task `done`. Full WP3-29 stays open:
multi-channel delivery workers (in-app only here), reconnect transport,
browser acceptance.
Next dependency-ready task: T-30 (executed same day).

What was built (tests-first):

- V7 tables (notifications with idempotent event unique, outbox with
  bounded-claim states, preferences, tenant grant epochs), RLS + grants.
- `NotificationsStore`: member-only recipients (forged refused, NEG3-31),
  repeat events collapse, muted categories suppress, linked run/project/
  repo grants re-checked at list time (lost grant hides item + snippet +
  count), read/dismiss/mark-all persist per user, outbox claim/ack with
  retry cap and failure marking.
- `QueriesStore`: text/filter search over projects, runs, and audit
  events; candidates filtered by fresh project grants + re-read repo rows
  before counts/snippets (NEG3-32); in-memory result cache keyed by
  (tenant, user, grant version, epoch, query) with explicit tenant
  invalidation; JSON audit export with sha256 manifest over canonical
  rows; reproduction delegating to lifecycle retry (one authority).
- Native NEG3-32: repo revoke + epoch bump removes the run from results,
  counts, and cache (hit-then-miss proven via stats).

## 5. T-30 / WP3-30 — support + collaboration (`done`)

Task ID / parent WP: T-30 (T4-4) / WP3-30.
Requirement IDs: FR3-41/42, NEG3-34/35.
User-visible outcome: durable tickets with sanitized context and role-split
visibility; access requests that never authorize by themselves, with
approvals minting scoped expiring grants and every grant-authorized read
logged; operator-only incidents and lease-fenced drain/quarantine receipts;
candidate-bound threads with versions, history, outdated marking, audience
control, safe sharing, and access-checked mentions — comments carry no
verdict authority.
Prerequisite evidence: T-28/T-29 service tasks (task-level `done`, this
turn).
Allowed source/config changes: `infra/postgres/V8__teamwork.sql`,
`src/core` support + collaboration contracts + support/mention ports,
`src/modules/support/`, `src/modules/collaboration/`, lifecycle/queries
operator-grant retrofit, orchestrator wiring, tests.
Input snapshots + intended intervention: real PG16 + RLS + three roles
(owner/member/operator); claimed job leases for fencing; mentioned users
with and without access.
Acceptance checks: unit 7/7 (validation 5, wiring 2); native 14/14
(tickets 2, request≠grant 3 incl. operator search/export scoping, operator
console 2, threads 7 incl. audience narrowing).
Protected oracle / proof scope: teamwork behavior and authority
enforcement only.
Artifacts expected: migration + stores + wiring — present.
Actual commands + exit codes: see §6.
Status + remaining blocker: allocated task `done`. Full WP3-30 stays open:
support email/push fan-out, execution-tree kill in the supervisor role
(drain requests cancel + receipts; the kill itself is future),
browser acceptance.
Next dependency-ready task: T4-5 (WP3-31) / T4-6 (WP3-32) per the
readiness rule; do not start the next phase automatically.

What was built (tests-first):

- V8 tables (tickets, access requests, grants, append-only access log,
  platform incidents, fenced operator actions, threads/comments/history/
  shares), RLS + least-privilege grants.
- `SupportStore`: ticket lifecycle (open→triaged→resolved→closed,
  owner/admin transitions, requester/owner-admin visibility);
  credential-shaped context refused; request/approve/deny/revoke with
  approver-scope checks (approver must hold the full scope); expiry
  enforced at check time; operator-only incidents (members read status);
  drain/quarantine fenced against the live lease epoch with receipts
  (drain also requests job cancel); tenant-auditable action list.
- `CollaborationStore`: run-bound threads (visible runs only, viewers
  cannot open); versioned comments with history; author-only edits;
  active-markup bodies refused (NEG3-35); candidate revisions mark
  comments outdated without moving them; internal/reviewer audiences
  with owner/admin changes + history (narrowing revokes shares);
  idempotent member sharing with revocation; mentions notify access
  holders only (trailing punctuation trimmed, ghosts skipped).
- NEG3-34: pending requests authorize nothing; owners cannot reach
  operator actions; operators read tenant data only under covering
  grants (lifecycle/queries retrofit), every such read logged.
- NEG3-35: resolve/comment flows leave run state and submit digest
  byte-identical (asserted); verdicts unreachable from discussion rows
  structurally.

## 6. Verification (this turn, actual commands + exit codes)

- `pnpm typecheck` → 0 · `pnpm lint` → 0 (95 modules / 264 deps, zero
  violations, incl. depcruise boundaries)
- New unit: publicsite 24/24 (contract 6, boundary+behavior 17, wiring
  1) · lifecycle 7/7 (validation 6, wiring 1) · engagement 8/8
  (validation 6, wiring 2) · teamwork 7/7 (validation 5, wiring 2)
- Native (`vitest.native.config.ts`, disposable `changeproof-pg-t26` /
  `changeproof-redis-t26`, removed at session end): lifecycle 7/7 +
  engagement 11/11 + teamwork 14/14 (32/32), each on its own database
  with concurrent tenants behind RLS
- Full `pnpm test` at close: 644 passed, 3 failed — the same 3
  pre-existing Python adapter failures proven identical on the untouched
  tree during T-26 (adapter files untouched since; all T-27..T-30 files
  green)
- `semgrep` → still missing (binary absent on dev machine)
- Security self-review (code-security mandatory skill loaded before
  backend coding + semgrep skill read; every store uses bound parameters
  with fixed identifiers, injected time only, no secrets in code, sha256
  digests, generic denials without disclosure): parameterized-query and
  grant-check pass over all new stores — no findings
- Skill bindings honored: information-architecture-navigation +
  antislop-copywriting (T-27 content: honest copy, no fabricated
  figures/testimonials, no em dashes, specific CTAs), code-security
  (T-28/29/30), semgrep (read; binary absent)
- Missing checks / honest limits: HTTP/streaming transport and browser
  acceptance (phase-6/7); multi-channel notification delivery (in-app
  only; outbox pattern committed); execution-tree kill behind drain
  receipts (supervisor role); worker-lease fencing across the
  lifecycle event boundary (jobs checkpoints own it; lifecycle matches
  tenant+job with state CAS — documented in code); hosted Redis cache
  binding (in-memory version-bound cache with the same key discipline
  + explicit invalidation here)

Changed files this turn (new): `src/core/contracts/schemas/
{publicsite,runlifecycle,engagement,support,collaboration}.ts`,
`src/core/ports/index.ts` (lifecycle/support/mention ports),
`src/modules/{publicsite,lifecycle,notifications,queries,support,
collaboration}/{index,store}.ts` (publicsite single file),
`config/publicsite/manifest.json`, `infra/postgres/V{6,7,8}_*.sql`,
`tests/{publicsite,lifecycle,engagement,teamwork}/*`,
`tests/orchestrator/phase4-{publicsite,lifecycle,engagement,teamwork}.
test.ts`, `tests/native/{lifecycle,engagement,teamwork}.test.ts`;
(modified): `src/core/index.ts` (schema exports),
`src/orchestrator/index.ts` (five compositions),
`src/modules/{lifecycle,queries}/store.ts` (T-30 operator-grant
retrofit — membership behavior unchanged, native suites re-run green),
`task-brief.md` (T-26..T-30 `done` + headers). No contract, policy,
threshold, or schema semantic change to existing versioned items
(digest normalization for submit retries is new-contract behavior);
no version bump needed.

**Next dependency-ready task (at §6 close):** T4-5 (WP3-31
self-host/BYOK/binary) and T4-6 (WP3-32 SAML/SCIM + GitLab/Bitbucket) —
executed below as T-31/T-32.

## 7. T-31 / WP3-31 — BYOK + self-host deployment tooling (`done`)

Task ID / parent WP: T-31 (T4-5) / WP3-31.
Requirement IDs: FR3-43, NEG3-37.
User-visible outcome: operator binary (`changeproof install/upgrade/
backup/restore/teardown/status/byok-*`) with a fail-closed deployment
gate; BYOK credentials live only as metadata + fingerprint while key
material stays in the secret broker with revocation-checked use,
rotation, and terminal revoke.
Prerequisite evidence: WP3-24 usage + WP3-25 lifecycle service tasks
(task-level `done`).
Allowed source/config changes: `src/core` distribution contracts,
`src/modules/distribution/`, `src/orchestrator/distribution.ts`,
`src/cli/`, `infra/postgres/V9__distribution.sql`,
`infra/selfhost/profiles/local-linux.json`, `package.json` bin, tests.
Input snapshots + intended intervention: frozen profile + pinned
migrations + qualification file; disposable PG16 for the install cycle.
Acceptance checks: unit 24/24 (BYOK + deployment); native 7/7
(install/upgrade/backup/restore/teardown cycle with digest verify +
sequence reset); CLI blocked path exits 2 (proven, not asserted).
Protected oracle / proof scope: install/restore mechanics on
disposable data only; no repair verdicts claimed.
Artifacts expected: module + CLI + migration + profile — present.
Actual commands + exit codes: see §9.
Status + remaining blocker: allocated task `done`. Full WP3-31 stays
open: self-host platform catalog + license choice, Windows/macOS
binary profiles, live pull-through qualification (phase-7).
Next dependency-ready task: T-32 (executed same session).

What was built (tests-first):

- BYOK: metadata-only contract (fingerprint SHA-256, key material
  refused at parse); secret resolved through the broker at call time;
  revocation-checked broker reads; terminal revoke; savepoint-guarded
  duplicate insert.
- Deployment: `assertDeploymentQualified` gate (exit 2 = blocked);
  exact runtime pins; artifact digest over profile + migrations;
  generic logical backup/restore with full verify + sequence reset;
  dbName bound into workdir state with mismatch refusals.
- NEG3-37: restore/install paths leak no key material and bypass no
  host isolation; unqualified profiles block instead of degrading.

## 8. T-32 / WP3-32 — SAML/SCIM + GitLab/Bitbucket adapters (`done`)

Task ID / parent WP: T-32 (T4-6) / WP3-32.
Requirement IDs: FR3-44/45, NEG3-38/39.
User-visible outcome: tenant-bound SAML login and SCIM provisioning
with replay/revoke safety; GitLab + Bitbucket as provider adapters
behind one neutral port with exact-head CI binding and fenced
webhook handling.
Prerequisite evidence: T-31 distribution + WP3-22 GitHub App + WP3-28
email identity service tasks (task-level `done`).
Allowed source/config changes: `src/core` identity-service contracts
+ provider port, `src/modules/identity/{saml,scim,guards,store}.ts`,
`src/modules/providers/`, `src/orchestrator/providers.ts`,
`infra/postgres/V10__enterprise.sql`,
`docs/decisions/t32-provider-catalog.md`, tests.
Input snapshots + intended intervention: frozen provider catalog
(REST v4 / Cloud 2.0, webhook auth rules); disposable PG16 + RLS +
two tenants; injected provider transports (no live org access).
Acceptance checks: unit 30/30 (SAML + SCIM + GitLab/Bitbucket +
transports); native 9/9 (enterprise RLS journey); 66/66 affected
re-verify green.
Protected oracle / proof scope: identity binding and provider
mechanics only; no live IdP/org interop claimed.
Artifacts expected: modules + migration + catalog freeze — present.
Actual commands + exit codes: see §9.
Status + remaining blocker: allocated task `done`. Full WP3-32 stays
open: configured SAML IdP + XML/C14N vendor, GitLab self-managed
matrix + Bitbucket Server/DC, authorized test orgs + tokens,
per-provider live snapshot/event/publication/CI (phase-7).
Next dependency-ready task: phase-5 T5-1 (executed same session).

What was built (tests-first):

- SAML: explicit-tenant login (no issuer routing); pure claim
  validation + RSA-SHA256 verification; replay-guard PK; explicit
  subject links only (no JIT, no email matching).
- SCIM: hash-only tokens with constant-time compare; version-ordered
  idempotent events; member-only provisioning; suspend + session
  revoke; last-owner guard.
- Providers: neutral `RepositoryProviderPort` + injected transport;
  exact-sha CI attestation; GitLab shared-secret webhook verify;
  Bitbucket webhooks as triggers only with API re-read; webhook
  dedup table.
- NEG3-38: wrong issuer/tenant, SCIM replay, deprovision races, and
  domain-takeover shapes refused without escalation. NEG3-39:
  provider mismatch/outage, wrong head/CI, and public-source
  instructions fenced with explicit partial effects.

## 9. Verification (T-31/T-32 turn, actual commands + exit codes)

- `pnpm typecheck` → 0 · `pnpm lint` → 0 (eslint + depcruise
  boundaries, zero violations, CLI orphan exempted in config)
- New unit: distribution 24/24 · identity 30/30 (SAML/SCIM/providers/
  transports, incl. conformance rows)
- Native (`vitest.native.config.ts`, disposable `changeproof-t31`
  PG16): distribution 7/7 + enterprise 9/9 (16/16); CLI `install`
  blocked path exits 2 (proven); no leftover containers/networks
- Full `pnpm test` at close: same 3 pre-existing Python adapter
  failures as the §6 close (adapter files untouched; all T-31/T-32
  files green)
- `pnpm build` → 0 + `changeproof help/status` CLI smoke green
- Skill bindings honored: code-security (T-31/32),
  secret-serialization (BYOK/SCIM tokens)
- Missing checks / honest limits: live IdP/org interop, XML/C14N
  vendor, self-managed/Server matrices, platform catalog + license
  (all recorded as phase-7 blockers in §7–§8, never simulated)

Changed files (T-31/T-32): `src/core/contracts/schemas/
{distribution,identity-services}.ts` (+ provider port,
`DeploymentBlockedError`), `src/modules/
{distribution,providers}/`, `src/modules/identity/
{saml,scim}.ts` (+ guards/store retrofit), `src/orchestrator/
{distribution,providers}.ts`, `src/cli/`, `infra/postgres/
V{9,10}_*.sql`, `infra/selfhost/profiles/local-linux.json`,
`docs/decisions/t32-provider-catalog.md`,
`tests/{distribution,identity,
providers}/t3*`, `tests/native/{distribution,enterprise}.test.ts`,
`tests/contracts/conformance-matrix.test.ts` (new rows);
(modified): `src/core/index.ts`, `src/orchestrator/index.ts`,
`.dependency-cruiser.cjs` (CLI orphan), `package.json` (bin).
No contract, policy, threshold, or schema semantic change to
existing versioned items; no version bump needed.

**Next dependency-ready task:** phase-5 T5-1/T5-2/T5-3 — executed
same session, reported in `docs/phase-reports/phase-5.md`. Do not
start phase-6 automatically; T5-4..T5-9 remain explicitly open.
