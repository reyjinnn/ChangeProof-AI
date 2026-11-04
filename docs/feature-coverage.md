# Feature coverage record — phase-6 UI (revision 2)

Every route, form, button, menu, filter, export, and collaboration
preview in the dashboard maps to its requirement, owning backend
task, actual endpoint or receipt, and positive/negative browser
case. No decorative controls: anything without a live behavior is
absent, not disabled decoration. (Disabled-with-reason states name
the obstacle and the next step; they are not decoration.)

Conventions: `C` = component case (`apps/dashboard`), `H` = HTTP
case (`tests/http`), `N` = native case (`tests/native`), `E` =
E2E case (`tests/e2e/specs`). All green at phase-6 close; see
`docs/phase-reports/phase-6.md` for commands + exit codes.

## T-42 / WP3-27 — tokens + shell + HTTP slice

| Control | Requirement | Backend (task) | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| Theme toggle + sidebar collapse | NFR3-14/15 | — (browser store) | localStorage keys | C: toggle persists | C: private-mode fallback |
| Service status page | FR3-37 | T-27 manifest | `GET /api/health` | C+E(shell): status renders | C: offline names outage + retry |
| Template apply gate | FR3-37 | T-27 publicsite | `POST /api/site/templates/:id/apply` → 401 + login target | H: guest refused with validated target | H: forged target rejected |
| Static hosting fallback | FR3-37 | — (slice) | dist + traversal guard | H: shell served | H: traversal 400, unknown 404 |

## T-43 / WP3-27 — public site

| Control | Requirement | Backend (task) | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| 17 manifest routes | FR3-37/40 | T-27 manifest | `GET /api/site/*` | C+E(public): all render live | C: unknown sample/template 404 |
| FAQ search | FR3-37 | T-27 publicsite | `GET /api/site/faq?q=` | C+E: ranked results | C: empty query refused |
| Login notice on gated CTA | FR3-38 | T-44 session | `#/login` target | E(public→auth): notice links login | H: cross-origin marker refused |

## T-44 / WP3-21/22/28 — auth / onboarding / settings

| Control | Requirement | Backend (task) | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| Register / resend / verify | FR3-38 | T-18 email | `/api/auth/register·verify·verify/resend` | N+E(auth): Mailpit token | N: unknown user shares shape (NEG3-30) |
| Login (+tenant reveal/prefill) | FR3-38, NEG3-29 | T-18 email | `/api/auth/login` + cookie | N+E: session + account slot | N: wrong pw shares message; evil target 400 |
| Logout | FR3-38 | T-14 identity | `/api/auth/logout` | E: slot returns to login | C: failure still clears locally |
| Forgot / reset password | FR3-38, NEG3-30 | T-18 email | `/api/auth/password/*` | N+E: reset revokes session | N+E: replay 400 |
| Create organization | FR3-29 | T-18 email | `/api/orgs` + claim ticket | N+E: tenant claimed | H/C: ticket single-use, in-memory only |
| Sessions list + revoke | FR3-29 | T-18 email | `/api/auth/sessions*` | C+E: current marked, revoke works | C: 401 → `#/session-expired` |
| Invite create / accept | FR3-29 | T-14 identity | `/api/orgs/:id/invitations`, `/api/invitations/accept` | E: link → accept → second login | E: replay fails closed; C: incomplete link |
| Member change / remove | FR3-29 | T-14 identity | `PATCH·DELETE /api/orgs/:id/members*` | N: role changes | N: last-owner lockout refuses |
| Delete organization | FR3-29 | T-14 identity | `DELETE /api/orgs/:id` | N: fence + session cleared | N: relogin 400 (fenced) |
| Guest guards | NEG3-29 | — (UI contract) | login card, no data calls | C+E: settings/runs guarded | C: no session → no fetch |

## T-45 / WP3-25 — run journey

