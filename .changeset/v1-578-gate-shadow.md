---
"@mainahq/core": minor
---

A candidate model can now run in shadow on every gate event. The new `gateShadowRequests` lists both orders of an evaluated event's `action.risk` request, keyed by the gate's decision ids. The new `logShadow` asks a shadow backend about a decision that is already made and logged, and logs each answer as `<decision id>:shadow`, so it pairs with the gate's own record and any outcome linked to it. `shadowInput` gives the input the shadow is handed, so a runtime can run an async model ahead of time. The runtime runs these shadow batches one at a time after the host has its answer. Each input is capped at 24 windows, and a WASM-only model runs in shadow only. A shadow answer never changes a verdict.
