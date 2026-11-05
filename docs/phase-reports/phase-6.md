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

## 21. UI1–UI8 rebuild + responsive/label verification (3 Nov 2026)

**Date:** 3 November 2026.
**Scope:** full-front-end rebuild to the active
`.modern-design` skin in `.template-ui/mockup.html`
(UI1 tokens/components, UI2 3-mode shell, UI3 public
site, UI4 auth/onboarding, UI5 workspace/project pages,
UI6 runs/evidence flow, UI7 org/billing/support/operator
pages, UI8 trace-viewer + whole-UI verification).
Historical §§1–20 are preserved untouched; this section
records only the rebuild and its evidence. No full WP and
no G3 gate passes on this evidence alone.

What was built:

- `apps/dashboard/src/tokens.css`: one 323 KB token
  source ported from the mockup cascade with winners
  resolved (no layered overrides); self-hosted Inter +
  Plus Jakarta Sans WOFF2 with SIL OFL notices under
  `public/assets/fonts/`; light + dark palettes.
- `apps/dashboard/src/components.ts` + new
  `icons.ts`: 44 mockup icons, mockup-structure helpers
  (`pillIcon`, `pageHead`, `card`, `padcard`, `table`,
  `tabs`, `drawer`, `modal`, `toast`,
  `enhanceCustomSelects`, `enhanceFilePickers`); all
  dynamic text via `textContent`/`h()` (NEG3-21).
- `shell.ts`/`routes.ts`/`main.ts`/`session.ts`:
  3-mode shell (public/auth/workspace), 3-group sidebar
  with plan meter + org switcher, dual-capsule topbar
  (search palette, notifications, theme, account
  popover), mobile off-canvas drawer with `.nav-scrim`
  and focus trap.
- Pages: `public.ts` (+ new `public-chrome.ts`,
  landing hero/ghost-fibers/tech-strip/proof-story/
  folder/pricing + 17 public pages), `auth.ts` (split
  auth shell, full recovery set, 3-step onboarding),
  new `workspace.ts` (overview, projects, 7 project
  tabs), `runs.ts`/`evidence.ts`/`threads.ts`
  (history, split builder, live progress, 7 run tabs),
  `billing.ts`/`enterprise.ts`/`settings.ts`/
  `support.ts`/`operator.ts`/`notifications.ts`/
  `status.ts` (team, ledger, settings tabs,
  support/status/evaluations/operator).
- New `apps/trace-viewer/`: read-only evidence audit
  UI reusing the dashboard token bundle (identical CSS
  hash at build), self-hosted fonts, strict
  same-origin `?src=` bundle loading, validated
  `TraceBundle` contract (caps on arrays/strings/
  depth, same-origin artifact hrefs), four views
  (event timeline, hypothesis tree, trial receipts,
  artifact digests) using only verified mockup
  classes. `package.json` gains `test:trace`,
  `build:trace`, and trace-viewer typecheck coverage.

Verification evidence (all observed, exit 0):

- `pnpm test:ui` → 0 (253/253, 20 files).
- `pnpm test:trace` → 0 (13/13, 2 files).
- `pnpm test` → 0 (1473/1473, 91 files).
- `pnpm typecheck` → 0 (root + dashboard +
  trace-viewer projects).
- `pnpm lint` → 0 (eslint clean; depcruise 174
  modules / 546 deps, zero violations).
- `pnpm build:ui` → 0; `pnpm build:trace` → 0.
- Playwright UI8 probe (system Chrome, production
  builds, `/tmp/ui8-verify.cjs`, throwaway):
  21 routes × 3 viewports (390×844, 768×1024,
  1440×900) — zero horizontal overflow, zero page
  errors; mobile shell: topbar is a fixed bottom bar
  (bottom 832/844), sidebar off-canvas at rest
  (x −264), menu opens drawer + `.nav-scrim`, focus
  trap holds across 14 Tabs, Escape closes;
  trace-viewer: all four views render, Inter loads
  from self-hosted fonts, dark theme flips the
  palette; FR3-40: rendered text + `document.title`
  + aria/placeholder/title/alt attributes checked
  against all 1,765 non-identity `englishCopy`
  dictionary keys plus dynamic fragments — no
  Indonesian remaining. Final: `failures=0
  warnings=0`, exit 0.

Findings fixed during verification:

- FR3-40 `Detail` → `Details` (dictionary maps
  standalone `Detail` to `Details`): billing ledger
  header, settings member table, trace-viewer trial
  receipts header, `/run` route title
  (`document.title`).
- `SCREEN_NAMES` covered only exact slugs: the
  `#/billing` alias fell through to a hardcoded
  `Run detail` topbar label. Added the 12 missing
  alias/section names and a section-segment fallback
  ending in `Workspace` (dictionary-clean).
