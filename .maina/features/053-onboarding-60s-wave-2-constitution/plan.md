# Implementation Plan — Feature 053

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Four-stage deterministic pipeline that sits inside `packages/core/src/setup/`, fed into the existing `resolveSetupAI()` entry point:

```
adopt(repo)  → Rule[]                          (deterministic, reads rule files)
scan(repo)   → Rule[]                          (deterministic, configs + AST + git)
confirm(rules) → { accepted, rejected }        (TTY y/n/e; non-TTY auto-accept ≥ 0.6)
tailor(accepted, stack, dirs, languages)
            → constitution.md                  (single LLM call, standard tier)
```

Pattern: pure-function, injected-generator style (same convention as the rest of `setup/`). Each module exports one entry function plus its types. `resolveSetupAI()` composes `adopt → scan → confirm → tailor`; `buildGenericConstitution()` gains two template sections for the offline fallback path.

Integration points:

- `packages/core/src/setup/resolve-ai.ts` — tiers already exist (host / cloud / byok / degraded); we augment the prompt with the accepted rule set and patch the generic fallback.
- `packages/core/src/setup/context.ts` — adds `detectExistingRuleFiles()` helper for `summarizeRepo()` to flag adopted files.
- `packages/core/src/setup/prompts/universal.md` — adds an "Accepted rules" block and a stronger directive not to invent rules.

## Key technical decisions

1. **`Rule[]` is the canonical currency.** Every source (adopt, scan) emits the same shape; every sink (confirm, tailor) consumes it. Trivial to plug in a new source later.
2. **Confidence is numeric (`0..1`)**, not an enum — enables the 0.6 auto-accept threshold and future-proofs weighted merging.
3. **Workflow + File Layout live in template files, not the LLM prompt body.** These are stable DNA; the LLM must not paraphrase them. Substitution is literal `{variable}` replacement performed in our code, never by the model.
4. **Validator is literal string check.** `/^##\s+Maina Workflow\b/m` and `/^##\s+File Layout\b/m`. Cheap, strict, retries once, falls through to the generic builder on persistent failure.
5. **AST sampler is regex-based in this PR.** `web-tree-sitter` is not a runtime dep of `@mainahq/core` today; regex sampling on ≤ 100 files per language is sufficient for the coarse signals we need (async usage, test file naming, error-handling style). Module is named `scan/tree-sitter.ts` for forward compatibility; a future PR can swap in a real parser without breaking callers.
6. **`@clack/prompts` lazy-imported.** Core doesn't declare `@clack/prompts` as a dep (CLI does). Dynamic import in `confirm.ts` TTY branch; non-TTY path is safe without it.
7. **`.maina/rejected.yml` is append-only, hand-rolled YAML emitter** — avoids pulling a YAML parser into core; YAML output is well-formed enough for diff/review.

## Files

| File | Purpose | New/Modified |
|------|---------|--------------|
| `packages/core/src/setup/adopt.ts` | Read existing rule files → `Rule[]` | **New** |
| `packages/core/src/setup/scan/index.ts` | Orchestrator for scanners | **New** |
| `packages/core/src/setup/scan/lint-config.ts` | Parse lint/config files → `Rule[]` | **New** |
| `packages/core/src/setup/scan/tree-sitter.ts` | Regex-based pattern sampler → `Rule[]` | **New** |
| `packages/core/src/setup/scan/git-log.ts` | git log + workflow analysis → `Rule[]` | **New** |
| `packages/core/src/setup/confirm.ts` | TTY y/n/e + non-TTY auto-accept | **New** |
| `packages/core/src/setup/tailor.ts` | LLM call + validator + fallback | **New** |
| `packages/core/src/setup/templates/workflow-section.md` | Constant workflow section | **New** |
| `packages/core/src/setup/templates/file-layout-section.md` | Templated file-layout section | **New** |
| `packages/core/src/setup/resolve-ai.ts` | Wire rules + patch generic builder | Modified |
| `packages/core/src/setup/context.ts` | `detectExistingRuleFiles()` helper | Modified |
| `packages/core/src/setup/prompts/universal.md` | Instruction update | Modified |
| `packages/core/src/setup/index.ts` | Re-exports | Modified |
| `packages/core/src/index.ts` | Re-exports | Modified |

Tests (all `packages/core/src/setup/__tests__/`):

