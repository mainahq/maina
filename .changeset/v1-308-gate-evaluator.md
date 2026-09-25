---
"@mainahq/core": minor
---

Add `evaluateGate(ports, event, policy)`, the gate evaluator: the rules engine, then `decide("action.risk")`, then the policy's confidence threshold. It is monotonic (a model answer can tighten a rule result, never loosen it) and fails closed (a backend error, an answer over the time budget, low confidence or a two-order disagreement on a high-risk action asks). Only closed-catalog values reach the trusted segment of the decide request. No allow rule reaches an irreversible class, and a repo policy's `explicitly_allow` takes effect only for classes the user confirmed (`GatePorts.confirmedLoosenings`). Also exports `withBackend`.
