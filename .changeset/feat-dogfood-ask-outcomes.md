---
"@mainahq/core": patch
---

The weekly digest's gate-log parser reads the dogfood hook's `toolUseId` and `sessionId` fields, and skips the hook's new `kind: "ran"` records (written when a gated tool ran) instead of counting them as malformed. Verdict counts are unchanged.
