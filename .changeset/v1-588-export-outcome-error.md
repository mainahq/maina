---
"@mainahq/core": patch
---

`@mainahq/core` now exports `OUTCOME_ERROR`, `DEFAULT_ERROR_COSTS` and the `ErrorKind` type. `OUTCOME_ERROR` maps each outcome to the kind of error it records: `null` for `accepted`, `false_positive` for `override`, `dismissed` and `rejected`, and `false_negative` for `reverted`, `hotfixed` and `test_failed_after_allow`. `DEFAULT_ERROR_COSTS` gives the default `error_costs` for each decision type, in `DECISION_TYPES` order. For `action.risk` and `diff.sensitive`, a false negative costs 10 and a false positive costs 1. For every other type, both cost 1. Both constants are frozen. `verdictOf` and the default policy read from them, so the model catalog generator can read these values from core rather than keep its own copy. Behaviour does not change.
