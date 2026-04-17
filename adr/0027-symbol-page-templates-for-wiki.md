# 0027. Symbol page templates for wiki

Date: 2026-04-17

## Status

Accepted

## Context

Wiki entity articles need structured per-symbol documentation: signature, location, refs, and call graph diagrams. Currently entities get minimal text. Adding templates makes the wiki navigable as a code reference.

## Decision

Template-based generation (no AI) with Mermaid diagrams for call relationships. Pure function: `(entity, refs) → markdown`. Content-hash keyed for deterministic caching.

Mermaid `graph LR` chosen because it renders natively in GitHub, Starlight docs, and any markdown viewer without JavaScript.

## Consequences

### Positive
- Every entity gets a structured, navigable page
- Mermaid diagrams render everywhere without JS
- Deterministic output enables caching

### Negative
- LLM prose requires API key or host delegation (falls back to template-only when unavailable)
- Diagrams may get complex for highly-connected symbols (mitigated: cap at 20 refs per direction)
