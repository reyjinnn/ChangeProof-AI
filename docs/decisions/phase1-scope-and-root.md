# DEC3-P1-01 — Phase-1 application root and scope

**Status:** `accepted` (24 October 2026 plan revision 2; execution decision recorded 26 October 2026)
**Decision class:** `[DERIVED]` — execution-scope decision. Does not change product scope, thresholds,
policy, oracle, budget or any full-release acceptance criterion.

## Decision

Phase-1 is executed **in this repository (`ChangeProof-AI/`)** as the application root, from scratch.

1. All product source is authored here under the layout mandated by `.prepare/architecture.md` §2:
   `src/core/`, `src/modules/*`, `src/orchestrator/`, `src/http/`, `src/workers/`, `src/cli/`.
   This is **one host package**. It is not a monorepo of `packages/*`.
2. No source is copied from any other directory on this machine. Every file under `src/` is authored
   in this repository. Prior work elsewhere is **not** used as a basis and is **not** claimed as
   evidence for any work package.
3. Consequence: `provenLevel` for every capability record starts at `none` and is raised only by
   conformance plus real, reproducible evidence produced **in this repository**.

## Why this is recorded

`.claude/AGENTS.md` §2.2 requires verifying what actually exists rather than copying claims, and §13 requires
explicitly versioning and recording scope-affecting decisions. A different ChangeProof implementation
exists elsewhere on this host (`../changeproof`) built against an earlier specification revision.
Reusing it would have imported an unverified provenance chain, a divergent module layout
(`packages/*` instead of `src/modules/*`) and a `ConsumerOutcome` vocabulary that revision 2 replaces
with `TargetOutcome`.

Recording the decision keeps three things honest:

- **No borrowed proof.** Nothing in this repository may cite that other directory as its evidence.
- **No layout drift.** The import matrix in `.prepare/architecture.md` §3 only holds for the `src/modules/*`
  layout, so building in that layout is what makes the boundary rules enforceable.
- **No hidden reuse.** If any artefact is ever reused later, it needs its own provenance record naming
  the source path and its SHA-256. None is reused as of this record.

## What this does not decide

Toolchain pins (`DEC3-P1-02`), the isolation boundary for the guest runner (`DEC3-P1-03`), and the
values of `HostedServiceProfile` remain separate decisions. No paid API call, external repository
mutation, publication, payment or production deployment is authorized by this record.
