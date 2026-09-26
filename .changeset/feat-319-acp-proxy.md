---
"@mainahq/cli": minor
---

New `maina acp --agent <name>` runs maina as an ACP agent for editors such as Zed and JetBrains IDEs. maina starts the real agent (Claude Code by default, or codex, cursor, gemini or opencode) and passes every message between the editor and the agent through unchanged, except permission requests. The gate answers those first: it rejects what the policy denies and answers `allow_once` for what it allows, so only an `ask` reaches you in the editor, and never with an "always allow" option that would let later calls skip the gate.

- If the editor hangs up, maina stops the agent. If the agent exits, maina closes the editor's side.
- Each session writes a receipt to `.maina/runs/acp-<id>.json` (sessions, turns, tool calls, files touched, and every permission answer and who gave it) and a permission log next to it.
- `integrations/acp-registry/maina.json` is the listing for the ACP Registry.
