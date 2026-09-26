---
"@mainahq/core": minor
"@mainahq/cli": minor
---

New `maina run <task>` runs a coding agent on a task in its own worktree, inside maina's OS sandbox. The gate checks what it does against the policy for the run's context. Each run has budgets and gets at most one revision. The policy schema gains a `run` section with `interactive` and `unattended` contexts, and each context has a `deny` list of action classes and `budgets` (`wall_clock_minutes`, `max_tool_calls`). Deny lists add up across layers, and a repo policy can only lower a budget.

- An unattended run (no terminal, or CI) denies every `ask`. It never merges, releases or publishes: `pr.merge` (new class, for `gh pr merge`), `git.push.protected`, `deploy` and `package.publish` are always denied.
- A run stops with a report when it goes over a budget. After a second failed review it stops with a "stopped" receipt and opens no PR. Receipts are written to `.maina/runs/<run id>.json`.
- In a plugin-only agent session, `maina status` says the sandbox is off and prints the `maina run` command that turns it on.
