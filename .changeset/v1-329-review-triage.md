---
"@mainahq/core": minor
"@mainahq/cli": minor
---

verify: findings and the review are now triaged through `decide` (#329).

- Every finding gets a `realProbability` (from `finding.real`). The noise filter drops a finding only when the backend is confident it is noise at the policy's `finding.real` confidence threshold, and shows one that is more likely noise than real one severity lower (`finding.severity`). It no longer drops every rule dismissed more than half the time: with the default 0.8 threshold, a rule dismissed 60% of the time is downgraded, not hidden.
- `diff.needs_review` decides whether the diff needs the standard-tier AI review: large (over 300 changed lines), wide (over 15 files) or security-sensitive diffs get it without `--deep`; `--deep` still forces it.
- Receipts record the triage decision as `triage: { decisionId, needsReview, confidence }` and each finding's `realProbability`; `verifyReceipt` validates both when present.
- The AI review now sees the bodies of the functions a diff calls, read from the code graph (`.maina/graph`). Before, it was always given none.
