# Feature: Glob-scoped constitution rules via constitution.d/*.md

## Problem Statement

Monorepos and mixed-stack repos need per-path rules. A React frontend and a Go API in the same repo have different conventions. Today, constitution.md is a flat file with no way to scope rules to specific paths.

## Target User

- Primary: Monorepo teams with multiple stacks (e.g. `apps/web/**` is React, `apps/api/**` is Go)
- Secondary: Any team wanting path-specific conventions

## Success Criteria

- [ ] Loader merges root `constitution.md` + `constitution.d/*.md` in deterministic order
- [ ] `applies_to:` frontmatter globs filter rules per file path
- [ ] Backward compatible: absent `constitution.d/` behaves as today
- [ ] Unit tests cover merge, glob filtering, and backward compat

## Scope

### In Scope

- `constitution.d/` directory support with per-file `applies_to:` globs
- Loader that merges root + shards deterministically
- Glob matching for filtering rules per file path
- Backward compatibility when directory is absent

### Out of Scope

- AI-powered rule assignment to shards (manual for now)
- Cookbook docs (separate issue)

## Design Decisions

- Frontmatter format: `applies_to: ["apps/web/**", "packages/ui/**"]`
- Merge order: root first, then shards sorted alphabetically by filename
- Shards augment root (additive), not replace
