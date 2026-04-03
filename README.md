# ମୈନା Maina

**The verification-first developer operating system.**

*Observe. Learn. Verify.*

---

## What is Maina?

AI writes 41% of the world's code. That code ships with 1.7x more defects than human-written code. Maina is a CLI, MCP server, and skills package that **proves AI-generated code is correct before it merges**. Three engines -- Context, Prompt, Verify -- observe your codebase, learn your team's preferences, and verify every change with deterministic tools and targeted AI review.

## Quick Start

```bash
bun add -g maina            # Install globally
maina init                  # Bootstrap in any repo
maina commit                # Verify and commit
maina verify                # Run verification pipeline
```

Or try without installing:

```bash
bunx maina init
bunx maina commit
```

Zero config. No accounts. No Docker. No cloud. Works with nothing beyond Git and Bun.

## Why Maina?

Every AI coding tool generates code. None of them prove it is correct. Maina closes that gap with three engines that work together on every command:

- **Context Engine** observes your codebase through 4-layer retrieval with PageRank scoring -- so AI sees exactly what matters, not everything.
- **Prompt Engine** learns your team's conventions through versioned prompts that evolve from feedback -- so AI output matches how you actually work.
- **Verify Engine** verifies every change through a deterministic pipeline -- syntax guard, parallel analysis tools, diff-only filtering, slop detection -- so nothing ships unchecked.

### Measured results from building Maina with Maina

| Metric | With Maina | Without Maina |
|--------|-----------|---------------|
| Tests passing | 802 | 0 |
| Findings caught | 29 | 0 |
| Semantic entities indexed | 742 | 0 |
| Dependency edges mapped | 176 | 0 |
| Avg verify time | 8.8s | -- |
| Avg spec quality score | 67/100 | -- |
| CLI commands | 20 | -- |
| MCP tools | 8 | -- |
| Skills | 5 | -- |

Every commit to Maina has gone through `maina commit` since Sprint 3. The numbers above are from real usage, not benchmarks.

## Commands

| Command | Description |
|---------|-------------|
| `maina init` | Bootstrap Maina in any repo |
| `maina commit` | Verify staged changes and commit |
| `maina verify` | Run full verification pipeline |
| `maina status` | Show current branch verification status |
| `maina context` | Generate focused codebase context |
| `maina context add <file>` | Add file to semantic custom context |
| `maina context show` | Show context layers with token counts |
| `maina plan` | Create feature branch with structured plan |
| `maina spec` | Generate TDD test stubs from plan |
| `maina ticket` | Create a GitHub Issue with module tagging |
| `maina design` | Create an Architecture Decision Record |
| `maina review design` | Review ADR against existing decisions and constitution |
| `maina review` | Comprehensive two-stage code review |
| `maina explain` | Visualize codebase structure with Mermaid diagrams |
| `maina analyze` | Check spec / plan / tasks consistency |
| `maina pr` | Create a PR with two-stage review |
| `maina learn` | Analyse feedback and propose prompt improvements |
| `maina prompt edit <task>` | Open prompt template in $EDITOR |
| `maina prompt list` | Show all prompt tasks with version info |
| `maina cache stats` | Show cache hit rate, entries, storage info |
| `maina stats` | Show commit verification metrics and trends |
| `maina doctor` | Check tool installation and engine health |

## Three Engines

### Context Engine -- Observes

The brain. Knows your codebase, your team's history, and what matters right now.

Four layers of retrieval, each loaded only when needed:

| Layer | What | Budget |
|-------|------|--------|
| **Working** | Current branch, PLAN.md, touched files, last verification | ~15% |
| **Episodic** | Compressed PR summaries, review feedback. Ebbinghaus decay -- fades if not reinforced. | ~15% |
| **Semantic** | Module entities (tree-sitter AST), dependency graph (PageRank-scored), ADRs, constitution | ~20% |
| **Retrieval** | Zoekt code search, on-demand only | ~10% |

40% headroom reserved for AI reasoning and output. Never filled.

**Dynamic budget:** expand to 80% during exploration (`maina context`), contract to 40% during focused work (`maina commit`). Each command declares its context needs via a selector -- no wasted tokens.

**PageRank for relevance:** tree-sitter extracts cross-file references, builds a directed dependency graph, and runs PageRank with a personalization vector biased toward the current task.

### Prompt Engine -- Learns

Prompts are versioned software, not static text.

- **Constitution** (`.maina/constitution.md`): Non-negotiable project rules. Injected as preamble into every AI call. Stable DNA -- not subject to A/B testing.
- **Custom prompts** (`.maina/prompts/`): Markdown files that control AI behavior per task. `review.md` tells the AI what to focus on. `tests.md` tells it how your team writes tests.
- **Prompt versioning:** Every prompt is hashed. Usage and accept rates tracked per version.
- **Evolution loop:** Feedback drives A/B-tested prompt improvements. Accept or reject AI output, and the prompt evolves. `maina learn` analyses patterns and proposes improvements.

### Verify Engine -- Verifies

Deterministic tools find issues. AI generates fixes. Humans review. Feedback improves everything.

```
Syntax Guard (Biome, <500ms)
    |
Parallel Deterministic Analysis
    |  Biome (423+ rules)        Semgrep (2,000+ SAST rules)
    |  SonarQube CE              Secretlint
    |  Trivy (dependency CVEs)   diff-cover
    |  Stryker (mutation)        Slop detector
    |
Diff-only filter (changed lines only -- no pre-existing noise)
    |
AI Fix Layer (context-aware, cache-checked)
    |
Two-stage Review
    |  Stage 1: Spec compliance (matches PLAN.md?)
    |  Stage 2: Code quality (clean, tested, safe?)
```

