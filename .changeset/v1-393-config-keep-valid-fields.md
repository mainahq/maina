---
"@mainahq/core": patch
"@mainahq/cli": patch
---

A `maina.config.ts` (or `.js`) with one invalid or unknown key no longer resets the whole config to the defaults. The loader now drops only the fields that fail validation, keeps every valid one (your provider and models stay in effect), and reports each dropped field with its path. `loadConfigModule` returns `{ config, errors }`, and the CLI prints a warning on stderr before each command, plus a Config section in `maina doctor` (`configErrors` in `--json`).
