---
"@mainahq/core": minor
---

The gate classifies a plain read inside the workspace (or a temp dir) as the new `fs.read` action class, allowed by default like `fs.write`. Host adapters report every file read (Claude Code's `Read`, `Grep` and `Glob`) as a `file.read.outside` event; a workspace read used to reach the decide stage with no class and ask. Credential reads (`secrets.read`) and reads outside the workspace (`fs.read.outside`) are unchanged.