- `pnpm lint` started at 50 errors in UI files
  (void-expression shorthands, `ReadonlyArray`,
  unnecessary conditions/assertions): 39 via
  `eslint --fix`, 11 by hand, including one the
  fixer introduced (bare reflow read → explicit
  `getBoundingClientRect()` call).

Limitations / not claimed:

- The UI8 probe stubs `/api/*` (authed session +
  empty manifests; everything else 500), so it
  proves layout, shell mechanics, and copy — not
  backend wiring. Several page endpoints have no
  server route yet and pages fail closed with
  Retry; backend gaps stay phase-7 work.
- `tests/e2e/run.mjs` (real server + disposable
  Postgres) was not rerun after the rebuild; the
  eight green specs in §§2–19 stand on the
  pre-rebuild tree. Whole-system E2E over the new
  UI is phase-7 scope (T-50).
- No G3 gate passes on this section alone.

## 22. Workspace backend-gap closure + DOM alignment (3 Nov 2026)

Task ID / parent WP: T6-UI-backend-gap (phase-6 closure; WP3-21/24/25/29/30/32).
Requirement IDs: FR3-24/29/31/34/35/40, NEG3-21/32/34, NFR3-14.
User-visible outcome: every workspace page reads real APIs; honest empty
states; no dummy data; DOM structure aligned to the mockup per page.
Prerequisite evidence: §21 (UI8 rebuild + stubbed probe).

### 22.1 New HTTP contracts (all behind current grants + RLS)

| Endpoint | Store | Dashboard consumer |
| --- | --- | --- |
| `GET /api/runs` | `LifecycleStore.listRuns` | overview, recent runs |
| `GET /api/projects/:id`, `PATCH /api/projects/:id` | `getProject`, `updateProject` (+ `description`, V12) | project detail/settings, search snippet |
| `GET /api/support/capabilities` | 14 `CapabilityRecord` via `AdapterRegistry` | capabilities matrix (target/proven split) |
| `GET /api/environments`, `POST /api/environments` | environment profile revisions (V12) | environments page + drawer |
| `GET /api/github/connections`, `POST …/:id/revoke` | github connections (V12; empty until WP3-22) | repositories page |
| `GET /api/telemetry/corpus`, `POST /api/telemetry/corpus` | telemetry metadata (V12; gaps `[]`) | telemetry page |
| `GET /api/billing/summary`, `GET /api/billing/ledger?limit=50` | `readBalances`, `listLedger` | overview credits, usage ledger |
| `GET /api/team/members` | `IdentityStore.listMembers` (grant/status detail; no email column exists) | team table |
| `GET /api/audit/entries?limit=50` | `QueriesStore.exportAudit` (receipt `runId:seq`) | audit log |

Conventions kept: `isXPath` + `handleXApi` (503 without DB),
`actingContext`, `orMapped` (runs/teamwork/enterprise mappings per brief;
auth maps operator refusal to 403), `z.strictObject` bodies, cursor
polling only (no SSE added). Unknown IDs 404 without disclosure
(NEG3-21); empty data returns empty lists, never 404.

### 22.2 Migration + compatibility

- `infra/postgres/V12__workspace.sql`: `projects.description`,
  `environment_profiles`, `github_connections`, `telemetry_corpus`
  (RLS + `app_user` grants; explicit `tenant_id` predicates in every
  query, same rule as V11).
- Pre-V12 databases keep working unchanged: reads treat missing
  tables/columns as empty (`to_regclass` / `information_schema`);
  writes fail closed naming V12. E2E specs still apply V1–V11 only.
- CRLF preserved in `lifecycle/store.ts`, `usage/store.ts`,
  `routes-enterprise.ts`, `routes-teamwork.ts`, `start.ts`, V12,
  `t48/t49`, native teamwork/enterprise suites (verified pure-CRLF).

### 22.3 Proof (mock vs native reported separately)

Mock suite: `pnpm test` → 91 files / 1483 tests green, exit 0.
Includes new `tests/http` cases in t45/t48/t49 (404/403/400/401/503,
empty lists, CSRF marker). One environmental fix: the two type-aware
ESLint negatives in `tests/architecture/import-boundaries.test.ts`
went 15s → 60s wall-clock (6.3s solo, >15s under parallel workers;
assertions untouched) after 3/3 full-suite timeouts at 15s.
UI suite: `pnpm test:ui` → 20 files / 258 tests green, exit 0
(includes 3 select idempotency/scroll tests, ledger empty/error
split, team empty case, and singular/empty-connections tests).
Native suite (disposable PostgreSQL 16, `DATABASE_URL=…@55433`):
4/4 files green — runs-http 17/17, teamwork-http 9/9,
enterprise-http 9/9, auth-http 7/7 (exit 0 each), covering V12
round-trips, cross-tenant fencing (404/empty), viewer 403, operator
403, and the 14-record capability matrix (explicit ranges, proven ≤
target).
Gates: `pnpm typecheck` exit 0 (root + dashboard + trace-viewer),
`pnpm lint` exit 0 (eslint clean; depcruise 174 modules / 548
dependencies, zero violations), `pnpm build` + `pnpm build:ui` exit 0.

