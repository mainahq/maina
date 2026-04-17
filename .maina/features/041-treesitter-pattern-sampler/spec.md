# Feature: Pattern sampler (TS — regex-based V1)

## Problem Statement

Constitution rules about coding style (async/await vs .then, arrow vs declaration, named vs default imports) can't be detected from config files. They need code analysis. V1 uses regex-based detection on sampled files (<=100 per language) — sufficient for the target patterns. Tree-sitter AST can be added in V2 for complex patterns.

## Target User

- Primary: Teams running `maina learn` to auto-detect coding conventions
- Secondary: Constitution builders wanting evidence-based rules

## User Stories

- As a developer, I want `maina learn` to detect that my team uses async/await (not .then) so the constitution reflects actual practice.
- As a team lead, I want auto-detected patterns with confidence scores so I can accept/reject them.

## Success Criteria

- [ ] Detects async style (async/await vs .then) in TypeScript files
- [ ] Detects function style (arrow vs declaration) in TypeScript files
- [ ] Detects import style (named vs default) in TypeScript files
- [ ] Detects error handling pattern (try/catch vs .catch) in TypeScript files
- [ ] Samples <=100 files per language
- [ ] Emits rules with confidence 0.4–0.7 based on pattern prevalence
- [ ] Runs in under 10 seconds on a 1000-file repo
- [ ] Output deterministic across runs

## Scope

### In Scope

- TypeScript pattern detection via tree-sitter queries
- Sampling logic (<=100 files, deterministic selection)
- Constitution rule emission with confidence scores

### Out of Scope

- Python patterns (stubbed but gated behind flag)
- Go, Rust, Java, C#, PHP (future)
- Interactive propose/accept (separate issue #117)
