---
"@mainahq/core": minor
"@mainahq/cli": patch
---

Policy confidence thresholds now resolve per backend. `decisions.<type>.thresholds.confidence` is optional in the resolved policy too, and the built-in policy no longer sets it. When it is unset, `confidenceThreshold(policy, type, decision.backend)` picks the default by the backend that answered: `rules` and `heuristic` keep 0.9 for `action.risk` and `diff.sensitive` and 0.8 otherwise; `system1` gets 0 for `action.risk`, because it applies its calibrated thresholds before it answers, and the calibrated `calibration.thresholds[type].confidence` for other types, where `null` means never act. A value set in the policy still wins, so it stays a floor on top of `system1`. A backend can now carry a `calibration` (its calibration file's sha256 plus per-type thresholds), which every `Decision.backend` it answers carries too. That sha is part of the logged `policyHash` and `modelHash`. An uncalibrated backend's `modelHash` does not change. The built-in policy's `policyHash` does, because it no longer lists thresholds.
