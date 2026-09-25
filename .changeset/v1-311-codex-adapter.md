---
"@mainahq/cli": minor
---

Codex support for the action gate. `emitCodexRules` turns the policy's static shell allow/deny rules into Codex `prefix_rule` entries (deny as `forbidden`, allow as `allow`), sorted and deduplicated so the same rules always give the same file; a rule a prefix cannot express exactly, such as a wildcard allow, is skipped with a comment rather than widened. `maina doctor` now warns when maina's Codex PreToolUse hook sees `apply_patch`, because Codex does not enforce that hook's deny for file edits yet (openai/codex#27833), or when the hook's matcher misses `apply_patch`, which leaves Codex file edits ungated.
