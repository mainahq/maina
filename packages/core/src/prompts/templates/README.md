# Maina prompt templates

These markdown templates ship inside `@mainahq/core` and are the **single
source of truth** for the spec → plan → tasks workflow. `index.ts` imports
them as text (bunup inlines them into the package) and everything else
reads them from there:

- `features/numbering.ts` scaffolds every feature directory from them
  (`scaffoldFeature`, `scaffoldFeatureWithContext`); no template text is
  restated in code.
- `features/quality.ts` holds a spec written from the template to the
  template's `*(mandatory)*` sections.

| File | Drives | Purpose |
|---|---|---|
| `spec-template.md` | `maina plan` scaffold → `spec.md` | WHAT a feature must do |
| `plan-template.md` | `maina plan` scaffold → `plan.md` | HOW it gets built, behind the constitution gate |
| `tasks-template.md` | `maina plan` scaffold → `tasks.md` | WHEN each step lands |

The templates are Maina-original. They follow the
*spec → plan → tasks* progression because that's the discipline the
verifier expects, not because any one upstream invented it.

**Override surface:** the prompt engine reads user overrides from
`.maina/prompts/<task>.md` (flat). Drop a `.maina/prompts/spec.md` to
override the *spec* prompt's rendered output.

## Conventions in the templates

- **Three-document split**: WHAT in spec, HOW in plan, WHEN in tasks.
  Mixing them across files is an immediate slop signal.
- **`[NEEDS CLARIFICATION: question]`** markers for ambiguity, at most 3
  per spec. `clarify` asks about them one question at a time (at most 5),
  as multiple choice with the recommendation first, and writes each answer
  back into the spec.
- **Constitution gate**: every unchecked MUST rule in the plan's gate
  blocks unless the plan's justification table records why
  (`constitutionGate`).
- **Checklist ticks** come only from a `decide` id or a human action, and
  record their source; the agent writing the code cannot tick its own
  checklist (`tickChecklistItem`, `unattestedTicks`).
- **Affirmative framing** in every user-facing string ("passed N of M
  checks", never "0 findings") — see `.maina/constitution.md` rule C2.
- **Tasks must trace** to spec items and plan modules; an untraced
  task is a task whose justification is missing. `converge` reports each
  gap as `missing`, `partial`, `contradicts` or `unrequested`.
