# IMPLEMENTATION PLAN: Maina Wiki — Codebase Knowledge Compiler
## Senior Architect Specification (Consolidated)

**Architect:** Bikash Dash
**Date:** April 2026
**Method:** Dogfood Maina workflow E2E. Every ticket: brainstorm → plan → design → spec → implement → verify → review → commit → PR.
**Infrastructure:** Workkit libraries for all cloud wiki services.
**RL policy:** Record feedback on every verify, review, and commit. `maina learn` at end of each sprint. Self-improve-action from Sprint 9.

---

## Package Architecture

Wiki is cross-cutting, not a new package.

```
packages/
  core/
    src/
      context/
        layers/
          working.ts              # existing L1
          episodic.ts             # existing L2
          semantic.ts             # existing L3
          retrieval.ts            # existing L4
          wiki.ts                 # NEW L5
        budget.ts                 # MODIFY — add wiki allocation
      wiki/
        types.ts                  # WikiArticle, WikiState, WikiIndex
        state.ts                  # .state.json management
        schema.ts                 # schema.md co-evolution
        compiler.ts               # full compilation orchestrator
        compiler-incremental.ts   # SHA-256 diff-based incremental
        linker.ts                 # backlink generation
        indexer.ts                # index.md generation
        extractors/
          code.ts                 # tree-sitter entities (adapts semantic layer)
          feature.ts              # .maina/features/*/plan+spec+tasks
          decision.ts             # adr/*.md
          workflow.ts             # .maina/workflow/
        graph.ts                  # unified knowledge graph (11 edge types)
        louvain.ts                # community detection for modules
      verify/
        tools/
          wiki-lint.ts            # staleness, gaps, spec drift, decision violations
      prompt/
        templates/
          compile-module.md       # module article prompt
          compile-entity.md       # entity article prompt
          compile-feature.md      # feature article prompt
          compile-decision.md     # decision article prompt
          compile-architecture.md # architecture article prompt
          wiki-query.md           # query synthesis prompt
  cli/
    src/
      commands/
        wiki/
          init.ts
          compile.ts
          query.ts
          lint.ts
          status.ts
          ingest.ts
          sync.ts
  mcp/
    src/
      tools/
        wiki-query.ts
        wiki-status.ts
  skills/
    wiki-workflow/
      SKILL.md
  cloud/
    src/
      routes/
        wiki.ts                   # sync API (@workkit/api)
        wiki-compile.ts           # hosted compilation (@workkit/queue)
      workers/
        wiki-compiler.worker.ts   # async compilation consumer
```

### Workkit Package Mapping

| Cloud Feature | Workkit Package | Usage |
|---|---|---|
| Article storage | `@workkit/d1` | Articles table with content hash dedup |
| Large article blobs | `@workkit/r2` | Articles > 64KB |
| Content-hash cache | `@workkit/kv` + `@workkit/cache` | SWR cache, skip unchanged uploads |
| Compilation queue | `@workkit/queue` | Async hosted compilation |
| Compilation coordination | `@workkit/do` | Durable Object prevents concurrent compiles per repo |
| Auth | `@workkit/auth` | Same OAuth as `maina login` |
| Rate limiting | `@workkit/ratelimit` | Per-team limits on sync + compile |
| Analytics API | `@workkit/api` | Coverage, staleness, query patterns |
| Logging | `@workkit/logger` | All wiki operations |
| Testing | `@workkit/testing` | Miniflare-based integration tests |
| Config | `@workkit/env` | WIKI_COMPILATION_MODEL, WIKI_MAX_ARTICLE_SIZE |

---

## Sprint 0: Types, State, Extractors (Week 1, Days 1-3)

### GitHub Issue
```
Title: [wiki] Foundation: types, state, extractors for all 6 source types
Labels: wiki, foundation, sprint-0
```

### Tickets

**0.1 — Core types** (`packages/core/src/wiki/types.ts`)

