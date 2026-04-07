# BRAINSTORM: wiki.mainahq.com — NotebookLM for Codebases
## Three ideas, one system

---

## The Three Ideas Are Actually One

```
IDEA 1: maina init includes wiki by default
  → generates magic documents on every new project
  → the activation moment for CLI users

IDEA 2: wiki.mainahq.com — paste GitHub URL, get NotebookLM-style interaction
  → the growth engine (free, viral, top-of-funnel)
  → converts visitors → CLI installs → Cloud signups

IDEA 3: E2E test suite on popular repos
  → validates wiki quality at scale
  → the repos used for testing ARE the demo content on the website
```

They share the same backend: the wiki compiler. The website is the cloud-hosted version of what `maina init` runs locally. The E2E tests are automated runs of the same compiler on curated repos.

---

## 1. `maina init` Change — Wiki Is Default

### Current flow

```
$ maina init --install

Creates:
  .maina/
    constitution.md
    prompts/
    AGENTS.md
  → installs missing verification tools
  → done
```

### New flow

```
$ maina init --install

Step 1: Setting up Maina...
  ✓ Created .maina/constitution.md
  ✓ Created .maina/prompts/
  ✓ Created AGENTS.md
  ✓ Installed: biome, semgrep, trivy, secretlint (4 tools)

Step 2: Building codebase wiki...
  Extracting: 247 functions, 38 classes, 12 interfaces
  Analyzing: 8 modules detected, 1,847 dependency edges
  Compiling: ████████████████████ 100%

  📘 PROJECT.md           — Your project at a glance
  🗺️  ARCHITECTURE.md      — System diagram
  📦 8 module guides       — What each module does
  🔧 12 entity docs        — Key functions documented
  🧭 ONBOARDING.md        — New contributor guide
  🎯 PATTERNS.md          — Detected conventions
  🏥 HEALTH.md            — Tech debt & hotspots
  📊 DEPENDENCIES.md      — Dependency analysis

  Coverage: 74% | 24 articles | 18,000 words

Ready. Try: maina wiki query "how does auth work?"
```

**Skip wiki:** `maina init --install --no-wiki` for users who want the old behavior.

**The key insight:** The wiki output IS the "wow" moment of Maina. If you hide it behind a separate command, 80% of users never discover it. Making it default means every new user sees the magic.

---

## 2. wiki.mainahq.com — The Product

### What DeepWiki does (and where it stops)

<table>
<tr><th>Feature</th><th>DeepWiki</th><th>wiki.mainahq.com</th></tr>
<tr><td>Paste GitHub URL → get docs</td><td>✅</td><td>✅</td></tr>
<tr><td>Architecture diagrams</td><td>✅</td><td>✅</td></tr>
<tr><td>Q&A chat</td><td>✅</td><td>✅</td></tr>
<tr><td>NotebookLM-style sources panel</td><td>❌</td><td>✅</td></tr>
<tr><td>Knowledge graph visualization</td><td>Partial</td><td>✅ (interactive)</td></tr>
<tr><td>npm package support</td><td>❌ (GitHub only)</td><td>✅</td></tr>
<tr><td>Lifecycle: specs, plans, ADRs</td><td>❌</td><td>✅</td></tr>
<tr><td>Detected patterns & conventions</td><td>❌</td><td>✅</td></tr>
<tr><td>Health report / tech debt</td><td>❌</td><td>✅</td></tr>
<tr><td>Compounding (answers filed back)</td><td>❌</td><td>✅</td></tr>
<tr><td>MCP server for querying</td><td>✅</td><td>✅</td></tr>
<tr><td>Audio overview (podcast-style)</td><td>❌</td><td>✅ (v2)</td></tr>
<tr><td>Private repos</td><td>Paid (Devin)</td><td>Paid (Maina Cloud)</td></tr>
</table>

### The NotebookLM Angle — What Makes This Different

