---
"@mainahq/core": minor
---

Session summary of gate and routing outcomes (FR-RET-2). `summarise(slice, { routing })` counts, from a decision log slice, the gate events that were blocked, asked and allowed (the two halves of a two-order check count as one event, and shadow records are left out). It also counts the tasks routed to a model tier, estimates what routing saved against a baseline tier from caller-supplied per-task costs, and reports the p95 of the latency Maina added per event. It returns `null` when the session had no gate or routing event. `formatSessionSummary(summary, receiptUrl?)` renders the one line a host adapter shows on `session.stop`, with the receipt link, and returns `undefined` (stays silent) when nothing happened.
