# Maina

**The verification-first developer operating system.**

*Observe. Learn. Verify.*

---

## The problem

AI writes 41% of the world's code. That code ships with 1.7× more defects than human code. Only 10% is both functional and secure.

The bottleneck in software development has permanently shifted. Making code is nearly free. **Proving code is correct** — review, testing, security, documentation — remains manual, fragmented, and slow.

Every team now faces the same question: how do you trust what the machine wrote?

---

## The insight

After studying 12 production agentic tools (Aider, PR-Agent, SWE-agent, Claude Code, OpenHands, Superpowers, Spec Kit, Instar, Reviewdog, Danger.js, Semgrep, Kodus), one pattern is universal:

**The quality of AI output is determined by three things:**

1. **Clarity of intent** — What are we building and why? (Spec Kit calls this "intent is the source of truth, code is generated output.")
2. **Relevance of context** — What does the AI know when it generates? (Instar learned that a single memory file overwhelms the model within a week. Aider uses PageRank to select what matters.)
3. **Reliability of verification** — Can we prove the output is correct? (SWE-agent found that preventing bad states beats recovering from them. PR-Agent found that one focused AI call beats a chain of sloppy ones.)

Everything else — the IDE, the model, the framework — is scaffolding. Maina is built around these three things, and nothing else.

---

## The user

**Primary:** A senior engineer or tech lead at a 5-50 person engineering team who's watching AI-generated code flood their codebase without adequate verification.

They've tried: Copilot (generates but doesn't verify), CodeRabbit (reviews but doesn't learn their preferences), Semgrep (scans but can't fix), Cursor (edits but context is per-file). None of these connect.

They want: one tool that knows their codebase, learns their preferences, and proves every change is correct — before it merges.

**Secondary:** A solo developer shipping fast with AI who needs guardrails against shipping slop.

---

## The product

Maina is a CLI that runs in your terminal, an MCP server that runs in your IDE, and a skills package that teaches any AI agent your team's verification workflow.

```
$ bunx maina          # And you're running. Zero config.
```

### Zero-friction layers

**Layer 0 — Git-native.** All artifacts live in the repo. Core commands work with nothing beyond Git and Bun. No accounts, no Docker, no cloud.

**Layer 1 — Add AI.** Set `MAINA_API_KEY` or point to Ollama. AI features activate. Without a key, deterministic verification still works.

**Layer 2 — Add tools.** Semgrep, Trivy, Secretlint, SonarQube — auto-detected, auto-skipped if missing.

**Layer 3 — Add PM.** GitHub Issues sync to Huly, Linear, Plane, or any GitHub-syncing PM tool. Users never sign up for anything.

---

## The architecture

Three engines. Every command draws from all three. The engines are the product — commands are thin wrappers.

```
                    ┌─────────────────────┐
                    │     maina CLI       │
                    │  + MCP server       │
                    │  + Skills package   │
                    └──────┬──────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ Context  │    │ Prompt   │    │ Verify   │
   │ Engine   │    │ Engine   │    │ Engine   │
   │          │    │          │    │          │
   │ Observes │    │ Learns   │    │ Verifies │
   └──────────┘    └──────────┘    └──────────┘
```

### Engine 1: Context Engine — Observes

The brain. Knows the codebase, the team's history, and what matters right now.

**Problem it solves:** Stuffing everything into the context window degrades AI output at ~60% utilisation. A 2,000-line file read wastes 15,000 tokens when you need 10 lines. Instar's single-file memory approach failed within a week of growth.

**Solution:** Four-layer retrieval with dynamic budget.

| Layer | What | Budget | Loaded when |
|-------|------|--------|-------------|
| **Working** | Current branch, PLAN.md, touched files, last verification | ~15% | Always |
| **Episodic** | Compressed PR summaries, review feedback, session notes. Ebbinghaus decay — fades if not reinforced by access. | ~15% | Most commands |
| **Semantic** | Module entities (tree-sitter AST), dependency graph (PageRank-scored), ADRs, conventions, constitution, custom context | ~20% | When AI needs codebase awareness |
| **Retrieval** | Zoekt code search, on-demand only | ~10% | Only when explicitly needed |

**40% headroom** reserved for AI reasoning and output. Never filled.

**Dynamic budget** (from Aider): expand to 80% during exploration (`maina context`), contract to 40% during focused work (`maina commit`).