NotebookLM's magic isn't the answers — it's the SOURCES PANEL. You see exactly which documents informed each answer. You can pin sources, highlight passages, and the AI grounds its responses in your uploaded material.

For code, this means:

```
User: "How does the payment flow work?"

Sources used:
  📦 modules/payments.md (PageRank: 0.89)
  🔧 entities/process-payment.md
  🔧 entities/stripe-webhook.md
  📋 decisions/004-stripe-over-paddle.md
  📊 features/007-payment-retry.md

Answer:
  The payment flow starts at process_payment() which validates
  the order, calls Stripe's API [→ entities/stripe-webhook.md],
  and handles retries via an exponential backoff pattern
  [→ features/007-payment-retry.md]. The team chose Stripe over
  Paddle because... [→ decisions/004-stripe-over-paddle.md]

  [Every claim is linked to a source article]
```

This is fundamentally different from DeepWiki's chat, which gives you an answer but doesn't show you WHERE in the codebase that understanding comes from. The sources panel creates trust.

### User Flow

```
1. LAND
   wiki.mainahq.com
   Input: [Paste GitHub URL or npm package name]   [Explore →]

   Featured repos: react, next.js, bun, hono, drizzle-orm
   (pre-indexed, instant access)

2. COMPILE (first visit, 60-90 seconds)
   "Analyzing expressjs/express..."
   Progress: extracting entities... building graph... compiling...

3. EXPLORE (the main experience)
   Left panel:  Wiki article tree (modules, entities, decisions)
   Center:      Current article with Mermaid diagrams
   Right panel: Sources used + knowledge graph mini-view

   Top bar: [Ask a question...] [Health] [Patterns] [Graph]

4. ASK (NotebookLM-style)
   "How does middleware routing work?"
   → Answer with source citations
   → Sources panel highlights which articles were used
   → Click any source to jump to that article

5. EXPLORE GRAPH
   Interactive knowledge graph
   Nodes = articles, sized by PageRank
   Edges = relationships (11 types)
   Click node → opens article
   Filter: by module, by type, by freshness

6. CONVERT
   "Want this for your private repos? Install the CLI."
   → bun add -g @mainahq/cli && maina init --install
   "Want team features? Try Maina Cloud."
   → maina login
```

### URL Structure

```
wiki.mainahq.com/github/expressjs/express          ← GitHub repo
wiki.mainahq.com/npm/hono                           ← npm package
wiki.mainahq.com/github/mainahq/maina               ← our own repo (dogfood)
```

For npm packages: resolve to GitHub repo from npm registry, then compile.

### The Viral Loop

```
Developer discovers wiki.mainahq.com
  → explores a repo they contribute to
    → sees accurate wiki they didn't write
      → shares link with team ("look at this for our repo")
        → team explores → impressed
          → one person installs CLI for private repos
            → team adopts → Cloud conversion
```

The shareable URL is the growth mechanism. "Check out the wiki for our project" is a natural share.

---

## 3. E2E Test Suite — Quality at Scale

### The insight

The repos we index on wiki.mainahq.com ARE the E2E test suite. If the wiki for Express.js is wrong, we know our compiler has bugs. If the wiki for React is accurate, we know it works at scale.

### Test structure

```
tests/
  e2e/
    wiki/
      repos.json                    # curated repo list
      fixtures/
        express/
          expected-modules.json     # expected module detection
          expected-entities.json    # expected top PageRank entities
          expected-patterns.json    # expected detected patterns
          smoke-queries.json        # questions with expected answer quality
        react/
          ...
        bun/
          ...
      run-e2e.ts                    # orchestrator
```

### Curated test repos (diverse stacks)

