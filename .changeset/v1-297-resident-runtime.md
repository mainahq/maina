---
"@mainahq/core": patch
---

Export the gate verdict catalog (`VERDICTS`, `Verdict`) from the package root, so the resident runtime (#297) validates `allow | ask | deny` against the same list as the policy schema instead of redefining it.
