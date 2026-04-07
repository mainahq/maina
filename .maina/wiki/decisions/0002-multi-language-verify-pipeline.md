# Decision: Multi-language verify pipeline

> Status: **accepted**

## Context

Maina's verify pipeline was hardcoded for TypeScript/JavaScript — Biome for syntax guard, JS-specific slop patterns, tree-sitter tuned for TS imports, file collectors only scanning .ts/.js. This blocked adoption for any non-TypeScript project, contradicting the product spec's "any repo" promise.

## Decision

Introduce a LanguageProfile abstraction that maps each supported language to its tools, file patterns, and slop detection rules. The pipeline auto-detects languages from project marker files and routes to the appropriate linter.

Supported languages: TypeScript (Biome), Python (ruff), Go (go vet), Rust (clippy).

## Rationale

### Positive

- Maina works with Python, Go, and Rust projects out of the box
- Language detection is automatic — no configuration needed
- Existing TypeScript behavior is fully preserved (backward compatible)
- Adding new languages requires only a new LanguageProfile entry

### Negative

- More tools to maintain (ruff, go vet, clippy parsers)
- Polyglot repos use primary language only (no per-file language detection)

### Neutral

- Future languages (Java, C#, Ruby) follow the same pattern
