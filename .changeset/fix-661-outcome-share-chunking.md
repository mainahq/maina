---
"@mainahq/core": patch
---

Opt-in outcome sharing now splits a share into requests of at most 100 outcomes and 64 KiB, the cloud's per-request caps, so a large share is no longer refused whole. `sent` sums the outcomes each accepted request took; the first failed request stops the share, and the error says how many were already sent (`payload_too_large` for a 413, `rate_limited` for a 429).
