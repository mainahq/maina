---
"@mainahq/core": minor
---

Model routing now comes from the `task.tier` decision with its confidence: an easy task keeps the cheaper tier when the decision is at or above the policy threshold, an uncertain one goes to the top tier. `budget.dailyUsd` / `budget.perTaskUsd` are enforced before every model call: `onBreach: "degrade"` drops to the most capable lower tier that fits, `"stop"` returns a message naming the cap. Each routing decision is logged with its savings estimate. The never-implemented `local` (Ollama) tier is removed; a 1.x `maina.config.ts` that still sets `models.local` keeps loading.
