# Feature: Implementation Plan

## Scope

### In Scope - TypeScript pattern detection via tree-sitter queries - Sampling logic (<=100 files, deterministic selection) - Constitution rule emission with confidence scores ### Out of Scope - Python patterns (stubbed but gated behind flag) - Go, Rust, Java, C#, PHP (future) - Interactive propose/accept (separate issue #117)

## Tasks

Progress: 8/8 (100%)

- [x] T1: Write TDD test stubs from spec (25 red, confirmed failing)
- [x] T2: Implement `sampleFiles()` — deterministic file sampling
- [x] T3: Implement `detectAsyncStyle()` — async/await vs .then
- [x] T4: Implement `detectFunctionStyle()` — arrow vs declaration
- [x] T5: Implement `detectImportStyle()` — named vs default
- [x] T6: Implement `detectErrorHandling()` — try/catch vs .catch
- [x] T7: Implement `samplePatterns()` — combined runner (17 tests green)
- [x] T8: `maina verify` + `maina review` (READY) + `maina analyze` — all pass

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
