# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Extend the existing `loadConstitution()` in `packages/core/src/prompts/loader.ts` to also scan `constitution.d/` and merge shards. Add a new `loadScopedConstitution(mainaDir, filePath?)` that filters by `applies_to:` globs.

## Key Technical Decisions

- Simple frontmatter parsing (regex, no YAML library needed — format is just `applies_to: [...]`)
- Custom `matchGlob()` using regex (lightweight, no dependency — supports `*` and `**` patterns)
- Deterministic merge: alphabetical sort of shard filenames

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/prompts/loader.ts` | Add `loadScopedConstitution()` and shard loading | Modified |
| `packages/core/src/prompts/__tests__/loader.test.ts` | Tests for scoped loading | Modified |

## Tasks

- [ ] T1: Write tests for shard loading, glob filtering, backward compat
- [ ] T2: Implement `loadConstitutionShards()` — reads `constitution.d/*.md`
- [ ] T3: Implement `loadScopedConstitution()` — merges root + filtered shards
- [ ] T4: Verify with maina verify + maina review

## Testing Strategy

- Unit tests with temp directories containing root + shard files
- Test glob filtering with various path patterns
- Test backward compat (no constitution.d/ directory)