### 22.4 Real-browser DOM probe (replaces the stubbed UI8 probe)

Throwaway `/tmp/domprobe.mjs`: migrates V1–V12, starts `dist`
as `app_user` (RLS active), seeds over real HTTP
(register→verify→claim→login→project→PATCH→grant→entitlement→
draft→submit→environment→telemetry→invite→accept), then drives
system Chrome over 12 workspace routes × 390/768/1440 × light/dark
(72 checks) + a keyboard select interaction. Result: **73/73 green**,
zero page errors, zero overflow, English-only markers clean.
Geometry matches the mockup exactly: `main` margin-left 284px /
content left 300px at 1440 (mockup ground truth measured the same).
Screenshots: `/tmp/domprobe-shots/` (72 + interaction).

### 22.5 Defects found by the probe and fixed

- **Observer infinite loop (critical):** `syncCustomSelect` rebuilt
  the trigger on every pass; the shell MutationObserver refired
  forever on any page with an inline select (`#/team` hung: goto
  timeout, then evaluate stall). Fix: signature-idempotent sync +
  invariant comment; regression tests in `components.test.ts`.
- **Sidebar overlap (critical):** outlet was `main#content`, so
  `#content{margin:auto}` cancelled the `main` sidebar offset at
  761–1599px. Fix: mockup nesting `main > div#content` (shell.ts +
  test).
- **Scroll-listener throw:** document-level scroll has
  `target=document` (no `closest`). Guarded; regression test.
- **Honesty/grammar:** empty connections no longer claim “active”;
  singular run/connection copy; audit-ledger-member fallbacks
  rewritten for the now-real endpoints; plan meter spacing; org
  subtitle shows the session role.
- **Impact tab:** the mockup project-level `impact` tab is run
  content in the dashboard (`#/impact?run=`, Dependency graph under
  run tabs); project tabs keep the workspace-plan family
  (capabilities + characterization added). No decorative tab added.

### 22.6 E2E status: blocked on T-50 (phase-7), with evidence

- Run 1: a leaked `node -e …startInfra` process from an earlier
  session held port 4179 (EADDRINUSE); killed after proving idle
  lineage (3.5s CPU in ~3h).
- Run 2 (free port, server listening): 8/8 specs fail only on stale
  `main#outlet` selectors — the UI8 rebuild renamed the outlet to
  `#content` (HEAD still has `#outlet`; predates this task).
- Run 3 (bounded experiment, then fully reverted): after a
  mechanical `#outlet`→`#content` swap, specs fail deeper on the old
  auth flow (`#/check-email` navigation), Primary-nav labeling, and
  an axe `heading-order` finding on public pages. Specs restored
  byte-identical (`git checkout -- tests/e2e/specs/`).
- Whole-system E2E over the new UI stays T-50. The §22.4 probe and
  §22.3 native suites are this task's whole-system evidence instead.

### 22.7 Remaining honest gaps (backend-owned, nothing faked)

Baseline (`null` → “No baseline pinned”), environment
services/journal/boundary/resources (`[]`/`null`), telemetry gaps
(`[]`), GitHub connections (empty until the WP3-22 installation
flow), audit export + invitation listing + org-profile writes
(absent endpoints, pages say so), characterization inputs (no
assessment backend), review aggregation (exact state + raw events
only). No verdict is computed in the UI; no mock/replay backs any
claim above.
Next dependency-ready task: T-50 (E2E over the new UI, phase-7).

## 23. Auth modals + public nav + hero headline (3 Nov 2026)

### 23.1 Scope

Login, register, forgot-password, and check-email render as labelled
signin dialogs over the remembered public backdrop (mockup
`modalAuthRoutes`/`signin-overlay`, incl. Escape/backdrop-press close,
focus trap, inert outlet, `body.signin-modal-route`); check-email is
modal per product request, the mockup keeps it split-screen. Public
nav is exactly Product / Pricing / Documentation + theme toggle +
Sign in + "Get started free" (mockup 2452, English). Landing hero
headline is now "Every change. / One proof." (pill on "proof.") per
supplied artwork; hero CTA aligned to "Get started free".

### 23.2 Deliberate honest deviations (mockup vs real backend)