**PageRank for relevance** (from Aider): tree-sitter extracts cross-file references, builds a directed graph, runs PageRank with personalization vector biased toward the current task. Edge weights: ×10 for identifiers in current ticket, ×50 for files already in context, ×0.1 for private names.

**Each command declares its context needs.** `maina commit` gets Layer 1 only. `maina verify --fix` gets Layers 1-3. `maina context` gets all four. The selector ensures each command gets exactly what it needs, nothing more.

### Engine 2: Prompt Engine — Learns

Prompts are versioned software, not static text.

**Problem it solves:** The best prompt for a team changes as their codebase, conventions, and preferences evolve. A prompt that works for a Django monolith is wrong for a microservices Go codebase. Teams can't tune prompts without understanding prompt engineering.

**Solution:** User-customisable prompts that evolve from feedback.

**Constitution** (from Spec Kit): Non-negotiable project rules that survive everything. Generated by `maina init`, stored in `.maina/constitution.md`. Injected as preamble into every AI call. Example: "All database queries go through the repository layer. No exceptions." "All error handling uses Result<T, E> pattern, never throw." The constitution doesn't evolve via A/B testing — it's stable project DNA.

**Custom prompts** in `.maina/prompts/`: Users drop markdown files that control AI behaviour per task. `review.md` tells the AI what to focus on during reviews. `tests.md` tells it how the team writes tests. `maina prompt edit review` opens it in `$EDITOR`.

**Prompt versioning:** Every prompt (default + custom) is hashed. Usage and accept rates tracked per version. When a user accepts or rejects AI output, the outcome is recorded against the prompt hash.

**Prompt evolution loop:**
```
Prompt v1 → AI output → Human accepts/rejects
                              ↓
                    Feedback stored with prompt hash
                              ↓
                    Every N interactions: `maina learn` analyses patterns
                              ↓
                    AI proposes improved prompt v2
                              ↓
                    Developer reviews diff, approves/modifies/rejects
                              ↓
                    A/B test: 80% v2, 20% v1
                              ↓
                    If v2 outperforms → promoted. Else → retired.
```

**[NEEDS CLARIFICATION] markers** (from Spec Kit): Every AI output uses `[NEEDS CLARIFICATION: specific question]` for ambiguous requirements. Never guesses.

### Engine 3: Verify Engine — Verifies

Deterministic tools find issues. AI generates fixes. Humans review. Feedback improves everything.

**Problem it solves:** AI-generated code ships with vulnerabilities, dead code, hallucinated imports, and copy-paste patterns that no linter catches. Manual code review can't keep pace with AI generation speed.

**Solution:** Hybrid verification pipeline with syntax guard.

```
Code change (diff)
    │
    ▼
Syntax Guard (Biome) ──── REJECT if invalid (< 500ms)
    │                      (from SWE-agent: prevent bad states)
    ▼
Deterministic Analysis ─── Run in parallel:
    │                      Biome (423+ rules)
    │                      Semgrep (2,000+ SAST rules + custom)
    │                      SonarQube CE (quality gates)
    │                      Secretlint (secrets)
    │                      Trivy (dependency CVEs)
    │                      diff-cover (coverage)
    │                      Stryker (mutation testing)
    │                      AI-SLOP-Detector
    │
    ▼
Diff-only filter ────────── Only findings on changed lines
    │                       (from Reviewdog: no pre-existing noise)
    ▼
AI Fix Layer ────────────── Context Engine provides surrounding code
    │                       Prompt Engine provides team-tuned prompts
    │                       Cache checks for identical findings
    │                       Generates contextual fix as diff
    │                       Validates fix compiles + tests pass
    ▼
Two-stage review ────────── Stage 1: Spec compliance (matches PLAN.md?)
    │                       Stage 2: Code quality (clean, tested, safe?)
    │                       (from Superpowers: split catches more)
    ▼
Feedback loop ───────────── Accept/reject → feedback.db → prompt evolves
```

**Single LLM call per command** (from PR-Agent): Every command makes at most one AI call. All intelligence goes into what context enters that call. Exception: PR review gets two calls (spec compliance + code quality).

---

## The cache

Same AI query should never happen twice.

