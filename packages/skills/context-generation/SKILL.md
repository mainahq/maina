---
name: context-generation
description: Generate rich codebase context using maina's 4-layer retrieval with dynamic token budgets.
triggers:
  - "generate context"
  - "codebase context"
  - "understand codebase"
  - "what does this code do"
---

# Context Generation

## When to use

When you need to understand a codebase, explore how components relate, or gather context before making changes. The context engine builds a multi-layered picture of the code so that AI calls receive the most relevant information within a token budget.

## Steps

1. **Run context generation** with `maina context` (or call the `getContext` MCP tool). This activates all four retrieval layers and returns a structured context document.
2. **Working layer** gathers immediate context: the current branch, staged/unstaged changes, and recently touched files. This is what you are actively working on.
3. **Episodic layer** retrieves historical context: past commit summaries, PR review feedback, and related discussions. Older memories decay using Ebbinghaus forgetting curves, keeping recent and significant events prominent.
4. **Semantic layer** builds structural understanding: tree-sitter parses source files into typed entities (functions, classes, interfaces), and a PageRank-scored dependency graph identifies the most connected and important modules.
5. **Retrieval layer** performs on-demand code search: when the other layers are insufficient, targeted searches fill gaps with specific code snippets, definitions, or usage examples.
6. **Dynamic budget** controls how many tokens each layer contributes:
   - **Focused (40%):** For small, targeted changes where you know exactly what to modify.
   - **Default (60%):** Balanced exploration suitable for most tasks.
   - **Explore (80%):** For broad understanding, refactoring, or onboarding to unfamiliar code.

## Example

```bash
# Default context generation (60% budget)
maina context

# Focused context for a specific file change
maina context --mode focused

# Broad exploration of a subsystem
maina context --mode explore

# Output structure:
# ## Working Context
# Branch: feature/auth-flow
# Changed files: src/auth/login.ts, src/auth/session.ts
#
# ## Episodic Context
# Recent: PR #42 added session refresh logic (3 days ago)
# Related: Commit abc123 refactored token validation (2 weeks ago)
#
# ## Semantic Context
# Key entities: AuthService (PageRank: 0.82), SessionManager (0.71)
# Dependency chain: login.ts -> AuthService -> SessionManager -> TokenStore
#
# ## Retrieved Snippets
# TokenStore.validate() — packages/core/src/auth/token-store.ts:58-72
```

## Notes

- Context is cached: identical queries with the same prompt version, context hash, and model never hit the AI twice.
- Each maina command declares its own context needs via a selector, so `maina review` and `maina plan` automatically request different context shapes.
- The semantic layer uses tree-sitter for language-aware parsing, supporting TypeScript, Python, Go, Rust, C#, Java, PHP, and more.
- When logged into Maina Cloud (`maina login`), the episodic layer merges team entries automatically -- reviews your teammates accepted feed into your context. Entries are deduplicated by content hash and decay naturally over time.
- All commands are available as both CLI (`maina <command>` or `npx @mainahq/cli <command>`) and MCP tools when running inside an AI coding tool.
