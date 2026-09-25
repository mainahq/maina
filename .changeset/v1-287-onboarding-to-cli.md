---
"@mainahq/core": major
"@mainahq/cli": patch
---

Move onboarding and host MCP config out of `@mainahq/core` into the CLI (FR-INS-5). The `init` bootstrapper, the `setup` wizard primitives (agent-file writers, stack context, constitution tailoring, setup AI resolution, skills deploy, setup telemetry) and the MCP client registry, launcher detection and `runAdd`/`runRemove`/`runList` now live in `@mainahq/cli` under `src/onboarding` and `src/hosts`. `@mainahq/core` no longer exports `bootstrap`, `buildMainaSection`, `buildMainaEntry`, `MAINA_MCP_KEY`, `detectLauncher`, `isDirectBinary`, `resetLauncherCache`, `buildClientRegistry`, `listClientIds`, `runAdd`, `runRemove`, `runList`, any `setup` export (`resolveSetupAI`, `writeAllAgentFiles`, `writeClaudeSettings`, `writeCursorMcp`, `scanRepo`, `confirmRules`, …) or their types, and drops its `@iarna/toml` dependency; it now exports `detectFileLanguage`. The setup templates are inlined at build time so the bundled CLI no longer reads them from disk. The rule scanners (`scanRepo`, `scanLintConfig`, `scanGitLog`, `scanTreeSitter`) and `confirmRules` were never called by `maina setup` and are deleted.
