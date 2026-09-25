---
"@mainahq/core": minor
---

New parser layer for the code graph: `parseFile(path, content, lang?)` parses TypeScript, TSX, JavaScript (with JSX), Python, Go, Rust and Java in-process with tree-sitter compiled to WebAssembly (`@vscode/tree-sitter-wasm`, no native build or external runtime; see ADR 0046). It returns the file's symbols (functions, classes, methods, types, with export visibility), imports and re-exports, calls (plain, member, constructor, JSX and macro), type and inheritance references, and tests (describe/it blocks, pytest, Go `Test*`, Rust `#[test]`, JUnit). A syntax error never throws: the result still covers everything the parser recovered and lists each error with its location.
