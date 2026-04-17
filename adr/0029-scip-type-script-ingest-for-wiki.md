# 0029. SCIP TypeScript ingest for wiki

Date: 2026-04-17

## Status

Accepted

## Context

Custom regex parsers miss complex cross-file relationships. SCIP (Sourcegraph, Apache-2.0) is the successor to LSIF — 5-10x smaller, 3x faster. Running `scip-typescript` gives precise symbol data for free.

## Decision

Spawn `scip-typescript` as a subprocess, parse JSON output, normalize into internal types. Graceful fallback when not installed — wiki continues to work with regex-based extraction.

## Consequences

### Positive
- Precise symbol refs (callers/callees) across files
- Monorepo support via multiple tsconfig.json discovery
- No protobuf dependency — use JSON output mode

### Negative
- External tool dependency (mitigated: graceful fallback + maina doctor recommendation)
- Subprocess spawning adds latency (mitigated: only runs during wiki compile, not on every command)