| Control | Requirement | Backend (task) | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| Runs + projects lists + filters | FR3-31 | T-28 queries search | `POST /api/search` | C+E(runs): hits link detail | C: empty/offline+retry/403/401→expired |
| New-run template picker | FR3-31 | T-27 manifest | `GET /api/site/templates` | C+E: fields prefill intent+notes | C: no-template free write |
| Inline project create | FR3-31 | T-28 lifecycle | `POST /api/projects` → 201 | C+E: id fills the field | H: guest 401, empty name 400 |
| Draft save + resume + recents | FR3-31 | T-28 lifecycle | `POST·GET /api/drafts*` | C+N+E: revisions, `?draft=` prefill | C: empty intent blocks; secret-key fallback |
| Submit (immutable receipt) | FR3-31/35 | T-28 lifecycle | `POST /api/runs` → 201/200+duplicate | C+N+E: receipt + digest + link | C+N: validation, stale grant 400, repo 403, viewer 403 |
| Run detail header | FR3-31 | T-28 lifecycle | `GET /api/runs/:id` | C+N+E: exact state+version+digest | C+N: unknown 404 quiet, guest card |
| Event timeline (poll+reconnect) | FR3-31 | T-28 lifecycle | `GET /api/runs/:id/events` cursor | C+E: submitted streams, terminal stops | C: failures warn → pause → reconnect; nav stops loop |
| Cancel / retry | FR3-31 | T-28 lifecycle+jobs | `POST /api/runs/:id/cancel·retry` | C+N+E: cancelled → retried link, same digest | C+N: terminal cancel 400, early retry 400 |
| Artifact download | FR3-35 | T-28 lifecycle+evidence | `GET /api/runs/:id/artifacts/:digest` bytes | C+N: link href, octet-stream bytes | N: guest 401, unknown 404, tamper 400 |
| Review panel | FR3-31/35 | — (no backend yet) | honest absence note | C: absence note renders | — (gap recorded, nothing faked) |

## T-46 / WP3-12+29 — evidence / publication / export

| Control | Requirement | Backend (task) | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| Evidence library per run | FR3-18/31/35 | T-28 lifecycle events | `GET /api/runs/:id/events` cursor pages | C+E(evidence): artifact events listed, others filtered | C: missing run param, guest card, 401→expired |
| Read-only viewer | FR3-18/35, NEG3-33 | T-28 lifecycle+evidence | `GET /api/runs/:id/artifacts/:digest` bytes | C+E: escaped text preview, full digest, server-verified label | C+E: tamper 400 integrity panel, 404 unknown, 403 unshared, oversize/binary download-only |
| Run-detail evidence links | FR3-18 | T-28 lifecycle | `#/evidence?run=` + `#/evidence/view` | E: header + event links reach library/viewer | C: incomplete/invalid link states, no fetch |
| Publication panel | FR3-19, NEG3-14 | — (no authorized App) | `GET /api/auth/providers` availability | C+E: honest no-App absence note | C: availability-unknown names the outage |
| Run evidence export (JSON) | FR3-20/35 | — (client snapshot) | Blob from fetched server data | C: kind/runId/artifacts/provenance shape | — (snapshot labeled non-proof, nothing faked) |
| Outcomes/evaluations note | FR3-21 | — (no backend yet) | honest absence note | C: absence note renders | — (gap recorded, nothing faked) |

## T-47 / WP3-29 — notifications / search

| Control | Requirement | Backend (task) | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| Inbox list + unread count | FR3-39 | T-29 notifications | `GET /api/notifications?limit=&cursor=&unreadOnly=` | C+N+E(inbox): items + fresh count | C: guest card, 401→expired, empty state |
| Unread filter + paging | FR3-39, NEG3-32 | T-29 notifications | same, cursor pages | C+E: filter refetch, load-more appends | N: lost grant hides item+count at list time |
| Mark read / dismiss / read-all | FR3-39 | T-29 notifications | `POST /api/notifications/:id/read·dismiss`, `.../read-all` | C+N+E: action then fresh re-list | C+N: unknown 404 quiet, cross-tenant 404, guest 401 |
| Preferences (5 mutes) | FR3-39 | T-29 notifications | `GET·POST /api/notification-preferences` | C+N+E: round-trip + saved note | H: unknown category 400 |
| Search palette (Ctrl/Cmd+K) | FR3-39 | T-28 queries search | `POST /api/search` | C+E: scope+text, run/project/audit links, count | C+E: no-matches, guest login note, Escape+refocus |
| Deep links | FR3-39 | T-29 notifications | record `deepLink` + `runId` | C+E: run link navigates, deep link as text | C: deep link never rendered as href |

## T-48 / WP3-30 — support / collaboration

