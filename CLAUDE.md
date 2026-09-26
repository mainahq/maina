# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Maina — verification-first developer OS. CLI + MCP server + skills package that proves AI-generated code is correct before it merges. Three engines: Context (observes), Prompt (learns), Verify (verifies).

Product spec and implementation plan live in the private `mainahq/maina-cloud` repo under `strategy/` (moved out on 2026-04-18 to keep roadmap private).

## v1 rebuild (in progress, ships as 2.0.0)

1.x is treated as a POC being refactored in place. Positioning: **guardrails for AI coding agents**; decides in milliseconds whether an agent action is allowed, asked or denied. Spec/plan: `maina-cloud:strategy/maina-v1/`. Tracking epic: mainahq/maina#365. Every task is one GitHub issue labelled `v1`; cite its FR IDs.

- **Branching:** branch per issue off `v1/main` (`v1/<issue>-<slug>`), PR into `v1/main`. Never PR v1 work into `master`.
- **Dogfood:** use `maina verify`, `maina commit` (never raw `git commit`, never `--skip`) and receipts. Friction → issue labelled `dogfood`; P0 (wrong allow, crash, no override path) blocks the next wave.
- **Target layering:** `core` = pure functions over explicit inputs + injected ports · `runtime` = process concerns (root, config, IPC, MCP, model) · adapters = host event normalisation, no decisions · surfaces (plugins, docs) = generated packaging only.

## Functional core rules

- No `process.cwd()`, `process.env`, `console.*`, `process.stdout`, `throw` or direct `Bun.spawn` in `packages/core`. Side effects go through `CorePorts` (`packages/core/src/ports`: `fs, git, db, clock, logger, model, env, process`; in-memory fakes in `ports/testing.ts`); logs go to stderr via the logger port. Child processes go through `ProcessPort` (real adapter: `core/src/process`, which drops leaked repo-local `GIT_*` vars).
- **Purity ratchet:** `packages/core/src/__tests__/purity.test.ts` statically scans non-test `packages/core/src` files for those six constructs. Only this first rule is machine-checked; the rest are enforced in review. Legacy 1.x offenders are grandfathered in `purity-allowlist.ts` with exact per-file, per-rule counts, so the test fails CI when an unlisted file offends, when a listed file's count rises, and when a count falls without the entry being lowered (or removed once clean). The list only shrinks: never add an entry to pass a new violation.
- Return `Result<T, E>` for anything fallible; errors are typed discriminated unions, not strings, in new code.
- No classes. Plain functions and data; `readonly` types; discriminated unions for variants; exhaustive `switch` with a `never` check.
- Small pure functions composed together; I/O at the edges. No new FP framework (no Effect/fp-ts): KISS.
- One source of truth: versions, tool lists, hook mappings, decision types and counts are defined once and generated elsewhere (docs included).
- Never overwrite user files: merge managed keys/regions, back up before first write, support clean uninstall.
- Fail closed: any gate path that errors resolves to `ask` (or `deny` where the host has no `ask`).
- Every public capability has tests; performance budgets are bench tests in CI.

## Stack

- **Runtime:** Bun (NOT Node.js)
- **Language:** TypeScript strict mode
- **Lint/Format:** Biome 2.x (NOT ESLint/Prettier)
- **Test:** bun:test (NOT Jest/Vitest)
- **Build:** bunup
- **CLI:** Commander 13 + @clack/prompts
- **AI:** Vercel AI SDK v6 via OpenRouter
- **DB:** bun:sqlite + Drizzle ORM
- **AST:** web-tree-sitter
- **Git hooks:** lefthook + commitlint

## Commands

```bash
bun install              # Install dependencies
bun run build            # Build all packages
bun run dev              # Dev mode
bun run check            # Biome lint + format check
bun run typecheck        # tsc --noEmit
bun run test             # Run all tests
bun test --filter <pat>  # Run specific tests
bun run verify           # Full verification: check + typecheck + test
```

## Monorepo Structure

