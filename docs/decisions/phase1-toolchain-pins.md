# DEC3-P1-02 — Phase-1 toolchain pins

**Status:** `accepted` 26 October 2026
**Decision class:** `[DERIVED]` — pins chosen so the phase-1 acceptance commands are reproducible.
**Supersedes:** the open question flagged in `.prepare/architecture.md` §3, which names pnpm/Vitest/ESLint/
dependency-cruiser but pins no Node version.

## Pinned host toolchain

| Tool | Pinned value | Verified on this host |
| --- | --- | --- |
| Node | `26.12.1` (exact: `engines`, `.node-version`) | `node --version` → `v26.12.1` — the version the user develops this project with |
| pnpm | `12.5.1` (`packageManager` + `engines`) | `pnpm --version` → `12.5.1` |
| TypeScript | `5.9.3` | resolved by `pnpm install` |
| Zod | `4.6.7` | resolved by `pnpm install` |
| Vitest | `5.0.5` | resolved by `pnpm install` |
| ESLint | `10.13.0` + `@eslint/js` `10.0.1` | resolved by `pnpm install` |
| typescript-eslint | `8.71.2` | resolved by `pnpm install` |
| dependency-cruiser | `18.6.0` | resolved by `pnpm install` |
| `@types/node` | `24.8.0` | resolved by `pnpm install` |

`save-exact=true` is set in `.npmrc`, so no dependency may drift by caret range. `pnpm-lock.yaml` is
the frozen resolution and is the identity recorded in the phase report.

Node is pinned exactly to `26.12.1`, the version this project is developed against, so a
reproducible run means the same runtime the developer actually uses. The pin is exact rather than a
range: a range would let a different minor version produce a different result under the same
identity, which is the drift `.claude/AGENTS.md` §3 rule 7 warns about for capability claims.

## Pinned native toolchain for adapter conformance (WP3-03)

Ecosystem toolchains are recorded per adapter as part of the capability tuple. Verified availability
on this host at the time of this record:

| Ecosystem | Tool | Status |
| --- | --- | --- |
| `typescript` | Node `26.12.1` | available |
| `python` | Python `3.10.0` | available |
| `jvm` (Java) | Java `21.0.12.1`, Maven `3.10.0`, Gradle | available |
| `jvm` (Kotlin) | `kotlinc` | **absent** → Kotlin L1 blocked |
| `php` | PHP `8.5.12` | available |
| `go` | `go` | **absent** → Go L1 blocked |
| `dotnet` | `dotnet` | **absent** → .NET L1 blocked |

Absent toolchains are recorded as a **specific blocker** per `.claude/AGENTS.md` §12 and are never
substituted with a simulation. The affected capability records stay `provenLevel = none`.

## What this does not decide

These pins are development-calibration values, not accepted product figures. Any SLO, capacity, cost,
retention or pricing number remains unmeasured and must not be quoted from this record. Changing a pin
after a conformance run is a new toolchain identity and invalidates the certification it produced.
