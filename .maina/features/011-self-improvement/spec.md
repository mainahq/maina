# Feature 011: Self-Improvement — Context Hydration & RL-Driven Prompt Evolution

## Problem

Maina's context engine has 4 layers but 3 are effectively empty:
- **Semantic:** 0 entities, 0 dependency edges — tree-sitter code exists but never runs at startup
- **Episodic:** 0 entries — accepted reviews aren't compressed into episodes
- **Cache:** 283 entries but 0% hit rate — cache keys may not be stable after host delegation fix

The review prompt has a **44% accept rate** (16/36 samples). Console-log slop detection has **64% false positive rate**.

Result: maina spends time assembling empty context, review output is rejected more than accepted, and verification findings erode user trust.

## Why Now

The tier 3 benchmark proved both pipelines produce identical quality. Maina's differentiator is verification + context — but context is empty and review is rejected half the time. Fixing these makes the actual tool better, not just the benchmark.

## Success Criteria

- **SC-1:** Semantic index populated on `maina init` and refreshed on `maina context` (entities + edges in DB)
- **SC-2:** Episodic entries auto-created from accepted `maina commit` reviews (compressed to <500 tokens)
- **SC-3:** Review prompt A/B candidate created targeting >60% accept rate
- **SC-4:** Cache hit rate measurable and >0% on repeated queries
- **SC-5:** Console-log slop rule respects `preferences.json` false positive threshold (skip if >50% FP)
- **SC-6:** Benchmark command wired into CLI entrypoint
- **SC-7:** `maina learn` outputs actionable prompt diff, not just stats table

## Out of Scope

- LSP/Zoekt integration (ripgrep is sufficient for now)
- New CLI commands
