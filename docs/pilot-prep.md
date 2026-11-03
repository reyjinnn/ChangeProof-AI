# T-41 / T5-9 / WP3-14 — Organic pilot preparation

Task ID / parent WP: T-41 (T5-9) / WP3-14.
Requirement IDs: BR3-11, BR3-14; FR3-21; SC3-06; NEG3-28.
Owner: Reyn. Status: `done` (preparation only).

## 1. What this task is and is not

This task prepares the authorized organic pilot; it does not run one.
No owner adoption, production impact, or repaired-issue count may be
claimed from this preparation (NEG3-28). Full WP3-14 stays open until
phase-7 proves G3-10 with owner validation on a representative
environment.

Verified 2 November 2026: **zero authorized pilot repositories and
zero authorized pilot owners exist.** The candidate register
(`config/pilot/register.json`) is therefore empty, and every row that
needs a pilot stays `blocked` with the concrete need named in §6.

## 2. Authorized pilot scope (template, frozen per pilot)

Each pilot freezes the following before any run:

- Owner identity + organization, contact path, and timezone.
- Repository set (provider, full name, pinned last-known-valid ref and
  failing ref) with installation/grant scope and expiry.
- Business workflow under test, stated in owner words, plus the
  before/after measurement method for that workflow.
- Workload: representative traffic shape, observation horizon (never
  shorter than the tested onset horizon for leak/soak claims), and
  pre-patch onset frequency.
- Required proof dimensions (C/P/R/D) for the case, with thresholds
  from the frozen service profile — never tuned after the run starts.
- Data permissions: telemetry/data the owner allows, retention, and
  deletion handling.

## 3. Owner/domain access checklist (all required before SC3-06)

- [ ] Written owner authorization naming repos, refs, workload, and horizon.
- [ ] Repository installation/grant verified against current grants
      (grant version recorded; revoke withheld new effects per NEG3-22).
- [ ] Domain reviewer named for invariant approval and outcome acceptance.
- [ ] Issue provenance: genuinely reported/experienced by the owner —
      a controlled mutation is not a substitute (MVP SC3-06 contract).
- [ ] Independent baseline/oracle authoring path agreed (owner/domain,
      never derived from the observed bug alone — NEG3-19).
- [ ] Human edits after proposal recorded as a new attributed candidate
      with full re-verification (FR3-21).

## 4. SC3-06 source-provenance record (template)

```json
{
  "pilotId": "pilot-YYYYMMDD-nn",
  "origin": "current_organic | historical_organic",
  "owner": { "name": "", "org": "", "authorizationRef": "" },
  "repos": [{ "provider": "", "fullName": "", "validRef": "", "failingRef": "" }],
  "issueRef": "",
  "symptomsObserved": "",
  "telemetryRefs": [],
  "invariantsRef": "",
  "workloadRef": "",
  "horizonRef": ""
}
```

`origin` uses the product vocabulary; `controlled_change` is rejected
for SC3-06. Missing trigger/intent is a blocker, not a gap to fill
with an example mutation.

## 5. Outcome/active-time/review measurement procedure

Frozen before runs (MVP §21, `[DERIVED]` study rules):

- Event definitions: run submitted, first diagnosis shown, proposal
  shown, owner decision (accept/revise/reject), workflow recovered.
- Active time vs elapsed time: active time counts owner/reviewer
  interaction only; idle handling frozen (idle > 15 min excluded).
- Dropout/blocked counts kept visible; they never narrow the denominator.
- First-use vs repeat-use reported separately; savings claimed only
  from matched comparisons (same case/profile/evidence scope).
- No calibrated numerical savings, duration, or cost-per-repair
  targets exist yet — unmeasured figures stay unfilled, never invented.

Owner acceptance record: workflow recovery confirmed in the
representative environment, known limitations listed, observation
horizon stated. Satisfaction, or disappearance after restart, does not
replace proof (FR3-21).

## 6. Concrete needs (blockers for the run, not for this prep task)

1. At least one authorized pilot repository + owner with written
   authorization (§3). Owner: Reyn to secure.
2. Representative environment + workload access for the chosen case.
3. Frozen service profile numbers the case depends on (caps, SLO).
4. Phase-7 campaign capacity (frozen oracle, qualified guest, live model).

## 7. NEG3-28 guard

Any pilot/demo output without owner validation must keep outcome
status `not_started`/`blocked` and must not enter a repaired-issues
numerator. `tests/pilot/t41-register.test.ts` enforces the
machine-readable half: the register parses against its schema and
contains zero records claiming adoption or repair.
