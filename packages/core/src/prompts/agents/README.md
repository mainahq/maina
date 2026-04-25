# Maina agent prompts

System prompts for the verification agents Maina is wiring through
the prompt engine. Today the engine reads its defaults from
`packages/core/src/prompts/defaults/<task>.md`; this directory ships
the next generation of agent-specific prompts, with the loader
unification tracked as a follow-up.

| File | Status | Used by | Output |
|---|---|---|---|
| `review.md` | shipped (will replace `defaults/review.md`) | `maina review`, receipt two-stage review | "is this safe to merge" 3-sentence verdict |
| `debug.md` | shipped (new path, no `defaults/` equivalent yet) | receipt failed-check explanation | why a specific check went red |
| `router.md` | shipped (new path) | task classification before `tryAIGenerate` | one of `review` / `debug` / `meta` |

`spec` and `explain` agents are planned (Wave 5 verification-agent
catalog) but not yet shipped in this directory; the router routes
those to `meta` until their prompt files land.

The prompts are Maina-original. They follow the
**verification-first** framing the receipt depends on:

- The agent's job is to **explain why a change is or isn't safe to
  merge**, not to generate code.
- Output is grounded in the receipt + diff in front of it. If the
  evidence isn't enough, the prompt asks the model to say so rather
  than invent context.
- Copy discipline (rule C2) — affirmative framing, never "0 findings".

## Overriding per repo

The prompt engine loads user overrides from `.maina/prompts/<task>.md`
(flat — no nested `agents/` directory). Drop `.maina/prompts/review.md`
next to the constitution and the engine picks it up; same pattern for
`debug.md`. Until the loader unification lands, the engine pulls
shipped defaults from `packages/core/src/prompts/defaults/`; once
unification ships the agent prompts in this directory will become the
shipped defaults for their respective task ids.