```
packages/
├── core/      # Pure functions + injected ports: decide, gate, policy, graph, verify, receipts
│   └── src/
│       ├── ports/     # CorePorts (fs, git, db, clock, logger, model, env, process) + fakes
│       ├── decide/    # decide(), backends (rules, heuristic), decision log, outcomes, promotion, drift
│       ├── gate/      # evaluateGate: trust → rules → decide("action.risk"); shell/SQL parsers
│       ├── policy/    # Policy schema, defaults, layered load (defaults < user < repo)
│       ├── graph/     # Code graph: tree-sitter parse, store, impact/context queries
│       ├── verify/    # Verify pipeline: syntax guard → tools → diff filter → triage → review
│       ├── receipt/   # Receipt build, canonical JSON hash, offline verification
│       ├── context/   # Context Engine: working, episodic, semantic (graph), retrieval
│       ├── prompts/   # Prompt Engine: constitution, custom prompts, versioning
│       ├── telemetry/ # Opt-in channels, consent, outcome sharing
│       └── ...        # ai, cache, db, features, feedback, wiki, digest, brain, ...
├── runtime/   # Process concerns: repo root, config, daemon + IPC, MCP root, retention
│   └── src/adapters/  # Host adapters (claude-code, codex, cursor): hook events in, verdicts out
├── harness/   # maina run / maina acp: ACP orchestrator, workers, OS sandbox, worktrees, budgets
├── cli/       # Commander entrypoint; commands are thin wrappers over core/runtime/harness
├── mcp/       # MCP server: the default tool allow-list, delegating to core
├── remote/    # Remote connector: MCP over Streamable HTTP + OAuth, GitHub App jobs, self-host
├── plugins/   # One definition generating the Claude Code, Cursor, Codex plugin packages
├── skills/    # Agent Skills (gate, verify, spec, triage, graph)
└── docs/      # Astro Starlight site; reference pages and facts generated from the code
```

## Architecture

Layers, from the inside out (dependencies point inward only):

- **core** decides. Pure functions over explicit inputs and `CorePorts`. `decide(type, state, questions)` is the one entry point for every judgement: a backend (`rules`, `heuristic`, later the local `system1` model) returns a probability distribution per question, and every gate decision is appended to the local decision log (`.maina/decisions.db`, append-only, hashes and labels only). The gate runs trust → rules → `decide("action.risk")`, which may tighten a rule verdict but never loosen it; every error asks. Policy merges defaults < user (`~/.maina/policy.json`) < repo (`.maina/policy.json`); rule lists accumulate and irreversible classes only loosen through `explicitly_allow`.
- **runtime** owns process concerns: finding the repo root, loading config and policy, the daemon and its IPC, the MCP root, retention. It builds the real ports and calls core.
- **adapters** (`runtime/src/adapters`) normalise each host's hook events into gate events and map verdicts back. They never decide. Hook mappings are defined once (`hook-map.ts`) and generated into docs and plugins.
- **harness** drives agents over ACP. `maina run` gives each run its own worktree, wraps the agent in the OS sandbox (sandbox-runtime: Seatbelt on macOS, bubblewrap on Linux; a floor under the gate, never a copy), gates permission requests by the run context (interactive or unattended), enforces budgets and allows one revision after a failed review. `maina acp` proxies an editor's agent and gates its permission requests, without a sandbox.
- **plugins** are generated packaging: one definition produces each host's plugin (hooks, MCP server, skills). Plugin users get the gate at the host's hooks, not the sandbox.
- **remote** serves the MCP tools over HTTP behind OAuth and runs GitHub App jobs in scratch directories that are deleted when the job ends. There is no action gate remotely.
- **Surfaces** (cli, mcp, skills, docs) are thin: they call core through runtime or harness and hold no decisions of their own.

The 1.x engines live on inside core: the Context Engine (working → episodic → semantic code graph → retrieval, with a task-dependent token budget), the Prompt Engine (constitution + custom prompts, hashed and versioned) and the Verify pipeline (syntax guard → parallel tools → diff-only filter → triage → review). AI calls are cached on `hash(prompt_version + context_hash + model + input)`.

## Conventions

- **TDD always.** Write tests first, watch them fail, implement, watch them pass.
- **Conventional commits.** Scopes (`commitlint.config.ts`): `cli`, `core`, `runtime`, `harness`, `adapters`, `mcp`, `remote`, `skills`, `plugins`, `docs`, `ci`.
- **Docs claims.** `bun run docs:check` fails on forbidden claims (`scripts/docs-claims.ts`): "deterministic", "can't hallucinate", "no telemetry" without the qualifier the config makes true, and "AST" on a page no tree-sitter source backs.
- **Error handling:** `Result<T, E>` pattern. Never throw.
- **WHAT/WHY in spec.md, HOW in plan.md** — never mixed.
- **`[NEEDS CLARIFICATION]` markers** for ambiguity in AI output — never guess.
- **Diff-only:** only report findings on changed lines.
- **Constitution** (`.maina/constitution.md`) is stable project DNA, not subject to A/B testing.
- All DB access through repository layer.
- API responses use `{ data, error, meta }` envelope.
- No `console.log` in production code.

## Model Tiers

`task.tier` routes AI work to one of three tiers (`packages/core/src/ai/tiers.ts`):

- **mechanical:** cheap/fast (tests, commit msgs, slop detection, compression)
- **standard:** mid-tier (reviews, plans, design docs)
- **architectural:** powerful (design review, architecture, prompt evolution)

The local `system1` model is a `decide` backend, not a tier.