```typescript
interface WikiArticle {
  path: string;                       // "modules/auth.md"
  type: 'module' | 'entity' | 'feature' | 'decision' | 'architecture' | 'raw';
  title: string;
  content: string;
  contentHash: string;                // SHA-256
  sourceHashes: string[];             // SHA-256 of sources that generated this
  backlinks: WikiLink[];
  forwardLinks: WikiLink[];
  pageRank: number;
  lastCompiled: string;
  referenceCount: number;             // RL Signal 3
  ebbinghausScore: number;            // type-specific decay
}

interface WikiLink {
  target: string;
  type: 'calls' | 'imports' | 'inherits' | 'references' | 'member_of'
      | 'modified_by' | 'specified_by' | 'decided_by' | 'motivated_by'
      | 'constrains' | 'aligns_with';
  weight: number;
}

interface ExtractedFeature {
  id: string;                         // "001-token-refresh"
  title: string;
  scope: string;                      // from plan.md
  specQualityScore: number;           // from spec.md
  specAssertions: string[];
  tasks: TaskItem[];
  entitiesModified: string[];         // from git blame
  decisionsCreated: string[];
  branch: string;
  prNumber: number | null;
  merged: boolean;
}

interface ExtractedDecision {
  id: string;                         // "002-jwt-strategy"
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  context: string;
  decision: string;
  rationale: string;
  alternativesRejected: string[];
  entityMentions: string[];
  constitutionAlignment: string[];
}

interface ExtractedWorkflowTrace {
  featureId: string;
  steps: WorkflowStep[];
  wikiRefsRead: string[];
  wikiRefsWritten: string[];
  rlSignals: { step: string; accepted: boolean }[];
}

interface WikiState {
  fileHashes: Record<string, string>;
  articleHashes: Record<string, string>;
  lastFullCompile: string;
  lastIncrementalCompile: string;
  compilationPromptHash: string;
}

interface WikiLintResult {
  stale: WikiLintFinding[];
  orphans: WikiLintFinding[];
  gaps: WikiLintFinding[];
  brokenLinks: WikiLintFinding[];
  contradictions: WikiLintFinding[];
  specDrift: WikiLintFinding[];       // spec says X, code does Y
  decisionViolations: WikiLintFinding[]; // ADR says X, code does Y
  missingRationale: WikiLintFinding[];   // high-PageRank, no decision
  coveragePercent: number;
}
```

**0.2 — State management** (`packages/core/src/wiki/state.ts`)

Manages `.maina/wiki/.state.json`. SHA-256 hashing, change detection, round-trip serialization.

**0.3 — Code entity extractor** (`packages/core/src/wiki/extractors/code.ts`)

Thin adapter over existing Semantic layer — does NOT reimplement tree-sitter. Gets entities + PageRank scores + dependency graph from existing infrastructure.

**0.4 — Feature extractor** (`packages/core/src/wiki/extractors/feature.ts`)

Parses `.maina/features/*/plan.md`, `spec.md`, `tasks.md`. These are already structured markdown generated by Maina, so parsing is deterministic (not LLM-dependent).

**0.5 — Decision extractor** (`packages/core/src/wiki/extractors/decision.ts`)

Parses `adr/*.md`. ADRs follow structured format from `maina design`. Extracts status, context, decision, rationale, alternatives, entity mentions.

**0.6 — Workflow trace extractor** (`packages/core/src/wiki/extractors/workflow.ts`)

Parses `.maina/workflow/`. Extracts step sequences, wiki refs, RL signals per step.

**0.7 — Schema management** (`packages/core/src/wiki/schema.ts`)

Default `schema.md` defining article structure, max length, linking conventions per article type.

### Workflow
```
maina plan wiki-foundation → maina spec → implement → maina verify → maina commit
```

### TDD Contracts
- All types serialize/deserialize correctly
- State survives round-trip
- Code extractor produces entities from Maina's own codebase
- Feature extractor parses Maina's own `.maina/features/`
- Decision extractor parses Maina's own `adr/`
- All extractors handle edge cases (missing files, empty dirs)

