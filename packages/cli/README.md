# @maina/cli

Command-line interface for Maina — the verification-first developer OS.

## Install

```bash
bunx maina          # Run without installing
bun add -g @maina/cli  # Install globally
```

## Commands

### Define
- `maina ticket` — Create GitHub Issue with module tagging
- `maina context` — Generate focused codebase context
- `maina explain` — Mermaid dependency diagrams + module summaries
- `maina design` — Scaffold Architecture Decision Records with HLD/LLD
- `maina review-design` — Review ADR against constitution

### Build
- `maina plan` — Create feature branch with structured spec/plan
- `maina spec` — Generate TDD test stubs from plan
- `maina commit` — Syntax guard + parallel verification + git commit

### Verify
- `maina verify` — Full verification pipeline (12 tools)
- `maina verify --deep` — Add AI semantic review
- `maina verify --visual` — Add Playwright visual regression
- `maina slop` — Standalone AI slop pattern detection
- `maina analyze` — Cross-artifact consistency check
- `maina pr` — Create PR with two-stage review + verification proof

### Meta
- `maina learn` — Analyse feedback, evolve prompts via A/B testing
- `maina visual update` — Capture visual baselines
- `maina stats` — Verification metrics and trends
- `maina doctor` — Tool health check
- `maina init` — Bootstrap Maina in any repo
- `maina init --install` — Auto-install missing verification tools

## License

Apache-2.0
