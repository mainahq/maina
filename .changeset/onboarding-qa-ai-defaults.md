---
"@mainahq/core": minor
"@mainahq/cli": minor
---

**AI defaults refreshed + cloud timeout fixed.** Two correctness issues caught during post-waves QA:

- **Model tier defaults** were pinned to Claude Sonnet 4 (May 2025) for both `standard` and `architectural`, which silently downgraded `maina design-review`, `maina learn`, and every architecture-class call to a mid-tier model. Bumped to the current Claude 4.X family: `mechanical` → Haiku 4.5, `standard` → Sonnet 4.6, `architectural` → Opus 4.7. The tiers are now genuinely distinct. Override per-repo with `maina.config.ts`; override the default provider with `MAINA_PROVIDER`.
- **Cloud setup gateway timeout** was 2 s, but the gateway at `api.mainahq.com/v1/setup` responds in 8–13 s in practice. Every cloud call timed out and fell through to BYOK or degraded — the working middle tier was invisible. Raised the default to 20 s and added `MAINA_CLOUD_TIMEOUT_MS` env override. The per-call `cloudTimeoutMs` option still takes precedence.