### Definition of Done
- All 6 extractors produce structured data from Maina's own repo (dogfood)
- State management with 100% test coverage
- `maina verify` passes

---

## Sprint 1: Knowledge Graph + Louvain (Week 1, Days 3-5)

### Tickets

**1.1 — Louvain community detection** (`packages/core/src/wiki/louvain.ts`)

Operates on existing dependency graph. Clusters entities by import/call density into natural modules. ~200 LOC.

TDD: Given known graph → expected clusters. Handles disconnected components. Deterministic. Scales to 1000+ nodes in < 1 second.

**1.2 — Unified knowledge graph** (`packages/core/src/wiki/graph.ts`)

Merges all 6 source outputs into one graph with 11 edge types:

```typescript
type EdgeType =
  // Code edges (from dependency graph)
  | 'calls' | 'imports' | 'inherits' | 'references' | 'member_of'
  // Lifecycle edges (from extractors)
  | 'modified_by'     // feature → entity (via git blame)
  | 'specified_by'    // spec → entity (via function references)
  | 'decided_by'      // decision → entity (via ADR mentions)
  | 'motivated_by'    // decision → feature (via ADR context)
  | 'constrains'      // decision → entity
  | 'aligns_with';    // decision → constitution rule
```

**1.3 — Entity-to-article mapping**

Maps graph nodes to wiki article paths:
- Top 20% PageRank → `wiki/entities/`
- Louvain clusters → `wiki/modules/`
- Features → `wiki/features/`
- ADRs → `wiki/decisions/`
- Cross-cutting patterns → `wiki/architecture/`

### Workflow
```
maina plan wiki-graph → maina design (ADR for graph architecture) → maina spec → implement → maina verify → maina review → maina commit
```

### Definition of Done
- Knowledge graph includes all 11 edge types from Maina's own codebase
- Louvain detects Maina's own package structure correctly
- Entity-to-article mapping covers all 7 languages

---

## Sprint 2: LLM Compilation (Week 2)

### Tickets

**2.1 — Compilation prompt templates** (6 new files in `.maina/prompts/`)

| Template | Input | Output |
|---|---|---|
| `compile-module.md` | Entity list + dep summary + related features | Module overview article |
| `compile-entity.md` | Function/class + callers + callees + features + specs + decisions | Entity article with full lifecycle |
| `compile-feature.md` | plan.md + spec.md + tasks.md + entities modified | Feature history article |
| `compile-decision.md` | ADR + affected entities + constitution alignment | Decision article |
| `compile-architecture.md` | Workflow traces + pattern detection | Cross-cutting architecture article |
| `wiki-query.md` | Question + relevant wiki articles | Synthesis answer |

All templates are Prompt Engine managed: hashed, versioned, A/B testable.

**2.2 — Full compiler** (`packages/core/src/wiki/compiler.ts`)

Orchestrates compilation across all source types. Uses `mechanical` model tier (cheapest). Calls extractors → builds graph → compiles articles → generates links → builds index.

**2.3 — Incremental compiler** (`packages/core/src/wiki/compiler-incremental.ts`)

SHA-256 diff detection. Only recompiles affected articles + their graph neighbors.

**2.4 — Linker** (`packages/core/src/wiki/linker.ts`)

Generates wikilinks from knowledge graph. Forward + backward. All 11 edge types produce appropriate link syntax: `[[entity:X]]`, `[[feature:001]]`, `[[decision:002]]`, `[[module:auth]]`.

**2.5 — Indexer** (`packages/core/src/wiki/indexer.ts`)

Generates `index.md` with sections per article type + freshness indicators.

### Workflow
```
maina brainstorm → maina plan wiki-compiler → maina design (ADR) → maina spec → implement → maina verify → maina review → maina commit → maina pr
```

**RL loop:** First compilation prompt A/B test starts. Two variants of `compile-entity.md`: one includes feature/decision context, one is code-only. Track which produces articles with higher referenceCount in subsequent sprints.

