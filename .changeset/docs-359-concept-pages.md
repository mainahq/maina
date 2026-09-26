---
"@mainahq/core": patch
---

`DECISION_BACKENDS` (`rules`, `heuristic`, `system1`) is exported from the policy schema, so the docs checks read the backend list from the code instead of repeating it.
