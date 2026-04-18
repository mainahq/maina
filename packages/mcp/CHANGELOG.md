# @mainahq/mcp

## 1.3.0

### Patch Changes

- [`4fcf247`](https://github.com/mainahq/maina/commit/4fcf2479cf316403126a13668ee7f1ba1c18de64) Thanks [@beeeku](https://github.com/beeeku)! - feat(cli): zero-friction setup wizard

  Adds `maina setup`, a one-command onboarding wizard that detects your stack,
  tailors a constitution via host-delegated or cloud AI (anonymous, no API key),
  scaffolds 5 agent instruction files with non-destructive managed regions,
  seeds the codebase wiki, and runs verify to surface a real finding inline —
  all in under 60 seconds.

  - `--ci` mode emits per-phase JSON for automation
  - `--update` re-tailors constitution + agent files for the current stack
  - `--reset` backs up `.maina/` and starts fresh
  - `--agents <list>` scopes which agent files are written
  - `maina configure` is now a deprecated alias for `setup --update` (removed in v1.5)

  Docs: new `getting-started.mdx` features the wizard as the primary CTA. The
  previous `quickstart` page redirects to `/getting-started`. `full-setup` is
  demoted under "Advanced" as the long-form reference. Landing-page hero and
  root `README.md` now lead with `bunx @mainahq/cli@latest setup`.

- Updated dependencies [[`4fcf247`](https://github.com/mainahq/maina/commit/4fcf2479cf316403126a13668ee7f1ba1c18de64)]:
  - @mainahq/core@1.3.0

## 1.2.0

### Minor Changes

- v1.2.0 — 50 issues shipped across 6 milestones:

  **Init & Wiki fixes:**

  - CI workflow uses actual package.json script names and `maina verify`
  - Constitution architecture enriched for monorepos (workspace layout, package names)
  - Wiki reads descriptions from package.json, modules use meaningful names (not cluster-N)
  - MCP getContext output capped at 50K chars to prevent token limit errors
  - MCP responses use `{ data, error, meta }` envelope
  - Builtin secret checker skips test files and test fixture values

  **Onboarding:**

  - New /quickstart page (3 commands, under 60 seconds)
  - MCP install badges for Claude Code, Cursor, Windsurf on hero
  - Build-time stats generator (single source of truth for docs numbers)
  - 5 cookbook pages (CI verify, Claude Code, CodeRabbit, constitution check, Playwright MCP)
  - 4 blog posts (no SDK, no Passmark, no custom search, wiki-is-a-view)

  **Constitution rebuild (derived, not authored):**

  - Import adapters for existing rule files (CLAUDE.md, AGENTS.md, .cursorrules, etc.)
  - Git-log + CI analyzer (commit conventions, hot paths, CI workflows, CODEOWNERS)
  - Lint-config + manifest parsers (biome, eslint, tsconfig, editorconfig, prettier, package.json)
  - Pattern sampler (async style, function style, import style, error handling)
  - Glob-scoped constitution rules via constitution.d/\*.md
  - Interview gap-filler with rejected rules persistence

  **PR comment v2:**

  - Sticky root-comment writer (find-or-create via marker, race-safe)
  - GitHub Checks API integration (success/failure/neutral, annotations, merge gating)
  - Slash command parser (/maina retry, explain, approve)

  **Error reporting & telemetry:**

  - PII and code-content scrubbing library (paths, secrets, emails, IPs, env values)
  - Error ID generation (deterministic 6-char IDs, CLI + MCP surfaces)
  - OSS error reporting (opt-in, consent-gated, PostHog-ready)
  - Cloud error reporting (opt-out, account-linked, user_id/org_id/plan_tier)
  - Usage telemetry (separate consent, anonymous events)

  **MCP & Wiki:**

  - Progressive tool disclosure (list_tools meta-tool, 14 total tools)
  - DeepWiki-compatible MCP server (ask_question, read_wiki_structure, read_wiki_contents)
  - Symbol page templates with Mermaid call graphs + LLM prose
  - SCIP TypeScript ingest (subprocess runner, JSON parser, monorepo tsconfig discovery)
  - Wiki repositioned as "a view of the Context engine"

  **CI & Infra:**

  - Source map generation + release artifact upload
  - Dep bumps (biome 2.4.12, bun-types 1.3.12, knip 6.4.1, lefthook 2.1.6, vite 8.0.8)

  **ADRs:** 17 architecture decision records (0013-0029)

### Patch Changes

- Updated dependencies []:
  - @mainahq/core@1.2.0

## 1.1.5

### Patch Changes

- [#84](https://github.com/mainahq/maina/pull/84) [`4ba53e6`](https://github.com/mainahq/maina/commit/4ba53e64e688ea1e6e53149211d9b285bfcfe126) Thanks [@beeeku](https://github.com/beeeku)! - Fix init, wiki, and MCP issues:

  - fix(core): CI workflow template uses actual package.json script names instead of hardcoded `bun run check` ([#79](https://github.com/mainahq/maina/issues/79))
  - feat(core): CI workflow uses `maina verify` with cloud and fallback options ([#82](https://github.com/mainahq/maina/issues/82))
  - feat(core): constitution architecture section includes workspace layout, package names, and project description for monorepos ([#83](https://github.com/mainahq/maina/issues/83))
  - fix(core): wiki architecture article reads descriptions from package.json with README fallback instead of hardcoded dictionary ([#81](https://github.com/mainahq/maina/issues/81))
  - fix(core): wiki module articles use meaningful names derived from file paths instead of generic cluster-N ([#80](https://github.com/mainahq/maina/issues/80))
  - fix(mcp): cap getContext output at 50K characters and use focused budget to prevent MCP token limit errors

- Updated dependencies [[`4ba53e6`](https://github.com/mainahq/maina/commit/4ba53e64e688ea1e6e53149211d9b285bfcfe126)]:
  - @mainahq/core@1.1.5

## 1.1.3

### Patch Changes

- [`f94987f`](https://github.com/mainahq/maina/commit/f94987f6bbc490c37f64f8dc66240319e63ffcb6) Thanks [@beeeku](https://github.com/beeeku)! - Fix MCP server inside Claude Code: suppress all delegation output in MCP server mode via MAINA_MCP_SERVER env flag. Prevents stderr pollution that breaks MCP JSON-RPC communication.

- Updated dependencies [[`f94987f`](https://github.com/mainahq/maina/commit/f94987f6bbc490c37f64f8dc66240319e63ffcb6)]:
  - @mainahq/core@1.1.3

## 1.1.2

### Patch Changes

- [`10649d3`](https://github.com/mainahq/maina/commit/10649d3733a38a1530ff3a2eb09a6123455fe84d) Thanks [@beeeku](https://github.com/beeeku)! - Post-release fixes: Orama search, wiki-aware commands, 12-tool support, install script, delegation output suppression, cloud sync fix, non-interactive mode.

- Updated dependencies [[`10649d3`](https://github.com/mainahq/maina/commit/10649d3733a38a1530ff3a2eb09a6123455fe84d)]:
  - @mainahq/core@1.1.2

## 1.1.1

### Patch Changes

- [#73](https://github.com/mainahq/maina/pull/73) [`331c58d`](https://github.com/mainahq/maina/commit/331c58d6287658934d8b434dffa5fab88a6db06e) Thanks [@beeeku](https://github.com/beeeku)! - Post-release fixes: MCP stdout fix, 12-tool support, install script, CI test fixes, docs updates.

- Updated dependencies [[`331c58d`](https://github.com/mainahq/maina/commit/331c58d6287658934d8b434dffa5fab88a6db06e)]:
  - @mainahq/core@1.1.1

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

### Patch Changes

- Updated dependencies [[`95e8d0b`](https://github.com/mainahq/maina/commit/95e8d0b47a94e3e9a4775b00afbb114c9a6740ae), [`3ae23de`](https://github.com/mainahq/maina/commit/3ae23de520dcfe6c75b5ffbe70d11af87c40ec99)]:
  - @mainahq/core@1.1.0

## 1.0.3

### Patch Changes

- Graceful AI failure messages, built-in verify checks (7 checks without external linters), merge maina sections into existing agent files, and AI status in maina doctor.

- Updated dependencies []:
  - @mainahq/core@1.0.3

## 1.0.1

### Patch Changes

- [`f96460e`](https://github.com/mainahq/maina/commit/f96460ecf95ca9ac84038c0713d65604956e82a2) Thanks [@beeeku](https://github.com/beeeku)! - AI-driven interactive init with API key setup, project-aware tool detection, MCP/agent file generation, landing page light mode, and Mermaid workflow diagrams.

- Updated dependencies [[`f96460e`](https://github.com/mainahq/maina/commit/f96460ecf95ca9ac84038c0713d65604956e82a2)]:
  - @mainahq/core@1.0.1

## 1.0.0

### Major Changes

- v1.0.0: Production release. Org migration to mainahq, community infrastructure (CONTRIBUTING.md, issue templates, CODEOWNERS), brainstorm --no-interactive fix, Show HN launch.

### Patch Changes

- Updated dependencies []:
  - @mainahq/core@1.0.0

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @mainahq/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`af6294a`](https://github.com/beeeku/maina/commit/af6294a394d35cac71853787028457b1858e01e9)]:
  - @mainahq/core@0.6.0

## 0.5.0

### Minor Changes

- [`c978eff`](https://github.com/beeeku/maina/commit/c978eff517e566a02bb27aa2190f8bceb77bfa7e) Thanks [@beeeku](https://github.com/beeeku)! - v0.5.0 release

  - Built-in typecheck, consistency check, 0-tools warning, Biome auto-config
  - --json flag on all commands, exit codes, GitHub Action
  - PHP support, per-file language detection, ZAP DAST, Lighthouse
  - Cloud API client, OAuth device flow, team sync, cross-repo ticketing
  - Post-workflow RL trace analysis, --auto flags

### Patch Changes

- Updated dependencies [[`c978eff`](https://github.com/beeeku/maina/commit/c978eff517e566a02bb27aa2190f8bceb77bfa7e)]:
  - @mainahq/core@0.5.0

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

### Patch Changes

- Updated dependencies []:
  - @mainahq/core@0.4.0

## 0.3.0

### Minor Changes

- [`e5a82ae`](https://github.com/beeeku/maina/commit/e5a82aedb0fb61d95758d5465c424a8cff3e9e8e) Thanks [@beeeku](https://github.com/beeeku)! - v0.3.0 — AI delegation, brainstorm command, enterprise languages.

  - Structured AI delegation protocol (`---MAINA_AI_REQUEST---`) for Claude Code, Codex, OpenCode
  - `maina brainstorm` — interactive idea exploration that generates structured GitHub issues
  - C#/.NET support — dotnet format, .sln/.csproj detection
  - Java/Kotlin support — Checkstyle, pom.xml/build.gradle detection
  - 6 languages, 16 tools, 25 commands, 1017+ tests

### Patch Changes

- Updated dependencies [[`e5a82ae`](https://github.com/beeeku/maina/commit/e5a82aedb0fb61d95758d5465c424a8cff3e9e8e)]:
  - @mainahq/core@0.3.0

## 0.2.2

### Patch Changes

- [`6532845`](https://github.com/beeeku/maina/commit/65328455596b1f26396a1254011916060cdb77bf) Thanks [@beeeku](https://github.com/beeeku)! - Fix npm install — move bundled workspace deps to devDependencies in CLI, use fixed version in MCP.

## 0.2.1

### Patch Changes

- [`570d0e5`](https://github.com/beeeku/maina/commit/570d0e5c8cb383d566c5901bbe3db98a40fbdf59) Thanks [@beeeku](https://github.com/beeeku)! - Fix workspace:\* dependencies not resolving on npm install. Changed to workspace:^ so changesets replaces them with ^version during publish.

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