### TDD Contracts
- Full compilation produces valid markdown with wikilinks for all article types
- Incremental compilation touches only affected articles
- Entity articles include feature history, spec contracts, decision links
- Feature articles link to all entities they modified
- Decision articles link to all entities they constrain
- Compilation of Maina's codebase: < 3 minutes full, < 15 seconds incremental

### Definition of Done
- `maina wiki compile` produces complete wiki from Maina's own codebase
- Wiki includes module, entity, feature, decision, and architecture articles
- All cross-type links resolve correctly
- Compilation prompts registered in Prompt Engine with version hashes

---

## Sprint 3: CLI Commands + Context L5 + Workflow Integration (Week 3)

### Tickets

**3.1 — `maina wiki init`**

Scaffold → extract → compile → write. Output: "Wiki initialized. X modules, Y entities, Z features, W decisions. Coverage: N%."

**3.2 — `maina wiki compile`**

Incremental default. `--full` forces recompile. `--dry-run` shows plan. Records compilation event to workflow context.

**3.3 — `maina wiki query`**

Synthesize from wiki. `--save` files back. Uses `wiki-query.md` prompt. Records accept/reject for RL.

**3.4 — `maina wiki status`**

Quick health: articles by type, coverage %, stale count, top gaps, last compile. < 100ms.

**3.5 — Wiki as Context Engine Layer 5** (`packages/core/src/context/layers/wiki.ts`)

```typescript
export class WikiLayer implements ContextLayer {
  name = 'wiki';
  defaultBudget = 0.12;

  async load(selector: ContextSelector): Promise<ContextChunk[]> {
    // Load index.md (always)
    // Find relevant articles based on:
    //   - Working files (L1) → their wiki articles
    //   - Current task/ticket → related feature + module articles
    //   - Entity references in diff → entity + decision articles
    // Sort by: PageRank × ebbinghausScore
    // Fit within budget
    // Record which articles loaded (RL Signal 1)
  }
}
```

Modify `budget.ts`: L1=12%, L2=12%, L3=16%, L4=8%, L5=12%, headroom=40%.

**3.6 — Workflow context `wiki_refs`**

Every command now records:
```typescript
interface WorkflowStep {
  // existing...
  wikiRefsRead: string[];
  wikiRefsWritten: string[];
}
```

**3.7 — `maina commit` auto-compilation hook**

Post-commit: detect changed files → run incremental compilation. Configurable via `maina configure` ("Auto-compile wiki on commit? [Y/n]").

**3.8 — Existing command enhancements**

- `maina explain` draws from wiki L5. `--save` files back.
- `maina design` auto-files output to `wiki/decisions/`
- `maina brainstorm` output becomes candidate architecture article
- `maina plan` → feature directory creation triggers wiki indexing
- `maina context show` includes L5 with token counts

### Workflow
```
maina plan wiki-cli → maina design (ADR for budget changes) → maina spec --auto → implement → maina verify → maina review → maina commit → maina pr
```

**RL loop:** Wiki context is now live. Every subsequent command records wiki article usage. First batch of Signal 1 data accumulates.

### Definition of Done
- `maina wiki init` works on Maina's codebase (dogfood)
- `maina wiki query "how does the verify engine work?"` returns answer citing entity + decision articles
- Wiki appears in `maina context show` as L5
- `maina commit` triggers incremental compilation
- `maina explain --save` creates valid wiki article
- `maina design` auto-files to wiki/decisions/
- All commands record wiki_refs in workflow context

---

## Sprint 4: Wiki Lint + Verify Integration (Week 4)

### Tickets

**4.1 — Wiki lint tool** (`packages/core/src/verify/tools/wiki-lint.ts`)

Implements `VerifyTool` interface (same as all 18+ tools). Runs in parallel.