- Password minimum stays 10-128 (`modules/identity` `[DERIVED]`
  policy); the mockup/reference says 8. Client help text and error
  copy use the true range.
- "Continue with GitHub" appears only when `/api/auth/providers`
  advertises it; otherwise an honest note names the missing
  authorized App. No dead button, no faked handshake.
- Register drops confirm-password (mockup has none; the server body
  is email+password only) and links terms to the real `#/terms` +
  `#/privacy` routes (the old `#/p/terms` links resolved nowhere).
- Login keeps its hidden organization field for multi-org accounts.
- All Indonesian reference copy ships in English (FR3-40).

### 23.3 Implementation

- `routes.ts`: new `renderStandalone` (backdrop render without
  nav/focus side effects). `components.ts`: `field()` placeholder
  option, `logoMarkSvg` (mockup C-mark, used by signin + public
  brand). `auth.ts`: backdrop memory via hashchange, `mountAuthModal`,
  delegated Escape/Tab-trap/backdrop-press handling.
- **Race fix (real-browser):** `githubSection` used to fire before
  the mount, so the providers response landed on a detached host and
  was dropped (`isConnected` false). It now fires after the mount;
  regression test pins a slow backdrop (`/landing` gate) with the
  note still rendering.

### 23.4 Proof

- `pnpm test:ui` -> 20 files / 262 tests green, exit 0 (auth modal
  structure/close/backdrop/race, nav labels, hero copy).
- `pnpm typecheck` exit 0, `pnpm lint` exit 0 (depcruise 174
  modules / 549 dependencies, zero violations), `pnpm build:ui`
  exit 0 (CSS minify warnings pre-existing, tokens.css untouched).
- Throwaway `/tmp/authprobe.mjs` (real `dist` + PostgreSQL 16 +
  system Chrome, logged out): nav + 4 modals x 390/1440 x
  light/dark + backdrop-memory/close/empty-submit interactions =
  **21/21 green**, zero page errors, zero overflow, English-only
  markers clean, GitHub note asserted present. Screenshots:
  `/tmp/authprobe-shots/`. Hero pill computed
  `rgb(201,228,255)/rgb(32,91,152)/999px` (light),
  `rgb(145,202,255)/rgb(8,39,69)/999px` (dark).
- Probe container `cp-authprobe-pg` removed after the run; no
  backend files changed by this task (server `dist` predates it).

### 23.5 Dialog readability surface (same day, product request)

The extracted `.signin-dialog` shipped no background, so busy
backdrops bled through and washed out form text. Added a near-opaque
themed surface (`--paper` 92% light / 90% dark + 22px frosted blur),
form text in `--ink`, secondary copy (hints, terms) in `--muted`,
dialog links in `--blue` (`tokens.css`, no `!important`). Contrast
checker: light ink 15.57 / muted 5.70 / blue 8.81, dark ink 16.99 /
muted 10.56 / blue 9.51 — all pass AA normal text. Re-ran
`/tmp/authprobe.mjs`: **21/21 green**; screenshots confirm solid
dialogs in both themes.

### 23.6 Technology marquee: real logos, Java removed (same day)

The strip used short text codes (GH, JV, ...). It now renders the
pinned Devicon data-URI artwork from the mockup itself (1997):
new `pages/tech-logos.ts` (8 URIs, ~55KB, self-hosted, `<img>`
context only, empty alt + aria-hidden parent), per-kind
`cp-tech-*` classes (GitHub inverts in dark mode via the existing
rule; Go/.NET keep their wide marks). Java removed per product
request. Tests: 16 marks, every `img` a data URI, Java absent.
Browser: 8/8 images loaded light+dark, authprobe still 21/21.

### 23.7 Sidebar meter + product mark (same day)

- Removed the "Manage usage →" link from all three plan-meter
  states (usage stays one click away via nav); fixed the fused
  "UsageUnavailable"/"UsageLoading…" words with proper spacing.
- Meter legibility: themed box (`--surface`), text (`--ink` /
  `--muted`), track (`--line`), fill (`--blue`) — the old
  white-on-white fill and faint foot tones vanished on light
  sidebars. Computed pairs match the §23.5 AA checks.
- New `changeproofMarkSvg()` inlines
  `public/assets/changeproof-mark.svg` (also the favicon);
  replaces the shield brand marks in the sidebar, the landing
  workflow logo, and the product preview brand, plus removes the
  now-unused `brandMarkSvg`. Feature/nav shield icons untouched.
- Tests: 264/264 UI green; `brandprobe.mjs` (seeded login,
  entitlement, both themes): mark viewBox/sizing, meter text, no
  manage link, no page errors — all green; screenshots in
  `/tmp/brandprobe-shots/`.
