# Decision: Karpathy-Principled Spec Quality System

> Status: **proposed**

## Context

After 8 sprints and 769 tests, maina has a complete verification pipeline for code but no quality gate for specifications. The spec/plan analyzer catches structural issues (missing sections, orphaned tasks) but doesn't measure whether specs are actually good — measurable, testable, unambiguous.

Andrej Karpathy's principles apply directly:
- "The most dangerous thing is a slightly wrong answer" — A spec that seems complete but has gaps is worse than no spec
- "You need to stare at your data" — Specs are training data for implementation. Garbage in, garbage out.
- "Loss curves don't lie" — Track spec quality metrics over time. Are they improving?

Additionally, the code review revealed we need rationalization prevention (skip tracking) and red-green enforcement for test stubs.

## Decision

Build a spec quality scoring system that:

1. **Scores specs 0-100** based on measurability, testability, ambiguity, completeness
2. **Tracks skip events** when developers bypass verification (rationalization prevention)
3. **Enforces red-green** by verifying test stubs actually fail before implementation
4. **Traces plan→code→test→commit** to ensure nothing falls through cracks
5. **Shows spec evolution** in `maina stats --specs` to prove quality is trending up

All checks are deterministic — no AI needed. This is the Karpathy principle: measure everything, trust nothing.

## Rationale

### Positive

- Specs become measurably better over time (tracked via stats)
- Developers can't rationalize skipping verification without it being recorded
- Test stubs that pass immediately are flagged as suspicious (not testing anything)
- Every plan task is traceable to test + code + commit

### Negative

- Additional overhead on each commit (spec quality check)
- False positives from measurability heuristics (vague verb detection isn't perfect)
- Skip tracking might feel punitive — needs to be presented as data, not judgment

### Neutral

- Requires cultural shift: specs are first-class artifacts, not throwaway docs
- Quality scores are relative to the project — not comparable across projects