```
Query → Hash(prompt_version + context_hash + model + input)
         │
         ├─ L1: In-memory LRU (same session) → instant
         ├─ L2: SQLite (cross-session) → < 10ms
         └─ L3: AI API call → cache result → return
```

Content-aware invalidation: cache key includes file content hashes. Change a file → key changes → fresh call. Don't change anything → instant cache hit.

| Task | TTL |
|------|-----|
| review, tests, fix | Forever (keyed by content hash) |
| context | 1 hour |
| explain | 24 hours |

---

## The workflow

### Phase 1 — Define

| Command | What it does | Context needs |
|---------|-------------|---------------|
| `maina ticket` | Creates GitHub Issue with module tags | Semantic (module structure) |
| `maina context` | Generates focused codebase context | All 4 layers (exploration mode) |
| `maina explain` | Mermaid diagrams + LLM summary | Semantic (dependency graph) |
| `maina design` | Scaffolds ADR — WHAT and WHY only | Semantic (existing ADRs) |
| `maina review design` | AI reviews design against ADRs + constitution | Semantic (ADRs + constitution) |

### Phase 2 — Build

| Command | What it does | Context needs |
|---------|-------------|---------------|
| `maina plan` | Creates branch, generates PLAN.md — HOW | Working + Semantic |
| `maina spec` | Generates TDD test stubs from PLAN.md | Working + Episodic (past test patterns) |
| `maina commit` | Syntax guard → parallel gates → git commit | Working only (fast) |

### Phase 3 — Verify

| Command | What it does | Context needs |
|---------|-------------|---------------|
| `maina pr` | Creates PR, two-stage AI review | All 4 layers |
| `maina verify` | Full verification pipeline, diff-only by default | Working + Semantic |
| `maina analyze` | Cross-artifact consistency: spec ↔ plan ↔ tasks ↔ code | Semantic (all artifacts) |

### Meta

| Command | What it does |
|---------|-------------|
| `maina learn` | Analyses feedback, proposes prompt improvements, manages A/B tests |
| `maina prompt edit <task>` | Opens custom prompt in `$EDITOR` |
| `maina context add <file>` | Adds file to semantic context layer |
| `maina cache stats` | Cache hit rate, tokens saved, cost saved |
| `maina doctor` | Shows installed tools, engine health |
| `maina init` | Bootstraps Maina in any repo |

---

## Features — organised per feature

### Feature: Constitution

**Source:** GitHub Spec Kit's immutable project principles.

`maina init` generates `.maina/constitution.md` — the non-negotiable rules for this project. Injected as preamble into every AI call. Not subject to A/B testing — this is stable DNA.

```markdown
# Project Constitution

## Stack
- Runtime: Bun
- Language: TypeScript strict
- Lint/Format: Biome 2.x (NOT ESLint/Prettier)
- Test: bun:test (NOT Jest)
- Error handling: Result<T, E> pattern. Never throw.

## Architecture
- All DB access through repository layer
- API responses: { data, error, meta } envelope
- Feature modules are self-contained packages

## Verification
- All commits pass: biome check + tsc --noEmit + bun test
- PR reviews require spec compliance before code quality
- Mutation testing score > 80% on changed code
- No console.log in production code
```

### Feature: Structured features directory

**Source:** Spec Kit's automatic feature numbering + branch creation.

```
.maina/features/
├── 001-add-auth/
│   ├── spec.md       # WHAT and WHY (technology-agnostic)
│   ├── plan.md       # HOW (technical implementation)
│   └── tasks.md      # Task breakdown
├── 002-payment-flow/
│   ├── spec.md
│   ├── plan.md
│   └── tasks.md
```

`maina plan` scans existing features, auto-numbers the next one, creates the branch, and scaffolds the directory. The Context Engine's episodic layer indexes these per-feature, building structured history.

### Feature: Lifecycle hooks

**Source:** Claude Code's hooks system.

`.maina/hooks/` — shell scripts that execute at lifecycle boundaries. Exit code 2 blocks the action.

```
.maina/hooks/
├── pre-commit.sh       # Before gates
├── post-commit.sh      # After commit
├── pre-verify.sh       # Before verification
├── post-verify.sh      # After verification
├── pre-review.sh       # Before AI review
└── post-learn.sh       # After prompt evolution
```

Receives JSON on stdin with event context. Enables custom integrations without a plugin API.

### Feature: AGENTS.md

**Source:** GitHub convention (60,000+ repos).

