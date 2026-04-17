# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/wiki/symbol-page.ts`. Pure function: `(CodeEntity, refs) → string`. Uses the existing `CodeEntity` type from extractors. Mermaid diagrams generated as code blocks.

## Key Technical Decisions

- Template-based (no AI) — deterministic, fast, cacheable
- Mermaid `graph LR` for call diagrams — renders in GitHub, docs, any markdown viewer
- Content hash = `hash(entity.name + entity.file + entity.line + refs)` for cache key

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/wiki/symbol-page.ts` | Symbol page template generator | New |
| `packages/core/src/wiki/__tests__/symbol-page.test.ts` | TDD tests | New |

## Tasks

- [ ] T1: Write TDD test stubs (red phase)
- [ ] T2: Implement `formatSignature()` — entity kind + name + exported status
- [ ] T3: Implement `formatLocation()` — file:line as repo-relative link
- [ ] T4: Implement `formatRefs()` — inbound/outbound ref lists with links
- [ ] T5: Implement `formatMermaidDiagram()` — call graph as Mermaid code block
- [ ] T6: Implement `generateSymbolPage()` — combined template
- [ ] T7: `maina verify` + `maina review` + `maina analyze`
