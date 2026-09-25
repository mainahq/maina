---
"@mainahq/core": minor
---

Add an append-only decision log. `buildDecisionRecord` turns a `decide` result into a record of stable sha256 hashes (input, question schema, policy, model), the option order, the distribution, the answer and the action taken; `appendDecision` validates and stores it through the `DbPort`, and `queryDecisions` reads it back by type, hash, session, host or time window. `migrateDecisionLog` creates the `decision_log` table with triggers that refuse UPDATE, DELETE and replacing inserts. Records never hold raw code, diff text or paths: free-form option strings are hashed unless `DecisionLogPrivacy.rawOptions` is set.
