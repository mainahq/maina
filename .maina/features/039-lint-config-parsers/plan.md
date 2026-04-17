# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/constitution/config-parsers.ts`. Each parser is a pure function: `(repoRoot) => ConstitutionRule[]`. Reuses `ConstitutionRule` type from git-analyzer.ts.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/constitution/config-parsers.ts` | All config parsers | New |
| `packages/core/src/constitution/__tests__/config-parsers.test.ts` | Tests | New |

## Tasks

- [x] T1: Implement parseBiomeConfig — extract lint rules, formatter settings
- [x] T2: Implement parseEslintConfig — detect preset, key rules
- [x] T3: Implement parseTsConfig — strict mode, paths, target
- [x] T4: Implement parseEditorConfig — indent style/size, charset
- [x] T5: Implement parsePackageJson — scripts, engines, type:module
- [x] T6: Implement parseAllConfigs — combined runner
- [x] T7: Write tests
