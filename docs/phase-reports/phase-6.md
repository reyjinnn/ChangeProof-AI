# Phase-6 report — revision 2

**Date:** 2 November 2026
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `in_progress` — allocated tasks T6-1..T6-4
(T-42..T-45) `done` (§§2–6 + gate §7); T6-5..T6-8 (T-46..T-49)
`not_started` (status §8). No full WP and no G3 gate passed;
local UI pass alone passes no gate.
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

## 8. Phase-6 status: T6-1..T6-4 done, T6-5..T6-8 remain

Allocated tasks T6-1..T6-4 (T-42..T-45) are `done` with the
proof above. T6-5..T6-8 (T-46..T-49: evidence/publication/
export, notifications/search, support/collaboration,
billing/BYOK/enterprise UI) are `not_started`, so phase-6 as a
whole stays `in_progress`; the next dependency-ready task is
T-46 (T6-5). Full WP3-12/14/21/22/24/25/26/27/28/29/30/31/32
and every G3 gate stay open until phase-7: pilot access,
backend gaps (§§5–6), production hardening, workers/real
execution, and whole-system qualification all remain. No gate
passes on UI evidence alone.
