---
"@mainahq/core": minor
---

Every gate evaluation is now logged, allows included. When a rule allows an action on its own (an allow rule, a `maina allow --always` rule), `evaluateGate` now records it as the rules backend's `action.risk` answer, the same way it already records a rule's ask or deny: one decision id, confidence 1, and a `decided` entry for the log. Before this change a rule's allow had no id, so the runtime logged nothing for it and the session summary, the dogfood report and drift under-counted what the gate let through. `decisionIds` is now empty only when the gate could not evaluate the event at all.
