---
name: wiki-workflow
description: Use maina wiki for persistent codebase knowledge
triggers:
  - "wiki"
  - "knowledge"
  - "documentation"
  - "explain"
---

> This plugin bundles the maina CLI: run it as `../../launcher/launch.sh cli <command>`, a path relative to this skill's folder.

# Wiki Workflow Skill

## When to use

- **Before implementing:** Query the wiki for existing patterns, decisions, and module architecture so you build on what exists rather than duplicating or contradicting it.
- **After committing:** The wiki auto-compiles incrementally on commit hooks, keeping knowledge current. Run `../../launcher/launch.sh cli wiki compile` manually after large refactors.
- **During review:** Check wiki for decision context before questioning architectural choices. Decisions have rationale documented.
- **For onboarding:** Query the wiki about module architecture, entity lifecycle, and feature history to ramp up quickly.

## Steps

- `../../launcher/launch.sh cli wiki init` — First-time setup. Scans the codebase, extracts entities via tree-sitter, builds the knowledge graph, and generates initial articles.
- `../../launcher/launch.sh cli wiki compile` — Recompile after changes. Runs incrementally by default (only changed files). Use `--full` for a complete rebuild.
- `../../launcher/launch.sh cli wiki query "question"` — Ask a natural-language question about the codebase. Uses AI to synthesize an answer from relevant articles. Falls back to keyword search when AI is unavailable.
- `../../launcher/launch.sh cli wiki status` — Health check showing article counts by type, coverage percentage, and last compile time.
- `../../launcher/launch.sh cli wiki lint` — Find stale articles, orphaned entities, broken links, spec drift, and missing rationale.
- `../../launcher/launch.sh cli wiki ingest <file>` — Add external documentation (RFCs, design docs, meeting notes) into the wiki as raw articles.

## MCP Tools

The `status` tool reports whether the wiki is ready. The DeepWiki-compatible wiki tools are off by default; enable them with the allow-list (`--tools default,ask_question,read_wiki_structure,read_wiki_contents` or `MAINA_MCP_TOOLS`):

<!-- maina:mcp-tools deepwiki list -->
- `ask_question` — Ask the maina wiki a question about the codebase; answers cite source articles.
- `read_wiki_structure` — List the maina wiki's articles with their paths, types and titles.
- `read_wiki_contents` — Read one maina wiki article by its path.
<!-- /maina:mcp-tools -->

## Workflow Integration

### Before coding
```bash
../../launcher/launch.sh cli wiki query "how does authentication work?"
../../launcher/launch.sh cli wiki query "what patterns does the verify engine use?"
```

### After large changes
```bash
../../launcher/launch.sh cli wiki compile
../../launcher/launch.sh cli wiki lint
```

### Save useful answers
```bash
../../launcher/launch.sh cli wiki query "explain the cache invalidation strategy" --save
# Persists the answer to wiki/raw/ for future reference
```

### Check decisions before proposing changes
```bash
../../launcher/launch.sh cli wiki query "why did we choose JWT over sessions?"
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
- All commands are available as both CLI (`../../launcher/launch.sh cli <command>`) and, for querying and reading the wiki, as the allow-listed DeepWiki MCP tools when running inside an AI coding tool
