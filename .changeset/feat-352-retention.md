---
"@mainahq/cli": minor
"@mainahq/core": minor
---

Local-first retention measurement: agent session starts (Claude Code, Cursor, Codex), the status line, terminal notifications and the weekly digest are noted in `~/.maina/retention.jsonl` on this machine. `maina stats --retention` shows day-7 and day-28 returns and the surface seen last before each return. Nothing leaves the machine unless you opt in to `telemetry.usage` and run `maina stats --retention --share`, which sends only window statuses and per-surface counts (no dates, hosts or paths).
