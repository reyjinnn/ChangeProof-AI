# T-06 ecosystem scope resolution: five ecosystems, JVM removed (owner-directed)

**Date:** 30 October 2026
**Task:** T-06 / T1-4 / WP3-03
**Affects:** `.prepare/BRD.md`, `.prepare/PRD.md`, `.prepare/MVP.md`, `.prepare/architecture.md`
**Requirements:** FR3-01/02; NEG3-02/09
**Prior record:** `docs/decisions/phase1-jvm-removal.md` (code-side removal, spec left open)

## Decision

Keep the owner-directed removal. The product scope is **five** ecosystems:

`typescript`, `python`, `go`, `php`, `dotnet`.

JVM (Java/Kotlin: Spring Boot, Hibernate/JPA, Quarkus, Micronaut, Ktor) is out
of scope. The six-ecosystem target in the specification package is narrowed to
five by this record, and the four governing documents are updated to match the
code (`ECOSYSTEMS` has five entries, `CapabilityRecord` v2, `ADAPTER_CONTRACT_VERSION` v2).

## Why this way

1. The code removal was an explicit owner instruction (remove everything
   Java/Kotlin), already implemented and verified.
2. Reinstating JVM is the larger change: re-add the adapter, fixtures, L1
   Java + Kotlin cases, L3 Spring Boot/Hibernate scope, and toolchains. Kotlin
   (`kotlinc`) is uninstallable in the current environment, so T-07 would stay
   blocked on toolchain alone.
3. Ponytail rule: deletion beats addition. Keeping five is the smallest change
   that fully resolves the divergence.

## What changed in this task

- This decision record.
- BRD: JVM row removed from the ecosystem-scope table; six-ecosystem and
  Spring Boot backend-choice wording narrowed to five/FastAPI.
- MVP: six-to-five wording; JVM matrix rows removed; flagship, SC3-01,
  WP3-03/WP3-08/WP3-10, evaluation L3 paths, and capability-matrix gate
  updated; stale technical-reference wording fixed.
- PRD: `browser/JVM warmup` narrowed to `browser warmup`.
- architecture: `jvm/` adapter entry removed.
- No contract version bump: the semantic change (enum removal) already landed
  as `CapabilityRecord` v2 in the prior removal record. New capability records
  still start at `provenLevel = none`.

## Handoff to T-07

T-07 L1 acceptance covers the five ecosystems above: at least one positive
extraction and one negative/unsupported case per tuple on a pinned version.
No JVM/Kotlin case is required. The `kotlinc` blocker is closed by removal,
not by installation.
