---
"@mainahq/core": patch
---

The weekly digest's gate-log parser reads the dogfood hook's `toolUseId` and `sessionId` fields, and skips the hook's new outcome records (`kind: "ran"`, written when a gated tool ran or ran and failed, and `kind: "denied"`, written when the auto-mode classifier denied it) instead of counting them as malformed. Verdict counts are unchanged.