| Control | Requirement | Backend (task) | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| Tickets file/list/transition | FR3-41 | T-30 support | `POST·GET /api/support/tickets`, `:id/triage·resolve·close` | C+N+E(teamwork): file receipt, status walk to closed | C+N: member triage 403, wrong-state 404 quiet, guest 401 |
| Access request/decide/revoke | FR3-41, NEG3-34 | T-30 support | `POST /api/support/access-requests`, `:id/decide`, `/grants/:id/revoke` | C+N+E: pending→approve→grant→revoke by receipt ids | C+N: member decide 403, double-decide 400, unknown 404 |
| Tenant incident list | FR3-41 | T-30 support | `GET /api/support/incidents` | C+N+E: platform incidents visible | C: guest card, 401→expired |
| Operator console gate | FR3-41, NEG3-34 | T-30 support | `#/operator` role check + server 403 | C+E: operators in, owners denied pre-fetch | H+N+E: owner report/drain/inspect 403 |
| Incident manage | FR3-41 | T-30 support | `POST /api/operator/incidents`, `:id/acknowledge·resolve` | C+N+E: report→ack→resolve | C+N: owner ack 403, unknown 404 |
| Fenced targets | FR3-41 | T-30 support+jobs | `POST /api/operator/targets/inspect·drain·quarantine` | C+N+E: inspect epoch → receipt | C+N: stale epoch 400, owner 403 |
| Operator audit | FR3-41 | T-30 support | `GET /api/operator/actions` | C+N: receipts listed | C: guest card |
| Threads + comments | FR3-42, NEG3-35 | T-30 collaboration | `POST·GET /api/threads`, `:id/comments` | C+N+E: create, post, escaped render | C+N+E: active markup 400 shown, guest 401 |
| Edit + history + outdated | FR3-42 | T-30 collaboration | `/api/comments/:id/edit·history` | C+N+E: v2 edit, superseded v1, outdated label | C+N: unknown 404 |
| Resolve/audience/share | FR3-42 | T-30 collaboration | `:id/resolve·audience·share`, `shares/:id/revoke` | C+N: resolve, reviewer, share→revoke | C+N: member audience 403, cross-tenant 404 |

## T-49 / WP3-24+31+32 — billing / BYOK / enterprise

| Control | Requirement | Backend (task) | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| Period balances + reservations | FR3-34 | T-24 usage | `GET /api/billing/balances` | C+N+E(enterprise): cap/consumed/reserved/remaining, open rows | C: guest card, 401→expired; error retry |
| Payment webhooks (no HTTP) | FR3-34, NEG3-36 | T-24 usage | store `recordPaymentEvent` only | N: HMAC-accept, idempotent replay, refund-after-charge | N: bad signature, refund-without-charge refused |
| BYOK provision/lookup/rotate/revoke | FR3-43, NEG3-37 | T-31 distribution | `POST·GET /api/byok/credentials`, `:ref/rotate·revoke` | C+N: metadata row, rotation 2, revoke; fingerprints only | C+N+E: broker-missing 404, member write 403, unknown 404 |
| SAML provision/rotate/link/disable | FR3-44, NEG3-38 | T-32 identity | `POST·GET /api/enterprise/saml`, `/rotate·link·disable` | C+N+E: pinned issuer, rotation, member link, disabled | C+N: member provision 403, non-member link 400, garbage cert 400 |
| SCIM mint/revoke | FR3-44, NEG3-21 | T-32 identity | `POST /api/enterprise/scim/tokens`, `:id/revoke` | C+N+E: token shown once, revoke flips true | C+N+E: foreign/already-revoked → revoked:false, indistinguishable (NEG3-21) |

## Recorded backend-owned gaps (no UI faked for these)

- Repository onboarding API (`repository_grants` has no writer):
  UI selects from session grants; tests seed. WP3-21 extension.
- Entitlement / budget-profile management + forecast figures: UI
  collects ids + requested budget only; no invented numbers. WP3-23.
- Readiness / characterization / verification-plan APIs: refs are
  opaque inputs; no assessment UI. WP3-24/15.
- Telemetry upload API: file connector only; no upload UI. WP3-15.
- Review aggregation (graph/ledger/diff/C-P-R-D, target/bundle
  verdicts): UI shows exact run state + raw event payloads. WP3-25.
- Run streaming: cursor polling + reconnect is the shipped
  behavior; no fake live stream. WP3-25 remainder.