`maina init` generates AGENTS.md — the universal instruction file that any AI agent understands. Works in Claude Code, Cursor, Codex, Gemini CLI. Contains team's verification requirements, conventions, and context pointers. Read automatically by Maina's Context Engine as part of the semantic layer.

### Feature: Maina as Skills

**Source:** Superpowers' skills framework.

Maina ships a skills package alongside the CLI:

```
packages/skills/
├── verification-workflow/SKILL.md
├── context-generation/SKILL.md
├── plan-writing/SKILL.md
├── code-review/SKILL.md
└── tdd/SKILL.md
```

Skills use progressive disclosure (~100 tokens for scanning, <5k when activated). They work cross-platform: Claude Code, Cursor, Codex, Gemini CLI. **Maina works even without the CLI installed** — an AI agent with just the skills follows the verification workflow.

The CLI is the automation layer. Skills are the knowledge layer. Both use the same three engines.

### Feature: MCP server

One server. Every IDE. No plugins.

```json
{ "mcpServers": { "maina": { "command": "maina", "args": ["--mcp"] } } }
```

Tools: `getContext`, `getConventions`, `getTicket`, `getVerification`, `suggestTests`, `checkSlop`, `generateFix`, `getPlan`, `getPrompt`, `runSemgrep`. Each delegates to the appropriate engine. All respect the cache.

### Feature: BYOM with model tiers

**Source:** Superpowers + PR-Agent model role separation.

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

Free tier works with zero API keys (deterministic verification only) or Ollama.

---

## Tech stack

TypeScript only. Bun-native. Modern tools.

| Component | Tool | Why |
|-----------|------|-----|
| Runtime | Bun | Fast, batteries-included, native SQLite |
| CLI | Commander 13 + @clack/prompts | Industry standard + beautiful terminal UI |
| Lint/Format | Biome 2.x | Single tool, 423+ rules, fast |
| Tests | bun:test + fast-check | Native + property testing |
| Build | bunup | Bun-native bundler |
| AI | Vercel AI SDK v6 + OpenRouter | 300+ models, unified interface |
| Database | bun:sqlite + Drizzle ORM | Zero-dep, embedded, type-safe |
| AST | web-tree-sitter | 130+ languages, WASM |
| Code search | Zoekt | Google's code search (optional) |
| Git hooks | lefthook | Fast, parallel |
| Commits | commitlint | Conventional commits |
| HTTP | Hono | Fast, lightweight (if needed) |
| Distribution | npm + `bun build --compile` + Homebrew | Universal |

---

## Project structure

