---
"@mainahq/core": minor
---

Core gains the building blocks for independent review, holdout scenarios, stop outcomes, a repo brain and evidence passed by reference:

- `independentReview` runs a review on a different model vendor from the implementer. It is given only the work item, the acceptance criteria, a diff ref (it fetches the diff itself and checks the hash) and the check results. Any other field, such as implementer messages or reasoning, is rejected before the model is called.
- `loadAcceptanceCriteria` reads a feature's criteria from its `spec.md` and gives each one a stable `AC-<n>` id. `mapEvidence` joins verdicts to criteria and refuses a criterion that has no evidence.
- `buildOutcomeReceipt` issues a hashed receipt for `completed` and for the stop outcomes `clarify`, `already_satisfied` and `unsupported`. A completed or already-satisfied receipt needs every criterion to be met, with evidence.
- `runHoldout(root, feature, deps)` runs the scenarios in `.maina/holdout/<feature>/` several times each and reports a satisfaction score next to pass/fail. `maina run` hides that directory from workers through `holdoutDir`.
- `writeBrain` stores build quirks and recurring findings in `.maina/brain.json`. Unattended runs can never write to it. Attended runs need approval from a human or a yes from `decide`.
- `putArtifact` and `getArtifact` store write-once artifacts under `.maina/artifacts/`. They are passed around as `{ id, hash }` and hash-checked whenever they are read.
