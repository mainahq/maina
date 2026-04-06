# @mainahq/cli

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
