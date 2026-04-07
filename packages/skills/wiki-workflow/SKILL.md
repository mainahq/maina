---
name: wiki-workflow
description: Use maina wiki for persistent codebase knowledge
triggers:
  - wiki
  - knowledge
  - documentation
  - explain
---

# Wiki Workflow Skill

## When to Use

- **Before implementing:** Query the wiki for existing patterns, decisions, and module architecture so you build on what exists rather than duplicating or contradicting it.
- **After committing:** The wiki auto-compiles incrementally on commit hooks, keeping knowledge current. Run `maina wiki compile` manually after large refactors.
- **During review:** Check wiki for decision context before questioning architectural choices. Decisions have rationale documented.
- **For onboarding:** Query the wiki about module architecture, entity lifecycle, and feature history to ramp up quickly.

## Commands

- `maina wiki init` — First-time setup. Scans the codebase, extracts entities via tree-sitter, builds the knowledge graph, and generates initial articles.
- `maina wiki compile` — Recompile after changes. Runs incrementally by default (only changed files). Use `--full` for a complete rebuild.
- `maina wiki query "question"` — Ask a natural-language question about the codebase. Uses AI to synthesize an answer from relevant articles. Falls back to keyword search when AI is unavailable.
- `maina wiki status` — Health check showing article counts by type, coverage percentage, and last compile time.
- `maina wiki lint` — Find stale articles, orphaned entities, broken links, spec drift, and missing rationale.
- `maina wiki ingest <file>` — Add external documentation (RFCs, design docs, meeting notes) into the wiki as raw articles.

## MCP Tools

- **wikiQuery** — Search and synthesize answers from wiki articles. Accepts a question string, returns an AI-synthesized answer with source citations.
- **wikiStatus** — Wiki health dashboard with article counts, coverage, and compile timestamps.

## Workflow Integration

### Before coding
```bash
maina wiki query "how does authentication work?"
maina wiki query "what patterns does the verify engine use?"
```

### After large changes
```bash
maina wiki compile
maina wiki lint
```

### Save useful answers
```bash
maina wiki query "explain the cache invalidation strategy" --save
# Persists the answer to wiki/raw/ for future reference
```

### Check decisions before proposing changes
```bash
maina wiki query "why did we choose JWT over sessions?"
# Returns the decision article with full rationale
```

## Article Types

| Type | Directory | Content |
|------|-----------|---------|
| Module | `wiki/modules/` | Module overview, exports, dependencies |
| Entity | `wiki/entities/` | Function/class/type with lifecycle context |
| Feature | `wiki/features/` | Feature history, tasks, acceptance criteria |
| Decision | `wiki/decisions/` | ADR with context, rationale, alternatives |
| Architecture | `wiki/architecture/` | System structure, dependency graph, clusters |
| Raw | `wiki/raw/` | Ingested docs, saved query results |

## Tips

- Query before coding to avoid reinventing existing patterns
- The `--save` flag on queries persists useful answers for the whole team
- Wiki articles use `[[path]]` notation for cross-references
- Articles include PageRank scores — higher-ranked articles are more connected and important
- Ebbinghaus decay scoring surfaces recently relevant articles over stale ones
- The knowledge graph tracks 11 edge types across code and lifecycle artifacts
