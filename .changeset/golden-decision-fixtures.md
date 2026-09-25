---
"@mainahq/core": patch
---

Add golden fixtures that pin the current output of every heuristic decision site (plan checklist, cross-artifact analyzer, spec quality, two-stage review, external-review categorisation, false-positive preferences, slop detector, AI output validation, wiki consult, relevance scoring, model tiers). Regenerate them with `bun scripts/golden-capture.ts`. The fixtures are left out of the published package. Runtime behaviour does not change.
