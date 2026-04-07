---
"@mainahq/core": minor
"@mainahq/cli": minor
"@mainahq/mcp": minor
"@mainahq/skills": minor
---

Wiki: Codebase Knowledge Compiler (v1.2.0)

Adds a persistent, compounding knowledge layer that compiles code, plans, specs, ADRs, and workflow traces into interlinked wiki articles.

**New Commands:** `wiki init`, `wiki compile`, `wiki query`, `wiki status`, `wiki lint`, `wiki ingest`, `setup`

**New MCP Tools:** `wikiQuery`, `wikiStatus` (10 total)

**Core Features:**
- Knowledge graph with 11 edge types, Louvain community detection, PageRank scoring
- Template-based + optional LLM compilation (`--ai` flag)
- Context Engine Layer 5 (12% token budget) — wiki loaded automatically into every AI call
- 9 wiki lint checks including spec drift, decision violations, missing rationale, contradictions
- RL signals: Ebbinghaus decay with type-specific half-lives, prompt effectiveness tracking
- Post-commit incremental compilation hook
- Workflow wiki_refs tracking

**Integration:**
- `doctor` shows wiki health + MCP configuration status
- `pr` includes wiki coverage delta
- `stats` shows wiki metrics
- `explain` draws from wiki with `--save` support
- `learn` shows wiki effectiveness report
- Verify pipeline includes wiki-lint (12+ tools)

**Onboarding Fixes:**
- Fixed MCP stdout corruption (delegation → stderr)
- `.mcp.json` uses `bunx`/`npx` instead of bare `maina`
- Auto-generates `.claude/settings.json` for Claude Code MCP discovery
- Updated CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules with all 38+ commands
- New `maina setup` guided onboarding with environment detection