| Repo | Language | Size | Tests What |
|---|---|---|---|
| expressjs/express | JS | Medium | Classic Node.js, middleware pattern |
| vercel/next.js | TS | Large | Monorepo, complex architecture |
| oven-sh/bun | Zig + TS | Large | Multi-language, native code |
| honojs/hono | TS | Small | Clean, well-structured |
| drizzle-team/drizzle-orm | TS | Medium | DB tooling, complex types |
| pallets/flask | Python | Medium | Python conventions |
| gin-gonic/gin | Go | Medium | Go patterns |
| tokio-rs/tokio | Rust | Large | Rust async ecosystem |
| laravel/laravel | PHP | Large | PHP framework patterns |
| mainahq/maina | TS | Medium | Dogfood (our own repo) |

### What each E2E test validates

```typescript
describe('wiki E2E: expressjs/express', () => {
  it('detects correct modules', () => {
    // Louvain should find: router, middleware, request, response, etc.
  });

  it('identifies high-PageRank entities', () => {
    // app.use, Router.route, req.params should be top entities
  });

  it('generates accurate PROJECT.md', () => {
    // Should mention: HTTP framework, middleware, routing
    // Should NOT mention: database, authentication (Express doesn't have these)
  });

  it('generates valid architecture diagram', () => {
    // Mermaid should parse without errors
    // Should show: app → router → middleware → handler flow
  });

  it('detects patterns correctly', () => {
    // Should detect: middleware pattern, callback style, error-first
  });

  it('answers smoke queries accurately', () => {
    const queries = [
      { q: "how does middleware work?", mustMention: ["app.use", "next()"] },
      { q: "how is routing implemented?", mustMention: ["Router", "params"] },
    ];
    // Each answer must mention expected terms
    // Each answer must cite wiki articles as sources
  });

  it('health report has no false alarms', () => {
    // Should not flag Express's intentional design patterns as "tech debt"
  });
});
```

### CI integration

```yaml
# .github/workflows/e2e-wiki.yml
name: Wiki E2E
on:
  push:
    paths: ['packages/core/src/wiki/**']
  schedule:
    - cron: '0 6 * * 1'  # weekly Monday 6 AM

jobs:
  e2e:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        repo: [express, hono, flask, gin, maina]
    steps:
      - uses: actions/checkout@v4
      - run: bun install && bun run build
      - run: git clone https://github.com/${{ matrix.repo.org }}/${{ matrix.repo.name }} /tmp/test-repo
      - run: cd /tmp/test-repo && maina init --install
      - run: bun run test:e2e:wiki -- --repo=${{ matrix.repo.name }}
```

### The feedback loop

E2E failures on popular repos → compilation prompt improvements → `maina learn` incorporates → prompts A/B tested → better wiki quality across ALL repos. The E2E suite is the training data for the RL loop.

---

## 4. Architecture for wiki.mainahq.com

### Tech Stack (Workkit-native)

```
wiki.mainahq.com (CF Pages)
  → React frontend
  → Calls wiki API

api.mainahq.com/wiki/* (CF Workers, @workkit/api)
  → /wiki/compile     — trigger compilation for a repo
  → /wiki/:repo       — get compiled wiki
  → /wiki/:repo/query — NotebookLM-style Q&A with sources
  → /wiki/:repo/graph — knowledge graph data
  → /wiki/:repo/health — health report

Infrastructure:
  @workkit/d1    — wiki articles, repo metadata
  @workkit/r2    — compiled wiki blobs, cached compilation results
  @workkit/kv    — repo index, content hashes
  @workkit/cache — SWR caching for popular repos
  @workkit/queue — async compilation jobs
  @workkit/do    — per-repo compilation lock
  @workkit/auth  — optional, for private repos
  @workkit/ratelimit — prevent abuse

Pre-indexed repos:
  Top 100 npm packages + top 100 GitHub repos by stars
  Re-compiled weekly via cron
  Instant access, no wait
```

### The NotebookLM sources panel

```typescript
interface WikiQueryResult {
  answer: string;
  sources: WikiSource[];    // which articles informed this answer
  confidence: number;
}

interface WikiSource {
  article: WikiArticle;
  relevanceScore: number;
  excerptUsed: string;      // which part of the article was cited
  highlightRange: [number, number]; // for highlighting in source panel
}
```

