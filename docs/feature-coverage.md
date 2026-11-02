# Feature coverage record — phase-6 UI (revision 1)

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
