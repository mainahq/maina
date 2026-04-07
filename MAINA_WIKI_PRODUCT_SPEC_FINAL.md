# PRODUCT SPEC: Maina Wiki — Codebase Knowledge Compiler
## v1.2.0 Feature Specification (Consolidated)

**Author:** Bikash Dash
**Date:** April 2026
**Status:** Final Draft
**GitHub Issue:** TBD

---

## 0. First Principles

### What problem does the developer have?

Every AI coding tool rebuilds codebase understanding from scratch every session. There's no persistent, compounding knowledge layer. When a new developer joins, or you return to a module after months, you start from zero. Institutional knowledge lives in heads, scattered Notion docs, and stale READMEs.

### What already exists in Maina that nearly solves this?

More than people realize. The Context Engine has tree-sitter AST parsing, PageRank dependency graphs, compressed PR summaries with Ebbinghaus decay, and Zoekt code search. The Prompt Engine has RL feedback loops and A/B testing. The Verify Engine runs 18+ parallel tools. The Cloud syncs prompts, feedback, and episodic entries across teams. And critically — Maina already generates structured lifecycle artifacts: plans, specs, tasks, ADRs, and workflow traces.

### What's the smallest thing we can build?

A compilation step that takes ALL Maina's outputs (code analysis + lifecycle artifacts) and produces persistent, interlinked markdown articles — plus a linting step that keeps them healthy. Everything else layers on top.

### The Four Delta Rules

**Δ1 (max value, min effort):** 80% reuses existing infrastructure. ~3,000 LOC new code total.

**Δ2 (compounds):** Every commit, every plan, every design decision auto-enriches the wiki. After 3 months, a team's wiki has more institutional knowledge than any manual docs effort.

**Δ3 (defensibility):** The compounding knowledge graph is the moat. Nobody can copy 6 months of interlinked team-specific codebase knowledge.

**Δ4 (revenue):** Solo wiki free (adoption) → team sync paid (conversion) → enterprise analytics paid (expansion).

---

## 1. Core Concept: Wiki Is a Layer, Not a Feature

Wiki is not a set of new commands. It's a new layer in all three engines.

| Engine | Without Wiki | With Wiki |
|---|---|---|
| **Context** | 4 layers: Working, Episodic, Semantic, Retrieval | 5 layers: + Wiki (persistent, compiled, interlinked) |
| **Prompt** | Prompts evolve from accept/reject | + wiki article effectiveness + compilation prompt quality |
| **Verify** | 18+ code verification tools | + wiki lint (staleness, gaps, orphans, spec drift, decision violations) |

Wiki participates in every workflow phase as both READER and WRITER. Wiki creates three new RL feedback signals. Wiki gives the autonomous actions persistent memory.

---

## 2. Six Raw Source Types

Maina generates six source types. The wiki compiler ingests ALL of them.

| Source | Location | What It Captures | Wiki Output |
|---|---|---|---|
| **Code** | `src/**/*.ts` etc. | What exists (functions, classes, types) | `wiki/entities/`, `wiki/modules/` |
| **Plans** | `.maina/features/*/plan.md` | Why features exist, scope, approach | `wiki/features/` |
| **Specs** | `.maina/features/*/spec.md` | Testing contract, acceptance criteria | Links from entity articles |
| **Tasks** | `.maina/features/*/tasks.md` | Work breakdown, dependencies | Links from feature articles |
| **ADRs** | `adr/*.md` | Architecture decisions, alternatives rejected | `wiki/decisions/` |
| **Workflow traces** | `.maina/workflow/` | How steps connected, what informed what | `wiki/architecture/` |

This creates 11 relationship types in the knowledge graph — 5 from code (calls, imports, inherits, references, member_of) plus 6 from lifecycle artifacts (modified_by, specified_by, decided_by, motivated_by, constrains, aligns_with).

---

## 3. CLI vs Cloud Split

Follow the existing pattern exactly:

| Capability | Existing Pattern | Wiki Equivalent |
|---|---|---|
| Local work | `maina verify` (free) | `maina wiki compile` (free) |
| Cloud work | `maina verify --cloud` (paid) | `maina wiki compile --cloud` (paid) |
| Local storage | `.maina/prompts/` (free) | `.maina/wiki/` (free) |
| Team sync | `maina sync push/pull` (paid) | `maina wiki sync` (paid) |
| Local learning | RL loop (free) | Wiki quality signals (free) |
| Team learning | `maina learn --cloud` (paid) | Wiki analytics (paid) |

**Rule:** Developer working alone = free and local. Team sharing = Cloud paid. Enterprise controls = Enterprise tier.

### CLI (free, Apache 2.0)

