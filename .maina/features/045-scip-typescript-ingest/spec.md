# Feature: Run scip-typescript in ingest

## Problem Statement

Custom parsers (regex-based entity extraction) don't scale and miss complex relationships. SCIP (Sourcegraph, Apache-2.0) gives precise code intelligence: every symbol with file, kind, refs, and cross-file relationships. Running `scip-typescript` in the wiki ingest path enables accurate symbol pages.

## Success Criteria

- [ ] `runScipTypescript(repoRoot)` spawns scip-typescript and parses output
- [ ] Handles monorepos with multiple tsconfig.json
- [ ] Returns structured symbol data (name, kind, file, line, refs)
- [ ] Graceful fallback when scip-typescript is not installed
- [ ] Unit tests with mock subprocess output

## Scope

### In Scope
- Subprocess invocation of scip-typescript
- Output parsing (SCIP protobuf → internal types)
- Monorepo support (find all tsconfig.json)
- Availability check + graceful fallback

### Out of Scope
- Wiki article generation from SCIP data (uses existing symbol-page.ts)
- Installing scip-typescript (user responsibility or maina doctor recommendation)
