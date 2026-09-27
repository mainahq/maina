---
"@mainahq/cli": patch
---

On Windows, the standalone `maina` runtime's hooks now get their gate answer from the resident runtime. Before this, a compiled hook started the runtime with the wrong command, because on Windows bun escapes the `~` in a compiled module's URL (`file:///B:/%7EBUN/...`). The runtime never came up and every hook waited out its 3 s budget. The in-process rules-only fallback then had only 50 ms, too little to load the bash grammar, so every Bash command asked, `rm -rf ~/.claude` included. The status line's host command had the same bug.

The fallback also has a real budget now on every OS. The runtime gets at most two thirds of a hook's budget, and the fallback starts loading the bash grammar as soon as the runtime has to be started or is slow to answer. So a runtime that does not answer in time still gets a decision from the rules: `rm -rf ~/.claude` is denied, not asked.
