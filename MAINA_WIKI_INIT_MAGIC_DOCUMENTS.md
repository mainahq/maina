# SPEC: `maina wiki init` — The Magic Documents
## What gets generated on first run to create the "aha moment"

---

## The Principle

The developer runs ONE command on a codebase they've been working on for months. In 60-90 seconds, Maina generates documentation better than anything the team has ever written manually. That's the activation moment.

```
$ maina wiki init

Extracting entities... 247 functions, 38 classes, 12 interfaces
Building knowledge graph... 1,847 edges across 297 nodes
Detecting modules... 8 modules found (Louvain clustering)
Compiling wiki... ████████████████████ 100%

Wiki initialized:

  📘 PROJECT.md           — Project overview & architecture
  🗺️  ARCHITECTURE.md      — System diagram with Mermaid
  📦 8 module articles     — What each module does & why
  🔧 12 entity articles    — Key functions & classes documented
  🧭 ONBOARDING.md        — New contributor guide
  🎯 PATTERNS.md          — Detected conventions & patterns
  🏥 HEALTH.md            — Tech debt, complexity hotspots, gaps
  📊 DEPENDENCIES.md      — Dependency graph & risk analysis
  📋 index.md             — Navigable catalog of everything

  Coverage: 74% of key entities documented
  Total: 24 articles, ~18,000 words
  Time: 67 seconds

  Open wiki: maina wiki browse
  Ask questions: maina wiki query "how does auth work?"
```

---

## The Documents

### 1. `PROJECT.md` — Project Overview

Generated from: package.json/Cargo.toml + README + constitution + module analysis + dependency graph

```markdown
# [Project Name]

## What This Project Does

[2-3 sentence summary synthesized from README + package description
+ analysis of what the code actually does]

## Tech Stack

- **Runtime:** Bun 1.x
- **Language:** TypeScript (strict mode)
- **Framework:** Hono
- **Database:** D1 (Cloudflare)
- **Testing:** bun:test (1,167 tests across 102 files)
- **Linting:** Biome 2.x
- **CI:** GitHub Actions

## Project Structure

[Tree view of top-level directories with 1-line descriptions]

packages/
  core/      — Three engines: Context, Prompt, Verify
  cli/       — 28+ CLI commands
  mcp/       — MCP server with 8 tools
  skills/    — Cross-platform SKILL.md files
  docs/      — Astro-based documentation site
  cloud/     — Cloudflare Workers API (Workkit)

## Key Numbers

- 297 source files across 8 modules
- 247 functions, 38 classes, 12 interfaces
- 1,167 tests (96% pass rate)
- Top dependency: @workkit/d1 (used by 4 modules)

## Quick Links

- [[module:context-engine]] — How codebase context is assembled
- [[module:verify-engine]] — The 18-tool verification pipeline
- [[module:prompt-engine]] — RL-driven prompt evolution
- [[decision:001-bun-only]] — Why Bun, not Node.js
```

**Why it's magic:** The developer never wrote this. Maina figured out the stack, counted the tests, analyzed the structure, and described it accurately. In 5 seconds of reading, a new contributor knows what this project is.

---

### 2. `ARCHITECTURE.md` — System Diagram

Generated from: dependency graph + module detection + cross-module call analysis

```markdown
# Architecture

## System Overview

[Mermaid diagram auto-generated from actual code relationships]

​```mermaid
graph TB
  subgraph CLI["CLI (packages/cli)"]
    commands[28+ Commands]
  end

  subgraph Core["Core (packages/core)"]
    context[Context Engine]
    prompt[Prompt Engine]
    verify[Verify Engine]
  end

  subgraph Cloud["Cloud (packages/cloud)"]
    api[API Routes]
    workers[Workers]
  end

  commands --> context
  commands --> prompt
  commands --> verify
  context --> prompt
  verify --> prompt
  api --> context
  api --> verify
​```

## Data Flow

[How data moves through the system, generated from actual import chains]

## Module Boundaries

[Which modules are tightly coupled vs loosely coupled,
from Louvain clustering + edge density analysis]

## Hot Paths

[Most-traversed call chains, from PageRank analysis.
"The auth flow touches 12 functions across 3 modules."]
```

