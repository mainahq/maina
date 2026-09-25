# 0042. Delete unwired verify runners (Lighthouse, ZAP) and other dead modules

Date: 2026-09-25

## Status

Accepted

## Context

The v1 rebuild (mainahq/maina#365) repositions Maina as guardrails for AI coding agents: a gate that decides in milliseconds whether an agent action is allowed, asked or denied. Task 1.6 (mainahq/maina#295) makes `knip` a failing CI check with zero findings, which forces a decision on every module that no production entry point reaches.

`packages/core/src/verify/lighthouse.ts` and `packages/core/src/verify/zap.ts` shipped in v0.4.0 (ADR 0011). They were never wired into `verify/pipeline.ts`. Their only consumers were their own tests, a re-export from `packages/core/src/index.ts`, and two `TOOL_REGISTRY` entries in `verify/detect.ts`. Those entries made `maina doctor` list them as optional tools that no command ever ran.

Both runners need a running target URL. ZAP runs through Docker and Lighthouse through headless Chrome, so each takes seconds to minutes. Their findings point at URLs, not at `file:line`. The diff-only filter keys on changed lines, so it would drop every one of those findings.

The same audit found other modules that only their own tests import:

| Module | Decision record |
|---|---|
| `core/src/github/checks.ts` | ADR 0025 |
| `core/src/github/slash-commands.ts` | ADR 0027 |
| `core/src/github/sticky-comment.ts` | none |
| `core/src/constitution/interview.ts` | ADR 0026 |
| `core/src/constitution/config-parsers.ts` | ADR 0036 (superseded in practice by `setup/scan/lint-config.ts`) |
| `core/src/constitution/pattern-sampler.ts` | ADR 0039 |
| `core/src/constitution/git-analyzer.ts` | none |
| `core/src/wiki/scip-ingest.ts` | ADR 0029 |
| `core/src/wiki/symbol-page.ts` | ADR 0041 |
| `core/src/wiki/hooks.ts` | none |
| `core/src/telemetry/cloud-reporter.ts` | ADR 0040 |
| `core/src/features/index.ts`, `core/src/stats/index.ts` | unused barrels |
| `core/src/prompts/agents/{router,debug,review}.md` | never loaded by the prompt engine |
| `cli` legacy `ensureClaudeSettings` / `buildClaudeSettingsJson` | replaced by the setup wizard |
| `docs/src/components/Hero.v2.astro` | empty A/B stub |
| `docs/scripts/generate-stats.ts`, `docs/src/data/stats.json` | output never read |

## Decision

**Delete Lighthouse and ZAP. Do not wire them in.** Apply the same rule to every module in the table above: code that no production entry point reaches is deleted, not ignored.

Options considered for Lighthouse and ZAP:

1. **Wire them into the pipeline behind a `targetUrl` config.** Rejected. They need a running application, they break the latency budget of the v1 gate, and their URL-scoped findings cannot pass the diff-only filter.
2. **Keep them as library exports for a future surface.** Rejected. Code that nothing runs rots without anyone noticing, and a knip gate with ignores does not catch the next dead module.
3. **Delete them.** Chosen. The code stays in git history (introduced in `a87fd34`) if a later surface needs dynamic analysis.

## Consequences

### Positive

- `bun run knip` runs in CI as two passes, and both must report zero findings. The first treats tests as entry points, so an export used only by a test is a valid DI seam. The second, `--production --include files`, fails on any source file that only its own test reaches.
- `maina doctor` and `TOOL_REGISTRY` stop advertising two tools the pipeline never ran.
- About 2,400 lines of unreachable source leave the repo, and their tests go with them.

### Negative

- Reviving one of these features means restoring it from git history and wiring it to a real entry point in the same PR.
- The ADRs listed above still describe designs that no longer have an implementation. Their Status sections now point here.

### Neutral

- The docs tool tables (`commands.mdx`, `engines/verify.mdx`) no longer list ZAP or Lighthouse. Aggregate tool counts in marketing copy are still typed by hand. Generating them from `TOOL_REGISTRY` is tracked separately.
