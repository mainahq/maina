# Decision: Kill decision — @workkit for wiki search

> Status: **accepted**

## Context

Internal discussion considered using @workkit as a search library for wiki queries. @workkit is a Cloudflare Workers toolkit — it has no search capabilities. Maina uses Pagefind for docs site search and Orama (under evaluation, gated by ADR 0014) for in-app wiki search.

## Decision

Do not use @workkit for search. Revisit only if @workkit ships dedicated search features.

## Rationale

- Pagefind handles docs site search (already working)
- Orama evaluation for in-app search proceeds under experiment gates (ADR 0014)
- @workkit continues to be used for its actual purpose: R2, KV, D1, auth, etc.
