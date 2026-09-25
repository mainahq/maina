# Maina

**Prove AI code is correct before it merges.**

*Observe. Learn. Verify.*

[Docs](https://mainahq.com/) | [Getting Started](https://mainahq.com/getting-started/) | [Commands](https://mainahq.com/commands/) | [Roadmap](https://mainahq.com/roadmap/)

---

```bash
curl -fsSL https://api.mainahq.com/install | bash
```

One command. Zero config. No API key, no login. In under 60 seconds: tailored `.maina/constitution.md`, five agent instruction files (`AGENTS.md`, Cursor, Claude, Copilot, Windsurf) with non-destructive managed regions, a seeded codebase wiki, and a real `maina verify` finding surfaced inline.

<details>
<summary>Alternate install paths</summary>

```bash
# Global install via any package manager you already have
bun  add -g @mainahq/cli
pnpm add -g @mainahq/cli
npm  install -g @mainahq/cli

# One-off run — the wrapper self-upgrades to a global install on first use,
# because AI agents that spawn subshells cannot find `maina` otherwise.
bunx @mainahq/cli@latest setup
```

</details>

## The Problem

AI writes 41% of code today. That code ships with **1.7x more defects** than human-written code. Every team now faces the same question: *how do you trust what the machine wrote?*

Copilot generates but doesn't verify. CodeRabbit reviews but doesn't learn your preferences. Semgrep scans but can't fix. Cursor edits but context is per-file. **None of these connect.**

## What Maina Does

Maina is a CLI + MCP server + skills package. One tool that:

1. **Knows your codebase** -- 4-layer context engine with PageRank relevance
2. **Learns your preferences** -- prompts evolve from your feedback via A/B testing
3. **Proves every change** -- 16-tool verification pipeline, diff-only, before it merges

```bash
bunx @mainahq/cli@latest setup   # Wizard: constitution + agents + wiki + verify (<60s)
maina commit                     # Verify with 12 tools + commit.
maina verify --visual            # Add screenshot regression.
maina pr                         # PR with verification proof attached.
```

## How It Works

Three engines. Every command draws from all three.

```
        Context Engine          Prompt Engine         Verify Engine
        (Observes)              (Learns)              (Verifies)
        ─────────────           ──────────            ─────────────
        4-layer retrieval       Constitution          16-tool pipeline
        PageRank relevance      Custom prompts        Diff-only filter
        Dynamic token budget    A/B testing           AI review
        Zoekt code search       Feedback evolution    Visual regression
```

### Context Engine -- knows what matters

Not "stuff everything in the context window." Smart retrieval:

- **Working layer** -- current branch, touched files, verification status
- **Episodic layer** -- compressed PR summaries with Ebbinghaus decay
- **Semantic layer** -- tree-sitter AST, PageRank dependency graph
- **Retrieval layer** -- Zoekt/ripgrep code search, on-demand

Each command declares what context it needs. `maina commit` gets working context only (fast). `maina pr` gets all four layers (thorough).

### Prompt Engine -- learns how you work

Your prompts evolve from your feedback:

```
You accept a review → feedback recorded → maina learn analyzes patterns
→ improved prompt proposed → A/B tested (80/20 split)
→ winner promoted automatically
```

Your team's constitution (`.maina/constitution.md`) is injected into every AI call. Non-negotiable rules that every AI respects.

### Verify Engine -- proves it's correct

12 tools run in parallel on every commit:

| Tool | What it catches |
|------|----------------|
| **Biome / ruff / go vet / clippy** | Syntax + lint (language-aware) |
| **Semgrep** | 2,000+ SAST rules |
| **Trivy** | Dependency CVEs |
| **Secretlint** | Leaked secrets |
| **SonarQube** | Quality gates |
| **Stryker** | Survived mutants (untested code) |
| **diff-cover** | Changed lines without test coverage |
| **AI review** | Cross-function consistency, missing edge cases |
| **Slop detector** | Empty bodies, hallucinated imports, console.log, TODOs |
| **Visual (Playwright)** | Screenshot regression |

All tools auto-detected. Missing tools skipped, not errors. **Works with zero external tools installed.**

## Multi-Language

Detects your project and adapts:

| Language | Detected from | Linter |
|----------|--------------|--------|
| TypeScript | `tsconfig.json` | Biome |
| Python | `pyproject.toml`, `requirements.txt` | ruff |
| Go | `go.mod` | go vet |
| Rust | `Cargo.toml` | clippy |

## Works With 12+ AI Coding Tools

Maina runs inside any AI coding tool via MCP and cross-platform skills:

```json
{
  "mcpServers": {
    "maina": { "command": "maina", "args": ["--mcp"] }
  }
}
```

The MCP server registers these tools by default (the DeepWiki-compatible wiki tools are added through the `--tools` allow-list):

<!-- maina:mcp-tools default list -->
- `verify` — Run the verification pipeline on your changes before asking for review; fix findings on changed lines.
- `decide` — Ask the repo's policy typed questions (e.g. `finding.real`, `diff.needs_review`) instead of guessing.
- `impact` — Before changing files or symbols, see what they can affect: callers, dependent files, covering tests.
- `context` — Get the source you need for files or a query, within a token budget, before reading whole files.
- `review_triage` — Two-stage review of your diff (spec compliance, then code quality), triaged into blocking, advisory and info.
- `spec_check` — Check a feature's spec.md, plan.md and tasks.md agree before implementing it.
- `receipt` — Verify maina receipt JSON files against the v1 schema and their canonical hash.
- `status` — Check the maina version, the enabled tools, and whether the code graph, wiki and policy are ready.
<!-- /maina:mcp-tools -->

Run `bun run docs:manifest` for the live tool + skill inventory.

Cross-platform skills work even without the CLI installed.

| Tool | MCP | Instructions | Setup |
|------|-----|-------------|-------|
| Claude Code | Yes | CLAUDE.md | `maina setup` |
| Cursor | Yes | .cursor/rules/maina.mdc | `maina setup` |
| Windsurf | Yes | .windsurf/rules/maina.md | `maina setup` |
| GitHub Copilot | Yes | copilot-instructions.md | `maina setup` |
| Continue.dev | Yes | config.yaml | `maina setup --legacy-agents` |
| Cline | Yes | .clinerules | `maina setup --legacy-agents` |
| Roo Code | Yes | .roo/rules/ | `maina setup --legacy-agents` |
| Amazon Q | Yes | .amazonq/ | `maina setup --legacy-agents` |
| Gemini CLI | Yes | GEMINI.md | `maina setup --legacy-agents` |
| Zed | Yes | -- | `maina setup` |
| Codex CLI | -- | AGENTS.md | `maina setup` |
| Aider | -- | CONVENTIONS.md | `maina setup --legacy-agents` |

Run `maina setup` to auto-configure MCP and write instruction files. It is idempotent and never overwrites your files: maina only edits its own `<!-- maina-managed -->` region (or its `mcpServers.maina` key in JSON) and backs up the original to `.maina/backups/` before the first edit. The older per-tool files are opt-in with `--legacy-agents`. See the [onboarding skill](packages/skills/onboarding/SKILL.md) for per-tool details.

## The Workflow

Every step feeds the next. Workflow context carries forward automatically.

```
brainstorm → ticket → plan → design → spec → implement
                                                  ↓
                              pr ← commit ← review ← verify
                              ↓
                            merge → learn → improve
```

Each step records async RL feedback. `maina learn` shows per-step accept rates and proposes prompt improvements.

## Benchmark

Validator library benchmark (95 hidden edge-case tests):

| Tool | Validation Pass Rate |
|------|---------------------|
| SpecKit | 95/95 (100%) |
| **Maina** | **95/95 (100%)** |

Maina's 16-tool pipeline caught issues that ad-hoc implementation missed.

## Commands

<!-- docs-manifest: ignore -->
Live count and names come from `bun run docs:manifest`. The groupings below are for readability only — do not hand-type counts.

### Define
`setup`, `setup --update`, `setup --reset`, `init`, `ticket`, `context`, `explain`, `design`, `review-design`

### Build
`plan`, `spec`, `commit`

### Verify
`verify`, `verify --deep`, `verify --visual`, `slop`, `review`, `analyze`, `pr`

### Meta
`learn`, `visual update`, `prompt edit`, `cache stats`, `stats`, `benchmark`, `doctor`

[Full command reference](https://mainahq.com/commands/)

## Quick Start

```bash
bunx @mainahq/cli@latest setup
```

That's it. In under 60 seconds you have a tailored constitution, wired agents, a seeded wiki, and a real verify finding. Then develop:

```bash
maina plan my-feature        # Create feature branch with structure
# ... write code ...
maina commit                 # Verify (12 tools) + commit
maina pr                     # PR with verification proof
maina learn                  # Evolve prompts from feedback
```

### Advanced

Lower-level primitives for scripting and power users — see the [Full Setup docs](https://mainahq.com/full-setup/).

```bash
maina setup --update         # Refresh managed regions after stack changes
maina setup --reset          # Back up .maina/ and start fresh
maina setup --ci             # Non-interactive; per-phase JSON output
maina setup --plugin         # Plugin mode: only .maina/ + existing managed regions
maina setup --legacy-agents  # Also write retired agent files (.clinerules, .roo/, …)
maina doctor                 # Check which tools are installed
```

## Zero-Friction Layers

| Layer | Add | Get |
|-------|-----|-----|
| **L0** | Git + Bun | Core commands, deterministic verification, context engine |
| **L1** | API key or Ollama | AI reviews, commit messages, explanations, fix suggestions |
| **L2** | Semgrep, Trivy, etc. | SAST, CVE scanning, secret detection, quality gates |
| **L3** | GitHub Issues | Sync to Linear, Huly, Plane, or any PM tool |

No accounts. No Docker. No cloud.

## Configuration

```typescript
// maina.config.ts
export default defineConfig({
  models: {
    mechanical: 'google/gemini-2.5-flash',
    standard: 'anthropic/claude-sonnet-4',
    architectural: 'anthropic/claude-sonnet-4',
  },
  provider: 'openrouter',
});
```

## Privacy & Telemetry

Maina sends **anonymous CLI crash reports** when an uncaught error terminates the process. The payload contains the error class/message/stack (absolute file paths rewritten to basenames, emails/IPs/API keys redacted), the subcommand, the maina/node versions, platform/arch, and a CI flag — **no code, no project names, no authentication tokens**.

Opt out any of these three ways:

```bash
export MAINA_TELEMETRY=0                 # or DO_NOT_TRACK=1
echo '{"optOut": true}' > ~/.maina/telemetry.json
```

## Development

```bash
git clone https://github.com/mainahq/maina
cd maina && bun install
bun run build && bun run test    # 1017+ tests
```

## The Name

**Maina** -- named after the mynah bird. Observes its environment. Learns from what it hears. Communicates with precision.

## License

[Apache 2.0](LICENSE)
