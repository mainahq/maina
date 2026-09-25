---
"@mainahq/core": minor
---

Add outcome capture linked to logged decisions (FR-DEC-4). `linkOutcome` records what happened after a decision (`override`, `dismissed`, `accepted`, `rejected`, `reverted`, `hotfixed`, `test_failed_after_allow`) in an append-only `decision_outcome` table; linking the same decision, outcome and ref twice is a no-op. `linkDecisionCommit` ties decisions to the commit they were made for, and `mineGitOutcomes` walks the commits after a ref through the git port, linking `reverted` for `git revert` commits and `hotfixed` for a fix-marked commit that touches a hunk added by one of the previous N commits (default 5) to their `diff.*` decisions. Mining is idempotent and stores only shas, never paths or diff text. `linkTestFailure` links `test_failed_after_allow` to a commit's `allow` decisions. `migrateDecisionOutcomes` creates both tables (and the decision log).
