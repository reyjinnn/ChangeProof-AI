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