**Why it's magic:** This is an accurate architecture diagram generated from actual code, not a stale whiteboard photo from 6 months ago.

---

### 3. Module Articles (one per detected module)

Generated from: Louvain clustering + entity extraction + internal dependency analysis

Example: `wiki/modules/verify-engine.md`

```markdown
# Verify Engine

## Purpose

Runs 18+ verification tools in parallel on code diffs.
Produces findings with severity and location. Diff-only
filtering ensures only changed lines are analyzed.

## Key Entities

| Entity | Type | PageRank | Description |
|--------|------|----------|-------------|
| [[entity:run-pipeline]] | function | 0.91 | Orchestrates parallel tool execution |
| [[entity:diff-filter]] | function | 0.84 | Filters findings to changed lines |
| [[entity:wiki-lint]] | class | 0.72 | Wiki health verification |
| [[entity:finding]] | interface | 0.68 | Structured verification result |

## Dependencies

- **Imports from:** [[module:context-engine]] (for codebase awareness)
- **Imports from:** [[module:prompt-engine]] (for AI review prompts)
- **Imported by:** [[module:cli]] (commands call verify)

## Internal Structure

​```
verify/
  pipeline.ts        — Main orchestrator
  tools/             — Individual tool adapters
    biome.ts
    semgrep.ts
    trivy.ts
    wiki-lint.ts     — Wiki health checks
  parsers/           — Output parsers for each tool
  diff-filter.ts     — Changed-lines-only filtering
​```

## Patterns Used

- Parallel execution via Promise.all
- Result<T, E> pattern (never throws)
- Tool auto-detection and auto-skip

## Related Decisions

- [[decision:003-parallel-tools]] — Why tools run in parallel, not serial
- [[decision:007-diff-only]] — Why only changed lines are analyzed
```

**Why it's magic:** Every module in the codebase gets a comprehensive article explaining what it does, what's inside it, what it depends on, and what architectural decisions shaped it — all generated from code analysis, not manual writing.

---

### 4. Entity Articles (top 20% by PageRank)

Generated from: tree-sitter + dependency graph + git blame + specs + ADRs

Example: `wiki/entities/run-pipeline.md`

```markdown
# run_pipeline()

Core orchestrator for the verification pipeline.
Accepts a diff and runs all registered tools in parallel.

## Signature

​```typescript
async function runPipeline(
  diff: Diff,
  tools: VerifyTool[],
  context: VerifyContext
): Promise<Result<PipelineResult, PipelineError>>
​```

## What It Does

1. Filters tools to those available (auto-skip missing)
2. Runs all tools in parallel via Promise.all
3. Collects findings from each tool
4. Applies diff-only filter (only changed lines)
5. Returns aggregated findings with severity

## Callers (who calls this)

- [[entity:verify-command]] — `maina verify` CLI command
- [[entity:commit-command]] — `maina commit` (pre-commit verification)
- [[entity:pr-command]] — `maina pr` (PR verification)
- [[entity:mcp-verify]] — MCP `verify` tool

## Dependencies (what this calls)

- [[entity:diff-filter]] — filters to changed lines
- [[entity:finding-aggregator]] — merges tool outputs

## Change History

- Created in Sprint 2 (initial pipeline)
- Modified by [[feature:004-parallel-tools]] — added Promise.all
- Modified by [[feature:011-wiki-lint]] — added wiki-lint tool

## Spec Contract

- Returns Result, never throws
- Exit code 0 = no error-severity findings
- Exit code 1 = error-severity findings found
```

**Why it's magic:** A new developer clicks on any important function and instantly understands what it does, who calls it, what it calls, how it's changed over time, and what contract it fulfills. This is senior-engineer-level understanding delivered in 10 seconds.

---

### 5. `ONBOARDING.md` — New Contributor Guide

Generated from: project structure + constitution + test framework + common patterns + build system

