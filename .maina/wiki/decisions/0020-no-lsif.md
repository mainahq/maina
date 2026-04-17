# Decision: No LSIF usage — SCIP is the target format

> Status: **accepted**

## Context

Sourcegraph migrated off LSIF in v4.6, replacing it with SCIP. Audit: does Maina use LSIF anywhere?

`rg -i "lsif"` across the codebase: **zero hits** (one false positive in bun.lock package hash).

## Decision

No LSIF migration needed. SCIP is the target format for the code intelligence epic (#133).

## Rationale

- SCIP ingest (#124) proceeds without migration overhead
- This ADR closes the audit cleanly