Tools are auto-detected. Missing tools are skipped, not errors. Works with zero external tools installed.

## MCP Server

Add Maina to any MCP-compatible IDE with one config entry:

```json
{
  "mcpServers": {
    "maina": {
      "command": "maina",
      "args": ["--mcp"]
    }
  }
}
```

### Tools

| Tool | Description |
|------|-------------|
| `getContext` | Get focused codebase context for a command |
| `getConventions` | Get project constitution and conventions |
| `verify` | Run verification pipeline on staged or specified files |
| `checkSlop` | Check code for AI-generated slop patterns |
| `reviewCode` | Run two-stage review on a diff |
| `explainModule` | Get Mermaid dependency diagram for a directory |
| `suggestTests` | Generate TDD test stubs from a plan.md file |
| `analyzeFeature` | Check spec/plan/tasks consistency for a feature |

Each tool delegates to the appropriate engine. All respect the cache.

## Skills

Maina ships a skills package that works cross-platform -- Claude Code, Cursor, Codex, Gemini CLI. Skills use progressive disclosure (~100 tokens for scanning, <5k when activated).

| Skill | Purpose |
|-------|---------|
| `verification-workflow` | End-to-end verification process |
| `context-generation` | Focused codebase context assembly |
| `plan-writing` | Structured feature planning |
| `code-review` | Two-stage review methodology |
| `tdd` | Test-driven development workflow |

Maina works even without the CLI installed. An AI agent with just the skills follows the verification workflow.

## Spec Quality (Karpathy Principles)

`maina spec` generates TDD test stubs and scores them across 5 categories:

- **Clarity** -- Are requirements unambiguous?
- **Testability** -- Can each requirement be verified?
- **Completeness** -- Are edge cases covered?
- **Consistency** -- Do requirements contradict each other?
- **Atomicity** -- Is each requirement independently implementable?

Red-green enforcement: stubs must fail before implementation, pass after. Average spec quality score across Maina's own development: **67/100**.

## Configuration

```typescript
// maina.config.ts
export default defineConfig({
  models: {
    mechanical: 'google/gemini-2.5-flash',      // Tests, commit msgs, slop, compression
    standard: 'anthropic/claude-sonnet-4',        // Reviews, plans, design docs
    architectural: 'anthropic/claude-sonnet-4',   // Design review, architecture, prompt evolution
    local: 'ollama/qwen3-coder-8b',              // Offline: slop, commit msgs
  },
  provider: 'openrouter',
  budget: { daily: 5.00, perTask: 0.50, alertAt: 0.80 },
});
```

### Model Tiers

| Tier | Used for | Example |
|------|----------|---------|
| **mechanical** | Tests, commit messages, slop detection, compression | gemini-2.5-flash |
| **standard** | Reviews, plans, design docs | claude-sonnet-4 |
| **architectural** | Design review, architecture, prompt evolution | claude-sonnet-4 |
| **local** | Offline use via Ollama | qwen3-coder-8b |

### Zero-friction layers

- **Layer 0 -- Git-native.** Core commands work with nothing beyond Git and Bun. No accounts, no Docker, no cloud.
- **Layer 1 -- Add AI.** Set `MAINA_API_KEY` or point to Ollama. AI features activate. Without a key, deterministic verification still works.
- **Layer 2 -- Add tools.** Semgrep, Trivy, Secretlint, SonarQube -- auto-detected, auto-skipped if missing.
- **Layer 3 -- Add PM.** GitHub Issues sync to Huly, Linear, Plane, or any GitHub-syncing PM tool.

## Stack

| Component | Tool | Why |
|-----------|------|-----|
| Runtime | Bun | Fast, batteries-included, native SQLite |
| Language | TypeScript (strict mode) | Type safety across the entire codebase |
| CLI | Commander 13 + @clack/prompts | Industry standard + terminal UI |
| Lint/Format | Biome 2.x | Single tool, 423+ rules, fast |
| Tests | bun:test | Native, zero-config |
| Build | bunup | Bun-native bundler |
| AI | Vercel AI SDK v6 + OpenRouter | 300+ models, unified interface |
| Database | bun:sqlite + Drizzle ORM | Zero-dep, embedded, type-safe |
| AST | web-tree-sitter | 130+ languages, WASM |
| Code search | Zoekt | Google's code search (optional) |
| Git hooks | lefthook + commitlint | Fast, parallel, conventional commits |

## Project Structure

```
maina/
  packages/
    cli/        # Commander entrypoint, commands, terminal UI
    core/       # Three engines + cache + AI + git + DB + hooks
    mcp/        # MCP server (delegates to engines)
    skills/     # Cross-platform skills (5 SKILL.md files)
  .maina/       # Per-repo state (gitignored)
    constitution.md
    context/
    features/
    prompts/
    hooks/
    cache/
    feedback.db
```

## Development

```bash
bun install              # Install dependencies
bun run build            # Build all packages
bun run dev              # Dev mode
bun run check            # Biome lint + format check
bun run typecheck        # tsc --noEmit
bun run test             # Run all tests (802 passing)
bun run verify           # Full verification: check + typecheck + test
```

## The Name

**Maina** (ମୈନା) -- Odia for the mynah bird. Observes its environment. Learns from what it hears. Communicates with precision.

Context Engine observes. Prompt Engine learns. Verify Engine communicates.

## License

[Apache 2.0](LICENSE)
