---
"@mainahq/cli": patch
---

Agent hooks now show the gate message for an ask or deny in Claude Code, Codex and Cursor: the verdict, the reason, a confidence band and the override (`maina allow <id> [--always]`), in place of the bare reason. The runtime carries the gate's confidence to the hooks, so a decision with an id is no longer banded `low` for lack of it. A Codex `apply_patch` that blocks names the id of the file decision that blocked it. A decision id that is not a plain token is never offered as a command.
