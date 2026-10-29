# JVM ecosystem removal (owner-directed)

**Date:** 30 October 2026
**Affects:** `src/modules/adapters/jvm`, `ECOSYSTEMS`, `CapabilityRecord` contract, adapter extract surface
**Requirements:** owner instruction (remove everything Java/Kotlin); FR3-02, FR3-03, NEG3-09

## What changed

1. Deleted `src/modules/adapters/jvm/index.ts` (Java `javac` extraction + Kotlin fail-closed stub).
2. Removed the `./jvm` re-export from `src/modules/adapters/index.ts`.
3. Removed the `jvm` value from `ECOSYSTEMS` (now five ecosystems).
4. Removed the now-unused optional `language` field from `AdapterExtractInput` (only the JVM adapter consumed it).
5. Removed JVM fixtures (`JVM_SERVICE`) and all JVM/Kotlin test cases (L1 extraction, Kotlin record, six-ecosystem assertions now assert five).

## Version bumps

- `CapabilityRecord` contract `1` → `2` (`SCHEMA_VERSIONS`, schema literal, all five adapter records, test helpers). Removing an enum value is a semantic contract change; old `jvm` records now fail closed at parse.
- `ADAPTER_CONTRACT_VERSION` `1` → `2` (both declarations and all five adapter definitions) for the `AdapterExtractInput` shape change.

## Evidence

Full suite re-run after the removal (typecheck, lint, `vitest run`) — see the phase-1 report addendum for commands and exit codes.

## Open divergence (not silently rewritten)

The specification package (BRD/PRD/MVP/architecture) and phase playbooks still name six ecosystems and JVM L1 requirements. Those documents were deliberately left untouched: narrowing the product scope in the spec requires an owner spec decision, not a code-side edit. Until that decision lands, code and spec disagree — code is five ecosystems, spec says six.
