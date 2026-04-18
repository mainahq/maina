---
"@mainahq/cli": minor
"@mainahq/core": minor
"@mainahq/mcp": minor
"@mainahq/skills": minor
---

**CLI errors & GitHub login**

- `maina login --github` — sign in with GitHub via device flow, then exchange for a maina token at `/auth/github/exchange`. Fixes the duplicate-account bug where the device flow created UUID+email members while the web flow keyed by `github_id` (#193).
- Top-level `uncaughtException` / `unhandledRejection` handler prints `err.code` + `err.message` instead of the generic `"Something went wrong"`. Pass `--debug` (or set `MAINA_DEBUG=1`) for the full stack trace (#192).
- Anonymous CLI crash reporting — fire-and-forget POST to `/v1/cli/errors` with a scrubbed payload (paths → basenames, secrets/emails/IPs redacted). Opt out via `MAINA_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `~/.maina/telemetry.json` `{ "optOut": true }` (#192).
- `maina sync pull` no longer crashes when the team has no prompts — prints `"No team prompts yet."` instead.
- `maina team` falls back to the server's `plan_display` label, then to `plan`, then to `"Free"`, so a missing or legacy response never renders `Plan: undefined`.
