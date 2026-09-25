---
description: "Check spec, plan and tasks consistency with maina analyze"
---

# Maina analyze

Check the current feature's `spec.md`, `plan.md` and `tasks.md` for
cross-artifact consistency with Maina.

## User Input

```text
$ARGUMENTS
```

## Steps

1. Run `maina analyze --json` from the project root. Maina finds the feature
   the way Spec Kit does: `SPECIFY_FEATURE_DIRECTORY`, then
   `.specify/feature.json`, then the branch (`specs/<branch>`). If the user
   named a feature directory, run `maina analyze --feature-dir <dir> --json`
   instead.
2. Read the JSON report. `passed` is false when there is at least one error.
3. Summarise the findings for the user, errors first, and name the file (and
   line, when given) of each. Do not edit the artifacts unless the user asks.
4. If `maina` is not installed, say so and stop; do not guess the result.
