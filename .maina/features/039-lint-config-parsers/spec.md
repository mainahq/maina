# Feature: Lint-config + manifest parsers

## Problem Statement

Constitution rules are manually authored. Lint configs (biome.json, .eslintrc, ruff.toml) and project manifests (package.json, pyproject.toml) contain implicit conventions that should be auto-extracted as constitution rules with confidence scores.

## Success Criteria

- [x] Parses biome.json, .eslintrc*, tsconfig.json, .editorconfig, .prettierrc*
- [x] Parses package.json scripts and engine requirements
- [x] Emits `{ text, confidence, source }` triples (confidence 1.0 for explicit config, 0.6 for inferred)
- [x] Unit tests against real config formats

## Scope

### In Scope
- Config file parsers for JS/TS ecosystem (biome, eslint, tsconfig, editorconfig, prettier)
- Package.json script and engine extraction
- Each parser returns ConstitutionRule[] with confidence scores

### Out of Scope
- Python configs (pyproject.toml, ruff.toml) — future extension
- Go, Rust, Java configs — future extension
- Writing rules to constitution.md (consumer responsibility)
