---
name: spec
description: Plan a feature spec-first with maina, keeping spec.md (what and why), plan.md (how) and tasks.md consistent, then implement it test-first from the plan. Use when starting a new feature or a change big enough to need a plan, when editing a feature's spec, plan or tasks, or before implementing tasks from a maina feature directory.
license: Apache-2.0
compatibility: Requires maina (the plugin or the CLI) in a git repository.
metadata:
  author: mainahq
---

> This plugin bundles the maina CLI: run it as `../../launcher/launch.sh cli <command>`, a path relative to this skill's folder.

# Spec

## When to use

- You are starting a feature, or a change that touches several modules or needs decisions written down.
- You edited `spec.md`, `plan.md` or `tasks.md` in a feature directory under `.maina/features/`.
- You are about to implement tasks from a feature directory and want to know the plan still holds.

## Steps

1. **Create the feature.** Run `../../launcher/launch.sh cli plan <feature-name>`. It creates a numbered directory (for example `.maina/features/012-login-rate-limit/`) with `spec.md`, `plan.md` and `tasks.md`, on a feature branch.
2. **Write the spec: what and why.** In `spec.md`, state the problem, who it is for, the acceptance criteria and what is out of scope. No implementation detail belongs here.
3. **Write the plan: how.** In `plan.md`, name the files, interfaces, data and trade-offs. No restated requirements belong here.
4. **Break it into tasks.** In `tasks.md`, write small tasks that each trace to an acceptance criterion.
5. **Mark what you do not know.** Where the request is ambiguous, write `[NEEDS CLARIFICATION]` with the question instead of guessing, and ask the user before implementing that part.
6. **Check consistency.** Call the `spec_check` MCP tool with the feature directory in `paths`. It reports missing files, criteria without tasks, tasks without criteria, how leaking into the spec (or what into the plan) and contradictions. Fix every error before implementing.
7. **Implement test-first.** Run `../../launcher/launch.sh cli spec` to generate failing test stubs from the plan, watch them fail for the right reason, then write the minimum code to pass. Verify and commit each task (see the verify skill).

## Example

```bash
../../launcher/launch.sh cli plan login-rate-limit
# Created .maina/features/012-login-rate-limit/ on branch feature/012-login-rate-limit
```

Then call `spec_check` with `paths: [".maina/features/012-login-rate-limit"]`:

```text
spec_check: FAILED: 1 error, 1 warning across 1 feature
.maina/features/012-login-rate-limit:
- [error] spec-coverage: acceptance criterion "lock after 5 failures" has no task
- [warning] separation-violation: spec.md names an implementation detail ("Redis counter")
```

Add the missing task, move the Redis note to `plan.md`, check again, then `../../launcher/launch.sh cli spec` to generate the stubs.

## Notes

- Keep the spec stable once implementation starts; change the plan when the approach changes, and re-run `spec_check` after either.
- The repo's constitution (`.maina/constitution.md`) holds rules every plan must follow; read it before planning.
- Review the finished diff against the spec with the triage skill.