```markdown
# Onboarding Guide

Welcome to [Project Name]. This guide was auto-generated from
code analysis. It covers everything you need to start contributing.

## Setup (from package.json + build scripts)

​```bash
git clone [repo url]
cd [project]
bun install
bun run build
bun run test        # 1,167 tests, should all pass
​```

## Project Rules (from constitution.md)

- Runtime: Bun only (not Node.js, not Deno)
- Testing: bun:test only (not Jest, not Vitest)
- Error handling: Result<T, E> pattern — never throw
- Linting: Biome 2.x (not ESLint/Prettier)

## Key Modules to Understand First

Based on PageRank analysis, these are the most-connected modules.
Understanding them gives you context for 80% of the codebase:

1. [[module:context-engine]] — PageRank: 0.94
2. [[module:verify-engine]] — PageRank: 0.89
3. [[module:prompt-engine]] — PageRank: 0.85

## Common Workflows

​```bash
maina plan my-feature      # start a feature
maina spec                 # generate test stubs
maina commit               # verify + commit
maina pr                   # create PR with proof
​```

## Where to Start

Low-risk first contributions (simple entities, high test coverage):
- packages/core/src/verify/parsers/ — add output parsers
- packages/skills/ — write new SKILL.md files
- packages/docs/ — improve documentation

High-impact areas (complex, but well-documented):
- packages/core/src/context/ — context engine layers
- packages/core/src/wiki/ — wiki compiler
```

**Why it's magic:** A new hire's first day goes from "read the README and ask questions for 3 days" to "I understand the project structure, the rules, what to learn first, and where to start contributing."

---

### 6. `PATTERNS.md` — Detected Conventions

Generated from: AST pattern analysis + constitution + code frequency analysis

```markdown
# Detected Patterns & Conventions

Patterns detected from code analysis across 297 files.
These represent how this team actually writes code.

## Error Handling

Pattern: Result<T, E> (detected in 94% of async functions)

​```typescript
// ✅ This project's pattern
async function doThing(): Promise<Result<Data, AppError>> {
  // ...
  return Result.ok(data);
}

// ❌ Never used in this project
async function doThing(): Promise<Data> {
  throw new Error("...");  // 0 occurrences
}
​```

Related decision: [[decision:002-result-pattern]]

## Naming Conventions

- Files: kebab-case (verify-engine.ts)
- Functions: camelCase (runPipeline)
- Classes: PascalCase (WikiLayer)
- Constants: UPPER_SNAKE (MAX_TOKEN_BUDGET)
- Test files: *.test.ts (co-located)

## Testing

- Framework: bun:test (100% of test files)
- Pattern: describe/it/expect
- Coverage: co-located tests (same directory as source)
- Avg tests per file: 11.4

## Module Organization

- One concern per file (avg 89 LOC per file)
- index.ts barrel exports at package level
- Internal types in types.ts per module
```

**Why it's magic:** Instead of a style guide that someone wrote once and nobody reads, this shows how the team ACTUALLY writes code — detected from the codebase itself. When a convention drifts, wiki lint catches it.

---

### 7. `HEALTH.md` — Tech Debt & Complexity Report

Generated from: complexity analysis + churn data + coverage gaps + PageRank

```markdown
# Codebase Health Report

Generated: April 7, 2026

## Complexity Hotspots

| File | Cyclomatic | LOC | Churn | Risk |
|------|-----------|-----|-------|------|
| core/context/budget.ts | 24 | 312 | 18 commits | 🔴 High |
| core/verify/pipeline.ts | 19 | 287 | 12 commits | 🟡 Medium |
| cli/commands/commit.ts | 16 | 245 | 9 commits | 🟡 Medium |

## Documentation Gaps

High-PageRank entities without documentation:

| Entity | PageRank | Module | Impact |
|--------|----------|--------|--------|
| assemblContext | 0.88 | context-engine | Called by 15 functions |
| resolveConflict | 0.76 | prompt-engine | Called by 8 functions |

## Missing Rationale

Important code with no architectural decision recorded:

- Token budget allocation algorithm (budget.ts)
  → Modified in 5 features, no ADR explaining the approach
- Cache invalidation strategy (cache.ts)
  → Complex logic, no documented reasoning

## Dependency Risks

| Dependency | Used By | Last Updated | Risk |
|-----------|---------|-------------|------|
| tree-sitter | context-engine | 2 months ago | Low |
| pptxgenjs | docs only | 8 months ago | Low |
```

**Why it's magic:** This is a tech lead's quarterly health review, generated in seconds. It surfaces the exact files that need attention, the documentation gaps that create bus-factor risk, and the decisions that should have been recorded but weren't.

