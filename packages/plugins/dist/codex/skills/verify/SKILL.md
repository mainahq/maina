---
name: verify
description: Run maina's verification pipeline on changed code, fix the findings on changed lines, then commit and produce a verification receipt. Use after editing code and before committing, opening a pull request or saying a task is done, or when a session stop is blocked because verify failed.
license: Apache-2.0
compatibility: Requires maina (the plugin or the CLI) in a git repository.
metadata:
  author: mainahq
---

> This plugin bundles the maina CLI: run it as `../../launcher/launch.sh cli <command>`, a path relative to this skill's folder.

# Verify

## When to use

- You changed code and are about to commit, open a pull request or report the task as done.
- The host blocked the end of a session because maina's stop check found verify failing on the files you edited.
- Someone asks for proof that a change was checked: a receipt.

## Steps

1. **Run the pipeline.** Run `../../launcher/launch.sh cli verify` (the working tree against the base branch), or call the `verify` MCP tool with the `files` you changed (without `files` it checks the staged files). It runs the syntax guard first, then the deterministic tools in parallel (linters, type checker, secret and security scanners, slop detection), and keeps only findings on the lines you changed.
2. **Read every tool's status.** Each tool reports `passed`, `failed` or `skipped` with the reason it was skipped. A skipped tool is not a pass: say which ones did not run.
3. **Fix the findings.** Fix the cause, not the message. Never silence a finding with an ignore comment, never weaken a check, and never pass a skip flag to get past it. If a finding is wrong, say why and let the user decide.
4. **Re-run until clean.** Repeat steps 1 to 3 until verify passes.
5. **Check what the change can break.** Run `../../launcher/launch.sh cli verify --tests` to also run the tests the code graph links to your change (see the graph skill).
6. **Commit through maina.** Stage the files by name and run `../../launcher/launch.sh cli commit -m "<conventional message>"`. It verifies the staged change again and adds a `Verified-by` trailer.
7. **Produce a receipt when asked.** `../../launcher/launch.sh cli receipt` runs the pipeline and writes a receipt (JSON and HTML) under `.maina/receipts/`. Check receipts with the `receipt` MCP tool or `../../launcher/launch.sh cli verify-receipt <path>`.

## Example

```bash
../../launcher/launch.sh cli verify
# prints each tool's status, then the findings on changed lines, e.g.
#   src/auth/login.ts:42  typecheck  Type 'string | undefined' is not assignable to type 'string'
# and names any tool it skipped, with the reason

# fix src/auth/login.ts, then run it again until it passes
../../launcher/launch.sh cli verify
git add src/auth/login.ts src/auth/login.test.ts
../../launcher/launch.sh cli commit -m "fix(auth): reject logins without a password"
```

## Notes

- Only changed lines are reported, so existing debt in untouched code never blocks you.
- `../../launcher/launch.sh cli verify --staged` checks only the staged changes; `--base <ref>` picks the branch to diff against; `--deep` forces the AI semantic review on top of the deterministic tools.
- When a session ends, maina verifies the files the session edited. A failure blocks the stop with the reason; fix it and finish again.
- For a review of the diff after verify passes, use the triage skill.