```
maina/
├── packages/
│   ├── cli/src/
│   │   ├── commands/           # Thin wrappers over engines
│   │   ├── ui/                 # @clack/prompts terminal UI
│   │   └── index.ts            # Commander entrypoint
│   │
│   ├── core/src/
│   │   ├── context/            # CONTEXT ENGINE
│   │   │   ├── engine.ts       # Orchestrator
│   │   │   ├── working.ts      # Layer 1
│   │   │   ├── episodic.ts     # Layer 2 (Ebbinghaus decay)
│   │   │   ├── semantic.ts     # Layer 3
│   │   │   ├── retrieval.ts    # Layer 4
│   │   │   ├── relevance.ts    # PageRank scorer
│   │   │   ├── selector.ts     # Per-command context needs
│   │   │   ├── budget.ts       # Dynamic token budget
│   │   │   └── treesitter.ts   # AST parsing
│   │   │
│   │   ├── prompts/            # PROMPT ENGINE
│   │   │   ├── engine.ts       # Resolution + injection
│   │   │   ├── defaults/       # Built-in prompts per task
│   │   │   ├── evolution.ts    # A/B testing + versions
│   │   │   ├── learn.ts        # Feedback → improvement
│   │   │   └── loader.ts       # Loads .maina/prompts/ + constitution
│   │   │
│   │   ├── verify/             # VERIFY ENGINE
│   │   │   ├── pipeline.ts     # Parallel runner
│   │   │   ├── syntax-guard.ts # Pre-gate Biome check
│   │   │   ├── diff-filter.ts  # Changed-lines-only filtering
│   │   │   ├── review.ts       # Two-stage: spec then quality
│   │   │   ├── semgrep.ts
│   │   │   ├── sonar.ts
│   │   │   ├── trivy.ts
│   │   │   ├── secretlint.ts
│   │   │   ├── slop.ts
│   │   │   ├── coverage.ts
│   │   │   ├── mutation.ts
│   │   │   └── fix.ts          # AI fix with cache
│   │   │
│   │   ├── features/           # Feature directory management
│   │   │   ├── numbering.ts    # Auto-increment 001, 002...
│   │   │   ├── analyzer.ts     # Cross-artifact consistency
│   │   │   └── checklist.ts    # Deterministic plan verification
│   │   │
│   │   ├── hooks/runner.ts     # Lifecycle hook executor
│   │   ├── cache/              # 3-layer cache (LRU → SQLite → API)
│   │   ├── ai/                 # Vercel AI SDK wrapper + model tiers
│   │   ├── feedback/           # RL feedback collection
│   │   ├── git/                # Git operations (Bun.spawn)
│   │   └── db/                 # Drizzle schemas
│   │
│   ├── mcp/src/                # MCP server
│   │   ├── server.ts
│   │   └── tools/
│   │
│   └── skills/                 # Claude Code / Cursor skills
│       ├── verification-workflow/SKILL.md
│       ├── context-generation/SKILL.md
│       ├── plan-writing/SKILL.md
│       ├── code-review/SKILL.md
│       └── tdd/SKILL.md
│
├── rules/                      # Custom Semgrep rules
├── docs/                       # Docusaurus
├── adr/                        # Architecture Decision Records
├── AGENTS.md                   # Cross-tool agent instructions
│
└── .maina/                     # Per-repo state (gitignored)
    ├── constitution.md         # Project DNA
    ├── context/                # 4-layer context storage
    ├── features/               # Per-feature spec/plan/tasks
    ├── prompts/                # Custom prompts
    ├── hooks/                  # Lifecycle scripts
    ├── cache/cache.db          # Response cache
    ├── feedback.db             # RL feedback
    └── preferences.json        # Learned thresholds
```

---

## Implementation plan

### Sprint 0 — Skeleton (Week 1)
Bun monorepo, Biome, lefthook, commitlint, Commander, `maina --version`.

### Sprint 1 — Context Engine (Weeks 2-3)
The brain. tree-sitter AST, PageRank relevance, 4-layer system, dynamic budget, Ebbinghaus decay. `maina context` generates focused output. `maina context add`. `maina context show`.

### Sprint 2 — Cache + Prompt Engine (Weeks 3-4)
3-layer cache. Vercel AI SDK integration. Constitution loader. Custom prompt loader. Prompt versioning. `maina prompt edit`. `maina cache stats`.

### Sprint 3 — Verify Engine + `maina commit` (Weeks 4-5)
Syntax guard. Tool auto-detection. Parallel pipeline. Diff-only filtering. Slop detector. AI fix generation. Hooks runner. `maina commit`. `maina verify`. `maina doctor`.

### Sprint 4 — `maina plan` + `maina spec` (Weeks 5-6)
Feature numbering. Structured features directory. Plan verification checklist. TDD test stub generation. WHAT/WHY vs HOW separation enforcement.

### Sprint 5 — Define commands (Weeks 6-7)
`maina ticket`, `maina design`, `maina explain`, `maina review design`, `maina analyze`.

### Sprint 6 — `maina pr` + `maina init` (Weeks 7-8)
Two-stage PR review. `maina init` bootstraps everything: `.maina/`, constitution, AGENTS.md, default prompts, lefthook hooks, CI workflow.

### Sprint 7 — MCP server (Weeks 8-9)
All MCP tools delegate to engines. Cache-aware. Progressive disclosure for context.

### Sprint 8 — RL feedback loop + `maina learn` (Weeks 9-10)
Full feedback collection. Prompt evolution. A/B testing. Episodic compression of accepted reviews as few-shot examples.

### Sprint 9 — Skills + publish (Week 10)
Skills package. npm publish. `bun build --compile` binaries. Homebrew. Docusaurus docs.

### Sprint 10 — Launch
Show HN. GitHub Discussions. CONTRIBUTING.md. Post-launch iteration.

### Dogfooding rule
From Sprint 3 onward, every commit to Maina goes through `maina commit`. If a gate is noisy, fix the gate, don't skip it.

---

## GTM