---

### 8. `DEPENDENCIES.md` — Dependency Graph & Risk

Generated from: import analysis + PageRank + external package analysis

```markdown
# Dependency Analysis

## Internal Module Dependencies

​```mermaid
graph LR
  CLI --> Core
  CLI --> MCP
  Cloud --> Core
  MCP --> Core
  Core --> |"context"| Core
  Core --> |"verify"| Core
  Core --> |"prompt"| Core
​```

## Most-Connected Entities (Hub Analysis)

| Entity | Inbound | Outbound | Total | Role |
|--------|---------|----------|-------|------|
| ContextEngine | 23 | 8 | 31 | Central hub |
| VerifyTool | 19 | 2 | 21 | Interface hub |
| Result | 0 | 187 | 187 | Utility type |

## External Dependencies

| Package | Purpose | Depth | Alternatives |
|---------|---------|-------|-------------|
| tree-sitter | AST parsing | Direct | None (core) |
| @workkit/d1 | Database | Direct | Drizzle |
| sharp | Image processing | Direct | jimp |

## Circular Dependencies

None detected. ✅
```

---

## What Gets Generated — Summary

| Document | Words | Time | Source Data |
|----------|-------|------|-----------|
| `PROJECT.md` | ~800 | 5s | package.json, README, structure analysis |
| `ARCHITECTURE.md` | ~600 | 8s | dependency graph, Louvain modules, call chains |
| Module articles (×8) | ~400 each | 30s | tree-sitter, PageRank, internal deps |
| Entity articles (×12) | ~300 each | 20s | AST, callers/callees, git blame, specs |
| `ONBOARDING.md` | ~600 | 5s | constitution, build scripts, PageRank |
| `PATTERNS.md` | ~500 | 8s | AST pattern frequency analysis |
| `HEALTH.md` | ~400 | 5s | complexity, churn, coverage gaps |
| `DEPENDENCIES.md` | ~400 | 3s | import graph, external packages |
| `index.md` | ~300 | 2s | article catalog |
| **Total** | **~10,000-18,000** | **60-90s** | |

---

## Implementation Notes

### What's deterministic (no LLM needed)

- Project structure tree
- Tech stack detection (from config files)
- Test count + framework detection
- Dependency graph + Mermaid diagrams
- PageRank scores
- Complexity metrics
- Naming convention detection (regex frequency)
- File churn (git log)

### What needs LLM (mechanical tier, cheap)

- Prose descriptions ("what this module does")
- Pattern explanations ("why this convention exists")
- Onboarding recommendations ("where to start")
- Health report narratives
- Entity article prose sections

### What comes from existing Maina data (zero LLM cost)

- Constitution rules → ONBOARDING.md
- ADRs → decision articles + decision references in entity articles
- Feature plans/specs → feature articles + spec contracts in entity articles
- Workflow traces → architecture articles

### The 30-second test

After `maina wiki init` completes, the developer should be able to:

1. Open `PROJECT.md` → understand the project in 10 seconds
2. Open `ARCHITECTURE.md` → see an accurate system diagram
3. Open any module article → understand what it does and why
4. Open `HEALTH.md` → see what needs attention
5. Run `maina wiki query "how does X work?"` → get an accurate answer

If all five work, the developer is activated. They'll never go back to reading raw code without wiki context.

---

## The Demo Script (for Product Hunt / investor pitch)

```
$ git clone https://github.com/some-popular-oss-project
$ cd some-popular-oss-project
$ maina init --install && maina wiki init

[90 seconds of compilation]

$ cat .maina/wiki/PROJECT.md      # "whoa, that's accurate"
$ cat .maina/wiki/ARCHITECTURE.md  # "that diagram is RIGHT"
$ cat .maina/wiki/HEALTH.md        # "we knew about that tech debt..."

$ maina wiki query "how does the authentication flow work?"
# → synthesized answer citing 4 wiki articles

$ maina wiki query "what would break if I changed UserService?" --save
# → impact analysis filed back as wiki article
```

That's the demo. Clone any repo, run one command, get documentation better than what the team has. Then ask it questions and it answers from compiled knowledge, not raw code search.
