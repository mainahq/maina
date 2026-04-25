# Maina prompt templates

These markdown templates ship inside `@mainahq/core` as **reference
scaffolding** for the spec → plan → tasks workflow. The current
feature-scaffolding code (`packages/core/src/features/numbering.ts`,
etc.) writes feature directories from inlined `SPEC_TEMPLATE` /
`PLAN_TEMPLATE` / `TASKS_TEMPLATE` constants; rewiring those paths to
read from this directory is a follow-up, tracked under prompt-engine
unification.

Until that lands, this directory is:

1. The **shape of truth** — the canonical Maina template that other
   tooling (constitution checks, future scaffolders) can grep against.
2. A **drop-in for repos that want to extend it** — copy a file into
   `.maina/templates/` to customise; the planned scaffolder reads
   that location first.
3. The **document that defines the discipline** — spec/plan/tasks
   separation, NEEDS-CLARIFICATION markers, copy discipline.

**Today's override surface:** the prompt engine reads user overrides
from `.maina/prompts/<task>.md` (flat). Drop a `.maina/prompts/spec.md`
to override the *spec* prompt's rendered output.

| File | Drives | Purpose |
|---|---|---|
| `spec-template.md` | `maina spec` (planned wiring) | WHAT a feature must do |
| `plan-template.md` | `maina plan` (planned wiring) | HOW it gets built |
| `tasks-template.md` | `maina plan` task scaffolding (planned wiring) | WHEN each step lands |

The templates are Maina-original. They follow the
*spec → plan → tasks* progression because that's the discipline the
verifier expects, not because any one upstream invented it. Edit them
freely for your repo; the verifier will read whatever shape lands in
`.maina/templates/`.

## Conventions in the templates

- **Three-document split**: WHAT in spec, HOW in plan, WHEN in tasks.
  Mixing them across files is an immediate slop signal.
- **`[NEEDS CLARIFICATION: question]`** markers for ambiguity. The
  verifier blocks `maina pr` when any marker is unresolved.
- **Affirmative framing** in every user-facing string ("passed N of M
  checks", never "0 findings") — see `.maina/constitution.md` rule C2.
- **Tasks must trace** to spec items and plan modules; an untraced
  task is a task whose justification is missing.
