# Phase-1 adapter fail-closed corrections (Go / .NET)

**Date:** 30 October 2026
**Affects:** `src/modules/adapters/go/index.ts`, `src/modules/adapters/dotnet/index.ts`
**Requirements:** NEG3-09, FR3-02

## What changed

1. Both adapters return `unsupported` (fail closed) when the toolchain version is
   missing or `unavailable`, instead of attempting native extraction without a
   pinned identity.
2. Go returns `unsupported` when native extraction yields zero facts, instead of
   `ok` with an empty graph.
3. .NET returns `unsupported` with an empty graph when no endpoint fact was
   extracted, instead of `ok` with a type-only graph.
4. .NET Roslyn helper path now includes the versioned SDK directory
   (`<sdk-root>/10.0.403/Roslyn/...`), and its JSON uses camelCase with
   case-insensitive deserialization to match the TypeScript side.

## Why no version bump

The adapter contract (`ADAPTER_CONTRACT_VERSION = '1'`, record `adapterVersion`
`'1.0.0'`) is unchanged: the previous behavior contradicted the contract the
maintained tests already asserted (`unsupported` + toolchain/SDK messages,
no generic success). This is a correction toward the specified contract, not a
contract change, so versions stay pinned.

## Evidence

`tests/adapters` 34/34, including native Go (go1.27.3) and .NET (SDK 10.0.403)
positive + negative cases. Kotlin remains `blocked` (kotlinc uninstallable).
