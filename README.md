# Maina

**Prove AI code is correct before it merges.**

*Observe. Learn. Verify.*

[Docs](https://beeeku.github.io/maina/) | [Getting Started](https://beeeku.github.io/maina/getting-started/) | [Commands](https://beeeku.github.io/maina/commands/) | [Roadmap](https://beeeku.github.io/maina/roadmap/)

---

## The Problem

AI writes 41% of code today. That code ships with **1.7x more defects** than human-written code. Every team now faces the same question: *how do you trust what the machine wrote?*

Copilot generates but doesn't verify. CodeRabbit reviews but doesn't learn your preferences. Semgrep scans but can't fix. Cursor edits but context is per-file. **None of these connect.**

## What Maina Does

Maina is a CLI + MCP server + skills package. One tool that:

1. **Knows your codebase** -- 4-layer context engine with PageRank relevance
2. **Learns your preferences** -- prompts evolve from your feedback via A/B testing
3. **Proves every change** -- 12-tool verification pipeline, diff-only, before it merges

```bash
bunx maina init             # Zero config. Works immediately.
maina commit                # Verify with 12 tools + commit.
maina verify --visual       # Add screenshot regression.
maina pr                    # PR with verification proof attached.
```

## How It Works

Three engines. Every command draws from all three.

```
        Context Engine          Prompt Engine         Verify Engine
        (Observes)              (Learns)              (Verifies)
        ─────────────           ──────────            ─────────────
        4-layer retrieval       Constitution          12-tool pipeline
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

## Works Inside Your AI Tool

Maina runs inside Claude Code, Cursor, Codex, and Gemini CLI via MCP:

```json
{
  "mcpServers": {
    "maina": { "command": "maina", "args": ["--mcp"] }
  }
}
```

8 MCP tools: `getContext`, `getConventions`, `verify`, `checkSlop`, `reviewCode`, `explainModule`, `suggestTests`, `analyzeFeature`.

5 cross-platform skills that work even without the CLI installed.

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

Maina's 12-tool pipeline caught issues that ad-hoc implementation missed.

## 24 Commands

### Define
`init`, `init --install`, `configure`, `ticket`, `context`, `explain`, `design`, `review-design`

### Build
`plan`, `spec`, `commit`

### Verify
`verify`, `verify --deep`, `verify --visual`, `slop`, `review`, `analyze`, `pr`

### Meta
`learn`, `visual update`, `prompt edit`, `cache stats`, `stats`, `benchmark`, `doctor`

[Full command reference](https://beeeku.github.io/maina/commands/)

## Quick Start

```bash
bun add -g @mainahq/cli    # Install
maina init --install         # Bootstrap + install verification tools
maina configure              # Set conventions interactively
maina doctor                 # Check what's available
```

Then develop:

```bash
maina plan my-feature        # Create feature branch with structure
# ... write code ...
maina commit                 # Verify (12 tools) + commit
maina pr                     # PR with verification proof
maina learn                  # Evolve prompts from feedback
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
    local: 'ollama/qwen3-coder-8b',
  },
  provider: 'openrouter',
});
```

## Development

```bash
git clone https://github.com/beeeku/maina
cd maina && bun install
bun run build && bun run test    # 1017+ tests
```

## The Name

**Maina** -- named after the mynah bird. Observes its environment. Learns from what it hears. Communicates with precision.

## License

[Apache 2.0](LICENSE)
