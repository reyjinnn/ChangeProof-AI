# Decision: verified installation connect flow (WP3-22)

**Date:** 5 November 2026
**Status:** implemented; provisional where marked.

## Problem

Installing the GitHub App on github.com never reached ChangeProof's database:
no code path wrote to `github_connections`, so the Repositories page was
honestly but permanently empty and the only working path was the CLI probe
with a hand-minted token. Token minting itself lived only in an operator
script (`scripts/github-installation-token.mjs`).

## Decided

- The server holds the App private key behind the broker (`CP_GITHUB_APP_KEY_FILE`,
  read once at startup, PEM-shape-checked) plus the public App id
  (`CP_GITHUB_APP_ID`). Both or neither; a partial pair refuses startup.
- `POST /api/github/connections {installationId}` mints a fresh JWT, exchanges
  one short-lived installation token (never stored, never logged), lists what
  that installation can actually see, and stores one row per repository:
  id `conn-<installation>-<repo>-<tenant-scope12>`, name = `owner/repo`,
  status active. Reconnecting the same installation revives rows via upsert
  (idempotent per tenant). The scope suffix is `sha256(tenantId)` truncated
  to 12 hex chars: opaque, IdSchema-safe, and it keeps two tenants
  connecting one installation on disjoint primary keys (a scope-less id
  collided on the global PK and tripped RLS on the other tenant's row).
- Failure mapping: unconfigured server → 503 `github_not_configured`; unknown
  installation → 404 `installation_not_found` (no disclosure); provider outage
  or rejected credential → 502 `github_unavailable`; malformed id → 400.
- The API base is a fixed constant and both ids are numeric-only before they
  touch a URL path (no caller-controlled URL reaches the fetch).
- `providers.githubApp` is true with a static installation token OR App
  credentials; with App credentials alone, authority flows through
  mint-on-demand while the static-token client stays dormant.
- Connection rows remain display metadata; run authorization still uses the
  separate repository grants. Webhook receiving stays out of scope (needs a
  public URL).

## Live-verification fixes (same date)

Three root causes surfaced against the real api.github.com, all fixed with
regression tests:

1. JWT `exp` of `now+600s` tripped GitHub's 10-minute ceiling under a fast
   local clock (`'exp' too far in the future`); TTL is now 540s.
2. `z.strictObject` on the token response rejected GitHub's extra fields
   (`permissions`, `repository_selection`, ...); now a plain `z.object`.
3. Connection ids were tenant-blind (see scope suffix above).

Non-2xx exchanges now carry GitHub's truncated public `message` in the
operator-side error only; clients still get the generic mapped codes.

## Not decided

Webhook receiver for install/uninstall events, token caching (each connect
mints fresh — correct and cheap at this call rate), per-run repo reads
through minted tokens.
