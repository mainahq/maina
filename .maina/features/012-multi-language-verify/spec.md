# Feature 012: Multi-Language Verify Support (Python, Go, Rust)

## Problem

Maina's verify pipeline is hardcoded for TypeScript/JavaScript. Nine components have language-specific patterns (syntax-guard→Biome only, slop→JS regex, treesitter→TS imports, semantic→.ts/.js files, retrieval→TS globs). This blocks adoption for any non-TypeScript project.

## Why Now

Product spec says "any repo." Verify pipeline just shipped 9 tools + AI review. Now it needs to work beyond TypeScript.

## Success Criteria

- **SC-1:** `detectLanguages(cwd)` returns detected languages from project files (pyproject.toml → Python, go.mod → Go, Cargo.toml → Rust, tsconfig.json → TypeScript)
- **SC-2:** Syntax guard routes to correct linter per language (Biome for TS, ruff for Python, go vet for Go, clippy for Rust)
- **SC-3:** Slop detection uses language-specific patterns (print() for Python, fmt.Println for Go, println! for Rust)
- **SC-4:** Tree-sitter parses entities for Python (def, class, import), Go (func, type, import), Rust (fn, struct, use)
- **SC-5:** Semantic context collects files by detected language (.py, .go, .rs)
- **SC-6:** Retrieval search uses language-appropriate file globs
- **SC-7:** Tool registry includes ruff, golangci-lint, clippy, cargo-audit
- **SC-8:** Pipeline filters tools by language compatibility
- **SC-9:** Existing TypeScript behavior unchanged (backward compatible)

## Out of Scope

- Java, C#, Ruby (future)
- Language-specific test runners (pytest, go test, cargo test)
- LSP integration
- Per-file language detection within polyglot repos (use dominant language)

---

## Design

### Core Abstraction: Language Profile

New module: `packages/core/src/language/profile.ts`

```typescript
interface LanguageProfile {
  id: "typescript" | "python" | "go" | "rust";
  extensions: string[];           // [".ts", ".tsx", ".js", ".jsx"]
  syntaxTool: string;             // "biome" | "ruff" | "go-vet" | "clippy"
  syntaxArgs: (files: string[]) => string[];  // build CLI args
  parseSyntaxOutput: (output: string) => SyntaxDiagnostic[];
  slopPatterns: SlopRule[];       // language-specific slop patterns
  commentStyles: string[];        // ["//", "/*"] or ["#"]
  importPattern: RegExp;          // language-specific import regex
  testFilePattern: RegExp;        // test file detection
  fileGlobs: string[];            // for retrieval search
  treeSitterLang: string;         // grammar name
}
```

### Language Detection

New module: `packages/core/src/language/detect.ts`

| Marker | Language |
|--------|----------|
| `tsconfig.json`, `package.json` | TypeScript |
| `pyproject.toml`, `setup.py`, `requirements.txt` | Python |
| `go.mod`, `go.sum` | Go |
| `Cargo.toml`, `Cargo.lock` | Rust |

Returns array of detected languages. Primary = first detected.

### Syntax Guard Refactor

`syntax-guard.ts` becomes a dispatcher — receives language profile, builds command, parses output per-tool. New parsers: `linters/ruff.ts`, `linters/go-vet.ts`, `linters/clippy.ts`.

### Slop Detection Refactor

Each LanguageProfile provides `slopPatterns`:
- **Python:** `print()`, bare `except:`, `# type: ignore`, `pass` in non-abstract
- **Go:** `fmt.Println`, `panic()`, empty `if err != nil {}`, `// nolint`
- **Rust:** `println!`, `unwrap()`, `todo!()`, `#[allow(dead_code)]`
- **TypeScript:** existing patterns unchanged

### Tree-Sitter Extension

Add grammars + entity extractors for Python/Go/Rust. If WASM grammar unavailable, fall back to regex-based extraction.

### Tool Registry Extension

Add to `detect.ts`: ruff, golangci-lint, clippy, cargo-audit

### Pipeline Changes

`PipelineOptions` gains `languages?: string[]`. Pipeline auto-detects languages, filters tools by compatibility, routes syntax guard per language.

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/language/profile.ts` | NEW — LanguageProfile interface + 4 profiles |
| `packages/core/src/language/detect.ts` | NEW — detectLanguages from project markers |
| `packages/core/src/verify/syntax-guard.ts` | Refactor to dispatch per language |
| `packages/core/src/verify/linters/ruff.ts` | NEW — ruff JSON parser |
| `packages/core/src/verify/linters/go-vet.ts` | NEW — go vet text parser |
| `packages/core/src/verify/linters/clippy.ts` | NEW — clippy JSON parser |
| `packages/core/src/verify/slop.ts` | Load patterns from LanguageProfile |
| `packages/core/src/verify/pipeline.ts` | Language detection + tool filtering |
| `packages/core/src/verify/detect.ts` | Add ruff, golangci-lint, clippy, cargo-audit |
| `packages/core/src/context/treesitter.ts` | Python/Go/Rust entity extraction |
| `packages/core/src/context/semantic.ts` | Dynamic file extension collection |
| `packages/core/src/context/relevance.ts` | Language-aware import resolution |
| `packages/core/src/context/retrieval.ts` | Dynamic file globs |
| `packages/core/src/init/index.ts` | Extend language detection + templates |
