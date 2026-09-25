# 0046. In-process tree-sitter (WASM) parser for the code graph

Date: 2026-09-25

## Status

Accepted

## Context

Phase 5 of the v1 rebuild (mainahq/maina#365) builds a code graph: symbols, imports, calls, references and tests, linked across files. Task 5.1 (mainahq/maina#323, FR-GRAPH-1, FR-GRAPH-6) is the layer underneath it, `parseFile(path, content, lang)`. It must:

- parse real syntax trees for TypeScript, TSX, JavaScript (with JSX), Python, Go, Rust and Java;
- run in-process, with no external runtime to install (no Python, no JVM, no language server, no native build step);
- return partial results on a syntax error and never throw, as the functional-core rules require.

CLAUDE.md lists web-tree-sitter as the AST stack, but no 1.x code used it. The 1.x "tree-sitter" sampler (ADR 0039) is regex-based, and the wiki's SCIP ingest (ADR 0029) needs an external indexer per language.

Options considered:

1. **Regex or hand-written scanners.** Rejected. They cannot tell a call from a declaration, nesting from text, or code from strings and comments. That accuracy is the whole point of the graph.
2. **Each language's own compiler API** (the TypeScript compiler, Python `ast`, `go/parser`, `syn`, JavaParser). Rejected. Four of the five need their own runtime, which breaks the no-external-runtime requirement.
3. **Native tree-sitter bindings** (`tree-sitter` plus one `tree-sitter-<lang>` npm package per language). Rejected. They are native addons built per platform, their Bun support is uneven, and a failed prebuild falls back to node-gyp on the user's machine.
4. **web-tree-sitter plus grammar `.wasm` files we build and vendor.** Viable, but we would own an emscripten toolchain and seven grammar builds, and have to keep the grammar ABI in step with the runtime.
5. **`@vscode/tree-sitter-wasm`.** Chosen. It is Microsoft's MIT-licensed build of web-tree-sitter (0.25), shipped with prebuilt grammars, including all seven we need, that match its runtime ABI. It has no dependencies and no install scripts, and it works under Bun unchanged. VS Code ships it, so its builds are exercised at scale.

For extraction, we considered tree-sitter query files (`.scm`) per language against hand-written walkers. Queries are declarative, but the facts we need depend on context: the enclosing scope for each call, visibility rules (`pub`, capitalisation, `export` lists, `private`), test blocks nested inside suites, and methods tied to their receiver or impl type. Queries capture flat node sets, so all of that would still be code written on top of them. We chose one small walker per language instead.

## Decision

- `@mainahq/core` depends on `@vscode/tree-sitter-wasm`. The runtime is initialised once per process, and each grammar is loaded once, on first use, from the package's `wasm/` directory. A grammar ships with the package like any other module code, so loading it is not user-facing I/O and does not go through `CorePorts`.
- The package is a UMD bundle, and Node's ESM loader cannot see its named exports. Core therefore loads the package, and resolves the grammar paths, through `createRequire(import.meta.url)`. That works the same under Bun, under Node and in the bundled `dist` build (#294). Loading happens lazily, so a broken install makes `parseFile` return `grammar_load_failed`; it does not break every import of core.
- `packages/core/src/graph/parse/` holds the layer:
  - `index.ts` holds `parseFile`;
  - `languages.ts` is the single table of extensions, grammar files and test-file conventions;
  - `extract.ts` dispatches each language to its walker in `lang/{js,python,go,rust,java}.ts`;
  - `nodes.ts` holds the shared node helpers;
  - `types.ts` holds the data shapes.
- Output is plain, readonly and JSON-serialisable. Names are left unresolved (a call records `path.join`, not the symbol it points at), because resolving names is the graph builder's job (task 5.2).
- Errors:
  - A syntax error is data. `errors` lists every ERROR and MISSING node, and extraction still covers everything the parser recovered.
  - A tree nested too deeply for the recursive walkers (tens of thousands of levels) keeps what was collected and adds a `limit` issue.
  - Only an unknown language, a grammar that fails to load, or an extractor bug returns an error `Result`.
- Spans use 1-based lines and 0-based UTF-16 columns, that is, JavaScript string indices, which is what web-tree-sitter reports for JS strings.

## Consequences

### Positive

- One dependency, no native code and no toolchain: `bun install` is enough on every platform.
- The same parser covers all five languages, so the graph builder handles every language the same way.
- A parse is fast enough to run on every changed file: about 5 ms for a 13k-character TypeScript file after warm-up.

### Negative

- The package adds about 21 MB unpacked to `@mainahq/core`, most of it grammars we do not use yet (C++, C#, Ruby, PHP and others). We accept this, rather than vendoring seven files, until install size becomes a problem.
- The grammar versions are whatever the package pins. A grammar upgrade can rename nodes, and the per-language fixture tests in `graph/parse/__tests__/` are the guard that catches it.
- Rust macro arguments are unparsed token trees, so calls inside `assert!(…)` or `println!(…)` are recovered from token patterns. This handles ordinary calls, but not every macro's own syntax.
- Go predeclared types are filtered by a fixed list, because the grammar does not distinguish them from user types.
