## Maina Workflow

Every feature follows this sequence:

```
brainstorm → ticket → plan → design → spec → implement → verify → review → fix → commit → review → pr
```

- `maina brainstorm` — interactive exploration; produces a GitHub issue.
- `maina plan <name>` — scaffolds `.maina/features/NNN-<name>/` with `spec.md`, `plan.md`, `tasks.md`.
- `maina spec` — generates runnable test stubs for every acceptance criterion.
- `maina verify` — runs the Maina verification pipeline (syntax guard, parallel tools, diff-only filter, AI review).
- `maina commit` — gates `git commit` on verification. Never use `--skip`.
- `maina review` — two-stage code review (spec compliance then code quality).
- `maina pr` — opens the pull request from the feature branch.

Do not skip steps. Do not use `--skip` on `maina commit`. Fix root causes instead of bypassing.
