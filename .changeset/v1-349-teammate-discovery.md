---
"@mainahq/core": minor
"@mainahq/cli": minor
---

Teammate discovery from PRs and repo policy (#349, FR-RET-4).

- The PR receipt comment's one-line "Verified by Maina" footer shows by default. A repo turns it off with `"discovery": { "receipt_line": false }` in `.maina/policy.json`; `maina receipt publish` reads it, and `--no-discovery-line` still works. Neither can turn the other's "off" back on. `discoveryLineEnabled({ flag, policy })` is the pure rule, and the policy schema gains the `discovery` section.
- When `.maina/policy.json` is committed, `maina setup` adds a "Maina for teammates" section to the managed region of each agent instruction file. It is a one-line shell check the agent runs: it prints the install command only when `maina` is not installed, and only once per developer (a marker at `~/.maina/install-hint-shown`).
