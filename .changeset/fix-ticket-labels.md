---
"@mainahq/core": patch
"@mainahq/cli": patch
---

fix(core): `maina ticket` warns and skips missing labels instead of aborting (#170)

Previously, inferred labels that didn't exist on the target repo would abort `gh issue create` one at a time, forcing users into whack-a-mole. `createTicket` now pre-fetches the repo's labels via `gh label list`, drops any that don't exist, and files the issue with the remainder. Skipped labels are surfaced via `skippedLabels` on the result and the CLI prints a `log.warning`. Pass `--strict-labels` to restore the old abort-on-missing behavior.
