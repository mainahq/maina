---
name: plan-writing
description: Scaffold and validate feature plans using maina's spec-first planning workflow.
triggers:
  - "plan feature"
  - "create plan"
  - "scaffold feature"
  - "start new feature"
---

> This plugin bundles the maina CLI: run it as `../../launcher/launch.sh cli <command>`, a path relative to this skill's folder.

# Plan Writing

## When to use

When starting a new feature, refactor, or significant change. The planning workflow ensures you define WHAT and WHY before deciding HOW, and validates that your implementation plan actually covers every acceptance criterion.

## Steps

1. **Start with brainstorm** using `../../launcher/launch.sh cli brainstorm` to explore the idea, surface edge cases, and generate a structured GitHub issue. This is the recommended starting point before planning.
2. **Scaffold the feature** with `../../launcher/launch.sh cli plan <name>`. This creates a numbered feature directory under `.maina/features/` containing `spec.md` and `plan.md` templates.
3. **Fill in spec.md** with the WHAT and WHY:
   - **Problem Statement:** What problem does this solve and for whom?
   - **User Stories:** Concrete "As a [role], I want [action] so that [benefit]" statements.
   - **Acceptance Criteria:** Specific, testable conditions that define done.
   - **Scope:** What is explicitly in and out of scope.
   - Mark anything uncertain with `[NEEDS CLARIFICATION]` -- never guess.
4. **Fill in plan.md** with the HOW:
   - **Architecture:** Key technical decisions and component design.
   - **Key Decisions:** Trade-offs made and why.
   - **Tasks:** Ordered task list (T001, T002, ...) with test tasks before implementation tasks (TDD).
   - **Failure Modes:** What can go wrong and how the design handles it.
5. **Check consistency** with `../../launcher/launch.sh cli analyze` (or call the `spec_check` MCP tool on the feature directory). This verifies:
   - Every acceptance criterion in spec.md is covered by at least one task in plan.md.
   - No TODO, TBD, PLACEHOLDER, or FIXME markers remain (except `[NEEDS CLARIFICATION]`).
   - Function and type names are used consistently across tasks.
   - Test tasks come before their corresponding implementation tasks.
6. **Generate test stubs** with `../../launcher/launch.sh cli spec`. This reads the plan and creates failing test files for each task, ready for the TDD red-green-refactor cycle.
7. **Remember:** Spec = WHAT/WHY, Plan = HOW. Never mix concerns between the two files.

## Example

```bash
# Scaffold a new feature
../../launcher/launch.sh cli plan user-auth

# Creates:
# .maina/features/003-user-auth/
#   spec.md   (template with sections to fill)
#   plan.md   (template with sections to fill)

# After filling in both files:
../../launcher/launch.sh cli analyze
# [spec-coverage]     PASS  All 4 criteria covered by tasks
# [no-placeholders]   PASS  No placeholder markers found
# [name-consistency]  PASS  All identifiers used consistently
# [test-first]        PASS  Test tasks precede implementation tasks
#
# Plan is ready for implementation.

# Generate test stubs
../../launcher/launch.sh cli spec
# Created 5 test files from plan tasks.
```

## Notes

- Feature directories are auto-numbered (F001, F002, ...) to maintain order.
- The `../../launcher/launch.sh cli analyze` check is also run automatically during `../../launcher/launch.sh cli verify`.
- Plans should have granular tasks: each task should be completable in a single focused session.
- All commands are available as both CLI (`../../launcher/launch.sh cli <command>`) and MCP tools when running inside an AI coding tool.
