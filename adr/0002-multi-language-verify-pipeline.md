# 0002. Multi-language verify pipeline

Date: 2026-04-03

## Status

Accepted

## Context

Maina's verify pipeline was hardcoded for TypeScript/JavaScript — Biome for syntax guard, JS-specific slop patterns, tree-sitter tuned for TS imports, file collectors only scanning .ts/.js. This blocked adoption for any non-TypeScript project, contradicting the product spec's "any repo" promise.

## Decision

Introduce a LanguageProfile abstraction that maps each supported language to its tools, file patterns, and slop detection rules. The pipeline auto-detects languages from project marker files and routes to the appropriate linter.

Supported languages: TypeScript (Biome), Python (ruff), Go (go vet), Rust (clippy).

## Consequences

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

## High-Level Design

### System Overview

A LanguageProfile interface maps each language to its linter, file extensions, slop patterns, comment styles, and test file patterns. Language detection reads project marker files (tsconfig.json, pyproject.toml, go.mod, Cargo.toml). The syntax guard, slop detector, semantic collector, and retrieval search all consume the profile.

### Component Boundaries

- `language/profile.ts` — LanguageProfile interface + 4 built-in profiles
- `language/detect.ts` — detectLanguages() from marker files
- `verify/syntax-guard.ts` — dispatch per profile (Biome/ruff/go vet/clippy)
- `verify/linters/` — per-language output parsers (ruff.ts, go-vet.ts, clippy.ts)
- `verify/slop.ts` — language-aware print/log/test-file detection
- `context/semantic.ts` — dynamic file extension collection
- `context/retrieval.ts` — language-aware grep globs

### Data Flow

Pipeline → detectLanguages(cwd) → getProfile(primaryLang) → syntaxGuard(files, cwd, profile) → language-specific linter → parse output → Finding[]

### External Dependencies

- ruff (Python linter, optional — skipped if not installed)
- go vet (Go, part of Go toolchain)
- cargo clippy (Rust, part of Rust toolchain)
- golangci-lint (Go meta-linter, optional)
- cargo-audit (Rust CVE scanner, optional)

## Low-Level Design

### Interfaces & Types

```typescript
type LanguageId = "typescript" | "python" | "go" | "rust";

interface LanguageProfile {
  id: LanguageId;
  extensions: string[];
  syntaxTool: string;
  syntaxArgs: (files: string[], cwd: string) => string[];
  commentPrefixes: string[];
  testFilePattern: RegExp;
  printPattern: RegExp;
  lintIgnorePattern: RegExp;
  importPattern: RegExp;
  fileGlobs: string[];
}
```

### Function Signatures

- `getProfile(id: LanguageId): LanguageProfile`
- `detectLanguages(cwd: string): LanguageId[]`
- `getPrimaryLanguage(cwd: string): LanguageId`
- `syntaxGuard(files, cwd?, profile?): Promise<SyntaxGuardResult>`
- `parseRuffOutput(json: string): SyntaxDiagnostic[]`
- `parseGoVetOutput(output: string): SyntaxDiagnostic[]`
- `parseClippyOutput(output: string): SyntaxDiagnostic[]`

### DB Schema Changes

None

### Sequence of Operations

1. Pipeline starts → detect languages from cwd
2. Get primary language profile
3. Pass profile to syntax guard → dispatches to correct linter
4. Parse linter output into SyntaxDiagnostic[]
5. Pass profile to slop detector → uses language-specific patterns
6. Merge all findings → diff filter → pass/fail

### Error Handling

All linters gracefully skip when not installed (isToolAvailable check). Spawn failures return error diagnostic with tool name. Malformed output returns empty diagnostics.

### Edge Cases

- No marker files found → defaults to TypeScript profile
- Polyglot repos → uses first detected language as primary
- Tool not installed → graceful skip, no error