| File | Covers | New/Modified |
|------|--------|--------------|
| `adopt.golden.test.ts` | ≥ 80 % carryover + provenance comments | **New** |
| `scan-lint-config.test.ts` | Known configs produce expected rules | **New** |
| `scan-git-log.test.ts` | Conventional-commits detection | **New** |
| `confirm.test.ts` | TTY vs non-TTY paths | **New** |
| `tailor.validate-schema.test.ts` | Validator rejects, retries, falls through | **New** |
| `resolve-ai.generic-template.test.ts` | Offline template contains both sections | **New** |

## Tasks

TDD: every implementation task has a preceding test task.

- [ ] T1 — Write `adopt.golden.test.ts` against a fixture dir with 20+ rules in AGENTS.md. Expect fail.
- [ ] T2 — Implement `adopt.ts`. Green.
- [ ] T3 — Write `scan-lint-config.test.ts`. Expect fail.
- [ ] T4 — Implement `scan/lint-config.ts`. Green.
- [ ] T5 — Write `scan-git-log.test.ts`. Expect fail.
- [ ] T6 — Implement `scan/git-log.ts`. Green.
- [ ] T7 — Implement `scan/tree-sitter.ts` (minimal regex sampler). Covered indirectly via orchestrator smoke.
- [ ] T8 — Implement `scan/index.ts` orchestrator.
- [ ] T9 — Write `confirm.test.ts` (non-TTY + rejected.yml write). Expect fail.
- [ ] T10 — Implement `confirm.ts`. Green.
- [ ] T11 — Write `tailor.validate-schema.test.ts`. Expect fail.
- [ ] T12 — Implement `tailor.ts` + `templates/*.md`. Green.
- [ ] T13 — Write `resolve-ai.generic-template.test.ts`. Expect fail.
- [ ] T14 — Patch `buildGenericConstitution()` to include both sections. Green.
- [ ] T15 — Wire rules into `resolveSetupAI()` prompt; update `prompts/universal.md`.
- [ ] T16 — Add `detectExistingRuleFiles()` helper to `context.ts`.
- [ ] T17 — Re-export from `setup/index.ts` + `core/src/index.ts`.
- [ ] T18 — Full typecheck + test run.
- [ ] T19 — `maina verify` on the diff; fix findings.
- [ ] T20 — MCP `reviewCode` + `checkSlop` on the diff.
- [ ] T21 — `maina commit` + `git push` + `maina pr`.

## Failure modes

| Failure | Detection | Handling |
|---------|-----------|----------|
| LLM returns constitution missing one of the two sections | String-match validator | Retry once with sterner instruction, then fall to `buildGenericConstitution()` |
| LLM invents a rule not in the accepted set | Not detected in this PR (would need semantic diffing) | Accepted as risk; mitigated by prompt instruction + provenance comments on adopted rules |
| `@clack/prompts` import fails in core | `import()` throws `MODULE_NOT_FOUND` | Fall back to non-TTY path silently |
| `.maina/` does not exist when writing `rejected.yml` | `writeFileSync` throws `ENOENT` | `mkdirSync({recursive:true})` first |
| `git log` fails (not a repo, no commits) | `Bun.spawn` returns non-zero | Emit no git rules, log warning to stderr when `DEBUG=maina:setup` set |
| Large repo: > 10 k files | Covered by existing `isLarge` flag | Pattern sampler caps at 100 files/language anyway |
| Adopted rule exceeds 300 chars | Validator in `adopt.ts` | Truncate with `…` suffix and lower confidence to 0.8 |

## Testing strategy

- **Unit tests** for each module with fixture directories built in `beforeEach` + torn down in `afterEach`.
- **No mocks of tree-sitter / AI** — we use injected `generate` functions for tailor tests, and `Bun.spawn` is the only real subprocess call (git log), which is exercised against a tiny fixture repo created per test.
- **Golden tests** for `adopt.ts` — fixture AGENTS.md + expected rule count + expected provenance format.
- **Integration** — one test in `resolve-ai.generic-template.test.ts` that checks the offline constitution string contains both headings without any LLM call.

## Wiki Context

### Related Modules

- **constitution** (7 entities) — `modules/constitution.md`

### Related Decisions

- 0023-lint-config-and-manifest-parsers-for-constitution [proposed] — directly applicable to the `scan/lint-config.ts` rule table.
- 0025-tree-sitter-pattern-sampler-for-constitution [accepted] — this PR ships a regex-based stand-in; tree-sitter upgrade deferred.
- 0021-glob-scoped-constitution-rules [proposed] — out of scope here.
- 0026-interview-gap-filler-for-constitution [accepted] — compatible; this PR doesn't change the interview flow.

### Similar features

- 039-lint-config-parsers, 037-git-ci-analyzer — referenced for parser shapes.
- 041-treesitter-pattern-sampler — we adopt its module name; implementation is regex-only in this PR.
