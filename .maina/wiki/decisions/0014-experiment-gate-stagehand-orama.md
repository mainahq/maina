# Decision: Experiment gate criteria for Stagehand and Orama

> Status: **accepted**

## Context

Week 5 includes two experimental spikes: Stagehand (AI-driven browser automation as a Playwright alternative) and Orama (hybrid BM25+vector search for wiki). Without pre-defined go/no-go criteria, "we invested time so let's ship it" bias takes over.

## Decision

### Stagehand Gate (`docs/decisions/0002-stagehand-gate.md`)

Ship only if ALL criteria are met across 50 benchmark runs:

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| Pass rate | ≥95% | Playwright baseline is ~99%; 95% is acceptable for AI-driven |
| Token cost per verify | ≤$0.05 | Must be viable at 100k runs/mo ($5k ceiling) |
| Cache hit rate (after first run) | ≥80% | Same flow on same page should cache; AI variance is the risk |

### Orama Gate (`docs/decisions/0003-orama-gate.md`)

Ship only if ALL criteria are met on a 30-query test set across 100 wiki pages:

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| NDCG@10 improvement over lexical | ≥15% | Must justify the embedding cost |
| Index size vs lexical | ≤2x | Storage tradeoff must be reasonable |
| p95 query latency | ≤50ms | Must feel instant in MCP tool responses |

### Default: Kill

If criteria aren't met, the experiment is killed. No negotiation — the gates are the gates.

## Rationale

### Positive

- Clear, measurable decision criteria prevent sunk-cost shipping
- Benchmark methodology is reusable for future experiments
- Team alignment before investment

### Negative

- Strict gates may kill a feature that's "close enough" — accepted tradeoff
- Requires writing benchmarks before the spike (small upfront cost)
