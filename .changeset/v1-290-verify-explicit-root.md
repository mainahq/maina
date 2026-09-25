---
"@mainahq/core": major
"@mainahq/cli": patch
"@mainahq/mcp": patch
---

Verify engine takes an explicit repository root and an injected environment instead of reading `process.cwd()`/`process.env`. `runPipeline`, `gatherVerificationProof`, `detectSlop`, `syntaxGuard`, `filterIgnoredFiles`, `runSemgrep`, `runTrivy`, `runSecretlint`, `runSonar`, `runMutation`, `runCoverage` and `captureScreenshot` now require the root (`cwd`/`root`); `detectTool(name, root)`, `isToolAvailable(name, root)` and `detectTools(root, languages?)` resolve local binaries from it. `runPipeline`/`runTypecheck` accept `env` for spawned checkers (the CLI and MCP pass their process environment). The pipeline's default `.maina` dir now resolves against the root.
