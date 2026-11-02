# T-32 provider + identity catalog freeze (WP3-32, FR3-44/45)

Date: 2026-11-02. Owner: Reyn (confirmation pending per task-brief tentative rule).

## Frozen for this implementation (`[DERIVED]`)

| Surface | Frozen choice |
|---|---|
| GitLab API | REST v4 (`/api/v4`), default base `https://gitlab.com`; self-managed base URL is a per-connection value, pinned at connection time |
| GitLab webhook auth | Shared secret token (`X-Gitlab-Token`), timing-safe compare against the broker-held value |
| GitLab CI attestation | Pipelines listed by exact sha; attestation binds repo + sha + pipeline id + status |
| Bitbucket API | Cloud 2.0 (`https://api.bitbucket.org/2.0`) |
| Bitbucket webhook auth | None offered by the provider → events are triggers only; every effect re-reads exact state over the authenticated API before acting |
| Bitbucket CI attestation | Commit statuses at the exact sha; attestation binds repo + sha + status key + state |
| SAML artifact | Parsed-claims validation + RSA-SHA256 signature verification (node:crypto, no new dependency); XML parsing/C14N extraction is the caller's boundary |
| SCIM role mapping | None invented: SCIM provisions `member`; privilege elevation stays an explicit owner/admin action via existing membership APIs |
| SCIM unknown subject | Refused: no JIT account creation, no email/domain matching into accounts |

## Explicitly not frozen (qualification-catalog blockers, not silent fallbacks)

- Configured SAML IdP + live interop (needs owner IdP decision and a test IdP).
- XML parser/C14N vendor for production SAML responses.
- GitLab self-managed version matrix and Bitbucket Server/Data Center modes.
- Authorized GitLab/Bitbucket test organizations + tokens for live rows.

Per FR3-45, an unsupported mode above blocks its qualification row; it never
falls back to another provider or to a stub success.
