# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- Pure function `exportGraph(graph, articles, format): Result<string | Record<string,string>, string>` in `packages/core/src/wiki/export.ts`. String return for single-file formats (Cypher, GraphML); `Record<string,string>` (path → contents) for Obsidian's directory layout.
- CLI subcommand `maina wiki export <format> --out <path>` writes the bytes to disk and returns a `Result`.
- [NEEDS CLARIFICATION] Obsidian: symlink vs. copy for existing wiki markdown. Cross-platform symlink support (Windows) is the deciding factor.
- [NEEDS CLARIFICATION] GraphML validation — run the golden fixture through `xmllint` in CI, or rely on Gephi/yEd manual acceptance?

## Files

| File | Purpose | New/Modified |
|------|---------|--------------|
| `packages/core/src/wiki/export.ts` | `exportGraph()` dispatcher + three format modules | New |
| `packages/core/src/wiki/__tests__/export.cypher.test.ts` | Golden fixture | New |
| `packages/core/src/wiki/__tests__/export.graphml.test.ts` | Golden fixture | New |
| `packages/core/src/wiki/__tests__/export.obsidian.test.ts` | Golden fixture | New |
| `packages/cli/src/commands/wiki/export.ts` | CLI subcommand | New |
| `packages/docs/...` | `wiki export` docs page | New |

## Tasks

See `tasks.md`.
