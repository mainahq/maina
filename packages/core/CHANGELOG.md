# @mainahq/core

## 0.3.0

### Minor Changes

- [`e5a82ae`](https://github.com/beeeku/maina/commit/e5a82aedb0fb61d95758d5465c424a8cff3e9e8e) Thanks [@beeeku](https://github.com/beeeku)! - v0.3.0 — AI delegation, brainstorm command, enterprise languages.

  - Structured AI delegation protocol (`---MAINA_AI_REQUEST---`) for Claude Code, Codex, OpenCode
  - `maina brainstorm` — interactive idea exploration that generates structured GitHub issues
  - C#/.NET support — dotnet format, .sln/.csproj detection
  - Java/Kotlin support — Checkstyle, pom.xml/build.gradle detection
  - 6 languages, 16 tools, 25 commands, 1017+ tests

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
