# Feature 053 — Onboarding-60s Wave 2: Constitution Derivation

Issue: https://github.com/mainahq/maina/issues/216
Gaps closed: G2 (LLM invents rules), G3 (offline fallback is bland), G7 (no workflow/file-layout sections).

## Problem Statement

`maina setup` today either:

1. Calls the LLM on a raw repo summary and gets a hallucinated or generic constitution, **ignoring** the rule files the user already wrote (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`, `CONTRIBUTING.md`, `CONTEXT.md`), or
2. Falls through to `buildGenericConstitution()` which is a boilerplate template that does not reflect this project at all.

In both paths, the generated `constitution.md` lacks the `## Maina Workflow` and `## File Layout` sections that every downstream maina command implicitly relies on for orientation.

## Target User

- **Primary:** Engineer running `curl | bash` + `maina setup` on their existing repo, expecting the first pass to feel like "maina understands my project", not like a demo. Especially users who already maintain `AGENTS.md` or `CLAUDE.md` — their rules should be the source of truth, not ignored.
- **Secondary:** Offline or rate-limited user whose setup falls to degraded mode — they still deserve a constitution that looks like their project, with the workflow spelled out.

## User Stories

- As an engineer with a pre-existing `AGENTS.md`, I want my rules to flow through to `constitution.md` verbatim (with provenance comments) so `maina setup` respects the work I already did.
- As a user on a flaky network, I want the offline-degraded constitution to still include the maina workflow and file layout, so `maina commit` and `maina plan` have something to anchor on.
- As a user who disagrees with an inferred rule, I want to press `n` and have it recorded in `.maina/rejected.yml`, not silently re-suggested on every re-run.
- As a CI runner piping maina through a script, I want non-interactive rule confirmation (auto-accept ≥ 0.6 confidence) so the pipeline never hangs.

## Success Criteria

Every criterion has a test.

- [ ] On a fixture repo whose `AGENTS.md` contains ≥ 20 unique rule sentences, `constitution.md` contains ≥ 80 % of those sentences, each annotated with an HTML comment of the shape `<!-- source: AGENTS.md:Lx-y, confidence: 1.0 -->`.
- [ ] Every constitution generated (host, cloud, byok, degraded) contains a `## Maina Workflow` section verbatim from `packages/core/src/setup/templates/workflow-section.md`.
- [ ] Every constitution generated (all four tiers) contains a `## File Layout` section derived from the `templates/file-layout-section.md` template.
- [ ] `buildGenericConstitution()` (offline fallback) includes both sections verbatim.
- [ ] Tailor's LLM-output validator rejects outputs missing either section, retries once, then falls through to the generic builder.
- [ ] TTY confirmation path emits a `y/n/e` prompt per rule via `@clack/prompts`; edit path opens `$EDITOR` with the rule text.
- [ ] Non-TTY confirmation path auto-accepts rules with confidence ≥ 0.6 and rejects the rest — no stdin reads.
- [ ] Rejected rules land in `.maina/rejected.yml` with their source + confidence.
- [ ] Re-running setup is idempotent — managed regions replace, user edits above/below preserved.

## Scope

### In scope (this PR)

- `packages/core/src/setup/adopt.ts` — rule extractor.
- `packages/core/src/setup/scan/index.ts` + `scan/lint-config.ts` + `scan/tree-sitter.ts` + `scan/git-log.ts`.
- `packages/core/src/setup/confirm.ts`.
- `packages/core/src/setup/tailor.ts`.
- `packages/core/src/setup/templates/workflow-section.md` + `templates/file-layout-section.md`.
- `packages/core/src/setup/prompts/universal.md` — updated instruction.
- `packages/core/src/setup/resolve-ai.ts` — wire adopted+scanned rules into prompt and patch `buildGenericConstitution()` to include the two sections.
- `packages/core/src/setup/context.ts` — `detectExistingRuleFiles()` helper.
- `packages/core/src/setup/index.ts` + `packages/core/src/index.ts` — re-exports.
- Tests (TDD): adopt.golden, scan-lint-config, scan-git-log, confirm, tailor.validate-schema, resolve-ai.generic-template.

### Out of scope (other waves)

- Wizard orchestrator (`packages/cli/src/commands/setup.ts`) — Wave 3.
- Merging `init` and `setup` scaffolding into `bootstrap/scaffold.ts` — Wave 3.
- `.claude/settings.json` keyed merge + progressive MCP handshake — Wave 3.
- `maina context` defaults, `wiki init --background`, SSOT doc-count regen — Wave 4.

## Design Decisions

1. **`Rule[]` as canonical currency.** Every upstream (adopt, scan) emits the same shape `{ text, source, confidence, category }`; every downstream (confirm, tailor) consumes it. That makes it trivial to add a new source (e.g. LSP diagnostics) later without touching the pipeline.
2. **Confidence thresholds are numeric, not enum.** 1.0 for adopted (explicit user intent), 0.7 for lint-config (explicit machine-readable intent), 0.5 for git-log heuristics, 0.4 for AST pattern samples. Non-TTY threshold is 0.6 so lint-config always passes but AST samples need review.
3. **Workflow + File Layout live in template files, not the LLM prompt.** These are stable project DNA — the LLM must not paraphrase them. We substitute detected variables (`{languages}`, `{toplevel_dirs}`) but never hand them to the model as free-form output.
4. **Validator is cheap and strict.** Literal string check for the two section headings. If either is missing, retry once with a stronger instruction then fall through to `buildGenericConstitution()`. We prefer a degraded constitution that's complete over an AI one that's missing structure.
5. **AST sampler is regex-based, not tree-sitter-bound.** The parent prompt referenced `web-tree-sitter`, but it's not a runtime dep of `@mainahq/core` today and the signals we need (test file naming, async usage, error handling style) are coarse enough that regex on ≤ 100 sampled files per language is adequate. Documented as `scan/tree-sitter.ts` to keep the module name consistent with the plan; a future PR can swap the implementation.
6. **`.maina/rejected.yml` is append-only.** Keeps a record so future re-runs of setup can either re-suggest (if confidence increased) or permanently skip. Format: YAML list of `{text, source, confidence, rejectedAt}`.
7. **`@clack/prompts` via dynamic import, not a hard dep of `@mainahq/core`.** Core doesn't currently depend on `@clack/prompts` — we import it lazily inside the TTY branch. If the dep is not available the confirm path falls back to non-TTY (auto-accept ≥ 0.6).

## Open Questions

- None blocking. Tree-sitter upgrade deferred per Design Decision 5.
