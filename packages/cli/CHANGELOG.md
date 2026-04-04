# @mainahq/cli

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
