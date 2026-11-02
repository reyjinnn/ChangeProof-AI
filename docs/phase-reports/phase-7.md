# Phase-7 report — whole-system testing, qualification and release assessment

**Plan revision:** 2 — 24 October 2026.
**This report covers:** T-50 only (the T7-1 slice for G3-01/G3-02:
contract/identity/policy/import negatives + qualified-guest probes).
Every other gate and full WP keeps the status stated in §3 — this
report passes no gate and closes no full WP.

## 1. T-50 / T7-1 slice / G3-01+G3-02 — negatives + guest probes

Task ID / parent WP: T-50 (T7-1 slice) / G3-01+G3-02 evidence.
Requirement IDs: WP3-01 contracts, WP3-02 identity, policy
precedence, import boundaries; runner isolation (WP3-04).
User-visible outcome: none directly — this task re-runs the
foundation's negative and boundary suites against the current
tree and attempts the qualified-guest hostile-code probes,
recording exactly what passed, what failed, and what is
blocked on credentials/scope.
Prerequisite evidence: phases 1–6 allocated tasks `done`
(phase-6 report §§1–20); full WPs still open per those reports.
Allowed source/config changes: none to product source — this
task only executes checks and writes this report. (No product
file was modified for T-50.)
Protected oracle / proof scope: suite results only; no
candidate, no verdict linkage, no publication.

What was executed (all commands on the current tree, 2026-11-02):

- `pnpm test:unit` → exit 0 — 6 files, 139/139
  (tests/contracts + tests/policy: versioned schemas,
  policy precedence, malformed-input negatives).
- `pnpm test:architecture` → exit 0 — 1 file, 9/9
  (prohibited-import/cycle/public-index boundary tests).
- `pnpm vitest run tests/identity` → exit 0 — 5 files, 47/47
  (tenancy/grant/session negatives, incl. NEG3-21 quiet refusals).
- `pnpm test:security` → exit 0 — 1 file, 14/14
  (mock-level runner security suite).
- `pnpm test:negative` → exit 1 — **missing check**: there is
  no `tests/negative/` directory, so the script reports "No
  test files found". Negatives currently live per-module
  (contracts/policy/identity/security); no consolidated
  negative suite exists to run.
- `pnpm test:adapters` → exit 1 — 11 files, 141/144. The 3
  failures are all Python L1 extraction
  (`l1-extraction.test.ts` × 2, `t07-acceptance.test.ts` × 1,
  `expected false to be true`). Proven pre-existing: with all
  working-tree changes stashed, the same file fails
  identically on the clean baseline (stash
  `t50-baseline-check`, popped afterwards, zero stashes left).
  No adapter source was touched by phases 6–7 work.
- `node scripts/runner-security-probes.mjs --dry-run` →
  exit 0 — wiring only (NOT qualification evidence): modal
  lib 1.6.3 present, `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`
  both unset, no network call, no credit spent.
- `node scripts/runner-security-probes.mjs` (real mode) →
  exit 2 — fail-closed `BLOCKED`: Modal credentials are not
  set, so no probe ran and nothing was spent. Live
  qualified-guest probes additionally need explicit session
  scope for paid Modal spend (AGENTS §16); no such scope was
  given, so they were not attempted beyond this refusal.
- Reused current-tree gates from the T-49 session (same
  uncommitted tree, no product change since): `pnpm
  typecheck` → 0, `pnpm lint` → 0 (168 modules / 526 deps,
  zero violations), `pnpm build` → 0, `pnpm build:ui` → 0,
  `pnpm test:ui` → 0 (132/132), `pnpm vitest run tests/http`
  → 0 (38/38), `pnpm test:e2e` → 0 (all eight specs).

Artifacts expected: this report with per-check commands +
exit codes — present. No receipts were fabricated for the
blocked probes; `runs/` gained no probe receipt.
Status + remaining blocker: allocated slice `done` (every
runnable check executed, blockers named concretely).
Concrete needs for the remainder of T7-1: (1) a consolidated
`tests/negative/` suite or an explicit decision that
per-module negatives are the suite (owns: backend phases);
(2) Python L1 extraction toolchain fix (owns: adapter phase);
(3) `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` + explicit paid-spend
scope for live guest probes (owns: session owner).
Next dependency-ready task: T7-2..T7-11 slices in gate order
(each needs its own frozen inputs and authorized access).

## 2. Gate rows touched by T-50 (contributions, not passes)

| Gate | T-50 contribution | State after T-50 |
| --- | --- | --- |
| G3-01 Foundation | contracts 139/139, architecture 9/9, identity 47/47, typecheck/lint green | `in_progress` — negative suite missing, adapter env failing |
| G3-02 Native runner | security mock 14/14; guest-probe wiring dry-run OK; live probes blocked (no creds/scope) | `blocked` — qualified-guest hostile-code probes have no credentials or spend authorization |

## 3. Everything else (unchanged by T-50)

G3-03..G3-17: `not_started` under phase-7 (T7-2..T7-11),
each awaiting its frozen inputs, live services, and
authorized access per the phase-7 playbook — notably
G3-08/G3-10 (repository/pilot access) and every gate
requiring paid APIs, external publication, or production
deployment, for which this session grants no scope.
Full WP3-01..34: open, exactly as the phase 1–6 reports
state; per-task `done` rows in those reports are not full-WP
acceptance. No gate passes on the evidence in this report
alone.
