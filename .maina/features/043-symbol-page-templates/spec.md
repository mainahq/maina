# Feature: Symbol page templates

## Problem Statement

Wiki entity articles show raw function/class names but lack structured symbol documentation. Per-symbol pages should have: signature block, file + line, refs (inbound + outbound), and a Mermaid diagram for call relationships. This makes the wiki navigable as a code reference.

## Target User

- Primary: Developers using `maina wiki query` or browsing wiki articles to understand codebase
- Secondary: New team members onboarding through wiki

## Success Criteria

- [ ] `generateSymbolPage(entity, refs)` produces structured markdown with signature, location, refs, diagram
- [ ] Signature block extracted from entity metadata
- [ ] File + line with repo-relative path
- [ ] Refs section with inbound (callers) and outbound (callees) links
- [ ] Mermaid diagram for call relationships (renders without JS in markdown)
- [ ] Content-hash-keyed caching for deterministic output
- [ ] Unit tests for all template sections

## Scope

### In Scope
- Symbol page template generator in wiki compiler
- Mermaid diagram generation from entity refs
- Deterministic output (same entity → same page)

### Out of Scope
- LLM-generated prose descriptions (future — needs AI integration)
- Interactive graph navigation (future — needs frontend)
