# @mainahq/cli

## 1.1.4

### Patch Changes

- [`f6bebe3`](https://github.com/mainahq/maina/commit/f6bebe38fba3a5e56f758f6cc798d3d4efbab6ac) Thanks [@beeeku](https://github.com/beeeku)! - Fix MCP server not found: move @mainahq/mcp from devDependencies to dependencies and import by package name instead of relative path. Fixes `maina --mcp` when installed from npm.

## 1.1.2

### Patch Changes

- [`10649d3`](https://github.com/mainahq/maina/commit/10649d3733a38a1530ff3a2eb09a6123455fe84d) Thanks [@beeeku](https://github.com/beeeku)! - Post-release fixes: Orama search, wiki-aware commands, 12-tool support, install script, delegation output suppression, cloud sync fix, non-interactive mode.

## 1.1.1

### Patch Changes

- [#73](https://github.com/mainahq/maina/pull/73) [`331c58d`](https://github.com/mainahq/maina/commit/331c58d6287658934d8b434dffa5fab88a6db06e) Thanks [@beeeku](https://github.com/beeeku)! - Post-release fixes: MCP stdout fix, 12-tool support, install script, CI test fixes, docs updates.

## 1.1.0

### Minor Changes

- [`95e8d0b`](https://github.com/mainahq/maina/commit/95e8d0b47a94e3e9a4775b00afbb114c9a6740ae) Thanks [@beeeku](https://github.com/beeeku)! - Connect MCP tool results to cache and feedback systems (round-trip flywheel). Every MCP tool call now feeds into cache for instant replay, feedback for prompt evolution, and stats for dashboard tracking. Adds implicit accept/reject signals from commit success and tool re-runs.

- [`3ae23de`](https://github.com/mainahq/maina/commit/3ae23de520dcfe6c75b5ffbe70d11af87c40ec99) Thanks [@beeeku](https://github.com/beeeku)! - Wiki: Codebase Knowledge Compiler (v1.2.0)

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

## 1.0.3

### Patch Changes

- Graceful AI failure messages, built-in verify checks (7 checks without external linters), merge maina sections into existing agent files, and AI status in maina doctor.

## 1.0.2

### Patch Changes

- Enrich constitution generation with project context: package.json scripts, build tool, monorepo detection, conventions (commitlint, strict TS, CI, Docker, git hooks), and verification commands.

## 1.0.1

### Patch Changes

- [`f96460e`](https://github.com/mainahq/maina/commit/f96460ecf95ca9ac84038c0713d65604956e82a2) Thanks [@beeeku](https://github.com/beeeku)! - AI-driven interactive init with API key setup, project-aware tool detection, MCP/agent file generation, landing page light mode, and Mermaid workflow diagrams.

## 1.0.0

### Major Changes

- v1.0.0: Production release. Org migration to mainahq, community infrastructure (CONTRIBUTING.md, issue templates, CODEOWNERS), brainstorm --no-interactive fix, Show HN launch.

## 0.7.0

### Minor Changes

- v0.7.0: RL flywheel — daily audit workflow, cloud feedback endpoints, `maina learn --cloud`, feedback sync module. Adds `postFeedbackBatch` and `getFeedbackImprovements` to CloudClient.

## 0.6.0

### Minor Changes

- [#53](https://github.com/beeeku/maina/pull/53) [`af6294a`](https://github.com/beeeku/maina/commit/af6294a394d35cac71853787028457b1858e01e9) Thanks [@beeeku](https://github.com/beeeku)! - v0.6.0 cloud verification

  - Cloud verification via `--cloud` flag for offloading verify runs
  - Shared type exports between CLI and core packages
  - Cloud client methods: submitVerify, getVerifyStatus, getVerifyResult
  - Default cloud URL updated to api.mainahq.com
  - Fixed snake_case API response mapping to camelCase types

## 0.5.0

### Minor Changes

- [`c978eff`](https://github.com/beeeku/maina/commit/c978eff517e566a02bb27aa2190f8bceb77bfa7e) Thanks [@beeeku](https://github.com/beeeku)! - v0.5.0 release

  - Built-in typecheck, consistency check, 0-tools warning, Biome auto-config
  - --json flag on all commands, exit codes, GitHub Action
  - PHP support, per-file language detection, ZAP DAST, Lighthouse
  - Cloud API client, OAuth device flow, team sync, cross-repo ticketing
  - Post-workflow RL trace analysis, --auto flags

## 0.4.0

### Minor Changes

- v0.5.0 — Cloud client, built-in verify, PHP, ZAP, Lighthouse, --json, GitHub Action

  **v0.3.x Hardening:**

  - Built-in typecheck (tsc --noEmit) and cross-function consistency check in verify
  - 0-tools warning, Biome auto-config in maina init
  - --auto flags for maina spec and maina design
  - Post-workflow RL trace analysis

  **v0.4.0 Polish + CI:**

  - --json flag on all commands with exit codes (0/1/2/3)
  - mainahq/verify-action GitHub Action
  - PHP language profile (PHPStan, Psalm)
  - Per-file language detection for polyglot repos
  - ZAP DAST and Lighthouse integration

  **v0.5.0 Cloud Client:**

  - Cloud API client with auth, retries, Result<T, E>
  - maina login/logout (GitHub OAuth device flow)
  - maina sync push/pull (team prompt sync)
  - maina team (team management)
  - Cross-repo ticketing with maina ticket --repo

## 0.3.0

### Minor Changes

- [`e5a82ae`](https://github.com/beeeku/maina/commit/e5a82aedb0fb61d95758d5465c424a8cff3e9e8e) Thanks [@beeeku](https://github.com/beeeku)! - v0.3.0 — AI delegation, brainstorm command, enterprise languages.

  - Structured AI delegation protocol (`---MAINA_AI_REQUEST---`) for Claude Code, Codex, OpenCode
  - `maina brainstorm` — interactive idea exploration that generates structured GitHub issues
  - C#/.NET support — dotnet format, .sln/.csproj detection
  - Java/Kotlin support — Checkstyle, pom.xml/build.gradle detection
  - 6 languages, 16 tools, 25 commands, 1017+ tests

## 0.2.2

### Patch Changes

- [`6532845`](https://github.com/beeeku/maina/commit/65328455596b1f26396a1254011916060cdb77bf) Thanks [@beeeku](https://github.com/beeeku)! - Fix npm install — move bundled workspace deps to devDependencies in CLI, use fixed version in MCP.

## 0.2.1

### Patch Changes

- [`570d0e5`](https://github.com/beeeku/maina/commit/570d0e5c8cb383d566c5901bbe3db98a40fbdf59) Thanks [@beeeku](https://github.com/beeeku)! - Fix workspace:\* dependencies not resolving on npm install. Changed to workspace:^ so changesets replaces them with ^version during publish.

- Updated dependencies [[`570d0e5`](https://github.com/beeeku/maina/commit/570d0e5c8cb383d566c5901bbe3db98a40fbdf59)]:
  - @mainahq/mcp@0.2.1

## 0.2.0

### Minor Changes

- [`59fcf84`](https://github.com/beeeku/maina/commit/59fcf844638af24ef25e849712397ff5b4b69095) Thanks [@beeeku](https://github.com/beeeku)! - Initial release of Maina — verification-first developer OS.

  - 24 CLI commands, 8 MCP tools, 5 cross-platform skills
  - 12-tool verify pipeline (Biome, Semgrep, Trivy, Secretlint, SonarQube, Stryker, diff-cover, AI review, slop detection, visual regression)
  - Multi-language support: TypeScript, Python, Go, Rust
  - Context Engine: 4-layer retrieval with PageRank relevance
  - Prompt Engine: constitution + A/B testing + feedback-driven evolution
  - Workflow context forwarding between lifecycle steps
  - Background RL feedback with post-workflow self-improvement loop
  - Visual verification with Playwright screenshots
  - Unified host delegation for Claude Code, Codex, OpenCode
  - Verification proof artifacts in PR body
  - 990 tests

### Patch Changes

- Updated dependencies [[`59fcf84`](https://github.com/beeeku/maina/commit/59fcf844638af24ef25e849712397ff5b4b69095)]:
  - @mainahq/core@0.2.0
  - @mainahq/mcp@0.2.0
