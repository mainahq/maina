# Architecture Decision Records

Each file records one decision: the context, what was decided, and what it costs. The file name is `NNNN-slug.md`, and the H1 repeats the number.

## Rules

- **Numbers are identifiers.** They are unique and contiguous, and a published number never changes meaning. `scripts/__tests__/adr-numbering.test.ts` enforces this, checks that this index lists every ADR, and checks that every `NNNN-slug` reference in tracked docs resolves.
- **Take the next free number.** Before you open a PR, rebase and check this index. If another PR merged the same number first, renumber your ADR.
- **Supersede, don't rewrite.** When a decision changes or its implementation is removed, add a note under the old ADR's Status that links to the new ADR.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-karpathy-principled-spec-quality-system.md) | Karpathy-Principled Spec Quality System | Proposed |
| [0002](0002-multi-language-verify-pipeline.md) | Multi-language verify pipeline | Accepted |
| [0003](0003-fix-host-delegation-for-cli-ai-tasks.md) | Fix host delegation for CLI AI tasks | Proposed |
| [0004](0004-workflow-context-forwarding.md) | Workflow context forwarding | Proposed |
| [0005](0005-background-rl-feedback-at-each-workflow-step.md) | Background RL feedback at each workflow step | Proposed |
| [0006](0006-post-workflow-rl-self-improvement-loop.md) | Post-workflow RL self-improvement loop | Proposed |
| [0007](0007-visual-verification-with-playwright.md) | Visual verification with Playwright | Proposed |
| [0008](0008-verification-proof-in-pr-body.md) | Verification proof in PR body | Proposed |
| [0009](0009-ai-delegation-protocol-for-host-agents.md) | AI delegation protocol for host agents | Proposed |
| [0010](0010-v03x-hardening-verify-gaps-rl-loop-hldlld.md) | v0.3.x Hardening: Verify Gaps + RL Loop + HLD/LLD | Accepted |
| [0011](0011-v040-polish-ci.md) | v0.4.0 Polish + CI | Accepted |
| [0012](0012-v050-cloud-client-maina-cloud.md) | v0.5.0 Cloud Client + maina-cloud | Accepted |
| [0013](0013-report-storage-backend-cloudflare-r2.md) | Report storage backend (Cloudflare R2) | Accepted |
| [0014](0014-experiment-gate-stagehand-orama.md) | Experiment gate criteria for Stagehand and Orama | Accepted |
| [0015](0015-cli-mcp-coequal.md) | CLI and MCP are co-equal first-class surfaces | Accepted |
| [0016](0016-error-reporting-backend.md) | Error and telemetry backend (PostHog) | Accepted |
| [0017](0017-no-workkit-search.md) | Kill decision — @workkit for wiki search | Accepted (kill) |
| [0018](0018-no-passmark.md) | Kill decision — Passmark adoption | Accepted (kill) |
| [0019](0019-no-fern-no-sdk.md) | Kill decision — Fern + multi-language SDKs | Accepted (kill) |
| [0020](0020-no-lsif.md) | No LSIF usage — SCIP is the target format | Accepted (N/A — no migration needed) |
| [0021](0021-glob-scoped-constitution-rules.md) | Glob-scoped constitution rules | Proposed |
| [0022](0022-mcp-install-badges-on-hero.md) | MCP install badges on hero | Proposed |
| [0023](0023-progressive-mcp-tool-disclosure.md) | Progressive MCP tool disclosure | Proposed |
| [0024](0024-oss-error-reporting-with-post-hog.md) | OSS error reporting with PostHog | Proposed |
| [0025](0025-git-hub-checks-api-integration.md) | GitHub Checks API integration | Accepted (implementation removed) |
| [0026](0026-interview-gap-filler-for-constitution.md) | Interview gap-filler for constitution | Accepted (implementation removed) |
| [0027](0027-slash-command-parser-for-pr-comments.md) | Slash command parser for PR comments | Accepted (implementation removed) |
| [0028](0028-visual-diff-backend-argos.md) | Visual diff backend — Argos | Accepted |
| [0029](0029-scip-type-script-ingest-for-wiki.md) | SCIP TypeScript ingest for wiki | Accepted (implementation removed) |
| [0030](0030-receipt-v1-field-schema.md) | Receipt v1 field schema | Accepted |
| [0031](0031-agent-retry-recording-policy.md) | Agent-retry recording policy | Accepted |
| [0032](0032-agent-id-format.md) | Agent.id format | Accepted |
| [0033](0033-error-id-surface-for-cli-and-mcp.md) | Error ID surface for CLI and MCP | Accepted |
| [0034](0034-wiki-is-a-view.md) | Wiki is a view of the Context engine | Accepted |
| [0035](0035-pii-and-code-content-scrubbing-library.md) | PII and code-content scrubbing library | Proposed |
| [0036](0036-lint-config-and-manifest-parsers-for-constitution.md) | Lint-config and manifest parsers for constitution | Proposed (implementation removed) |
| [0037](0037-deep-wiki-compatible-mcp-server.md) | DeepWiki-compatible MCP server | Proposed |
| [0038](0038-opt-in-usage-telemetry.md) | Opt-in usage telemetry | Proposed |
| [0039](0039-tree-sitter-pattern-sampler-for-constitution.md) | Pattern sampler for constitution rules | Accepted (implementation removed) |
| [0040](0040-cloud-error-reporting-with-account-linking.md) | Cloud error reporting with account linking | Accepted (implementation removed) |
| [0041](0041-symbol-page-templates-for-wiki.md) | Symbol page templates for wiki | Accepted (implementation removed) |
| [0042](0042-delete-unwired-verify-runners-and-dead-modules.md) | Delete unwired verify runners (Lighthouse, ZAP) and other dead modules | Accepted |
| [0043](0043-zod-for-config-and-policy-validation.md) | Zod for config and policy validation | Accepted |

## Renumbering (mainahq/maina#295)

Parallel branches created duplicate numbers from 0021 to 0027. The earliest-merged ADR kept each number, and the rest moved to the end of the sequence with `git mv`, so history is preserved:

| Old | New | Decision |
|---|---|---|
| 0021 | 0033 | Error ID surface for CLI and MCP |
| 0022 | 0034 | Wiki is a view of the Context engine |
| 0023 | 0035 | PII and code-content scrubbing library |
| 0023 | 0036 | Lint-config and manifest parsers for constitution |
| 0024 | 0037 | DeepWiki-compatible MCP server |
| 0024 | 0038 | Opt-in usage telemetry |
| 0025 | 0039 | Pattern sampler for constitution rules |
| 0026 | 0040 | Cloud error reporting with account linking |
| 0027 | 0041 | Symbol page templates for wiki |

A second copy of the "wiki is a view" ADR, an unfilled template, was deleted rather than renumbered.
