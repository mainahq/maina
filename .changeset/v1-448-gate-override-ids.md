---
"@mainahq/core": minor
---

Every gate ask or deny now has an override id that `maina allow` can resolve. When a rule reaches an ask or deny on its own (a deny rule, `rm -rf`, a push to a protected branch), `evaluateGate` now records it as the rules backend's `action.risk` answer: one decision id, confidence 1, and a `decided` entry for the log. Before this change it returned no id, so the gate message had no `maina allow <id>` to offer. A rule's allow still has no id, so allowed actions are not logged. The runtime logs these decisions to `.maina/decisions.db` like the others. For each ask or deny it also records the gate subject under `decisionIds[0]`, so `maina allow <id> --always` can build the scoped rule. `gateSubject` now adds the policy's `protected_branches` when it classifies, the same way the gate does.
