---
"@mainahq/core": patch
---

The standalone `maina` runtime that host plugins run now embeds the tree-sitter runtime and the grammars it uses (bash for the gate, plus the code-graph languages). Before this, the compiled executable could not load tree-sitter at all, so the gate treated every shell command as opaque and asked: `echo hello` asked, and `rm -rf ~/.claude`, which the gate denies by default, only asked. The code graph could not parse files in the standalone runtime either. Commands are now classified the same way as when maina runs from source.

Core adds `setTreeSitterSource`, which lets a process supply the tree-sitter runtime and grammar bytes (as the compiled executable does) instead of resolving them from the installed `@vscode/tree-sitter-wasm` package.