Every answer comes with sources. The frontend renders a split view:
- Left: article tree (like Obsidian sidebar)
- Center: answer with inline source citations [1], [2], [3]
- Right: source panel showing the actual wiki articles used, with highlights

Clicking a citation scrolls the right panel to the relevant excerpt.

### Pricing for website

| Tier | Price | What |
|---|---|---|
| Public repos | Free | Unlimited, no signup |
| Private repos | Maina Cloud subscription | Link GitHub, auto-index |
| API access | Rate-limited free tier | MCP server + REST API |

The website is a **loss leader for adoption**. It costs ~$0.05 per repo compilation. For pre-indexed repos, the cost is amortized across all visitors. The conversion path: free website → CLI install → Cloud subscription.

---

## 5. What Maina Wiki Does That DeepWiki Cannot

| Capability | Why DeepWiki Can't | Why Maina Can |
|---|---|---|
| **Specs, plans, ADRs** | Doesn't generate them. Has no workflow. | Maina generates these via `plan`, `spec`, `design` commands |
| **Compounding loop** | Read-only. Queries don't enrich the wiki. | `--save` files answers back. Every commit auto-compiles. |
| **RL-optimized articles** | Static generation. Same prompt every time. | Compilation prompts evolve via A/B testing from user feedback |
| **Patterns detection** | Describes what code does, not how team writes | AST frequency analysis detects actual conventions |
| **Health report** | No complexity analysis, no tech debt surfacing | Cyclomatic complexity, churn data, missing rationale |
| **Decision capture** | Cannot capture "why" — no design workflow | `maina design` → ADR → wiki decision article → linked to entities |
| **Ebbinghaus decay** | All articles treated equally | Frequently-referenced knowledge persists, stale knowledge fades |
| **Verification integration** | Documentation only | Wiki lint runs alongside 18+ tools on every verify |

The fundamental difference: **DeepWiki documents code. Maina documents the project** — the code, the decisions, the plans, the patterns, the history, and the reasoning. And it gets better with every interaction.

---

## 6. Naming Options

For the website:

| Option | URL | Vibe |
|---|---|---|
| Maina Wiki | wiki.mainahq.com | Product extension, clear |
| Maina Explore | explore.mainahq.com | Discovery-focused |
| Maina Read | read.mainahq.com | "Read the wiki" |

Recommendation: **wiki.mainahq.com** — simple, descriptive, matches the CLI command (`maina wiki`). When someone shares a link, the URL itself explains what it is.

---

## 7. Implementation Priority

```
Phase 1 (with wiki compiler): maina init includes wiki
  → zero additional engineering beyond the wiki compiler itself
  → just move wiki compilation into the init flow

Phase 2 (with Cloud sprint): wiki.mainahq.com MVP
  → Workkit-powered API for hosted compilation
  → Basic frontend: article viewer, search, simple Q&A
  → Pre-index top 50 repos

Phase 3 (post-launch): NotebookLM features
  → Sources panel with citation highlighting
  → Interactive knowledge graph
  → npm package URL support
  → Audio overview generation (v2, if demand exists)

Phase 4 (growth): Scale + viral
  → Pre-index top 500 repos
  → DeepWiki-style URL swap: github.com → wiki.mainahq.com
  → Embeddable wiki badges for READMEs
  → MCP server for wiki.mainahq.com content
```

Phase 1 is free — it's a one-line change to the init command. Phase 2 reuses the Cloud sprint's Workkit infrastructure. Phase 3 is frontend work. Phase 4 is growth engineering.

---

## 8. The E2E Test ↔ Demo ↔ Website Loop

```
E2E test suite runs on 10+ popular repos
  → validates wiki quality
    → same compiled wikis served on wiki.mainahq.com
      → visitors explore real, validated wikis
        → share links → viral growth
          → feedback → compilation prompt improvements
            → better E2E scores → better website → more sharing
```

The testing infrastructure IS the product infrastructure. No duplicated work.
