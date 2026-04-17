# 0022. Wiki is a view of the Context engine

Date: 2026-04-17

## Status

Accepted

## Context

The wiki was initially presented as a standalone feature: "codebase knowledge compiler." This creates confusion — users think Maina has two products (verification + wiki) instead of one system with multiple views.

The Context engine is the core. It has 5 layers (Working, Episodic, Semantic, Retrieval, Wiki). The wiki is Layer 5 — a persistent, human-readable *view* of the knowledge graph. Same engine, same data, different rendering.

## Decision

Reposition the wiki as "a view of the Context engine" in all messaging:

- **Context engine** (core) — the product, the thing that understands your codebase
- **Wiki** (view) — human-readable articles compiled from the knowledge graph
- **Blast radius** (view, future) — impact analysis rendered from the dependency graph
- **Symbol graph** (view, future) — per-symbol documentation pages

## Consequences

### Positive

- Clearer product narrative: one engine, multiple views
- Wiki becomes a feature of something bigger, not a standalone tool
- Differentiates from DeepWiki (which is wiki-only, not a verification system)

### Negative

- Existing marketing copy needs updates (README, docs, site)
- Users who found Maina through wiki features may be briefly confused
