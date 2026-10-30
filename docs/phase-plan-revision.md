# Seven-Phase Execution Plan Revision — 24 October 2026

**Status:** `done` for planning-document revision and validation only. No implementation phase was executed by this change.

## Task header

```text
Task ID / parent WP: DOC3-20261024-01 / execution preparation for WP3-01..34
Requirement IDs: BR3-01..25, FR3-01..45, NFR3-01..15, DEC3-01..23;
                 mappings for WP3-01..34, G3-01..17, NEG3-01..40, PC3-01..08,
                 and SC3-01..11 retained
User-visible outcome: phases 1-5 focus on back-end work; phase-6 covers all product front-end
                      work from the final mockup; phase-7 covers whole-system testing and
                      qualification, all within one complete release
Prerequisite evidence: AGENTS and the development skill reviewed; BRD reference located in a
                       neighboring project; PRD → MVP → architecture and five older playbooks
                       reviewed; this root initially contained specification documents only,
                       with no .git, package.json, or application source
Allowed source/config changes: phases/*.md, AGENTS.md, SKILL.md, .prepare/BRD.md,
                               .prepare/PRD.md, .prepare/MVP.md, .prepare/architecture.md,
                               this revision note; temporary validators/snapshots
Input snapshots + intended intervention: pre-change document snapshot stored in a temporary
                                         directory; five-phase plan replaced by execution-plan
                                         revision 2
Acceptance checks (positive, negative, native): exactly seven playbooks; all 34 WPs and 17
  gates; one back-end task owner per WP; complete phase-6 UI tasks; phase-7 acceptance; unchanged
  §8 dependency DAG; topological acceptance order; all ancestors of final WP3-14; valid local
  links/anchors; phase routing 1-7; retained IDs and mockup identity; assertions cover missing,
  duplicate, reversed-dependency, broken-link, and stale-routing cases; native checks not
  applicable to documentation changes
Protected oracle / proof scope: product oracle, thresholds, policy, budget, and evidence unchanged;
                                no runtime or capability evidence produced
Artifacts expected: phases/phase-1.md through phases/phase-7.md; MVP §22; cross-document routing;
                    BRD provenance; revision record and actual check results
Actual commands + exit codes: see the checks table below
Status + remaining blocker: done for planning-document scope; no documentation blocker;
                           implementation evidence and product gates remain unproven
Next dependency-ready task: on a phase-1 request, audit the actual source and then continue
                            dependency-ready WP3-01 contracts/policy work; do not execute a phase
                            automatically
```

## Changes and limitations

The normative allocation is in [MVP §22](../.prepare/MVP.md#execution-phases), with prompt routing in [AGENTS §18](../AGENTS.md#18-pemanggilan-fase-eksekusi). All seven playbooks use revision 2. Work packages spanning service and UI work have separate tasks; completing a service task does not complete the WP until all dependencies and original acceptance criteria are satisfied. Independent preparation may use proven task inputs, but does not replace full-WP prerequisites. Phase-7 still reviews all gates; local positive/negative tests and native checks remain required in each development phase.

The actual package layout has the source documents directly in the ChangeProof-AI root: `phases/`, `SKILL.md`, four specifications, and `.template-ui/mockup.html`. No duplicate specification tree was created. Playbooks use relative links to neighboring documents and accommodate both the conventional layout and this extracted root-level package. No historical execution report was present in `docs/phase-reports/` before this report; migration guidance is provided without fabricating execution status.

`.prepare/BRD.md` was initially absent. It was supplied from `C:/Users/user/Documents/All Project/changeproof/.prepare/BRD.md`, with source SHA-256 `e88f14c7a3ae9999affe9f514e4d3252435f683391ad3992fabd58f7ed1c132e`. After copying, only references for phase allocation and provenance were aligned. The neighboring project was not changed. The copy restores a local BRD reference that was previously broken; it does not prove any capability.

The 22 October 2026 five-phase note and its reported checks in the MVP are retained as history. Those older results were not used as evidence for validating this revision. Product schema/policy/evaluation did not change; only the execution plan changed from revision 1 to revision 2. UI figures, product license, vendors, pricing, and capacity were not decided by this task. Runtime UI language remains English.

## Actual checks

| Command / check | Exit code | Result and scope |
|---|---:|---|
| `git status --short` | 1 | No Git metadata at this root; the shell/tool returned exit code 1. No Git diff or commit is claimed. |
| `Get-ChildItem -Force`, `Test-Path package.json`, `Test-Path .improvement`, `Test-Path docs/phase-reports` | 0 | Layout audit; the latter three paths were absent before the report was added. |
| `python C:\Users\user\AppData\Local\Temp\changeproof_rephase.py` | 0 | Captured the initial snapshot, wrote seven playbooks and references; did not execute a phase. |
| Change inspection using `difflib` through `python -` | 1 | Console cp1252 could not display Unicode; this was an output-encoding issue, not a content failure. |
| Change and identity inspection using `python -X utf8 -` | 0 | Reviewed document diff and calculated BRD/mockup/plan digests. |
| `python C:\Users\user\AppData\Local\Temp\check_changeproof_phase_plan.py` (first run) | 1 | All structural assertions passed; the link to this note was not yet present because the file had not been written. |
| `python -X utf8 C:\Users\user\AppData\Local\Temp\check_changeproof_phase_plan.py` (final run) | 0 | PASS: seven playbooks, 34 WPs, unchanged §8 DAG, topological acceptance order, 17 gates, routing/IDs/mockup, and 181 valid local Markdown links; no broken links. |

The validator compared MVP §8 with a pre-edit snapshot and checked unique back-end task ownership, task-list/playbook agreement, UI allocation, dependency ordering, all ancestors of WP3-14, allocation of all 17 gates, phase routing/resume behavior, retained IDs, and local Markdown links/anchors. Assertions reject missing/duplicate tasks, reversed dependencies, missing anchors/files, and inconsistent routing. External URLs were not checked. Markdown/structure validation does not prove behavior of future agent sessions.

The baseline package had 125 local links, including 18 broken references to the absent BRD. Adding the local BRD copy and aligning the plan resolved those references. Final validation covered 181 local links with zero broken references. This is document-navigation validation, not product acceptance.

Combined identity for the six main documents and seven playbooks after the change: SHA-256 `9348bac0eb6d0861e8b1e18f4d1625c64ea283514722260c60021c6157213bb2`. Calculation: sort absolute paths, concatenate each relative path using `/`, a NUL byte, the file bytes, and another NUL byte; hash the resulting bytes. This report is not included in that digest.

`.template-ui/mockup.html` identity before and after the change is unchanged: SHA-256 `2ec45e56280259d8ebee164fc97161fb77a185802aef69c4c04852cdf32a4011`. The source mockup, stripped mockup, and preview were not edited. Snapshots/validators were temporary and outside the package; they are not hosted authority or immutable product evidence.

**Mock/replay:** not run. **Native/model/provider/browser/payment:** not run. **Missing application checks:** strict typecheck, lint/boundaries, unit/integration, and native E2E were unavailable for this documentation-only package because `package.json` and application source were absent at the time. No passing product result or completed WP/gate is claimed. No paid API, external message, publication, or deployment occurred.
