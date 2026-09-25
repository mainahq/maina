---
"@mainahq/cli": minor
---

`maina doctor` v2 (FR-INS-6): doctor now launches every configured maina MCP entry exactly as configured, under the host's minimal GUI environment (the `PATH` a Dock-launched host gets, plus `HOME`), and checks the entry, that the command resolves, the MCP `initialize` handshake, and which maina version answered. Once per repo it checks the root the server resolves, `.maina/policy.json` validity, and the local model (reported as not installed until the model backend ships). A maina entry left in a Claude Code `settings.json` is reported as broken. The machine-readable `hostHealth` report in `--json` gives every failed check a fix command; `--fix` runs the `maina mcp add` ones. Doctor exits 1 when any check fails. The minimal host environment moved to `hosts/host-env.ts`, shared with the real-config e2e matrix.
