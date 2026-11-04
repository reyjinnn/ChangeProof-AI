# Phase-6 report — revision 2

**Date:** 2 November 2026
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `in_progress` — allocated tasks T6-1..T6-7
(T-42..T-48) `done` (§§2–6 + gate §7, §9 + gate §10, §12 + gate §13, §15 + gate §16); T6-8
(T-49) `not_started` (status §17). No full WP and no G3 gate
passed; local UI pass alone passes no gate.
**Plan revision:** 2 (24 October 2026).

## 1. Entry audit (evidence, not summary)

Phase-5 state verified in the tree at kickoff: T-33..T-41 allocated
`done` (see `docs/phase-reports/phase-5.md` §2–§13). `src/http`,
`src/workers`, and `apps/` are all absent (verified `Test-Path`
False; phase-4 report §1). `package.json` has no component-test or
E2E scripts and no front-end tooling beyond `playwright-core`.
System browsers available for native E2E: Edge
(`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`),
Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`),
and a `ms-playwright` cache with `chromium-1248`.
Mockup `.template-ui/mockup.html` is 1,097,689 bytes with 7 `:root`
skin layers and Indonesian leftovers on login/register/forgot-password
strings (FR3-40: runtime UI must be English).

Backend task-level prerequisites present: T-27 publicsite
module + manifest (17/17 routes), T-28 lifecycle store + wiring,
T-14 identity, T-15 GitHub client, T-18 email/session. Full WPs stay
open per MVP §22.

## 2. T-42 / T6-1 / WP3-27 — design tokens + responsive shell

Task ID / parent WP: T-42 (T6-1) / WP3-27.
Requirement IDs: FR3-37/40; NFR3-14/15; NEG3-21 (boundary re-check on
the HTTP slice).
User-visible outcome: one token source from the final mockup cascade,
responsive shell (sidebar/topbar/theme), self-hosted Inter + Plus
Jakarta Sans with SIL OFL notices, zero external requests, English
runtime copy, `apps/dashboard` scaffold with component + native E2E
scripts, and a thin `src/http` slice (health + public content +
static hosting) calling existing orchestrator wiring only.
Prerequisite evidence: T-27 manifest/module (phase-4 §2); mockup skin
audit in §1; no `src/http` or `apps/` (verified absent).
Allowed source/config changes: `apps/dashboard/**`, `src/http/**`,
`src/core/contracts/schemas/http.ts` (+ export), `tests/http/**`,
`tests/e2e/**`, `package.json` scripts + pinned devDeps
(`vite@7.1.7`, `happy-dom@15.11.7`, `axe-core@4.10.2`),
`pnpm-workspace.yaml` allowBuilds, `.dependency-cruiser.cjs` apps
rules, `eslint.config.mjs` apps block, dashboard tsconfig/vite/vitest
configs. No verdict, grant, or proof-scope changes.
Acceptance checks: component 30/30 (tokens AA both themes, shell,
components, store, api, routes); http 12/12 (health, content,
CSRF/origin/body-limit/traversal negatives, static fallback);
typecheck 0; lint 0 incl. boundaries (149 modules / 417 deps, zero
violations); `pnpm build` 0; `pnpm build:ui` 0; native E2E shell spec
(real chromium + server, axe both themes, zero external requests).
Protected oracle / proof scope: public content + shell mechanics only;
template apply refuses guests (401 + validated login target) until
T-44 wires sessions; no repair verdicts anywhere in the UI.
Artifacts expected: token source, shell, scaffold, http slice, tests,
E2E runner — present.
Actual commands + exit codes: see §3.
Status + remaining blocker: allocated task `done`. Full WP3-27 stays
open: T-43 public pages + phase-7 browser acceptance.
Next dependency-ready task: T-43 (executed next).

What was built (tests-first):

- `apps/dashboard/src/tokens.css`: one token source from the final
  mockup cascade (sapphire light `--blue #28558e`/`--bg #efeeeb`,
  dark `--bg #0b0b0d`, sidebar 252/230/overlay breakpoints, Inter +
  Plus Jakarta Sans self-hosted WOFF2, SIL OFL notices shipped in
  `public/assets/fonts/`, zero external requests). Two `[DERIVED]`
  deviations, both tested: light `--muted` darkened `#60738d` →
  `#5b6c84` (4.18 → 4.61:1, AA) and dark warning badges keep the
  readable `#f2cd88` amber for status semantics.
- Shell + shared components: skip link, landmarks, responsive
  sidebar/topbar, theme toggle persisted, collapse persisted, mobile
  drawer with Escape + focus return, labeled fields with error slots,
  modal with focus trap + trigger refocus, status badges with tone
  text (never color alone), persistent route announcer, focus moved
  to the new heading on every route change. Runtime copy is English.
- `src/http` thin slice over existing wiring only: health, public
  content list/get/faq-search/changelog/roadmap/pricing, guest apply
  gate (401 + `loginThenReturnTo`), CSRF marker + Origin check on
  mutations, 1 MB body cap with 413, traversal-safe static hosting
  with SPA fallback, `ui_not_built` when the build is absent.
- Boundaries: new depcruise apps rules (browser imports
  `core/contracts` + `core/errors` only; no node builtins, no
  devDeps in shipped code; configs/tests excluded from the cruise),
  orphan exemption for the vite entry, CSS imports excused from the
  resolver rule. `src/http` imports core + orchestrator only.
- Tooling: `dev`, `build:ui`, `test:ui`, `test:e2e` scripts;
  typecheck covers both projects; `pnpm-workspace.yaml` allowBuilds
  resolved (`esbuild: true`, pre-existing postgres/prisma builds
  stay `false` as before — they were never approved, behavior
  unchanged).

## 3. T-42 verification (actual commands + exit codes)

- `pnpm test:ui` → 0 (30/30: tokens 6, shell 7, components 9, store
  4, api 4)
- `pnpm vitest run tests/http` → 0 (12/12 incl. CSRF, origin,
  body-limit, traversal, fallback negatives)
- `pnpm typecheck` → 0 (root + dashboard projects)
- `pnpm lint` → 0 (ESLint + depcruise, 149 modules / 417 deps,
  zero violations)
- `pnpm build` → 0; `pnpm build:ui` → 0 (vite 7.1.7)
- `pnpm test:e2e` → 0 (shell spec: landmarks, skip-link keyboard
  path, theme persistence, mobile drawer + Escape refocus, axe zero
  violations on light + dark, zero external requests; real chromium +
  real server on 127.0.0.1:4179)

## 4. T-43 / T6-2 / WP3-27 — public site front-end

Task ID / parent WP: T-43 (T6-2) / WP3-27.
Requirement IDs: FR3-37; NEG3-21.
User-visible outcome: all seventeen public routes render from the live
manifest with working CTAs; FAQ search, template detail + login-gated
apply, synthetic sample detail, separated changelog, roadmap status,
and versioned pricing all read live API data; `#/login` shows an
honest login-required notice with the validated return target (the
form itself is T-44).
Prerequisite evidence: T-42 shell/tokens/http slice (allocated
`done`); T-27 manifest/module (phase-4 §2, 17/17 routes).
Allowed source/config changes: `apps/dashboard/src/{pages,main,shell,
api}.ts`, `apps/dashboard/src/*.test.ts`, `tests/e2e/specs/public.mjs`,
this report. No backend, contract, or threshold changes.
Acceptance checks: component 36/36 (30 T-42 + 6 public: CTA
classification, return-target validation, page render, apply-gate
navigation, login notice, FAQ field error); typecheck 0; lint 0
(150 modules / 424 deps, zero violations); `pnpm build:ui` 0; native
E2E public spec (all 17 routes + CTA resolution, FAQ search/error/
recovery, template gate, synthetic label, changelog/roadmap/pricing,
NEG3-21 payload scan, axe on 3 pages, 768px overflow check).
Protected oracle / proof scope: public content rendering only; no
tenant data is requested or displayed; samples labeled synthetic.
Artifacts expected: public pages, login notice, tests, E2E spec —
present.
Actual commands + exit codes: `pnpm test:ui` → 0 (36/36);
`pnpm typecheck` → 0; `pnpm lint` → 0 (150/424);
`pnpm build:ui` → 0; `pnpm test:e2e` → 0 (shell + public).
Status + remaining blocker: allocated task `done`. Full WP3-27 stays
open: phase-7 browser acceptance.
Next dependency-ready task: T-44 (executed next).

What was built (tests-first):

- `apps/dashboard/src/pages/public.ts`: one route per manifest path
  (`#/p/...`) registered from the live manifest at boot, generic
  title/summary/CTA renderer plus FAQ search, template cards/detail,
  sample cards/detail with provenance, separated changelog,
  roadmap status badges, and versioned pricing. Template apply
  follows the real 401 gate to `#/login?return=...`.
- `#/login` notice (T-43 scope): validates the return target for
  display (`/app` same-app paths only; anything else renders as
  plain text, never a link) and links back to the public site. The
  real form replaces this notice in T-44 at the same route.
- Shell navigation grouped by section (Workspace / Public site /
  Account) with plain-text group labels.
- `ApiFailure.detail` carries envelope extras (the apply gate) to
  the UI; `main.ts` boots async from live manifest data and still
  renders the status route when the API is down.

## 5. T-44 / T6-3 / WP3-21/22/28 — auth / onboarding / settings UI

Task ID / parent WP: T-44 (T6-3) / WP3-21/22/28.
Requirement IDs: FR3-29/30/38; NEG3-29/30.
User-visible outcome: email register → verify → create-org →
login → sessions/invite/delete settings, all against the real
identity stores; GitHub login reports its real unavailable state
(no authorized App) instead of a fake button.
Prerequisite evidence: T-42/T-43 shell + http slice (allocated
`done`); T-14 identity, T-15 GitHub client, T-18 email/session
(task-level `done`); backend API audit in this section.
Allowed source/config changes: `src/http/{routes-auth,server,
start,index}.ts`, `apps/dashboard/src/{pages/auth,main,shell,
api}.ts`, `apps/dashboard/src/*.test.ts`, `tests/native/auth-http.
test.ts`, `tests/e2e/{run,specs/auth}.mjs`, this report. No
contract, policy, verdict, or threshold changes.

Backend audit (verified in source before UI work):

- `loginWithPassword` validates `returnTarget` server-side via
  `assertSafeReturnTarget` (NEG3-29 covered in the module); unknown
  users and wrong passwords share one message; resend/reset are
  same-shape for unknown addresses (NEG3-30 covered).
- Session failures share "re-authentication is required" phrasing
  (unknown/revoked/expired); deletion fence raises separately.
- `claimTenant` mints the tenant from ticket + chosen `tenantId`
  (`IdSchema`); invitation TTL is caller-chosen.
- No `listMembers`, `listInvitations`, or user lookup exists, so
  member/role/invite-list UI cannot be built without a backend
  extension (recorded below as a backend-owned gap, not stubbed).
- Registration stores email + password only; name/consent fields
  need a backend decision before any UI collects them.
- SMTP delivery (`createSmtpDelivery`) has no auth/TLS options;
  local/E2E use plain SMTP to disposable Mailpit. Production
  transport hardening is a full-WP gap, not silently solved here.
- Session cookies are `HttpOnly; SameSite=Strict` without `Secure`
  (local 127.0.0.1 HTTP); production must terminate TLS and set
  `Secure` — deployment gap, recorded, not silent.

What was built (tests-first):

- `src/http/routes-auth.ts` + server dispatch: seventeen account
  endpoints (providers, register, login/logout, session, sessions
  list/revoke, verify/resend, password forgot/reset, org claim,
  invite create/accept, member change/remove, org delete) over the
  composed stores, with strict zod bodies, CSRF + Origin checks,
  401/403 session mapping, and 404-without-disclosure on forged
  tenant paths. `start.ts` wires Pool + SMTP + secret broker from
  explicit env only (fail closed); without `DATABASE_URL` the auth
  paths answer 503 `auth_unavailable`.
- Backend defect repaired in explicitly authorized scope (found by
  the native test, mirroring the module's own error mapping):
  `loginWithPassword` leaked a raw `tenant_fenced` DB error as a
  500 when logging into a deleted organization; now a
  `ChangeProofError` refusal (relogin → 400). `composeSmtpDelivery`
  passthrough added to the orchestrator so `src/http` never
  imports a leaf module directly.
- `apps/dashboard/src/pages/{auth,settings}.ts`: login (with
  multi-tenant reveal, tenant prefill, tenantless recovery link,
  honest GitHub-unavailable note), register, check-email/resend,
  verify with in-memory claim ticket, forgot/reset, create-org,
  invite accept, session-expired, settings (account, sessions +
  revoke, invite create with one-time link, type-to-confirm
  deletion), shell account slot with logout.
- `[DERIVED]`: invitation TTL 7 days; owner role excluded from the
  invite menu pending a product decision (server stays authority).
- E2E infra (`tests/e2e/infra.mjs` + runner): disposable PG16
  migrated V1/V2/V5/V10 + Mailpit per run, always torn down.

Backend-owned gaps (not stubbed, owners named):

- Member/role/invite-list UI needs `listMembers`/
  `listInvitations` (WP3-21 extension; Reyn to authorize).
- Registration name/consent fields need a backend decision before
  any UI collects them (WP3-28).
- SMTP auth/TLS + `Secure` cookies + IP rate limiting are
  production hardening gaps for the full WP.

E2E hardening (defects the browser journey exposed, all fixed in
this task, none weakened):

- Login/logout used `location.reload()`, which raced navigation and
  wiped in-memory tickets. Replaced with the `cp:session-changed`
  event + `refreshAccount()` (`apps/dashboard/src/session.ts`, new,
  4 unit tests); `renderAccount` moved there so `shell ↔ session`
  has no import cycle.
- The session listener re-rendered the *current* hash after its
  async refresh, so a stale login completion re-fired the invite
  route and consumed the single-use token twice ("already used").
  The listener now captures the hash at dispatch and skips
  re-render on navigation (`main.ts`); `renderRoute` carries an
  epoch guard so a superseded render never marks nav, announces,
  or steals focus (`routes.ts`, 2 unit tests).
- Spec corrections (product behavior confirmed right in each
  case): two users run in two browser contexts (one jar let the
  member login silently reassign the owner page); the post-reset
  settings state is the login card, not `#/session-expired`
  (dead cookie → 200 `authenticated:false`; mid-session 401
  redirect stays unit-covered); owner login waits on tenant text,
  never an immediate assert.
- `tests/e2e/run.mjs` prints the failure stack (file + line),
  not just the message.

Acceptance checks: component 55/55; native auth-http 11/11
(real PG16 + real server, NEG3-21/29/30 negatives); typecheck 0;
lint 0 (154 modules / 444 deps, zero violations); `pnpm build` 0;
`pnpm build:ui` 0; native E2E auth spec (full browser journey via
real Mailpit delivery) plus the shell + public specs, all green.
Protected oracle / proof scope: account behavior only; no repair
verdicts; invitations are bearer links shown once to the inviter.
Artifacts expected: auth routes, pages, native + E2E tests —
present.
Actual commands + exit codes: `pnpm test:ui` → 0 (55/55);
`pnpm vitest run --config vitest.native.config.ts
tests/native/auth-http.test.ts` → 0 (11/11, disposable PG16
`cp-authhttp-pg`, torn down);
`pnpm typecheck` → 0; `pnpm lint` → 0 (154/444);
`pnpm build` → 0; `pnpm build:ui` → 0; `node tests/e2e/run.mjs
auth` → 0 (`e2e ok: auth`); `pnpm test:e2e` → 0 (`e2e ok: auth`,
`e2e ok: public`, `e2e ok: shell`).
Status + remaining blocker: allocated task `done`. Full WP3-21/22/28
stay open: backend gaps above + phase-7 acceptance.
Next dependency-ready task: T-45 (executed next, §6).

## 6. T-45 / T6-4 / WP3-25 — run journey UI

Task ID / parent WP: T-45 (T6-4) / WP3-25.
Requirement IDs: FR3-31/35; NEG3-21/22/33/34 (mapping layer).
User-visible outcome: run/project lists with filters, template-driven
draft + immutable submit with receipt, live run detail (cursor
polling, reconnect, cancel/retry, artifact download, honest review
note) — every control over a real endpoint, no decorative controls.
Prerequisite evidence: T-42/T-43/T-44 allocated `done`; T-28
lifecycle store + wiring (task-level `done`); backend audit in this
section.
Allowed source/config changes: `src/http/{context,runs,server,
index,start,routes-auth,respond}.ts`, `src/orchestrator/index.ts`
(`composeFileEvidence` only), `apps/dashboard/src/{main,shell,
tokens.css,pages/runs}.ts`, `apps/dashboard/src/pages/runs.test.ts`,
`tests/{http/t45-runs,native/runs-http,e2e/run,infra,specs/runs}.mjs`,
`docs/feature-coverage.md`, this report. No contract, policy,
verdict, threshold, or store-behavior changes.

Backend audit (verified in source before UI work):

- `LifecycleStore` exposes createProject, saveDraftRevision,
  getDraft, submitRun (reservation + enqueue + submitted event,
  idempotent by key, stale-grant and fence refusals), getRun,
  pollEvents (cursor), cancelRun, retryRun (same digest), and
  downloadArtifact (event-linked, digest-verified, tombstone-aware).
  `recordRunEvent`/`applyRepoRevocation` stay worker/control-plane
  only and are not exposed over HTTP.
- `QueriesStore.search` covers project/run/audit lists inside the
  tenant fence (used for lists; no listProjects/listRuns exists).
- `repository_grants` has no writer in `src/` (GitHub installation
  flow is unblocked only with an authorized App): the UI selects
  from session grants, tests seed. `UsageStore` has no read ops and
  entitlements have no product API: the UI collects budget inputs
  only and invents no forecast figures. No readiness,
  characterization, telemetry-upload, or review-aggregation
  (graph/ledger/diff/C-P-R-D/target/bundle) backend exists: refs
  stay opaque inputs, events render raw, the review panel states
  the absence. No streaming backend exists: cursor polling with
  reconnect is the shipped behavior. The manifest serves 2 run
  templates; the UI renders all served templates generically.
- Session contexts already carry grantVersion + project/
  repository grants; the UI needs all three for submit.

What was built (tests-first):

- `src/http/context.ts` (new): shared `HttpRouteError`,
  `SESSION_COOKIE`, `parseBody`, `sessionCookieId`,
  `actingContext` (now over the `LifecycleSessionPort`, so auth
  and runs share one 401/403 mapping), `pathSegment`.
  `routes-auth.ts` refactored onto it (all callers finished);
  `GET /api/auth/session` additionally returns grantVersion +
  projectGrants + repositoryGrants (additive; the tenant's own
  grants for its own session).
- `src/http/routes-runs.ts` (new): ten endpoints — projects
  create; drafts save/get; runs submit (server sets
  tenant/actor/request identity; client key + read grant
  version; 201 new / 200 duplicate) and get; events poll;
  cancel/retry; artifact bytes (`sendBytes`, digest-named
  attachment); grant-scoped search. Unknown ids → 404 without
  disclosure; authorization refusals → 403; worker/control-plane
  calls unexposed. `sendCreated`/`sendBytes` live in `respond.ts`.
- `start.ts` wires identity/usage/jobs/file-evidence/lifecycle/
  queries from one pool; `CP_EVIDENCE_DIR` (existing directory,
  fail closed) joins the required env. `composeFileEvidence`
  passthrough added to the orchestrator. E2E infra mints and
  tears down a per-run evidence dir.
- `apps/dashboard/src/pages/runs.ts` (new): `#/runs` lists with
  text/state filters; `#/runs/new` template picker (intent →
  intent, other fields → notes), inline project create,
  versioned drafts with account-scoped recents (secret-shaped
  keys fall back to in-memory) and `?draft=` resume, submit
  with per-load 64-hex key and immutable receipt; `#/run?id=`
  exact state/version/digest header, cursor poll loop
  (navigation-epoch stop, terminal stop, warn → pause → manual
  reconnect), cancel/retry with refresh, artifact download
  links, raw-payload timeline, honest review note. Guests get
  login cards with no data calls; viewers get a disabled submit
  with the reason; 401 mid-use redirects to `#/session-expired`.
- `docs/feature-coverage.md` (new): the phase-6 control →
  requirement → backend → endpoint → browser-case record,
  including the gaps above.

Acceptance checks: component 79/79 (24 new); http 20/20 (8 new,
stub stores + sentinel ids); native runs-http 10/10 (real PG16 +
real server + file evidence, incl. duplicate/stale-grant/403/
tamper/viewer/fence cases); typecheck 0; lint 0 (157 modules /
465 deps, zero violations); `pnpm build` 0; `pnpm build:ui` 0;
native E2E runs spec (full browser journey; repo grant +
entitlement seeded as recorded gaps) plus auth + public + shell.
Protected oracle / proof scope: journey mechanics only; no
verdicts rendered anywhere; execution-mode labels are user input,
not proof claims.
Artifacts expected: runs routes, pages, native + E2E tests,
coverage record — present.
Actual commands + exit codes: `pnpm test:ui` → 0 (79/79);
`pnpm vitest run tests/http` → 0 (20/20);
`pnpm vitest run --config vitest.native.config.ts
tests/native/runs-http.test.ts` → 0 (10/10, disposable PG16
`cp-runshttp-pg`, torn down);
`pnpm typecheck` → 0; `pnpm lint` → 0 (157/465);
`pnpm build` → 0; `pnpm build:ui` → 0; `node tests/e2e/run.mjs
runs` → 0 (`e2e ok: runs`); `pnpm test:e2e` → 0 (`e2e ok: auth`,
`e2e ok: public`, `e2e ok: runs`, `e2e ok: shell`).
Status + remaining blocker: allocated task `done`. Full WP3-25
stays open: backend gaps above + phase-7 acceptance (workers,
real execution, review aggregation, streaming).
Next dependency-ready task: T-46 (T6-5, evidence/publication/
export UI).

## 7. Interface-quality gate (required before handoff)

Method: rendered `#/runs`, `#/runs/new`, `#/run` (seeded account +
run, real server) at desktop width and 390px, captured
screenshots, computed-value audits, overflow queries, and console
errors. Desktop ran at 1280 (the probe's `context.newPage`
ignores `viewport`; mobile 390 via `setViewportSize` is exact).

First impression: a legible run-management workspace; "File a run"
is unmistakable; the eye landed first on the h1 focus box (wrong
reason — fixed below); restrained enterprise direction, no
AI-generated tells.

Findings (all fixed in this task, re-verified):

- Critical: topbar overflowed at 390 (account + four buttons
  spilled; Collapse/Dark cut off). Fix: collapse hides on mobile
  (meaningless over a drawer), account truncates with ellipsis,
  row wraps, tighter padding/gap (`tokens.css`, `shell.ts`
  collapse class).
- Important: detail-list + inline code overflowed at 390
  (unbreakable 64-hex digests). Fix: dl stacks to one column on
  narrow screens (placed after the base rule so it wins), `dd`
  and `code.inline` wrap anywhere, payload `pre` scrolls
  internally.
- Minor: programmatic h1 focus drew a heavy box on every route.
  Fix: `#outlet h1:focus` suppresses the ring (h1 is never in
  the keyboard tab order; screen-reader announcement kept).
- Dismissed with evidence: "Times New Roman" computes only on
  `head` elements; Arial only on one glyph-less checkbox;
  buttons measure 43px (≈ the 44px guideline; WCAG 2.5.8 met);
  5–6 border radii are the approved T-42 token system, not
  redesigned here.

Evidence after fix: zero element overflow on all six renders;
page `scrollWidth == clientWidth` (390) on run detail with the
payload `pre` scrolling internally; zero console errors; full
E2E (incl. axe on runs/new/detail) green. Verdict: ship.

## 9. T-46 / T6-5 / WP3-12+29 — evidence / publication / export UI

Task ID / parent WP: T-46 (T6-5) / WP3-12+29.
Requirement IDs: FR3-18/19/20/21/31/35; NEG3-14/33/35 (shape).
User-visible outcome: per-run evidence library, read-only escaped
viewer over the digest-verified download, honest publication panel,
labeled JSON export — every control over a real endpoint, no
decorative controls, no UI-generated verdict.
Prerequisite evidence: T-42..T-45 allocated `done`; T-28 lifecycle
store + wiring (task-level `done`); backend audit in this section.
Allowed source/config changes: `apps/dashboard/src/{api,main,
pages/evidence}.ts`, `apps/dashboard/src/pages/{evidence.test,
runs}.ts`, `tests/e2e/{run,infra,specs/evidence}.mjs`,
`docs/feature-coverage.md`, this report. No contract, policy,
verdict, threshold, or store-behavior changes; no new HTTP
endpoints (all three pages reuse events + artifact bytes +
providers endpoints).

Backend audit (verified in source before UI work):

- `EvidenceStore` is put/get/has only — no enumeration, no
  metadata. The only artifact index the backend owns is the run's
  `kind='artifact'` events (`payload.digest`), served by the
  existing cursor-paged events endpoint (limit ≤ 100). The library
  therefore lists one run's artifacts, honestly capped at 500
  events with a labeled truncation note.
- `downloadArtifact` is event-linked, tombstone-aware, and
  digest-verified twice (file-store `get` raises
  `EvidenceIntegrityError` first; the lifecycle re-hash second).
  Tamper answers 400 with the store message verbatim; unknown →
  404 without disclosure; unshared → 403.
- Publication: `GitHubClient.findPullRequest` exists but needs a
  broker token + authorized installation; T-44 established no
  authorized App, and no PR/CI read path is exposed over HTTP.
  The panel reports availability from `/api/auth/providers` and
  shows no PR/CI state rather than guessing it.
- Owner outcome reporting and evaluation denominators have no
  listing backend (`evaluation` is a file case store). One
  absence note; no figures invented.

What was built (tests-first):

- `apps/dashboard/src/pages/evidence.ts` (new):
  `#/evidence?run=` library (artifact filter, hex-64 digest
  validation, View/Download/Copy per entry, publication +
  export + outcomes sections) and `#/evidence/view?run=&digest=`
  viewer (256 KiB preview cap, NUL/UTF-8 binary refusal with
  download kept, full digest + "verified by the server when
  served" label, 400→integrity panel / 404→unknown /
  403→unshared / 401→session-expired).
- `apiGetBytes` (new in `api.ts`): octet-stream on success,
  JSON-envelope error mapping on failure, same offline shape.
- `buildEvidenceExport` (pure, unit-tested): client-side JSON
  snapshot of fetched server data, provenance-labeled non-proof.
- `runs.ts`: artifact events gain a View link; run header gains
  "Open the evidence library". `main.ts` registers the pages.
- `tests/e2e/run.mjs` passes `evidenceDir` to specs (additive);
  `tests/e2e/specs/evidence.mjs` (new): guest guard, real
  register→submit journey, worker-simulation seeding (SQL event
  row + digest-named bytes), library → viewer → tamper-refusal
  drive, axe + overflow + console + zero-external asserts, with
  `CP_E2E_WIDTH`/`CP_E2E_DARK` gate overrides.

Security finding + harness repair (fp-check TRUE POSITIVE):

- The new spec exposed a real cross-tenant leak: with two
  tenants' runs in the shared suite database, the runs spec's
  fresh tenant saw the evidence tenant's run + project on `#/runs`
  (outlet dump captured as evidence).
- Root cause: `tests/e2e/infra.mjs` handed the server a
  **superuser** `DATABASE_URL`, and superusers bypass RLS
  entirely — so `deriveContext` granted all projects globally
  and search fenced nothing. Product RLS design (policies +
  NOBYPASSRLS `app_user` + per-table grants) is correct; only
  the harness role was wrong. Native suites already used
  `app_user` (T-44 pattern).
- Repair (harness-only, no product change): `infra.mjs` returns
  `appDatabaseUrl` (`app_user`, same disposable credential as
  native tests); `run.mjs` starts the server on it; specs keep
  the superuser URL for seeding. Before: leak reproduced
  (`evidence runs` → runs FAIL). After: full suite green. The
  suite itself is now the concurrent-tenant regression guard
  (runs spec's `No runs yet` fails on any future leak).

Acceptance checks: component 91/91 (12 new); typecheck 0; lint 0
(158 modules / 469 deps, zero violations); `pnpm build` 0;
`pnpm build:ui` 0; native E2E evidence spec plus auth + public +
runs + shell, all green (gate §10).
Protected oracle / proof scope: evidence mechanics only; the
viewer repeats the server's integrity verdict verbatim and
renders no verdict of its own; export is labeled non-proof.
Artifacts expected: evidence pages, bytes helper, E2E spec,
coverage rows — present.
Actual commands + exit codes: `pnpm test:ui` → 0 (91/91);
`pnpm typecheck` → 0; `pnpm lint` → 0 (158/469);
`pnpm build` → 0; `pnpm build:ui` → 0;
`node tests/e2e/run.mjs evidence` → 0 (`e2e ok: evidence`,
also at 390px and dark); `pnpm test:e2e` → 0 (all five specs).
Status + remaining blocker: allocated task `done`. Full
WP3-12/29 stay open: backend gaps above + phase-7 acceptance.
Next dependency-ready task: T-47 (executed next, §11+).

## 10. T-46 interface-quality gate (required before handoff)

Method: the evidence spec itself carries the gate — axe on the
library + viewer, overflow query (page `scrollWidth` plus every
`main#outlet` element except internally-scrolling `pre`/`code`),
console/pageerror collection, and zero-external-request assert —
run at 1280px, at 390px (`CP_E2E_WIDTH=390`), and dark
(`CP_E2E_DARK=1`, OS dark scheme).

Findings (both spec-side, product needed no change):

- Strict-mode duplicate `Evidence viewer` text (h1 + route
  announcer): spec waits on `.first()`. No product change —
  the announcer is required accessibility behavior.
- Console-error assert caught the browser's own resource-load
  log for the intentional 400 tamper refusal: spec filters
  `Failed to load resource` lines (expected HTTP negatives),
  keeps pageerror + all other console errors fatal.

Evidence after fix: `e2e ok: evidence` at all three
configurations; zero axe violations; zero overflow; zero console
errors; zero external requests. Verdict: ship.

## 12. T-47 / T6-6 / WP3-29 — notifications / search UI

Task ID / parent WP: T-47 (T6-6) / WP3-29.
Requirement IDs: FR3-39; NEG3-31/32/34 (mapping layer).
User-visible outcome: persisted inbox (cursor paging, unread
filter, read/dismiss/read-all, live count), five-category
preferences, and a Ctrl/Cmd+K search palette over grant-scoped
search — every control over a real endpoint, deep links safe,
no stale counts anywhere.
Prerequisite evidence: T-42..T-46 allocated `done`; T-29
notifications store + wiring (task-level `done`); backend audit
in this section.
Allowed source/config changes: `src/http/{routes-
notifications,index,server,start}.ts`, `apps/dashboard/src/
{shell,main,pages/notifications,pages/search}.ts`,
`apps/dashboard/src/pages/{notifications.test,search.test}.ts`,
`tests/{http/t47-notifications,native/notifications-http,
e2e/specs/inbox}.mjs`, `docs/feature-coverage.md`, this report.
No contract, policy, verdict, threshold, or store-behavior
changes.

Backend audit (verified in source before UI work):

- `NotificationsStore` exposes exactly what the UI needs:
  `listNotifications` (limit ≤ 50, opaque cursor, unreadOnly,
  per-user rows, dismissed excluded, project/repository/run
  links re-checked at list time so a lost grant hides item +
  snippet + count), `markRead` (idempotent) /
  `markDismissed` / `markAllRead` (counted),
  `getPreferences` / `setPreferences` (five categories).
- `publishFromEvent` refuses forged recipients (NEG3-31),
  suppresses muted categories, and collapses duplicate event
  ids; it and the outbox claim/ack pair stay
  worker/control-plane-only and are not exposed over HTTP —
  the 404-on-publish route is asserted, not assumed.
- Operator sessions carry no inbox authority (NEG3-34 refusal
  in the store); the HTTP layer maps it to 403.
- Search (`POST /api/search`, T-45) is reused unchanged for
  the palette; counts/snippets arrive post-grant-filter.

What was built (tests-first):

- `src/http/routes-notifications.ts` (new): six endpoints —
  inbox list (limit/cursor/unreadOnly query), per-row
  read/dismiss, read-all, preference get/set. Unknown ids →
  404 without disclosure; operator → 403; guest → 401;
  worker-only calls unexposed. `server.ts` dispatches the
  paths (503 without a database); `start.ts` wires
  `composeNotifications` from the shared pool.
- `apps/dashboard/src/pages/notifications.ts` (new): `#/inbox`
  (workspace nav) with fresh-count header, unread filter,
  cursor Load more, per-item read/dismiss, read-all with
  marked-count confirmation, and the preferences fieldset.
  Every action re-lists from the server instead of guessing
  the new count locally. Run ids link to run detail;
  `deepLink` values render as plain text (`[DERIVED]`: the
  `/app` surface they name is not dashboard hashes, so they
  are never hrefs).
- `apps/dashboard/src/pages/search.ts` (new) + shell trigger:
  topbar `Search (Ctrl+K)` button with `aria-keyshortcuts`,
  document-level Ctrl/Cmd+K, modal palette (reused focus
  trap + Escape + trigger refocus) with text + scope form,
  run/project/audit-event links, total count, and guest /
  empty / error states that keep the form.
- `[DERIVED]` non-build: no shell unread badge — a polling
  badge could show the stale counts NEG3-32 forbids, so the
  count renders only from fresh list responses.

Acceptance checks: component 106/106 (15 new: 11 inbox +
4 palette); http 27/27 (7 new, stub stores); native
notifications-http 6/6 (real PG16 + real server as app_user,
incl. NEG3-31 forged publish, NEG3-32 lost-grant hide,
cross-tenant 404 + isolation); typecheck 0; lint 0 (161
modules / 485 deps, zero violations); `pnpm build` 0;
`pnpm build:ui` 0; native E2E inbox spec plus auth + evidence
+ public + runs + shell, all green (gate §13).
Protected oracle / proof scope: inbox mechanics only; no
verdicts; publish/outbox unreachable from the browser.
Artifacts expected: notifications routes, inbox + palette,
native + E2E tests, coverage rows — present.
Actual commands + exit codes: `pnpm test:ui` → 0 (106/106);
`pnpm vitest run tests/http` → 0 (27/27);
`pnpm vitest run --config vitest.native.config.ts
tests/native/notifications-http.test.ts` → 0 (6/6, disposable
PG16 `cp-notifhttp-pg`, torn down);
`pnpm typecheck` → 0; `pnpm lint` → 0 (161/485);
`pnpm build` → 0; `pnpm build:ui` → 0;
`node tests/e2e/run.mjs inbox` → 0 (`e2e ok: inbox`, also at
390px and dark); `pnpm test:e2e` → 0 (all six specs).
Full unit suite: 822 passed, 4 failed — all 4 pre-existing
on the stashed baseline (Python-adapter environment x3 +
one ESLint-inline timeout under parallel load), none in
this task's scope.
Status + remaining blocker: allocated task `done`. Full
WP3-29 stays open: phase-7 acceptance (workers, channels).
Next dependency-ready task: T-48 (executed next, §14+).

## 13. T-47 interface-quality gate (required before handoff)

Method: the inbox spec carries the gate — axe on the inbox +
open palette, overflow query, console/pageerror collection,
zero-external-request assert — at 1280px, 390px
(`CP_E2E_WIDTH=390`), and dark (`CP_E2E_DARK=1`). Palette
Escape/refocus and checkbox toggle behavior are asserted in
the real browser (the component suite drives `change`
directly; real activation is E2E by design).

Findings: none — `e2e ok: inbox` at all three configurations
on the first gate run; zero axe violations; zero overflow;
zero console errors; zero external requests. Verdict: ship.

## 15. T-48 / T6-7 / WP3-30 — support / collaboration UI

Task ID / parent WP: T-48 (T6-7) / WP3-30.
Requirement IDs: FR3-41/42; NEG3-34/35.
User-visible outcome: support desk (tickets, access
request/decide/revoke, tenant incident list), an operator console
that owners cannot reach (incidents, lease-fenced
inspect/drain/quarantine, action audit), and run discussions
(threads, comments, edits, history, audience, shares) — every
control over a real endpoint, hostile markup refused at the
boundary and escaped in render.
Prerequisite evidence: T-42..T-47 allocated `done`; T-30 support
+ collaboration stores and wiring (task-level `done`); backend
audit in this section.
Allowed source/config changes: `src/http/{routes-teamwork,
index,server,start}.ts`, `apps/dashboard/src/{main,
pages/support,operator,threads,runs}.ts`, component tests,
`tests/{http/t48-teamwork,native/teamwork-http,
e2e/specs/teamwork}.mjs`, `docs/feature-coverage.md`, this
report. No contract, policy, verdict, threshold, or
store-behavior changes.

Backend audit (verified in source before UI work):

- `SupportStore`: owner/admin triage+decide gates, member-only
  ticket visibility, ticket open→triaged→resolved→closed flow,
  request/approve+grant/deny/revoke with scope-holding checks
  (request is never a grant), tenant-visible incident list,
  operator-only report/ack/resolve + inspect/drain/quarantine
  under the lease fence with stale-epoch refusal, and an
  action audit owners may read. Internal scope/audit calls
  stay unexposed.
- `CollaborationStore`: run-scoped threads pinned to a
  candidate digest, comments with versions + superseded-only
  history, `CommentBodySchema` refusing active markup at
  write time (400), audience internal/reviewer, shares with
  membership checks, worker-only `recordCandidateRevision`
  marking older comments outdated (displayed, never computed
  by the UI).
- Gaps recorded, not faked: no access-request/grant listing
  (decide/revoke take pasted receipt ids), no user lookup
  (shares take typed user ids), no operator-membership API
  (tests flip the role over SQL).

What was built (tests-first):

- `src/http/routes-teamwork.ts` (new): 21 endpoints across
  `/api/support`, `/api/operator`, `/api/threads`,
  `/api/comments`. Unknown ids → 404 without disclosure;
  role refusals → 403; worker/internal calls unexposed
  (404 asserted). `server.ts` dispatches (503 without a
  database); `start.ts` wires support + collaboration (the
  notifications composition is shared, not doubled).
- `#/support` (workspace nav): ticket list with per-status
  transition, file form, access request/decide/revoke forms
  with receipt ids, incident list, operator link only for
  operator sessions.
- `#/operator` (no nav): session-role gate refuses owners
  before any data fetch; operators get incident
  report/ack/resolve, inspect-then-fenced-action with the
  epoch from inspect (reset after every attempt), and the
  action audit.
- `#/threads?run=` (linked from run detail): run-scoped
  thread list, create form prefilled with the run's own
  submit digest, per-thread comments with post/edit/history,
  resolve, audience, share/revoke, and outdated labels.
  Bodies render through the escaping builder; the server's
  active-markup refusal surfaces verbatim.

Acceptance checks: component 122/122 (16 new: 6 support +
4 operator + 6 threads); http 33/33 (6 new, stub stores);
native teamwork-http 6/6 (real PG16 + real server as
app_user, incl. member invite/accept, NEG3-34 both
directions, lease-fence drain, XSS boundary refusal,
outdated marking, cross-tenant 404); typecheck 0; lint 0
(165 modules / 508 deps, zero violations); `pnpm build` 0;
`pnpm build:ui` 0; native E2E teamwork spec plus six prior
specs, all green (gate §16).
Protected oracle / proof scope: teamwork mechanics only;
comments carry no verdict linkage; publish/outbox untouched.
Artifacts expected: teamwork routes, three pages, native +
E2E tests, coverage rows — present.
Actual commands + exit codes: `pnpm test:ui` → 0 (122/122);
`pnpm vitest run tests/http` → 0 (33/33);
`pnpm vitest run --config vitest.native.config.ts
tests/native/teamwork-http.test.ts` → 0 (6/6, disposable
PG16 `cp-teamworkhttp-pg`, torn down);
`pnpm typecheck` → 0; `pnpm lint` → 0 (165/508);
`pnpm build` → 0; `pnpm build:ui` → 0;
`node tests/e2e/run.mjs teamwork` → 0 (`e2e ok: teamwork`,
also at 390px and dark); `pnpm test:e2e` → 0 (all seven
specs).
Status + remaining blocker: allocated task `done`. Full
WP3-30 stays open: phase-7 acceptance (gap APIs, workers).
Next dependency-ready task: T-49 (executed next, §17+).

## 16. T-48 interface-quality gate (required before handoff)

Method: the teamwork spec carries the gate — axe on support
+ operator console + threads, overflow query,
console/pageerror collection, zero-external-request assert —
at 1280px, 390px (`CP_E2E_WIDTH=390`), and dark
(`CP_E2E_DARK=1`).

Findings:

- Overflow probe flagged an `input`: form controls scroll
  long values internally by design, so the probe now skips
  `input`/`textarea`/`select` like `pre`/`code` (probe
  correction in all three owning specs, not a product
  change).
- axe `select-name` on the threads page: the per-thread
  audience select had no accessible name — fixed with an
  `aria-label` in `threads.ts`, then green.

Evidence after fix: `e2e ok: teamwork` at all three
configurations; zero axe violations; zero overflow; zero
console errors; zero external requests. Verdict: ship.

## 17. Phase-6 status: T6-1..T6-7 done, T6-8 remains

Allocated tasks T6-1..T6-7 (T-42..T-48) are `done` with the
proof above. T6-8 (T-49: billing/BYOK/enterprise UI) is
`not_started`, so phase-6 as a whole stays `in_progress`; the
next dependency-ready task is T-49 (T6-8). Full
WP3-12/14/21/22/24/25/26/27/28/29/30/31/32 and every G3 gate stay
open until phase-7: pilot access, backend gaps (§§5–6, §9),
production hardening, workers/real execution, and
whole-system qualification all remain. No gate passes on UI
evidence alone.

## 18. T-49 / T6-8 / WP3-24+31+32 — billing / BYOK / enterprise UI

Task ID / parent WP: T-49 (T6-8) / WP3-24+31+32.
Requirement IDs: FR3-34/43/44; NEG3-21/36/37/38.
User-visible outcome: a billing page (period cap, consumed,
reserved, remaining, open reservations, and an honest
no-invoice-listing note) and an enterprise page (BYOK
provision/lookup/rotate/revoke over fingerprints only, SAML
provision/rotate/link/disable, SCIM mint-once/revoke) — every
control over a real endpoint, key material never rendered.
Prerequisite evidence: T-42..T-48 allocated `done`; T-24 usage
+ T-31 distribution + T-32 identity stores and wiring
(task-level `done`); backend audit in this section.
Allowed source/config changes: `src/http/{routes-enterprise,
index,server,start}.ts`, `apps/dashboard/src/{main,
pages/billing,enterprise}.ts`, component tests,
`tests/{http/t49-enterprise,native/enterprise-http,
e2e/specs/enterprise}.mjs`, `docs/feature-coverage.md`, this
report. One route-mapping fix (`owner or admin`), one
boundary-typing fix (orchestrator types); no contract,
policy, verdict, threshold, or store-behavior changes.

Backend audit (verified in source before UI work):

- `UsageStore`: entitlement + reservation + consumption
  ledger with `readBalances`; `recordPaymentEvent` verifies
  the provider HMAC, ignores idempotent replays, and refuses
  a refund without a recorded charge (NEG3-36). No HTTP
  exposes the webhook — native calls the store directly.
- `ByokStore` (V9): provision requires the broker to already
  hold the ref (out-of-band CLI/vault onboarding; fails
  closed otherwise), rows carry fingerprints only, rotation
  versions, revoke-then-read shows `revoked` (NEG3-37).
  Member writes refused; member reads allowed.
- `SamlStore`: owner/admin provision with a real
  certificate-fingerprint gate (garbage PEM refused),
  rotation, disablement, and subject links that require a
  current membership — email similarity never merges
  (NEG3-38). Issuer/audience/destination pinned per tenant.
- `ScimStore`: owner/admin mint returns the value once
  (stored hashed); revoke is tenant-scoped and idempotent —
  foreign and already-revoked ids both answer
  `revoked: false`, indistinguishably, so no existence leaks
  across tenants (NEG3-21). An earlier draft mapped foreign
  revokes to 404; source review showed that would leak
  token existence, so the route keeps the store's quiet
  contract and the tests assert it.
- Gaps recorded, not faked: no invoice/payment-method
  listing, no credential/token listing (pasted ids), no user
  lookup (typed ids), broker preload out-of-band only.

What was built (tests-first):

- `src/http/routes-enterprise.ts` (new): balances read,
  BYOK provision/get/rotate/revoke, SAML get/provision/
  rotate/link/disable, SCIM mint/revoke. Unknown/missing →
  404; `owner or admin` refusals → 403 (fixed mid-task: the
  real guard says "requires", the first pattern matched
  only "require"); unmapped store errors → 400 by the
  server frame. `server.ts` dispatches (503 without a
  database); `start.ts` wires usage + distribution +
  identity saml/scim with an empty runtime broker (fail
  closed by construction). Route types come from
  orchestrator compositions only (boundary fix §19).
- `#/billing` (workspace nav): period line with remaining
  arithmetic, reservations table with run links, empty
  state, invoices card with the no-listing note, error
  retry, guest login card.
- `#/enterprise` (workspace nav): BYOK card (provision
  form, lookup-by-ref with fingerprint/rotation detail,
  rotate, revoke), SAML card (empty-state provision form
  with PEM textareas, connection detail, rotate, explicit
  subject link, disable), SCIM card (mint-once display,
  revoke-by-id with the quiet already-revoked-or-unknown
  message). Server refusals surface verbatim.

Acceptance checks: component 132/132 (10 new: 4 billing +
6 enterprise); http 38/38 (5 new, stub stores); native
enterprise-http 5/5 (real PG16 + real server as app_user,
incl. HMAC webhook +/- replay, charge-before-refund,
broker-missing 404, rotation 2, member-write 403,
real-key SAML cycle, SCIM fence proof via own-revoke-true
after the foreign attempt); typecheck 0; lint 0
(168 modules / 526 deps, zero violations); `pnpm build` 0;
`pnpm build:ui` 0; native E2E enterprise spec plus seven
prior specs, all green (gate §19).
Protected oracle / proof scope: enterprise mechanics only;
no verdict, policy, or publication linkage; payment
provider stays a recorded decision (test HMAC only).
Artifacts expected: enterprise routes, two pages, native +
E2E tests, coverage rows — present.
Actual commands + exit codes: `pnpm test:ui` → 0 (132/132);
`pnpm vitest run tests/http` → 0 (38/38);
`pnpm vitest run --config vitest.native.config.ts
tests/native/enterprise-http.test.ts` → 0 (5/5, disposable
PG16 `cp-enterprisehttp-pg`, torn down);
`pnpm typecheck` → 0; `pnpm lint` → 0 (168/526);
`pnpm build` → 0; `pnpm build:ui` → 0;
`node tests/e2e/run.mjs enterprise` → 0 (`e2e ok:
enterprise`, also at 390px and dark); `pnpm test:e2e` → 0
(all eight specs).
Status + remaining blocker: allocated task `done`. Full
WP3-24/31/32 stay open: phase-7 acceptance (live-IdP row,
payment provider, gap APIs, workers).
Next dependency-ready task: T-50 (phase-7, G3-01/G3-02).

## 19. T-49 interface-quality gate (required before handoff)

Method: the enterprise spec carries the gate — axe on
billing + enterprise, overflow query, console/pageerror
collection, zero-external-request assert — at 1280px,
390px (`CP_E2E_WIDTH=390`), and dark (`CP_E2E_DARK=1`).

Findings:

- E2E SAML-link timeout: the rotate step waited on issuer
  text that was already visible, so the follow-up fills
  raced the card re-render (spec race, not a product bug).
  Fixed by waiting for the rotate POST response before
  touching the re-rendered form — then green.
- Component-test stubs: a malformed error envelope
  (`error:` as a string, which the server never sends)
  crashed `errorState` in happy-dom — stub corrected to
  the real envelope; and PEM fields moved from `input`
  (which strips newlines) to `textarea`.

Evidence after fix: `e2e ok: enterprise` at all three
configurations; zero axe violations; zero overflow; zero
console errors; zero external requests. Verdict: ship.

## 20. Phase-6 status: T6-1..T6-8 done, phase-7 next

Allocated tasks T6-1..T6-8 (T-42..T-49) are `done` with the
proof above: shell, public site, auth/settings, runs,
evidence, inbox/search, teamwork, billing/enterprise —
132 component, 38 HTTP-unit, full native per slice, and
eight E2E specs green with the quality gate shipped per
task. Phase-6 as a whole is `done` on its allocation. Full
WP3-12/14/21/22/24/25/26/27/28/29/30/31/32 and every G3
gate stay open until phase-7: pilot access, backend gaps
(coverage gaps list), production hardening, workers/real
execution, and whole-system qualification all remain. No
gate passes on UI evidence alone. Next dependency-ready
task: T-50 (phase-7, G3-01/G3-02 + qualified-guest probes).

## 21. UI demo-readiness follow-up — 3 November 2026

Plan revision 2. User authorized UI ownership and bounded local integration
repairs after T-55; this is not an invocation of another acceptance phase.
Historical results above remain historical, not fresh qualification claims.

```text
Team assignment ID / task ID / parent WP: UI demo-readiness follow-up / T6-1..T6-8 / WP3-27,25,29
Owner: Hoang (user-authorized UI ownership)
Requirement IDs: BR3-10/14/17; FR3-31/37/38/39/40; NFR3-08/10/14; relevant NEG3-21/29/33
User-visible or system outcome: Mockup-aligned public/auth/workspace UI, usable compact/mobile navigation, real API errors and honest sample/readiness labels.
Prerequisite evidence and identities: Clean feature branch from origin/development 1977172; T-40..55 reports inspected. Windows x64; Node 26.12.1, pnpm 12.5.1, TS 5.9.3, Vite 7.1.7. Task intake preserved before implementation in the external evidence directory.
Allowed source/config changes: apps/dashboard, related tests/e2e specs, frontend README/coverage/report. No backend policy, contract, worker or security-boundary changes.
Input snapshot and intended intervention: Mockup SHA256 39E85A9C708EE313FCC42E5ABF4B6C43532D256D0E98D4BE2FA0E2E01B92FBE8. Extract final visual tokens, preserve framework/assets, fix demonstrated UI/proxy failures.
Acceptance checks (positive, negative, native): Real public entry/API navigation; keyboard/theme/mobile; delayed responses; account/health/error handling; real dev-proxy POST and cross-origin refusal; existing account/run/evidence/team/billing E2E.
Protected oracle / proof scope: Existing assertions/authorization retained; synthetic reports remain labeled; no model, guest, publication or organic-impact proof. No schema/policy/contract versions changed.
Artifacts expected: UI changes, regression tests, screenshots, command receipts, baseline failure comparison, PR draft.
Actual commands + exit codes: See table below and external *.command.json receipts.
Mock/replay result: UI components 143/143 pass (baseline 132/132); failure-path tests were red first. These use happy-dom/stubbed fetch and do not qualify real services.
Native/real-runtime result: Real Edge 156.0.4314.58, local HTTP/PostgreSQL 16/Mailpit; final combined E2E result recorded below. Screenshot capture: 11 states, zero axe violations, horizontal overflow or page errors. Existing E2E seeds test grants/entitlements; this does not prove a live AI workflow.
Missing checks / blockers: Semgrep binary/approved ruleset/version/setup and named specialist skills unavailable; no claimed scan/skill pass. Full suite has 31 reproduced baseline failures. Muse transport/worker and qualified Modal execution are not wired into HTTP startup. No deployment, paid provider calls or credentials used.
Allocated task status: in_progress (review and missing checks)
Full-WP status (separate): No full WP or G3 gate closed by this follow-up.
Next dependency-ready task: Reyn review of this UI slice and provider/worker/qualified-runner decisions; no other engineering task started.
Reviewer: Reyn
```

### Changes and interface-quality review

- Final neutral/navy mockup tokens, frosted shell, self-hosted fonts and compact
  SVGs; public/auth headers, responsive hero/footer and mobile navigation.
- Public default entry with explicit workspace route, accessible architecture
  tabs, safe query parsing, route-epoch guards and loading/error/retry states.
- Overview separates live API/account facts from unassessed repair readiness.
  Existing samples remain synthetic; queued never means repaired.
- Strict API-envelope handling and a local Vite API proxy. A real failing
  same-origin POST demonstrated Vite shorthand rewrites Host; explicit
  `changeOrigin: false` fixes it while foreign Origin still returns 403.
- Mockup inspected across all style/script/asset sections without printing font
  data. Its original JavaScript has syntax errors (`Unexpected token 'class'`,
  then missing route/auth globals), so exact live-page comparison is unavailable.
  Original mockup untouched. Visual comparison used its final computed tokens
  and static layouts, plus before/after screenshots; no pixel-perfect claim.
- Real browser gate: keyboard focus/skip link, Escape, mobile menu, light/dark,
  1440/768/390/375px, axe, overflow, local assets and error/recovery. Transient
  theme contrast failures found and fixed by removing color transitions on the
  affected navigation/action surfaces. No arbitrary animation redesign.
- Required specialist skills are absent from this environment. Manual review and
  axe do not substitute for those missing checks or Semgrep qualification.
- Supplementary references requested during review: Dribbble's SaaS dashboard
  gallery and React Bits. Consulted without copying assets/code, adding React or
  introducing dependencies. The repository mockup remains the governing design.
- An additional drawer regression initially assumed the Resources summary was
  the final focusable item; actual account links follow it. That incorrect test
  assumption was corrected, the unnecessary implementation experiment removed,
  and the actual first/final-link focus loop verified in the final green run.

### Actual verification

All pnpm entries below used the isolated Node 26.12.1 and pnpm 12.5.1 with
`--config.verify-deps-before-run=false --config.offline=true run` before the
script name. Exact argument arrays and logs are in
`D:/20261/.changeproof-review/UI-1793683235015/` (outside the repository).

| Command | Exit | Actual result |
| --- | --- | --- |
| `pnpm test:ui` | 0 | 143/143, 20 files; baseline 132/132 |
| `pnpm typecheck` | 0 | Backend and dashboard strict check |
| `pnpm lint` | 0 | ESLint + src/apps boundaries, 168 modules/530 deps |
| `pnpm lint:boundaries` | 0 | src boundaries, 147 modules/455 deps |
| `pnpm build` | 0 | Backend build |
| `pnpm build:ui` | 0 | Production dashboard bundle |
| `CP_PORT=4181 pnpm test:e2e` | 0 | 10 suites: auth, demo, dev-proxy, enterprise, evidence, inbox, public, runs, shell, teamwork |
| `pnpm test --maxWorkers=2 --reporter=json --outputFile=<evidence>/feature-full.json` | 1 | 1442 pass / 31 fail / 0 skipped |
| Same full command on archived unmodified 1977172 baseline | 1 | 1442 pass / 31 fail / 0 skipped; same failing identities, zero new/resolved failures |
| `pnpm test:runner-security:native --dry-run` | 2 | Project .venv missing; no Modal execution attempted |
| External final screenshot capture | 0 | 11 screenshots, real Edge; zero axe/overflow/page errors |
| `git diff --check` | 0 | No whitespace errors |

The full-suite failures are not assumed harmless: native TS fixture harness
cannot find its hard-coded pnpm shim; Python fixture import/framework paths,
offline Go framework dependencies and Windows temporary-path/architecture
cases also fail. They occur in both identical-toolchain trees (including
NEG-suite imports of those same cases); their qualification needs separate
work. Root `pnpm test` excludes dashboard components, hence the separate UI run.

Dependency restoration used the unchanged frozen lockfile with `--ignore-scripts`;
offline attempt exited 1 (uncached metadata), frozen registry restore exited 0.
No new dependency, build approval, registry/PATH or repository package-config
change. Existing Docker Desktop was started for local disposable services.

Muse: the injected ModelTransport/broker and composeAgent exist, but no concrete
Muse HTTP transport or repair-worker composition exists in HTTP startup. Modal:
qualification tooling exists, not a wired product runner; missing .venv prevents
even dry-run setup. Credentials alone do not close either integration. Reyn
must approve/provide provider identity/access and qualified worker/guest wiring.
Do not showcase a completed AI repair while those are unavailable.

Local review preview: `http://127.0.0.1:4183/`; captured mail only at
`http://127.0.0.1:18026/`. Disposable PostgreSQL/Mailpit, no customer source or
model/runner, no seeded preview users. E2E uses a separate disposable stack.
Demo: public landing -> templates/help -> clearly synthetic report -> workspace
overview; optionally local email registration/verification with Mailpit. This
proves UI/account mechanics only. Repository grants/entitlement provisioning,
live model/sandbox/worker and real publication remain separate prerequisites.
The redundant public-only server on 4179 and Vite server on 5173 were stopped
after verification; only the database-backed preview on 4183 and its owned
PostgreSQL/Mailpit services remain for local review. No other process stopped.

## 22. Focused visual-polish and final review — 3 November 2026

Continuation of §21's user-authorized UI scope and intake, not a new task or
gate. Reviewed the complete 21-file working diff, the original mockup and fresh
native captures. Preserved existing source work; before-polish diff/hashes are
saved in the external evidence directory under `polish/`.

Changes in this pass: compact two-column mobile overview cards (one column below
350px), aligned mobile overview heading, auth form before supporting copy on
narrow screens, explicit Muse/Modal names in the existing unconfirmed-readiness
notice, and vertical ARIA tab semantics with Up/Down/Home/End keyboard support
(existing Left/Right retained). Six existing source/test files plus this report
and the coverage record changed; total working-tree file set remains 21.

Dribbble SaaS references informed restrained hierarchy/card density; React Bits
was inspected as optional inspiration. No third-party code/assets copied, no
React migration, dependency/license addition or new animation. Existing fonts,
navy identity and mockup tokens preserved. Full diff review found no unrelated
changes or suspected credentials; this manual review is not a secret-scanner or
Semgrep qualification. Package/lockfiles, backend/contracts and mockup untouched.

Tests-first evidence: status-copy check exited 1 (1 fail/2 pass) and vertical-tab
check exited 1 (1 fail/7 pass) before the corresponding changes. The first new
canvas check exposed ignored options passed to BrowserContext.newPage; fixed
the test to use explicit setViewportSize/emulateMedia, not the animation code.
The canvas then stayed identical across native frames with reduced motion. An
initial login test selector assumed an unused CSS class; corrected to the real
auth card. Intermediate ESLint errors for the browser RAF global were corrected
with explicit window qualification. These intermediate failures remain recorded.

Fresh Windows x64 verification, isolated Node 26.12.1/pnpm 12.5.1:

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm test:ui` | 0 | 143/143, 20 files |
| `pnpm typecheck` | 0 | Strict backend/dashboard |
| `pnpm lint` | 0 | ESLint + boundaries, 168 modules/530 dependencies |
| `pnpm lint:boundaries` | 0 | 147 modules/455 dependencies |
| `pnpm build` / `pnpm build:ui` | 0 / 0 | Production builds |
| `CP_PORT=4181 pnpm test:e2e` | 0 | All 10 suites; explicit viewport/media, mobile layout and native keyboard/motion assertions |
| `pnpm test --maxWorkers=2 --reporter=json --outputFile=<evidence>/polish-full.json` | 1 | 1442 pass/31 fail/0 skipped; identical failing identities to unmodified 1977172 baseline; zero new/resolved failures |
| External `polish/capture.mjs` | 0 | 14 captures, real Edge 156.0.4314.58, zero axe/overflow/page errors; failure/retry included |
| `git diff --check` | 0 | Clean |

Same pnpm flags/environment as §21; exact receipts use `polish-*` names in
`D:/20261/.changeproof-review/UI-1793683235015/`. Component tests remain
happy-dom/stubbed fetch. Native browser checks use real local HTTP/PG/Mailpit;
no Muse, Modal, customer repair, Linux or live deployment proof. Capture covers
home/overview/login at 1440/390 in both themes, plus light desktop/dark mobile
network-failure states; demo E2E also checks 768/375. Original mockup opened in
Edge again: its three JS errors still prevent populated route/pixel comparison;
static layouts and final computed light/dark tokens are the available reference.

Status: `in_progress`, bounded UI demo ready for review. Missing Semgrep/approved
ruleset/version/setup and specialist skills, Muse transport/repair-worker and
qualified Modal runner remain §21 blockers. The same 31 baseline failures remain
separate from this green UI pass. No full WP/G3 status changed. Next: Reyn review
and missing verification/integration decisions; no new assignment started.

## 23. Landing reconstruction — user-corrected visual source

The user rejected the earlier interpretation and explicitly designated root
`mockup.html`, **not** `.template-ui/mockup.html`, as the authoritative visual
input. SHA256: `6998e21248e413013b555eb6a04ffffe4ef3f6e385a71ae574998ba51051bf8f`.
The root file opens directly in Edge with zero JavaScript errors. The syntax
errors/repair discussed in §§21–22 concerned the wrong reference and are **not**
a blocker for this input. Neither reference file was modified. The untracked
root input is user-owned and excluded from implementation diff artifacts.

Scope continues the UI follow-up intake in §21, limited to landing reconstruction
and its tests/assets/report. No other page redesign, provider work, policy,
contract, package or security-boundary change. The original 21 changed files were
snapshotted byte-for-byte before reconstruction under the external `landing/before`
directory so the rejected implementation remains recoverable.

Concrete prior gaps: full-width centered composition became a two-column white
card; 108px Inter headline/highlight became a smaller brand heading; the dense
particle wave became four faint strokes; floating nav became two navigation
rows; two pill CTAs became three rectangular actions; ecosystem logos became
internal-pipeline labels; mobile hero extended far below the intended viewport.
These were implementation choices, not backend constraints.

Changes: landing-only DOM component and scoped consolidated CSS, exact original
WebGL shader/particle equations and native 2D fallback ported to strict TS, nine
unchanged embedded SVG marks with their Devicon MIT notice, actual existing route
links and theme control. Timers/observers stop on route departure; reduced motion,
hidden/offscreen pause and theme/resize redraw retained from the reference. The
existing interactive walkthrough is retained below the reconstructed hero/strip;
the full lower-page folders/pricing composition is not claimed reproduced yet.

Intentional differences: no false GitHub-connected/evidence-collected status in
the release pill/caption; Muse/Modal unavailable and illustrative-preview notice;
slightly darker small-text colors for AA contrast. Root mockup typography is
used on this landing under the user's explicit faithful-reconstruction direction.
Other pages retain their existing typography/design and behavior.

Native comparison: original root file and app captured directly at **1440×900**
and **390×844**, same Edge 156.0.4314.58, light theme and reduced-motion freeze.
Side-by-side comparison images are actual screenshots, not generated renders.
Hero/nav/headline/subtitle/CTA-row/technology-strip bounds agree in those captures;
the changed disclosure text has a slightly different pill width. Largest visible
differences (CTA width, extra strip border, logo size) were corrected after the
first comparison. Final light captures: zero axe violations, overflow/page errors.
Dark browser checks also passed; do not call the entire full landing pixel-identical.

Fresh commands with the same pinned environment/flags as §21:

| Command | Exit | Actual result |
| --- | --- | --- |
| `pnpm test:ui src/pages/public.test.ts` (red first) | 1 | Required hero structure absent: 1 fail/8 pass |
| `pnpm test:ui` | 0 | 144/144, 20 files |
| `pnpm typecheck` | 0 | Strict backend + dashboard |
| `pnpm lint` | 0 | ESLint/boundaries, 171 modules/534 dependencies |
| `pnpm build:ui` | 0 | Production bundle, no dependency changes |
| `CP_PORT=4181 pnpm test:e2e` | 0 | 11 suites, including native WebGL/2D/motion cleanup; all existing flows retained |
| `pnpm test --maxWorkers=2 --reporter=json --outputFile=<evidence>/landing-full.json` | 1 | 1442 pass/31 fail/0 skipped; same identities as unmodified 1977172 baseline, zero new/resolved failures |
| `landing/capture-comparison.mjs` | 0 | Original/app desktop/mobile captures + side-by-side artifacts |
| `git diff --check` | 0 | Clean |

Early TS/nullability/unused-source-variable, native contrast, browser test-global
and registration-heading selector failures were corrected, not suppressed; all
intermediate receipts remain. Unit tests are mocked/happy-dom. Native UI checks
use real Edge/HTTP/local PG/Mailpit, not model or qualified guest execution.

Evidence: `D:/20261/.changeproof-review/UI-1793683235015/landing/` contains root
reference identity, before snapshots, comparison PNG/HTML/JSON, asset hashes,
landing-only/full implementation diffs and baseline comparison. Command receipts
use `landing-*` names in the parent directory. Existing Semgrep/specialist-skill,
Muse/worker/Modal and 31 baseline blockers remain; no full WP/G3 status promoted.
Status `in_progress`, awaiting the user's visual approval of the landing before
any further page design work. No commit/push/PR/merge/deploy performed.


## 24. Root mockup full frontend port — 4 November 2026

Plan revision 2; session-authorized UI follow-up across the existing T6-1..T6-8 allocation. This record supersedes the previous landing-only approval stop; historical evidence above is unchanged. User explicitly selected ROOT mockup.html, not .template-ui/mockup.html.

Task / requirement scope: FR3-31/37/38/40, NFR3-14/15; public/auth/workspace presentation and existing HTTP flows. Allowed changes: dashboard source/tests/styles, native browser checks, feature/report docs. No backend/core/policy/contract/spec/package/lockfile changes. Prerequisites: HEAD1977172 on feat/ui-demo-ready; root reference SHA2566998e21248e413013b555eb6a04ffffe4ef3f6e385a71ae574998ba51051bf8f; recoverable complete workspace backup plus source-before.tar containing approved Register.

All62 root screens inventoried and mapped. Seventeen public layouts directly ported; Landing contains hero/canvas/technology strip, three-step preview, four-area capability folder, inline pricing, closing CTA/footer. Product/Pricing keep dedicated original compositions. How it works is an explicit Verification alias. Public errors return to public landing; back/forward/refresh regressions pass. Auth retains approved Register and real password10–128/confirmation/non-enumerating recovery/server return-target rules. Original standalone/modal patterns used for other account states, with English copy. Workspace shell, projects/drafts, usage/account/settings and existing run/evidence controls retain real APIs. Actual null billing period/cap from new organizations is now a tested empty state.

Sixteen workspace screens have source-specific structural layouts with disabled controls and explicit missing HTTP integration reasons (workspace.ts); rich graphs/campaigns/investigation/publication/outcome/audit/evaluations/provider access remain unavailable. No mockup tenant/count/verdict is presented as real. The public product diagram is explicitly illustrative. Legal/pricing/service commitments remain drafts/unqualified. Full functional or pixel parity is not claimed.

Final commands used existing isolated Node26.12.1/pnpm12.5.1 and process-local offline flags: pnpm --config.verify-deps-before-run=false --config.offline=true run <script>.

| Script / check | Exit | Actual result |
| --- | --- | --- |
| test:ui | 0 | 162/162,21 files; mock/happy-dom |
| typecheck | 0 | strict server/dashboard |
| lint | 0 | ESLint+boundaries,183 modules/556 dependencies |
| build | 0 | backend tsc |
| build:ui | 0 | production UI |
| CP_PORT=4181 test:e2e | 0 | all12 native browser specs, actual HTTP/PG/Mailpit |
| test:e2e public demo | 0 | explicit public 404/How it works/history/refresh and visual bounds |
| test:e2e demo enterprise | 0 | workspace/mobile/theme/billing checks |
| test (feature and unmodified development1977172) | 1 /1 | identical31 full failure identities;1442pass,31fail,0skip; zero new/resolved |
| native screen capture / navigation / image composition | 0 | 62 screens ×2versions ×2sizes;44 discovered internal destinations, no404 |

Failure-first Billing shape test:1fail/3pass ->4pass; null-entitlement failure:1fail/4pass ->5pass. Earlier auth/layout/contrast/selector failures were corrected rather than filtered; all raw logs retained. Native keyboard activation opens capability areas in original/app. The original's sheet centers can be occluded; no forced click is used as interaction proof.

Actual visual evidence: same Edge156.0.4314.58,1440x900 and390x844,DPR1/light/reduced-motion;496individual full/viewport screenshots plus248side-by-side images. Source original check/reset/verify scripts emit invalid '.' selector errors (reference unchanged); final app124captures have no JS error, overflow, missing H1 or404. Capture-only content-visibility override exposes off-screen original sections in both versions. Modal viewport captures are primary auth comparison because app correctly locks its inert background. These observations are not a pixel-parity claim.

Native real-service journey: public preview -> email registration -> local Mailpit verification -> organization/login -> project -> versioned draft/save/refresh -> honest unconfigured usage. Docker Desktop recovered using installed engine/cached images, unique preview containers; existing baseline4184 unchanged. Current preview4183 has real local DB/email. No Muse/Modal/worker execution, sandbox qualification, paid call, real billing or publication was performed.

Artifacts: D:/20261/.changeproof-review/frontend-port-20261103-232653/index.html (all screen comparisons),final-report.md,route-inventory.json,navigation-inventory.json,final-screen-capture.json,verification.json,regression-comparison.json,review.diff,changed-files.json and command logs. No source changes in isolated baseline.

Missing checks/blockers: Semgrep has no approved scanner/version/ruleset/setup available; mandatory UI/security specialist skills absent from catalog. Provider/worker authorization, sixteen workspace HTTP surfaces, production profile/pricing/legal and full system acceptance remain open. Engineering status in_progress; every full WP/G3 status unchanged. Next: user visual review and Reyn's explicit missing integration contracts; no automatic unrelated task. No commit,push,PR,merge or deploy.


## 25. UI PR review remediation — 4 November 2026

Scope: the three user-approved review findings only; existing feat/ui-demo-ready work and root reference preserved. Source before remediation is archived with hashes at D:\20261\.changeproof-review\ui-pr-remediation-20261104-111613/source-before.tar. No design, backend, API contract, policy, dependency or runtime configuration change.

- P2: authorized() now receives its caller's frozen route epoch and checks it before returning authorization or writing a guest state. Project creation captures the same epoch and withholds stale failure rendering. Existing project-search/layout import guards remain. Current401 errors, login links and retry behavior are preserved.
- P3: README uses PORT for HTTP startup, explains CP_PORT belongs to the E2E harness, identifies the local root mockup and committed font notices. The root reference remains outside the implementation commit.
- P3: the Landing test compares the complete ordered sequence of its four required sections with toEqual, retaining existing workflow/folder/footer assertions.

Tests first: workspace tests exited1 with8fail/14pass before implementation. Focused workspace/public tests then exited0 with35pass. Fifteen delayed-session cases cover guest/authenticated/401/503/network failure across projects/new-project/impact, plus active expiry/retry and stale project-search coverage. Full UI is now181/181 (21files). Initial lint exited1 for deferred<void> in the test helper; changed to deferred<undefined> without changing behavior/assertions, final lint0.

Native: all12E2E suites exit0, including actual200session responses held and delivered after rapid navigation away from each of the three workspace routes. Those tests delay a real response; they do not fabricate authentication. Auth/reset/return-target and existing service error tests remain green.

Origin: exact new workspace module/routes do not exist in unmodified development1977172, so that implementation defect belongs to this feature. A similar existing Settings race is also reproduced on the unchanged baseline preview4184: actual503session response delayed until Pricing is visible then replaces Pricing with Settings unavailable, while URL stays Pricing. This is a separately recorded pre-existing UI defect, outside this bounded workspace fix; it is not one of the31root-suite failures and not a new regression introduced here. Initial diagnostic expected a guest login card, but the real public-only baseline returns503; the corrected probe asserts its actual error state and exits0. Baseline source remains clean.

Fresh pinned Windows verification, same process-local Node26.12.1/pnpm12.5.1/offline flags as §24:

| Command | Exit | Actual result |
| --- | --- | --- |
| test:ui workspace.test.ts public.test.ts | 0 | 35pass |
| test:ui | 0 | 181pass /21files |
| typecheck | 0 | strict server/dashboard |
| lint | 0 | ESLint +183modules/556dependencies, no violations |
| build / build:ui | 0 /0 | fresh backend/UI bundles |
| CP_PORT=4181 test:e2e | 0 | all12specs |
| test, feature / clean development1977172 | 1 /1 | both1442pass/31fail; identical full failure identities, zero new/resolved |
| native baseline delayed-response probe | 0 | analogous Settings race reproduced, source unmodified |

Artifact directory: D:\20261\.changeproof-review\ui-pr-remediation-20261104-111613/ contains exact command receipts/logs, regression-comparison.json, baseline-race.json, final report, PR draft, source hashes and staging manifest. Historical screenshot captures in §24 remain visual evidence; this remediation changes no UI geometry/CSS.

Statusin_progress for frontend/WPs: the three scoped fixes are verified;16workspace integrations, Muse/Modal/worker/GitHub access, approved Semgrep and full-system evidence remain open. No complete frontend, global async-race elimination, AI repair or sandbox qualification claim. Next: user/Reyn review; baseline Settings race requires its own bounded follow-up. No staging,commit,push,merge,deployment or PR creation performed.

## 26. UI visual-polish pilot — Landing and Workspace Overview (2026-11-04)

User-authorized scope only: Landing, Workspace Overview and minimal shared tokens/original SVG diagrams. Based on approved UI commit `667803844c0da8aa887223f4145bb65331685810`, on separate local `feat/ui-visual-polish-pilot` with no upstream. The baseline UI PR remains separate and unmerged into recorded development `19771728312981a2737fee5eb4b8f0cc6ea29d58`. Root `mockup.html` is preserved/untracked; its external backup matches SHA256 `6998e21248e413013b555eb6a04ffffe4ef3f6e385a71ae574998ba51051bf8f`.

Requirements: FR3-31/37 and NFR3-14; preserve FR3-40 navigation/search behavior. No contract, policy, security, dependency or support-level changes. Product, Pricing, Auth and other workspace pages are excluded from redesign. Landing's existing inline pricing, capability folders and footer remain present; the dedicated Pricing route is unchanged.

Landing gains a scoped charcoal/blue and coherent light palette, Jakarta hierarchy, quieter controls/surfaces, a three-tab change explorer with an explicitly illustrative original relationship diagram, and mobile public navigation. Existing particle canvas, all sections, folder interactions and destinations remain. Overview replaces repeated summary/status cards with a factual service strip, auth-aware next action, original illustrative change/evidence map, linked action rows and explicit prerequisites/unavailable states. Only health/session endpoints are requested; no run statistics or integration success is fabricated. API health is separate from repair readiness. Unknown account service stays Unavailable, and health failure stays an actionable retry. Existing route-epoch guard is retained.

Tests-first: initial focused command exit1 (3 new failures,16 pass); after implementation exit0 (19 pass). Final verification uses isolated Windows Node26.12.1 / pnpm12.5.1 with process-local toolchain PATH, `--config.verify-deps-before-run=false --config.offline=true`. No packages installed or external providers called.

| Actual pnpm run command (same offline prefix) | Exit | Result |
| --- | --- | --- |
| test:ui apps/dashboard/src/status.test.ts apps/dashboard/src/pages/public.test.ts | 0 | 19 pass after red phase |
| test:ui | 0 | final184 pass /21files |
| typecheck | 0 | strict server + dashboard |
| lint | 0 | ESLint +187modules/563dependencies, no boundary violations |
| build | 0 | backend output generated; backend source unchanged |
| build:ui | 0 | final pilot bundle generated |
| test:e2e | 0 | all12nativebrowser suites |
| test --reporter=json --outputFile=<external feature JSON> | 1 | 1442pass/31fail |
| same full test in clean development1977172 | 1 | 1442pass/31fail; exact failure identities match, zero new/resolved |

The first native E2E pass exit1 exposed new contrast and definition-list markup issues; both were fixed. Focused rerun exit1 then exposed an incorrect new test locator assuming a summary button role; changed to the actual native summary and verified keyboard Enter/Escape without changing semantics. Final complete12suite run exit0, including axe scans, mobile drawer/menu keyboard, reduced-motion canvas, HTTP failures/retry, existing public/auth/navigation checks and actual email-verified account -> authenticated Overview -> project -> saved revision journey. Synthetic UI tests are not native proof; browser/HTTP/Postgres/Mailpit evidence is local real-runtime proof only, not live Muse/Modal/GitHub/worker or customer repair qualification.

Visual evidence: same real Edge156.0.4314.58, deviceScaleFactor1, reduced-motion,1440x900desktop and390x844mobile.12before +12after states, each full-page and viewport; includes dark/light Landing, guest Overview and genuinely authenticated Overview. All24capture states report no horizontal overflow or page errors. Auth uses a real local email-verified fixture/session; session cookies/passwords remain memory-only, not screenshot artifacts.24side-by-side images label BEFORE left and AFTER right. Screenshot helper exits0. Images show the actual rendered result; user visual approval remains pending. SVG mobile layout preserves the two evidence paths rather than shrinking desktop labels. No external fonts/assets/dependencies introduced; original SVG code and existing self-hosted licensed fonts/icons only.

Artifacts: `D:\20261\.changeproof-review\ui-polish-pilot-20261104-120559` contains `index.html` comparison gallery, individual PNGs,24comparison PNGs, source hashes, exact command receipts/logs, regression-comparison.json, task intake, final report and full §5 draft. Screenshots/backups/root mockup are not commit candidates.

Missing checks/limitations: approved Semgrep setup remains absent;31root-suite failures remain reproducible on clean development. Existing16incomplete workspace integrations and Muse/Modal/GitHub/worker readiness are not solved by this visual pilot. Browser evidence is Windows Edge/local services; no new Linux/production/isolation/customer-impact qualification is claimed. Readiness diagram is explanatory, never execution evidence. Full frontend/full WP status remains `in_progress`; scoped pilot status `in_progress` pending visual approval. Next action: user approves/rejects these two pilots; no other page implementation authorized. No staging,commit,push,merge,deployment or PR creation performed.

## 27. Pilot defect remediation — no expansion (2026-11-04)

Scope remains only Landing, Workspace Overview and their necessary scoped styles/tests. All earlier pilot changes and root mockup were preserved in an external recoverable backup before editing. Branch `feat/ui-visual-polish-pilot` and both UI branch refs remain at approved6678038; no staging/commit/push/merge/PR.

Tests-first: two added public UI regressions failed initially (exit1:2fail/19pass), then passed (exit0:21pass). Verification checks now form a semantic ordered list with neutral, consistently centered01/02/03 badges. The03 row has a separate amber Incomplete label; no check is presented as having passed. Browser regression also exposed inherited green surfaces on nested divs, which are now reset only within this illustrative list. Actual badge glyph/row centering is measured natively, not inferred from CSS names.

Landing now exposes Open workspace in the first hero viewport and mobile menu, using existing `#/` Overview. Guest Overview still offers the existing sign-in form; authenticated Overview offers Prepare a change. Existing pricing/register links remain. Native tests cover keyboard activation, actual server sessions, Back/Forward, refresh and the corresponding primary action without redirect loops. Public link inventory now explicitly verifies this workspace destination rather than treating it as an external URL.

Whole-page sweep: fixed unreadable dark-mode folder step labels on white paper, overlapping mobile folder hit areas, and the selected folder control becoming invisible. All four areas now accept normal pointer clicks and keyboard activation; no forced clicks. Kept the folder visual and content. Fixed the Overview toolbar's horizontal alignment when sidebar is collapsed, and preserved collapsed navigation text for screen readers (visually hidden instead of display:none). These are pilot-only changes; other pages/backend/auth/contracts are unchanged.

Final local Windows Node26.12.1/pnpm12.5.1 verification (same process-local offline flags as section26):

| Command | Exit | Result |
| --- | --- | --- |
| test:ui apps/dashboard/src/status.test.ts apps/dashboard/src/pages/public.test.ts | 0 | 21pass after red phase |
| test:ui | 0 | 186pass /21files |
| typecheck | 0 | strict server/dashboard |
| lint | 0 | ESLint +187modules/563dependencies; no violations |
| build | 0 | backend source unchanged |
| build:ui | 0 | final pilot bundle |
| test:e2e | 0 | final all12native suites |
| native screenshot/sweep helper | 0 | 24full-page+24viewport states,4panel crops; axe/overflow/page-error checks pass |
| collapsed Overview probe | 0 | dark/light, toolbar and headingx92, axe clean |
| git diff --check | 0 | clean |

Earlier native runs exposed the inherited success surface, folder contrast/hit-area problems, missing screen-reader names when collapsed, a new test's stale scroll-position assumption and the public inventory's unrecognized new `#/` destination. All scoped defects/test assumptions were corrected before final full native exit0. Lint initially rejected unqualified browser globals in the new Node-side Playwright helper; browser callbacks now use window explicitly. Checks are real local Edge156.0.4314.58/HTTP/Postgres/Mailpit; UI unit tests remain synthetic. No live Muse/Modal/GitHub/worker or customer repair qualification is claimed.

Newly exercised integration limitation, kept separate: entering the run form in a fresh empty workspace performs a project search; creating a project afterwards may still return cached empty results. A real HTTP probe reproduced search200/count0 -> create201/id returned -> same search200/count0. No fabricated responses. That broader sequence initially failed the draft journey after the additional navigation test. Navigation assertions were retained and run after the original project/draft setup, where the real workflow passes. The failing empty-search-before-create sequence is still explicitly unverified/defective and not hidden by claiming universal E2E coverage. Queries store/routes source matches recorded development after CRLF normalization, but this specific native probe was not separately run on an unmodified development server. It is not classified as one of the prior31failures and was not fixed outside this pilot's backend boundary.

Full root suite was not rerun in this bounded remediation. The preceding section26 comparison remains historical evidence of1442pass/31identicalfail on pilot/development; no new root-suite pass claim. Approved Semgrep and existing integration blockers remain missing. Scoped status `in_progress` pending user visual review; no other page polish authorized.

Artifacts: `C:\Users\Admin\AppData\Local\ChangeProof-AI\review\ui-pilot-remediation-20261104-143405` — gallery index.html, individual full/viewport PNGs, panel crops, screenshots.json, exact command receipts/logs, source/remediation diff, backup, cache diagnostic and source comparison. D: filled during screenshot writing (ENOSPC); only this session's generated review artifacts were moved to C:. The preceding pilot artifact directory was also moved with a junction preserving its existing D: links; file inventory/lengths were verified. No source, dependencies or original mockup was deleted; D: still has only about70MB free and needs owner attention before broader work. Incomplete captures/failed scans were not counted as final evidence.

## 28. Remaining frontend visual polish and cache origin investigation (2026-11-04)

User authorized all remaining frontend groups on `feat/ui-visual-polish-pilot`, preserving approved Landing/Overview and original UI branch6678038. Before work, D: had5696540672bytes free; before later builds/browser passes it remained above5GB decimal. At final verification it had about5093257216bytes free. No existing source file or backup was moved or deleted in this continuation; no manual disk cleanup was performed. Existing tracked/untracked work was copied into a new recoverable external backup; root mockup SHA256 remains6998e21248e413013b555eb6a04ffffe4ef3f6e385a71ae574998ba51051bf8f. Source/API/auth/policy/security/dependency authority is unchanged; no package or tool installation.

Scope/requirements: user-approved visual-polish continuation, existing phase-6 frontend allocation; FR3-31/37/40 and NFR3-14, preserving existing FR3-29/30/38 account behavior. No new numbered engineering assignment or full-WP completion claim.

**Cache finding:** direct backend4183 HTTP, bypassing Vite and all frontend fetch wrappers, reproduces search200/count0 -> create201/new ID -> identical search200/count0. A different valid query(limit19) returns200/count1 and the created project. The frontend does not cache these search results. Queries store caches by tenant,user,grant version/epoch and query, including empty results; createProject/POST route does not invalidate or change that cache identity. Backend change is needed; none was made. Diagnostic limit19 is not a production workaround. Cache fix must preserve tenant/current-grant isolation and invalidate/version data consistently after successful mutations. See external cache-finding.md and direct-backend-cache.json. This observed defect is separate from31baseline test failures; exact native reproduction on an unmodified development server was not performed.

**Group1:** Product now uses a numbered feature index and an original contract/proof split illustration, replacing live-looking example run IDs/timings in its product preview. All four feature areas/headings remain. Pricing retains its asymmetric Free-tier/three-step composition with an amount-free conceptual budget lifecycle. Verification has an explicit agent/verifier/policy boundary plus its full five-step process. Sample Reports uses a responsive outcome table with prominent illustrative/synthetic labels and preserved API provenance, including source/dataset/capture identity. Public content, approved prices/readiness/legal statements and links are retained. Product/diagram states never claim a real execution or repaired target.

**Group2:** Projects uses identity/action rows; actual Runs search records are semantic responsive tables with unchanged queries/links/filter behavior. Real server counts are presented as search facts, never invented activity. Run Details has the actual event timeline and readable immutable identity metadata; Evidence has artifact/hash action rows, text preview and export boundaries. Native fixtures cover authenticated project creation, saved draft, actual queued run, cancel/retry and real seeded artifact bytes/integrity failure. A queued job is not worker/model repair proof. The populated Runs capture uses the real Queued filter; it does not establish the unfiltered cached search is fresh.

**Group3:** Auth uses the same palette, visible modal heading, readable forms and retained password/return-target/session rules. Help/search, documentation indexes, legal prose, release notes and roadmap retain their distinct structures and dynamic API content. Settings sections are separated by hierarchy/dividers; destructive action has a distinct danger treatment without changing its validation/confirmation. Shared navigation, mobile toolbar, focus and reduced motion apply across existing routes.

The16workspace routes lacking backend integration now show their actual feature-specific blocker, a conceptual missing-connection path, and real next links. The original inactive layout remains recoverable in an expandable, inert, aria-hidden design reference. This prevents dead controls/placeholder layouts from masquerading as a functional workspace. The heading, actual reason and next actions remain accessible; no axe rules were disabled. Native checks exercise opening that reference with keyboard. No original functional backend behavior was removed or replaced with fabricated success.

Tests-first per group: Group1 exit1(2fail/16pass), then0(18pass); Group2 exit1(1fail/57pass), then0(58pass); Group3 exit1(1fail/27pass), then0(46pass including public tests). A separate unavailable-state landmark regression failed1 before its semantic fix, then passed. Full UI final0:189pass/21files. The browser sweep caught and corrected sample-provenance mobile overflow, light-mode auth contrast, auth footer heading order, duplicate landmarks/invalid status landmark, inactive preview semantics, mobile table caption wrapping, and inherited pastel fact-strip styles. Earlier findings are retained in logs; only final records qualify the final claims.

Pinned Windows Node26.12.1 / pnpm12.5.1, process-local PATH and offline flags; exact receipts in the external artifact directory. Commands below use `pnpm --config.verify-deps-before-run=false --config.offline=true run` prefix:

| Actual task/script | Exit | Result |
| --- | --- | --- |
| test:ui | 0 | final189pass /21files |
| typecheck | 0 | strict server/dashboard |
| lint | 0 | ESLint +191modules/569dependencies, no violations |
| build | 0 | backend source unchanged |
| build:ui | 0 | final bundle363–365KB CSS /408KB JS before gzip; exact output in final-facts-build.log |
| test:e2e demo-flow runs evidence | 0 | first native group pass |
| test:e2e | 0 | complete12native suites, including per-fixture visual matrices |
| test:e2e public runs | 0 | after final sample/caption adjustments |
| test:e2e runs | 0 | after final fact-strip cascade correction |
| test --reporter=json --outputFile=<external feature JSON> | 1 | final1442pass/31fail |
| same full test in clean development1977172 | 1 | 1442pass/31fail; exact identities match, zero new/resolved |
| direct backend cache diagnostic | 0 | diagnostic completed; cache behavior is a reproduced failure, not a pass |
| final consolidated visual route matrix | 0 | 67routes×4profiles=268states; no overflow,page errors or axe violations |
| git diff --check | 0 | no whitespace errors |

Native browser evidence: real Windows Edge156.0.4314.58,1xdevice scale,1440x900desktop/390x844mobile,dark/light,reduced motion. The full route pass was followed by recapture of affected routes after scoped final changes. Eleven populated/valid-ticket local fixture profiles provide44additional native screenshots: registration/login, reset with valid ticket, authenticated settings/projects, actual queued run, filtered run table and real seeded artifact library/viewer, plus unavailable Impact. Standalone run/evidence/token links without required context show their true error state; those are not claimed as populated acceptance. Modal color variants use the real stored theme preference because their background controls are inert. Public/workspace theme interaction is separately exercised by native UI clicks. Unit/happy-dom checks are synthetic, distinct from native HTTP/Postgres/Mailpit/browser checks; neither proves live Muse/Modal/GitHub/worker or organic impact.

Artifacts: `C:\Users\Admin\AppData\Local\ChangeProof-AI\review\ui-polish-expansion-20261104-174433` contains gallery index.html,67route checklist,16before/after full-page comparisons for the first public group,268route images, populated native fixture images, task header, source hashes/diff, cache finding, exact command receipts/logs, baseline comparison and §5 draft. Generated files/backups/root mockup are not commit candidates. No backend/core/config/lockfile/package changes. All changes remain uncommitted; no staging,push,merge,deploy or PR creation.

Limitations: the cache defect needs backend work;16workspace integrations remain unavailable; Muse/Modal/GitHub/worker readiness and approved Semgrep remain missing;31root failures remain unresolved despite exact baseline reproduction. No production/Linux-browser/new sandbox/live-model/release qualification claim. Allocated polish status `in_progress` pending user final visual approval; full-WP/frontend release status separately `in_progress`. Next action: user review, then separately authorized backend cache remediation/integration review; no next task started automatically.

## 29. Bounded composition correction and route audit (2026-11-04)

Plan revision 2; user-directed review of the already-polished frontend, not a new backend task. FR3-31/37/40 and NFR3-14; branch `feat/ui-visual-polish-pilot`, baseline UI commit `667803844c0da8aa887223f4145bb65331685810`. Before editing, copied every modified/untracked file into the external review backup. D: had 4,012,748,800 bytes free before builds/browser checks; no existing files/backups moved or deleted. Root `mockup.html` remains untracked and SHA256 `6998e21248e413013b555eb6a04ffffe4ef3f6e385a71ae574998ba51051bf8f` is unchanged.

**Extent correction:** 67 registered routes are not 67 bespoke designs. Source inspection classified 15 route/alias entries as page-specific (Landing, Overview/service-status, Product, Pricing, Verification/How it works, sample report/detail, Projects/project, Runs, Run Details and Evidence/library viewer). Eighteen have family/component refinement (auth, settings, help, legal, releases and roadmap); 16 share an unavailable-state composition; 18 inherit shared styling and retain their previous structure. Aliases and reused templates are explicit in the external per-route checklist. No new page-specific redesign is claimed for those shared-only routes.

**Confirmed corrections:** Product feature ordinals are real DOM labels, readable and baseline-aligned in four editorial columns; mobile descriptions/actions align beneath their titles. Its illustrative type change now has a contained diff header, not-executed status, type-boundary label, numbered lines, removed/added highlighting and context, connected to the required-evidence diagram. It is neither executed code nor a verified result. Pricing publication metadata is separated from the conceptual budget flow. Verification boundary numbers/titles share an aligned row. Published sample entries group provenance/title/summary/action; template definition lists pair labels with their explanations. Workspace empty-state art is anchored beside the message rather than floating above it; Run action rows and Evidence artifact controls have explicit wrapping/gaps. Standalone auth navigation hides the visual-only theme label while preserving the accessible button name. API handlers/auth rules/backend/security/contracts/pricing semantics remain unchanged. Approved Landing/Overview and other satisfactory compositions were not redesigned.

**Tests and native evidence:** extended the existing Product regression first: initial focused `pnpm test:ui apps/dashboard/src/pages/public.test.ts` exited 1 (17 pass, 1 fail), then exited 0 (18/18). Native public checks additionally measure ordinal/title/description/action geometry at 1440px/390px and verify added/removed lines and no fabricated execution claims. Final `pnpm test:ui` exited 0 (189/189, 21 files); `pnpm typecheck` 0; `pnpm lint` 0 (191 modules/569 dependencies, no boundary violations); `pnpm build` 0; `pnpm build:ui` 0; `pnpm test:e2e` 0 (all 12 specs); subsequent `pnpm test:e2e public` 0 on the final E2E test spelling. An intermediate lint run exited 1 on two unqualified browser globals in the new E2E assertion; fixed to `window.*`, then reran successfully. This was an introduced test lint defect, not a baseline failure. All package commands used pinned Node26.12.1/pnpm12.5.1 with process-local toolchains and `--config.verify-deps-before-run=false --config.offline=true run`.

Final `pnpm test --reporter=json --outputFile=<review>/full-suite.json` exited 1: 1,442 pass, 31 fail. Fresh equivalent unmodified development worktree `19771728312981a2737fee5eb4b8f0cc6ea29d58` exited 1: 1,442 pass, 31 fail, identical failing test identities, zero new/resolved failures. Baseline worktree remained clean. Reproduction does not waive or fix those failures.

Native visual matrix: same installed Edge156.0.4314.58, 1x scale, reduced motion, desktop1440x900/mobile390x844, dark/light; 268 full-page route captures plus 44 populated native-fixture captures (11 profiles), zero recorded JS/axe/overflow findings. Owner session was established through real registration/email verification/organization/login; fixtures use actual local HTTP/Postgres/Mailpit and actual queued run/artifact bytes. Missing-ID pages in the broad route matrix are error-state evidence, not populated acceptance. Before screenshots are the preceding polish snapshot, verified against all32 candidate file hashes before edits; not the root mockup. IDs/timestamps legitimately differ between native fixture runs. Human review used before/after full-page contact sheets for all67routes and enlarged priority/fixture images; automated results alone do not establish visual quality or user approval.

Artifacts: `C:\Users\Admin\AppData\Local\ChangeProof-AI\review\ui-composition-review-20261104-202448` contains `index.html` (all-route before/after gallery), 88 full-resolution comparison PNGs, individual screenshots, per-route classification, annotated visual audit, backup, task header, command receipts/logs, failure identity comparison, diff and source hashes. Only seven pre-existing candidate files changed during this correction: public-refinement.ts/css, public.test.ts, auth-refinement.css, workspace-refinement.css, public E2E spec and this report. All previous work/untracked files preserved, no staging/commit/push/merge/PR.

Allocated task and full-WP status remain `in_progress` pending user visual approval. Missing: approved Semgrep scan, production/Linux-browser qualification, 16 unavailable workspace integrations and live Muse/Modal/GitHub/worker evidence. Previously reproduced project-search cache defect needs separate backend remediation; no backend edit or workaround was introduced. No new provider/security decision made. Next action is user review of the screenshots; no next task automatically started.

## 30. Systematic two-pass site-wide composition QA (2026-11-04)

Plan revision 2; user-directed bounded frontend QA, FR3-31/37/40 and NFR3-14. Branch `feat/ui-visual-polish-pilot`, original UI commit `667803844c0da8aa887223f4145bb65331685810`. Copied every current modified/untracked file, including root `mockup.html`, into the external backup before edits. D: free4,012,630,016bytes at intake and4,006,838,272bytes before the final UI build. No files/backups deleted or moved; no Git publication/mutation.

Pass1 freshly captured all67registered routes in dark/light at1440x900/390x844 with the same Edge156,1xscale,reduced motion. Real owner context came from actual local registration/email verification/org/login. Reviewed full-page contact sheets for every route, enlarged priority/fix images and measured component geometry/cascade. Pass2 used a separate browser process/new contexts/new actual owner session to recapture all268views on corrected UI. Its visual review additionally caught a tiny inline primary Log in anchor in the expired-session state; corrected auth-scoped button geometry, added a native size/click regression and recaptured the six affected auth routes (24views) within pass2. Original pass2captures remain intact; final-screens.json selects the corrected auth images. No open-ended redesign or third site-wide pass.

Six confirmed defect families across17routes: (1) Product horizontal padding0 placed ordinals at rectangle edges, now28px desktop/20px mobile across all four rows; (2) Changelog inherited190px/1fr grid auto-placement, now a single vertical column with consistent marker/time/title/body; design notes and releases remain separate; (3) legacy ID+content selector kept glass rectangles behind zero-padding editorial rows, fixed at the component specificity for Guides/Roadmap/Templates/Help/Privacy/Impact overview/Evidence overview/Collaboration; (4) reset .card padding plus surviving glass frame crowded both API template details, now properly grouped prose/requirements sections; (5) redundant unpadded card inside the already padded standalone auth surface, flattened visually for five status routes; (6) reset button geometry left auth recovery anchors tiny, now scoped inline-flex/padding, with expired-session primary CTA measured>=44px and clicked on desktop/mobile. No global padding workaround, new feature, backend/API/auth/security/contract/pricing/provider change. Other satisfactory compositions retained, including approved Landing/Overview and Register/Login.

Focused Changelog unit regression before implementation exited1(18pass/1fail); after exited0(19/19), preserving title/body/date and empty-release separation. Native measurements/assertions exited1before and0after; Product insets0to28/20px and Changelog headings395px/165px to one shared content start. Geometry candidates18to0 refer to two repeated defect types across variants, not18distinct defects. Other findings came from visual/cascade inspection. Final UI190/190 in21files(exit0); strict typecheck0; lint0(ESLint+boundaries,191modules/569dependencies); backend build0; final UI build0; final native E2E12/12specs(exit0), including padding/timeline/auth CTA regressions and all previous route/history/auth/run/evidence behavior. Intermediate lint1 was a new non-null assertion in the test, corrected and rerun; not a baseline defect. All package invocations used pinned Node26.12.1/pnpm12.5.1, process-local toolchains and offline/verify-deps-before-run flags; exact command receipts/logs retained.

Fresh full root test exited1:1442pass/31fail of1473. Equivalent clean development worktree19771728312981a2737fee5eb4b8f0cc6ea29d58 exited1 with the identical31failure identities,0new/0resolved; worktree remained clean. This does not waive those failures or prove each is environmental. Final route matrix268views plus44actual populated/valid-state native fixture views had0recorded JS/axe/overflow findings. These functional/machine checks are not a visual perfection certificate. Native fixtures use actual local HTTP/Postgres/Mailpit and queued runs/artifact bytes, not live model/customer repair evidence. Missing-ID/expired/owner-denied/unavailable states and unqualified operator/provider/data variants are explicit in the checklist. Accessibility heading-focus outlines retained.

Artifacts: `C:\Users\Admin\AppData\Local\ChangeProof-AI\review\ui-sitewide-qa-20261104-214252` contains the small eight-representative `index.html` gallery with theme/device controls, `all-routes.html`, route-by-route reviewed checklist, root-cause QA report,536initial route screenshots+24final auth replacements,44final native views,68significant-fix comparison PNGs, geometry/cascade data, task intake/report, command receipts/baseline identities, backup/diff/hashes. Source changes this task are six existing candidates only: public.ts, public-refinement.css, auth-refinement.css, public.test.ts, public E2E spec and this report. Previous32polish candidates/root mockup remain intact. No staging/commit/push/merge/PR/deployment.

Allocated QA/full-WP status `in_progress` pending review, not visual perfection/release acceptance. Remaining: approved Semgrep scan,31root baseline failures,16unavailable workspace service integrations,live Muse/Modal/GitHub/worker qualification and previously reproduced backend search-cache defect. No backend fix performed. Next action: user reviews the eight representative pages; no automatic next task.