- Manifest carries 2 run templates; the UI renders all served
  templates generically. T-27 content gap for the other four.
- Member/role/invite-list UI needs `listMembers`/
  `listInvitations`. WP3-21 extension (from T-44).
- Evidence has no global enumeration API (`EvidenceStore` is
  put/get/has): the library lists one run's artifact events. WP3-12.
- PR/CI state has no HTTP read path and no authorized GitHub App:
  the publication panel reports availability only. WP3-13/T-15.
- Owner outcome reporting + evaluation denominators have no
  listing backend. WP3-14/WP3-26.
- Notification publish + outbox claim/ack are worker/control-plane
  only (no HTTP route by design); the UI seeds nothing. WP3-29.
- Shell has no unread badge: counts render only from fresh list
  responses, so no stale count is ever shown (NEG3-32).
- No access-request/grant listing API: decide/revoke forms take
  pasted receipt ids. WP3-30 extension.
- No user lookup API: thread shares take typed user ids (same
  class as the T-44 member-list gap). WP3-21 extension.
- Operator memberships have no product API: E2E/native flip the
  role over SQL. WP3-30.
- Deep links name the `/app` surface, not dashboard hashes: shown
  as text, with run links for navigation. `[DERIVED]`.
- Invoices / payment methods have no listing API (webhook
  records only): billing shows usage + reservations and says so.
  WP3-24 extension.
- BYOK credentials and SCIM tokens have no listing API:
  lookup/revoke take pasted ids. WP3-31/32 extension.
- SAML subject linking takes typed user ids (same class as the
  member-list gap). WP3-21 extension.

## UI demo-readiness follow-up — 3 November 2026

This adds evidence to the existing allocation; it does not close a full
WP or qualify a live model/guest. See phase-6 report §21 for identities,
commands and missing checks. Existing account/run/evidence/billing
routes and their backend contracts are retained.

| Control | Requirement | Backend | Endpoint / receipt | Positive case | Negative case |
| --- | --- | --- | --- | --- | --- |
| Default entry, public header/footer and workspace links | FR3-37/40 | Existing publicsite + session | `/api/site/manifest`, published route content | C routes/public; E demo/public | Explicit `#/` stays workspace; unknown route still errors |
| Architecture tabs | FR3-37, NFR3-14 | Published explanatory content | No execution receipt claimed | C public vertical orientation, Up/Down/Left/Right/Home/End; E demo native Down/Home/End | Roving tab stop; explicit architecture-only and synthetic labels |
| Shared theme, compact icons and mobile drawer | FR3-40, NFR3-14 | Browser non-secret theme preference | Existing local assets/fonts | E demo/shell at 1440/768/390/375px, light/dark | Escape/focus return, backdrop, route close, axe and overflow checks |
| Overview and retry | FR3-31/40 | Existing health + identity | `/api/health`, `/api/auth/session` | C status; E demo, compact two-column mobile facts | Account failure remains Unavailable; health failure/retry; stale response cannot overwrite next page; Muse/Modal connection not claimed |
| Public content navigation | FR3-37 | Existing publicsite | Existing route/section endpoints | E public/demo | C delayed response cannot replace a newer route |
| Login and unavailable provider message | FR3-38 | Existing identity | Existing login/registration/recovery/session endpoints | E auth; E demo checks form ahead of supporting copy on mobile | Real rejected login and account-service errors; no invented GitHub flow |
| API error handling | FR3-31/40, NFR3-08 | Existing JSON envelope | No contract change | C api | Malformed envelopes/non-2xx success-shaped payloads cannot become success |
| Local development API proxy | NFR3-08/10 | Existing same-origin HTTP guard | Actual Vite config -> API | E dev-proxy: health 200; valid POST reaches 401 login gate | Foreign-Origin POST remains 403; no guard changes |
| Reduced-motion hero | FR3-37, NFR3-14 | Local decorative canvas | No service or execution claim | E demo checks identical canvas pixels across frames under actual reduced-motion media | Correct explicit Playwright viewport/media setup; no new animation or dependency |

### Landing reconstruction — authoritative root `mockup.html`

The user corrected the reference path to root `mockup.html` (SHA256
`6998e21248e413013b555eb6a04ffffe4ef3f6e385a71ae574998ba51051bf8f`).
Its landing headline/composition supersede the earlier generic landing design;
the backend manifest/contracts and all other page designs are retained.

