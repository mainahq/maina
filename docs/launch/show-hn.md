# Show HN: Maina — verification-first OS that proves AI code is correct before it merges

AI writes 41% of code today, with 1.7x more defects than human code. We built Maina to fix this.

Maina is an open-source CLI + MCP server that runs a 16-tool verification pipeline on every commit. It catches bugs, security issues, and AI slop patterns before they reach your PR. It learns your preferences over time and gets smarter with every accept/reject.

## What it does

- **16-tool pipeline** running in parallel: Biome, Semgrep, Trivy, Secretlint, SonarQube, Stryker, diff-cover, AI review, slop detection, visual regression, and more
- **6 languages**: TypeScript, Python, Go, Rust, C#, Java — auto-detected
- **MCP server** that works inside Claude Code, Cursor, Codex, Gemini CLI
- **RL feedback loop**: every accept/reject feeds prompt evolution via A/B testing
- **Cloud verification**: `maina verify --cloud` for CI pipelines, GitHub Action (`mainahq/verify-action@v1`), GitHub App for automatic PR checks
- **Zero config**: `bunx @mainahq/cli && maina init` and you're running

## Architecture

Three engines:
1. **Context Engine** — 4-layer retrieval (working, episodic, semantic, retrieval) with PageRank-scored dependency graphs
2. **Prompt Engine** — constitution + custom prompts, hashed and versioned, A/B tested
3. **Verify Engine** — syntax guard → parallel tools → diff-only filter → AI fix → two-stage review

## What makes it different

- **Verification-first, not generation-first.** We don't write code. We prove code is correct.
- **Diff-only.** We only report findings on changed lines. No noise from legacy code.
- **Learns.** Prompts evolve based on your feedback. Cloud sync aggregates learning across teams.
- **Works inside your AI tool.** MCP server means Claude/Cursor/Codex call maina automatically.

## Built with

Bun, TypeScript, Cloudflare Workers, Hono, tree-sitter, Vercel AI SDK. Cloud backend uses @workkit packages.

## Links

- GitHub: https://github.com/mainahq/maina
- Docs: https://mainahq.com
- npm: https://www.npmjs.com/package/@mainahq/cli
- GitHub Action: https://github.com/mainahq/verify-action

1156 tests, Apache 2.0 license. Would love feedback from the HN community.
