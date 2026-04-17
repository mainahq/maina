# Feature: DeepWiki-compatible MCP server

## Problem Statement

DeepWiki is gaining traction for codebase Q&A. Maina's wiki engine already does the same thing better (verification-aware, blast radius). By exposing 3 DeepWiki-compatible tools, any client that speaks DeepWiki gets instant Maina interop.

## Success Criteria

- [x] `ask_question(repo, question)` — delegates to wikiQuery
- [x] `read_wiki_structure(repo)` — returns wiki article index
- [x] `read_wiki_contents(repo, page)` — returns article content
- [x] All 3 tools registered in the MCP server
- [x] Unit tests for each tool

## Scope

### In Scope
- 3 new MCP tools matching DeepWiki's surface
- Delegation to existing wiki engine functions
- Registered alongside existing Maina tools

### Out of Scope
- Standalone `maina-wiki-mcp` package (future)
- Full DeepWiki test harness compatibility
