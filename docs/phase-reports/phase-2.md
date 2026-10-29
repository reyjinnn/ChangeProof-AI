# Phase-2 kickoff — revision 2

**Date:** 30 October 2026
**Application root:** this repository (`ChangeProof-AI/`), branch `development`
**Phase status:** `blocked` — entry audit complete, no T2 task has executable acceptance yet.
**Plan revision:** 2 (24 October 2026).

## Entry audit (evidence, not summary)

Phase-1 task evidence verified in the tree on `development` (uncommitted):

- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (42 modules / 97 dependencies, zero violations).
- `pnpm test` exit 0 (190 tests / 15 files), after owner-directed JVM removal
  (`docs/decisions/phase1-jvm-removal.md`): five ecosystems, `CapabilityRecord` `2`,
  adapter contract `2`. Spec documents still name six ecosystems (flagged divergence).
- Existing modules: `adapters`, `analyzer`, `dependencies`, `detector`, `graph`,
  `policy`, `verifier`. No `observability`, `fixtures`, `identity`, `github`,
  `jobs`, or `usage` modules exist yet.
- Full work packages WP3-01..05 remain `in_progress` (see `phase-1.md` addenda);
  no WP is `done`, no G3 gate passed.

Readiness probes (Windows PowerShell): `psql` absent, no `pg` driver, no `octokit`,
no GitHub App authorization, no email delivery infrastructure. Docker server
`29.0.1` present (container-level only, not VM/microVM qualification).

## T2 readiness mapping

| Task | Requires (full WP) | State | Reason |
|---|---|---|---|
| T2-1 observability (WP3-15) | 02, 05 | preparation only | predecessors `in_progress`; module does not exist |
| T2-2 campaign (WP3-16) | 04, 15 | preparation only | predecessors `in_progress` |
| T2-3 reducers (WP3-17) | 01, 16 | preparation only | predecessors `in_progress` |
| T2-4 fixtures/oracle (WP3-06) | 04, 05, 16, 17 | `blocked` | dependency chain incomplete; no frozen oracle |
| T2-5 identity/RLS (WP3-21) | 02 | `blocked` | `psql` absent, no `pg` driver, WP3-02 `in_progress` |
| T2-6 GitHub (WP3-22) | 21 | `blocked` | T2-5 blocked; no `octokit`; no authorized installation |
| T2-7 jobs (WP3-23) | 04, 21, 22 | `blocked` | chain blocked |
| T2-8 usage (WP3-24) | 21, 23 | `blocked` | chain blocked; pricing/vendor decisions absent |
| T2-9 email (WP3-28) | 21 | `blocked` | T2-5 blocked; no authorized delivery |

Per MVP §22, incomplete predecessors permit only independent preparation with
proven task inputs — no full-WP acceptance is claimable. Blocked items are
recorded, not worked around: substituting mocks, weakening checks, or inventing
evidence would invalidate downstream proof (AGENTS.md §3).

## Next dependency-ready task

Resolve the branching preconditions first: commit decision for the uncommitted
JVM-removal set on `development` (18 modified + 3 untracked, recovery ref
`refs/tbh/recovery/before-discard/20261029T185941Z-1790`), and the owner spec
decision on five vs six ecosystems. Then: PostgreSQL + `pg` driver for T2-5,
or scoped T2-1/T2-2/T2-3 preparation (failure-path tests first) against proven
T1-3/T1-7 inputs. Do not start T2-4..T2-9 implementation while their chains are
blocked.
