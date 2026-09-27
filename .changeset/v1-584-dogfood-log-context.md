---
"@mainahq/core": patch
---

The weekly digest's gate-log parser now reads the dogfood hook's new per-call fields: `root`, `host`, `permissionMode` and `decisionIds`. Lines written before them still parse. A line that has one of them malformed is counted as malformed. The permission modes are now listed once, as `PERMISSION_MODES` in `gate/events`, and the gate uses that list.
