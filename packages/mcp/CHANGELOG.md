# @mainahq/mcp

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
