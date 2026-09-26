---
"@mainahq/core": minor
---

The gate now closes more ways an agent could turn off its own gate. Each of these is now classed `gate.self_override` and denied:

- `maina setup` or `maina init`, which write `.maina/` and host hook configs from inside the CLI where the gate cannot see the write.
- An MCP tool that writes, edits, moves, deletes or links a maina policy or host hook config, found by the path in its input. Read-only tools are not affected. If the gate cannot tell from the tool name whether a tool only reads, it treats the tool as a write.
- `chmod`/`chown` of a control file or directory. This includes modes that start with `-`, such as `chmod -r`.
- `git checkout`, `git restore`, `git rm` or `git mv` of a control path.
- A symlink placed over `.maina`, `.claude`, `.cursor` or `.codex`, or a symlink that points at a control path.

`script -c '<cmd>'` and the BSD form `script <file> <cmd…>` are now classified by the command they run, not as a plain `shell.exec`.

`gate.self_override` can no longer be loosened by any policy layer. The schema rejects it in `explicitly_allow`. The loader reports any attempt to loosen it. The evaluator ignores any policy that still says otherwise, whether the user confirmed it or not. The only way past it is the user running `maina allow` in a terminal.
