---
"@mainahq/cli": patch
"@mainahq/core": patch
"@mainahq/mcp": patch
"@mainahq/skills": patch
---

**Harden `maina sync pull` + broaden `--debug`**

Follow-up to #194, addresses #196.

- `DEBUG=1` and `NODE_DEBUG=1` are now honoured as aliases for `MAINA_DEBUG=1`. Users naturally reach for the generic env var first.
- `maina sync pull` now validates each prompt's `path` and `content` before writing to disk. Malformed records are skipped with a per-record reason instead of throwing out of the loop and leaving `@clack/prompts`' spinner monitor to print a generic `"Something went wrong"`. `mkdirSync` failures are caught and surfaced.
- Empty-team response now shows `log.info("No team prompts yet.")` instead of a misleading `log.success("Pulled 0 prompt(s)")`.
- Partial success (some records written, some skipped) surfaces a warning with the skipped count + reasons.