Checks:
- **Stale article** — code changed, article not recompiled (weighted by PageRank)
- **Missing article** — top-20% entity without article
- **Orphan article** — references deleted entity
- **Broken link** — `[[entity:X]]` resolves to nothing
- **Contradiction** — wiki claims vs code behavior (AST-verified)
- **Spec drift** — spec says `Result<T,E>`, code throws exceptions
- **Decision violation** — ADR says JWT, code uses sessions
- **Missing rationale** — high-PageRank entity changed in 3+ features, no decision

**4.2 — Register in verify pipeline**

Add `WikiLintTool` to parallel tool array. Auto-skip if `.maina/wiki/` absent.

**4.3 — `maina wiki lint` standalone**

Detailed health report with actionable items sorted by priority.

**4.4 — `maina doctor` wiki section**

Shows wiki health alongside tool health.

**4.5 — `maina pr` wiki coverage delta**

PR body includes: articles updated, articles added, coverage change.

### TDD Contracts
- Staleness catches articles with outdated source hashes
- Spec drift catches mismatches between spec assertions and code AST
- Decision violations caught via pattern matching
- Missing rationale surfaces high-PageRank entities without decisions
- Wiki lint < 500ms (doesn't slow verify pipeline)
- Zero false positives on Maina's own codebase

### Definition of Done
- `maina verify` includes wiki lint (now 19+ tools)
- `maina wiki lint` produces actionable report on Maina's codebase
- `maina pr` shows wiki coverage delta
- Spec drift and decision violation checks work on real ADRs

---

## Sprint 5: RL Integration — Three Signals (Week 5)

### Tickets

**5.1 — Signal 1: Wiki-as-context effectiveness**

Extend `FeedbackEvent` with `wikiArticlesLoaded: string[]`. Aggregate in `maina learn`:
```
accept_rate(with article X) vs accept_rate(without)
→ flag negative-effectiveness articles for recompilation
```

**5.2 — Signal 2: Compilation prompt quality**

Track transitive quality. Compilation prompts are in `.maina/prompts/`, already hashed/versioned by Prompt Engine. Add indirect accept rate aggregation to `maina learn`.

**5.3 — Signal 3: Reference frequency → Ebbinghaus decay**

Type-specific half-lives: decision=180d, architecture=150d, module=120d, entity=90d, feature=60d. Articles with score < 0.2 excluded from default context loading.

**5.4 — `maina learn` wiki output**

```
Wiki Effectiveness:
  Positive-signal articles: 34/47 (72%)
  Negative-signal articles: 2/47 (flag for recompilation)

Compilation Prompts:
  compile-entity.md v2 (with lifecycle): 82% indirect accept
  compile-entity.md v1 (code-only): 68% indirect accept → v2 wins

Knowledge Decay:
  Active (>0.5): 38  |  Decaying (0.2-0.5): 7  |  Dormant (<0.2): 2

Lifecycle Coverage:
  Features with articles: 12/15 (80%)
  ADRs compiled: 8/8 (100%)
  Missing rationale: 3 entities flagged
```

**5.5 — `maina stats` wiki metrics**

Coverage trend, compilation frequency, query count, compounding rate (articles/week).

### Definition of Done
- Every verify/review/commit records wiki article hashes in feedback
- `maina learn` shows all three signal reports
- Compilation prompts are A/B tested with 50+ observations
- Ebbinghaus decay applies with type-specific rates
- Dormant articles excluded from default L5 loading

---

## Sprint 6: MCP Tools + Skills (Week 5-6)

### Tickets

**6.1 — `wikiQuery` MCP tool**

Search and synthesize from wiki. `save` parameter for compounding loop.

**6.2 — `wikiStatus` MCP tool**

Returns structured wiki health for IDE display.

**6.3 — `wiki-workflow` skill**

SKILL.md teaching agents when to query wiki, how to use `--save`, when to trigger compilation, how to interpret lint findings.

### Definition of Done
- Claude Code can call `wikiQuery` and get answers with lifecycle context
- Wiki skill works without CLI installed
- Total MCP tools: 10. Total skills: 6.

---

## Sprint 7: Cloud Wiki — Workkit (Week 6-7)

### Tickets

**7.1 — D1 schema**

```sql
CREATE TABLE wiki_articles (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  repo_slug TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content TEXT,
  r2_key TEXT,
  page_rank REAL,
  reference_count INTEGER DEFAULT 0,
  ebbinghaus_score REAL DEFAULT 1.0,
  last_compiled TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, repo_slug, path)
);

CREATE TABLE wiki_compile_jobs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  repo_slug TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  diff_r2_key TEXT,
  result_r2_key TEXT,
  created_at TEXT,
  completed_at TEXT
);
```

**7.2 — Wiki sync routes** (`@workkit/api` + `@workkit/auth`)

```
POST /wiki/sync/push    # content-hash dedup upload
GET  /wiki/sync/pull     # download team wiki
```

**7.3 — Hosted compilation** (`@workkit/queue` + `@workkit/r2` + `@workkit/do`)

```
POST /wiki/compile       # submit diff
GET  /wiki/compile/:id   # poll status
```

Durable Object prevents concurrent compilations per repo.

**7.4 — `maina wiki sync push/pull`**

Same conflict resolution UX as prompt sync.

**7.5 — `maina wiki compile --cloud`**

Submit diff → poll → download result.

**7.6 — Analytics API** (`@workkit/api`)

```
GET /wiki/analytics/coverage
GET /wiki/analytics/staleness
GET /wiki/analytics/queries
GET /wiki/analytics/onboarding
```

### TDD (using `@workkit/testing`)
- Sync round-trips correctly
- Content-hash dedup works
- Hosted compilation = local compilation (same result)
- Durable Object prevents races
- Rate limiting active
- All routes require auth

### Definition of Done
- `maina wiki sync push/pull` works between two machines
- `maina wiki compile --cloud` produces valid wiki
- All routes tested via Miniflare
- Analytics API returns valid data

---

## Sprint 8: Full Command Integration (Week 7-8)

### Tickets

**8.1 — `maina review` wiki-aware two-stage**

Stage 1: loads decision articles for spec compliance.
Stage 2: loads module/entity articles for quality patterns.
Review outcomes update article freshness.

**8.2 — `maina verify --deep` wiki-aware**

Loads decision articles for architectural compliance checking.

**8.3 — `maina analyze` wiki consistency**

Cross-artifact check includes wiki: spec says X, plan says Y, wiki says Z → misalignment flagged.

**8.4 — `maina wiki ingest`**

```
maina wiki ingest ./docs/rfc.md
maina wiki ingest https://notion.so/page/xyz
```

External sources → `wiki/raw/` → compiled on next `maina wiki compile`.

**8.5 — End-to-end workflow validation**

Full dogfood cycle on Maina's own codebase:
```
maina brainstorm → reads wiki/architecture/
  → maina plan → creates feature dir, wiki indexes
    → maina design → files ADR to wiki/decisions/
      → maina spec → links spec to entity articles
        → implement
          → maina verify → wiki lint runs (19+ tools)
            → maina review → cites wiki decisions in review
              → maina commit → triggers incremental compilation
                → maina pr → body includes wiki coverage delta
```

### Definition of Done
- Full workflow works on Maina's own codebase with wiki integration at every step
- `maina review` cites wiki decisions
- `maina analyze` catches wiki inconsistencies
- `maina wiki ingest` adds external sources

---

## Sprint 9: Self-Improve Action (Week 8)

### Tickets

**9.1 — Extend `mainahq/self-improve-action`**

With `include_wiki: true`, the daily cron now:
1. Collects workflow traces (existing)
2. Analyzes prompt effectiveness (existing)
3. Analyzes wiki article effectiveness (Signal 1)
4. Analyzes compilation prompt quality (Signal 2)
5. Identifies dormant articles for retirement (Signal 3)
6. Proposes improvements to prompts AND compilation prompts
7. A/B tests improvements
8. Commits better prompts AND recompiles flagged articles

**9.2 — Extend `mainahq/workflow-action`**

With `wiki_context: true`, the autonomous agent:
- Loads wiki/architecture/ during brainstorm
- Loads wiki/modules/ during plan
- Loads wiki/decisions/ during design (avoids conflicts)
- Loads wiki/entities/ during implementation
- Runs wiki lint during verify
- Uses wiki for two-stage review
- Triggers compilation on commit
- Includes wiki delta in PR

### Definition of Done
- Self-improve action optimizes wiki quality alongside prompts
- Workflow action uses wiki for persistent memory
- Both pass on Maina's own repo

---

## Sprint 10: Dogfood Report + Launch (Week 8-9)

### Tickets

**10.1 — Generate Maina's own wiki**

Full `maina wiki init` on the Maina codebase. Measure: total articles, coverage, compilation time, article quality.

**10.2 — Run `maina learn` with 9 sprints of data**

Analyze: wiki effectiveness across all sprints, compilation prompt A/B results, article decay patterns, lifecycle article impact vs code-only.

**10.3 — Cross-dogfooding report**

Quantitative: bugs found by wiki lint, prompts evolved via wiki RL, spec drift caught, decision violations caught, compilation time trends.

**10.4 — Documentation**

Update mainahq.com: wiki section, commands page (38+ commands), MCP page (10 tools), roadmap, README.

**10.5 — Update pitch deck**

Add wiki stats + lifecycle graph to traction slide.

### Definition of Done
- Maina's own wiki is live and healthy
- Cross-dogfooding report has real numbers
- Documentation complete
- Ready for launch

---

## RL Schedule

| When | What | Signal |
|---|---|---|
| Every `maina verify` | Records wiki articles in context + pass/fail | Signal 1 |
| Every `maina review` | Records accept/reject + wiki citations | Signal 1 + 2 |
| Every `maina commit` | Records success + triggers compile | Signal 1 + compile data |
| Every sprint end | `maina learn` | All 3 signals analyzed |
| Sprint 5+ | Full 3-signal analysis | Wiki optimization recommendations |
| Sprint 9+ | `self-improve-action` daily | Autonomous wiki + prompt optimization |

---

## Quality Gates (Every Sprint)

1. All tests pass (`bun run test`, target: 1,500+ by Sprint 10)
2. `maina verify` passes (including wiki lint from Sprint 4)
3. `maina review` passes (two-stage, wiki-aware from Sprint 8)
4. Dogfood: wiki features tested on Maina's own codebase
5. RL data recorded: every sprint produces feedback for `maina learn`
6. No regressions: existing 1,167 tests continue passing

---

## Timeline

| Sprint | Week | Focus | Deliverable |
|---|---|---|---|
| 0 | W1 (D1-3) | Types, state, 6 extractors | All sources extractable from Maina's repo |
| 1 | W1 (D3-5) | Knowledge graph, Louvain | 11-edge-type graph, module detection |
| 2 | W2 | LLM compilation | Full wiki with all article types |
| 3 | W3 | CLI + L5 + workflow integration | Wiki in every command's context |
| 4 | W4 | Wiki lint + verify | 19+ tools including lifecycle-aware lint |
| 5 | W5 | RL — 3 signals | Full feedback loop active |
| 6 | W5-6 | MCP + skills | 10 MCP tools, 6 skills |
| 7 | W6-7 | Cloud (Workkit) | Team sync, hosted compile, analytics |
| 8 | W7-8 | Command integration | Every command wiki-aware, E2E workflow |
| 9 | W8 | Self-improve action | Autonomous wiki optimization |
| 10 | W8-9 | Dogfood + launch | Report, docs, pitch deck |

**Total: 9 weeks. 10 sprints. ~3,000 LOC new + ~500 LOC modifications.**
**New commands: 10. New MCP tools: 2. New skills: 1. New prompt templates: 6.**
**New lint checks: 9. New RL signals: 3. New edge types: 6.**