| Control | Requirement | Endpoint / behavior | Positive / negative evidence |
| --- | --- | --- | --- |
| Floating nav, two-line headline, highlighted proof, two pill CTAs | FR3-37, NFR3-14 | Product/pricing/guides/register/login use existing routes; theme uses existing store | C public home structure; E public validates two landing CTAs and all other manifest pages; identical-size native side-by-side captures |
| Original technology identities | FR3-37 | Nine local SVGs extracted unchanged from root mockup, embedded Devicon MIT notice retained | Asset hashes; E demo local-only requests; labels describe scope preview, not certified support |
| Particle-wave field | FR3-37, NFR3-14 | Original WebGL2 equations + Canvas2D fallback; no provider calls | E landing real GPU/forced-unavailable-GPU -> native 2D; motion preference pause/resume; route departure stops drawing; dark axe/overflow |
| Capability disclosure | FR3-31/37 | No live connection or repair claimed | C/E labels Muse/Modal unavailable; original mockup's connected/evidence-collected wording replaced with non-status copy |


## Root mockup complete frontend port — 4 November 2026

The session explicitly supersedes older landing-only/reference-path notes. All62 source screens are mapped in the local review artifact route-inventory.json; full/viewport images at1440x900 and390x844 are in index.html. This is presentation/browser evidence, not full service/WP qualification.

| Control | Requirement / backend | Observable positive and negative evidence |
| --- | --- | --- |
| Complete Landing / three-stage proof / four-area folder | FR3-37/40,NFR3-14; trusted static root design | C public structural/keyboard cases; native three-step controls and folder keyboard original/app; actual light/dark/GPU/reduced-motion checks. Illustrative label retained. |
| Product / Pricing / all17public designs | FR3-37; published site APIs | Native public traverses links/FAQ/template/sample/pricing; real pricing and legal draft labels replace unapproved claims; no private payload keys. |
| How it works / public error / history | FR3-37,NFR3-14; real registered routes | C routes/public and native public: valid Verification content; Back to start goes#/p/; refresh/back/forward stay valid. |
| Login/recovery/verify/org/account states | FR3-38,NEG3-29/30; existing identity endpoints | C auth +native auth; same server return, password, enumeration/reset replay rules; inaccessible providers disabled. Register retained. |
| Workspace shell/account/sidebar | FR3-40,NFR3-14; actual session/theme | Native demo/shell light/dark/mobile/drawer/focus, header clear of heading and uncropped brand. No fake user/count. |
| Project creation / run draft | FR3-31/40; POST/api/projects, existing grants/draft APIs | C workspace empty input/strict payload/guest; native demo-flow real email->org->project->draft save+refresh. No repair success claim. |
| Usage / no entitlement | FR3-40,NEG3-36; GET/api/billing/balances | C billing red/green for null period/cap; native new-org empty state and seeded real balances. No client entitlement/payment grant. |
| Sixteen unavailable workspace integrations | FR3-31/40; no exposed HTTP contract | Original structural layouts; explicit service gap/disabled controls, no manufactured proof/count/graph. These remain partial. |

Final:162mock UI tests and12native E2E specs pass; typecheck/lint/boundaries/backend+UI builds exit0. Full root test exits1 on feature and clean1977172 baseline with same31failures/1442passes. Semgrep/specialist skills/provider/full-workspace qualification remain missing; statusin_progress. Exact receipts, complete failure IDs, files and limitations: frontend-port-20261103-232653/final-report.md.


### UI review remediation — 4 November 2026

Workspace session loading uses the caller's route epoch before any guest/error/authorized render. C workspace:15delayed result cases (guest/authenticated/401/503/network) across3routes,3current expiry/retry cases, stale-search guard; E demo-flow: genuine held session responses released after navigation. README now documents HTTP PORT and local root design input. Landing section assertion is ordered and exact. Fresh181UI tests and12native E2E suites pass; typecheck/lint/builds0. Full-root feature/baseline each1442pass/31fail with identical failures. Similar pre-existing Settings race reproduced on clean baseline and tracked separately, not fixed by the scoped workspace guard. Full frontend remainsin_progress; previous16integration/provider/Semgrep blockers retained. Evidence: D:\20261\.changeproof-review\ui-pr-remediation-20261104-111613/.