### v1 — Open source (Apache 2.0)
Everything free. `bunx maina` to try. Three engines fully functional locally.

### v2 — Maina Cloud
Team RL sync (shared prompts + feedback via Turso), hosted verification, usage dashboard, SSO.

### v3 — Maina Enterprise
On-premise, air-gapped, audit logging, custom model fine-tuning, SOC 2.

---

## CLAUDE.md

```markdown
# Maina

Verification-first developer OS. Three engines: Context, Prompt, Verify.

Read PRODUCT_SPEC.md for full product context.

## Stack
- Runtime: Bun (NOT Node.js)
- Lint/Format: Biome 2.x (NOT ESLint/Prettier)
- Test: bun:test (NOT Jest/Vitest)
- Build: bunup
- CLI: Commander 13 + @clack/prompts
- AI: Vercel AI SDK v6
- DB: bun:sqlite + Drizzle ORM
- AST: web-tree-sitter
- Hooks: lefthook + commitlint

## Architecture
- Context Engine: 4 layers (Working → Episodic → Semantic → Retrieval)
  - PageRank for relevance, Ebbinghaus decay for episodic memory
  - Dynamic budget: 60% default, 80% explore, 40% focused
  - Each command declares its context needs via selector
- Prompt Engine: Constitution + custom prompts + versioned evolution + A/B testing
- Verify Engine: Syntax guard → parallel deterministic tools → diff-only filter → AI fix → two-stage review
- Cache: L1 memory LRU → L2 SQLite → L3 API call

## Principles
- TDD: write tests before implementation, always
- Single LLM call per command (exception: PR review gets two)
- Syntax guard rejects before other gates run
- Constitution is stable project DNA, not subject to A/B testing
- Custom prompts evolve from feedback
- Cache everything: same query never hits AI twice
- Diff-only: only report findings on changed lines
- WHAT/WHY in spec.md, HOW in plan.md — never mixed
- [NEEDS CLARIFICATION] markers for ambiguity — never guess
- Conventional commits: scopes are cli, core, mcp, skills, docs, ci
- Every AI output records feedback for the prompt evolution loop
```

---

## What Maina is not

Not an IDE. Not a code generator. Not a CI/CD platform. Not a chatbot. Not vendor-locked. Not a replacement for thinking.

---

## The name

**Maina** — named after the mynah bird. Observes its environment. Learns from what it hears. Communicates with precision.

Context Engine observes. Prompt Engine learns. Verify Engine verifies.

**"Observe. Learn. Verify."**

---

## Intellectual sources

| Pattern | Source | How Maina uses it |
|---------|--------|-------------------|
| PageRank for code relevance | Aider | Context Engine Layer 3 |
| Dynamic token budget | Aider | Expand/contract based on task |
| Single LLM call per command | PR-Agent | Every command except PR review |
| Prompt templates in TOML/MD | PR-Agent | `.maina/prompts/` |
| Linter-on-edit guardrail | SWE-agent | Syntax guard before gates |
| Lifecycle hooks | Claude Code | `.maina/hooks/` |
| AGENTS.md convention | GitHub (60k+ repos) | Generated by `maina init` |
| Diff-only filtering | Reviewdog | Verify Engine default |
| Two-stage review | Superpowers | Spec compliance → code quality |
| Plan verification checklist | Superpowers | Deterministic self-check |
| Model role tiers | Superpowers + PR-Agent | mechanical/standard/architectural/local |
| Skills as knowledge layer | Superpowers | `packages/skills/` |
| Constitution as project DNA | Spec Kit | `.maina/constitution.md` |
| WHAT/WHY vs HOW separation | Spec Kit | spec.md vs plan.md |
| [NEEDS CLARIFICATION] markers | Spec Kit | All AI outputs |
| Cross-artifact consistency | Spec Kit `/analyze` | `maina analyze` |
| Feature numbering + branches | Spec Kit `/specify` | `.maina/features/001-name/` |
| Community extensions | Spec Kit `catalog.community.json` | v2: `.maina/extensions/` |
| Layered memory with decay | Instar | Context Engine 4 layers |
| Filesystem as agent state | Claude Code + Instar + Aider | All state in `.maina/` + repo |
| Scaffold simplicity | mini-swe-agent | Keep engines simple, models improve |
| Sandboxed execution interface | OpenHands + Open SWE | v2: pluggable sandbox backend |