- `maina wiki init` — scaffold, first full compilation from all 6 sources
- `maina wiki compile` — incremental recompilation
- `maina wiki query <question>` — synthesize from wiki, `--save` to file back
- `maina wiki lint` — health checks including spec drift and decision violations
- `maina wiki status` — coverage and health dashboard
- `maina wiki ingest <source>` — add external sources
- Wiki as Context Engine Layer 5
- MCP tools: `wikiQuery`, `wikiStatus`

### Cloud (paid)

- `maina wiki sync push/pull` — team wiki sharing
- `maina wiki compile --cloud` — hosted compilation
- `maina wiki browse` — graph visualization at app.mainahq.com
- Team analytics: coverage heatmap, query patterns, onboarding score, knowledge retention

### Enterprise (v2.0)

- Wiki access controls per module
- Knowledge retention reports (what's lost when someone leaves)
- Compliance wiki generation (SOC 2, ISO 27001 evidence)
- Custom compilation models fine-tuned on team's codebase
- Self-hosted wiki server for air-gapped environments

---

## 4. Architecture

### Where wiki sits in the three engines

```
┌────────────────────────────────────────────────────────┐
│                    maina CLI                            │
│                                                        │
│  ┌──────────────┐  ┌───────────┐  ┌─────────────────┐  │
│  │  Context      │  │  Prompt   │  │  Verify         │  │
│  │  Engine       │  │  Engine   │  │  Engine          │  │
│  │               │  │           │  │                  │  │
│  │  L1 Working   │  │ Constit.  │  │ 18+ tools       │  │
│  │  L2 Episodic  │  │ Custom    │  │ in parallel     │  │
│  │  L3 Semantic  │  │ prompts   │  │                  │  │
│  │  L4 Retrieval │  │ RL loop   │  │ + Wiki lint     │  │
│  │  L5 Wiki ◄────┤  │ + Compile │  │   (staleness,   │  │
│  │    (NEW)      │  │   prompts │  │    spec drift,   │  │
│  └───────────────┘  └───────────┘  │    decision      │  │
│         │                          │    violations)    │  │
│         ▼                          └─────────────────┘  │
│  ┌──────────────────────────────────────────────────┐   │
│  │     Wiki Compiler (ALL 6 sources)                │   │
│  │                                                  │   │
│  │  Code (tree-sitter) ──┐                          │   │
│  │  Plans ───────────────┤                          │   │
│  │  Specs ───────────────┼──→ Knowledge ──→ wiki/   │   │
│  │  Tasks ───────────────┤    Graph           │     │   │
│  │  ADRs ────────────────┤    (11 edge       ▼     │   │
│  │  Workflow traces ─────┘     types)    index.md   │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### Directory structure

```
.maina/
  constitution.md              # existing
  prompts/
    compile-module.md          # NEW — compilation prompt
    compile-entity.md          # NEW
    compile-feature.md         # NEW
    compile-decision.md        # NEW
    compile-architecture.md    # NEW
    wiki-query.md              # NEW
  features/                    # existing (raw source for wiki)
    001-token-refresh/
      plan.md
      spec.md
      tasks.md
  workflow/                    # existing (raw source for wiki)
    current.md
  wiki/                        # NEW — compiled output
    schema.md                  # compilation rules (co-evolves)
    index.md                   # auto-maintained catalog
    log.md                     # append-only compilation log
    modules/                   # from code (tree-sitter + Louvain)
    entities/                  # from code (high PageRank)
    features/                  # from .maina/features/*/
    decisions/                 # from adr/
    architecture/              # from workflow traces + patterns
    raw/                       # manually ingested external sources
    .state.json                # SHA hashes, timestamps (gitignored)
adr/                           # existing (raw source for wiki)
```

### Compilation pipeline (all 6 sources)

```
Step 1: Extract from ALL sources
  1a. tree-sitter → code entities
  1b. Parse .maina/features/*/plan.md → feature records
  1c. Parse .maina/features/*/spec.md → spec contracts
  1d. Parse .maina/features/*/tasks.md → task breakdowns
  1e. Parse adr/*.md → decision records
  1f. Parse .maina/workflow/ → workflow traces

Step 2: Build unified knowledge graph
  2a. PageRank on code dependency graph
  2b. Louvain community detection → module boundaries
  2c. Feature → entity links (via git blame)
  2d. Decision → entity links (via ADR mentions)
  2e. Spec → entity links (via function references)
  2f. Workflow → feature links (via branch names)

Step 3: LLM compilation
  3a. Module articles from entities (mechanical model tier)
  3b. Entity articles enriched with features + specs + decisions
  3c. Feature articles from plans + specs + tasks
  3d. Decision articles from ADRs + affected entities
  3e. Architecture articles from workflow traces + patterns

Step 4: Cross-type linking
  4a. Code backlinks from dependency graph
  4b. Feature → entity links
  4c. Decision → entity links
  4d. Spec → entity links
  4e. Architecture → module links

Step 5: Index generation (grouped by source type)

Step 6: Lint (including lifecycle-aware checks)
```

### Incremental compilation

Full compilation runs once (`maina wiki init`). After that, incremental:

1. `git diff` identifies changed files since last compile
2. SHA-256 compared to `.state.json`
3. Changed entities + changed lifecycle artifacts identified
4. Dependency graph traversed to find affected wiki articles
5. Only affected articles recompiled
6. Backlinks recalculated for affected subgraph
7. Index updated

Typical commit touching 3-5 files: 5-15 seconds. Full init on medium codebase (~500 files): 2-5 minutes.

---

## 5. Wiki Integration Per Workflow Phase

### Brainstorm Phase

| Command | Wiki Reads | Wiki Writes |
|---|---|---|
| `maina brainstorm` | Architecture + decision articles for grounding | Candidate architecture article (filed if plan created) |

### Define Phase

| Command | Wiki Reads | Wiki Writes |
|---|---|---|
| `maina ticket` | Module articles for auto-tagging | — |
| `maina context` | Wiki as L5 in exploration mode | — |
| `maina explain` | Wiki articles as primary source | `--save` files answer back as article |
| `maina design` | Decision articles for conflict detection | Auto-files new decision article |
| `maina review-design` | Decision articles + constitution | Appends review outcome to decision article |

### Build Phase

| Command | Wiki Reads | Wiki Writes |
|---|---|---|
| `maina plan` | Module articles inform planning | Feature directory created → wiki indexes |
| `maina spec` | Wiki patterns inform test generation | Spec links to entity articles |
| `maina commit` | Wiki context for commit message | **Triggers incremental compilation** |

### Verify Phase

| Command | Wiki Reads | Wiki Writes |
|---|---|---|
| `maina verify` | Architecture context for AI review | Wiki lint runs alongside 18+ tools |
| `maina verify --deep` | Decision articles for spec compliance | Findings become candidate wiki updates |
| `maina slop` | Wiki patterns reduce false positives | — |
| `maina review` | Two-stage review uses decisions + patterns | Review outcomes update article freshness |
| `maina analyze` | Cross-artifact consistency includes wiki | Findings trigger article updates |
| `maina pr` | — | PR body includes wiki coverage delta |

### Cloud Phase

| Command | Wiki Reads | Wiki Writes |
|---|---|---|
| `maina verify --cloud` | Cloud pipeline includes wiki context | Cloud results update wiki freshness |
| `maina wiki sync` | — | Articles synced across team |
| `maina learn --cloud` | — | Team-wide wiki quality aggregated |

### Meta Phase

| Command | Wiki Reads | Wiki Writes |
|---|---|---|
| `maina learn` | Per-step wiki effectiveness analysis | Proposes compilation prompt improvements |
| `maina stats` | Wiki coverage trend, query count | — |
| `maina doctor` | Wiki health alongside tool health | — |

---

## 6. Workflow Context Forwarding

Every step records `wiki_refs`:

```typescript
interface WorkflowStep {
  command: string;
  // existing fields...
  wikiRefsRead: string[];    // article paths loaded as context
  wikiRefsWritten: string[]; // articles created/updated
}
```

This creates an audit trail: `maina learn` traces from a successful PR back to which wiki articles informed each step and reinforces them.

---

## 7. Three New RL Feedback Signals

### Signal 1: Wiki-as-context effectiveness

Track whether wiki articles improve command outcomes.

```
For each command:
  Record: wiki articles loaded (by hash) + accept/reject
  Aggregate: accept_rate(with article X) vs accept_rate(without)
  Action: flag articles with negative effectiveness for recompilation
```

### Signal 2: Compilation prompt quality

Track transitive quality of compilation prompts.

```
compile-module.md v3 → generated wiki/modules/auth.md
  → auth.md loaded as context for 15 commands → 12 accepted
  → compile-module.md v3 indirect accept rate: 80%
```

Compilation prompts go through the same A/B testing as all other prompts. They're just template files in `.maina/prompts/`.

### Signal 3: Reference frequency → Ebbinghaus decay

Type-specific decay rates:

| Article Type | Decay Half-Life | Rationale |
|---|---|---|
| Decision | 180 days | Decisions are long-lived |
| Module | 120 days | Module structure is semi-stable |
| Entity | 90 days | Default |
| Feature | 60 days | Features are events, not structures |
| Architecture | 150 days | Cross-cutting concerns are durable |

Articles with Ebbinghaus score < 0.2 excluded from default context loading. Still searchable via `maina wiki query`.

---

## 8. Autonomous Actions Integration

### workflow-action (Issue → PR)

```
WITHOUT wiki: Agent reads code → writes implementation → verifies
WITH wiki:    Agent reads code + features + decisions + specs
                → understands WHY the module is structured this way
                → avoids contradicting existing decisions
                → follows established spec patterns
                → produces implementation consistent with history
```

Every automated PR enriches the wiki. The agent gets smarter with every run.

### self-improve-action (daily cron)

Now optimizes three surfaces:
1. Prompts (existing)
2. Wiki article quality (new — recompile ineffective articles)
3. Compilation prompt quality (new — A/B test compilation variants)

---

## 9. Wiki Lint Specification

Added to Verify Engine pipeline. Runs on `maina verify` and `maina wiki lint`.

| Check | Severity | Source |
|---|---|---|
| Stale article | warning | Code changed since article last compiled |
| Missing article | info | High-PageRank entity (top 20%) without article |
| Orphan article | warning | Article references deleted entity |
| Broken link | error | `[[entity:X]]` points to nothing |
| Contradiction | warning | Wiki claims vs actual code (AST-verified) |
| Coverage gap | info | Public API without wiki documentation |
| **Spec drift** | warning | Spec says `Result<T,E>`, code throws exceptions |
| **Decision violation** | warning | ADR says JWT, code uses sessions |
| **Missing rationale** | info | High-PageRank entity changed in 3+ features, no decision |

Coverage formula: `documented_entities / total_high_pagerank_entities × 100`. Target: 80% of top-20%.

---

## 10. Context Window Strategy

| Codebase Size | Wiki Size | Strategy |
|---|---|---|
| Small (< 100 files) | 5K-20K words | Full wiki in context |
| Medium (100-1000 files) | 20K-100K words | Index + relevant articles |
| Large (1000-5000 files) | 100K-400K words | Selective loading |
| Monorepo (5000+ files) | 400K+ words | Chunked retrieval via Zoekt |

Token budget with wiki (L5 = 12%, headroom stays at 40%):

| Layer | Budget |
|---|---|
| Working | ~12% |
| Episodic | ~12% |
| Semantic | ~16% |
| Retrieval | ~8% |
| Wiki (L5) | ~12% |
| Headroom | ~40% |

---

## 11. New Commands Summary

| Command | Engine | Free/Cloud |
|---|---|---|
| `maina wiki init` | Context + LLM | Free |
| `maina wiki compile` | Context + LLM | Free |
| `maina wiki compile --cloud` | Cloud API | Cloud |
| `maina wiki query <question>` | Context (L5) + LLM | Free |
| `maina wiki query --save` | Context (L5) + LLM | Free |
| `maina wiki lint` | Verify | Free |
| `maina wiki status` | Context | Free |
| `maina wiki ingest <source>` | LLM | Free |
| `maina wiki sync push/pull` | Cloud API | Cloud |
| `maina wiki browse` | Cloud UI | Cloud |

**New MCP tools:** `wikiQuery`, `wikiStatus` (total: 10)
**New skill:** `wiki-workflow/SKILL.md` (total: 6)
**New prompt templates:** 6 (`compile-module`, `compile-entity`, `compile-feature`, `compile-decision`, `compile-architecture`, `wiki-query`)
**Total CLI commands:** 38+ (up from 28+)

---

## 12. Success Metrics

| Metric | Target (6 months) |
|---|---|
| Wiki adoption | 40% of active users run `wiki init` |
| Compounding rate | 5+ articles/week per active repo |
| Coverage | Median 60% of top-20% PageRank entities |
| Lifecycle coverage | 80% of features have feature articles |
| Decision coverage | 90% of ADRs compiled into wiki |
| Conversion | 15% upgrade to Cloud for team sync |
| Retention | Wiki users have 2x 90-day retention |

---

## 13. Open Questions

1. **Auto-compile on commit?** Yes, via post-commit hook. `--no-wiki` to skip.
2. **Wiki committed to repo?** Yes. `.maina/wiki/` in version control. `.state.json` gitignored.
3. **Default compilation model?** `mechanical` tier (cheapest). Queries use `standard`.
4. **Wiki replace or supplement `maina explain`?** Supplement. Explain draws from wiki, `--save` files back.
5. **Max wiki before chunked retrieval?** 200K tokens. Below = full index + relevant articles. Above = Zoekt.

---

## 14. The Pitch Line

Every other AI coding tool sees your code. Maina sees your code AND why it was built that way — every plan, every decision, every spec, every rejected alternative. The wiki compounds this knowledge automatically. After 6 months, Maina knows your project's history better than any individual engineer.
