# Decision: v0.3.x Hardening: Verify Gaps + RL Loop + HLD/LLD

> Status: **accepted**

## Context

Tier 3 benchmark (2026-04-03): SpecKit achieved 100% on 95 hidden validation tests. Maina got 97.9% (2 bugs). SpecKit's 58s self-review caught 4 issues that Maina's verify pipeline missed because no external tools were installed. `maina verify` returned "0 findings, passed" — false confidence.

Additionally, `maina design` only produces ADR scaffolds with no HLD/LLD generation, `maina spec` and `maina design` lack `--auto` flags (blocking CI/benchmark automation), and the RL loop doesn't close automatically after workflow completion.

## Decision

Add built-in verification checks that work without external tools, AI-powered review via delegation protocol, HLD/LLD generation in design, automation flags, and automatic post-workflow RL trace analysis. Execute sequentially: deterministic checks first, then AI features, then automation.

## Rationale

### Positive

- `maina verify` produces meaningful findings on any project, even with 0 external tools installed
- AI self-review catches cross-function consistency bugs that deterministic tools miss
- `maina design` generates useful HLD/LLD from spec, not just empty templates
- `--auto` flags enable full workflow automation in CI and benchmarks
- RL loop closes automatically — prompts improve without human intervention

### Negative

- AI self-review adds latency (~3s mechanical, ~15s deep)
- Cross-function consistency check depends on tree-sitter AST quality per language
- Automatic RL could theoretically degrade prompts (mitigated by A/B testing with rollback)

### Neutral

- Built-in typecheck duplicates what external tools do, but guarantees baseline coverage
- HLD/LLD quality depends on spec quality — garbage in, garbage out
