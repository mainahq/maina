---
"@mainahq/core": minor
"@mainahq/cli": minor
---

An agent can no longer override its own gate. The new irreversible action class `gate.self_override` is denied by default (`DENIED_ACTION_CLASSES`). The gate puts an action in it when an agent runs `maina allow` or a `maina policy` mutation, whether through the bin, `bunx`/`npx`/`pnpm dlx`/`bun x` (`@mainahq/cli` included) or a runtime running maina's entry file. Writing, moving or deleting a maina policy (`.maina/policy*` in the repo or `~/.maina/`) or a host hook config (`.claude/settings*.json`, `.cursor/hooks.json`, `.codex/hooks.json`, `.codex/config.toml`) counts too. No allow rule reaches the class. A repo policy cannot loosen it without `explicitly_allow` and the user's confirmation, and a policy that leaves the class out still denies it. `maina allow` now refuses when stdin is not a terminal, unless the user sets `MAINA_ALLOW_NONINTERACTIVE=1` for a script they trust.
