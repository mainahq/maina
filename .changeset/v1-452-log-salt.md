---
"@mainahq/core": minor
---

`evaluateGate` now returns `decided` when an `action.risk` decision was made. It holds the policy `decide` ran with, plus each request and its decision, in the same order as `decisionIds`, so a caller can log the verdict. The runtime gate uses it to append every gate decision to `.maina/decisions.db`. Each record is keyed by the repo's own salt (`loadLogSalt` then `logPrivacy(policy, salt)`), and the salt is loaded once per root. If the salt can't be loaded, nothing is logged, so no record is ever written unsalted. A logging failure never changes the verdict.
