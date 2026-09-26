---
"@mainahq/core": patch
---

The `hardcoded-secret` check no longer flags an environment variable or CI secret name used as a value, such as `secret: ANTHROPIC_API_KEY` in a GitHub Actions matrix. A value in SCREAMING_SNAKE_CASE with at least one underscore is treated as a variable name, not a credential. All-caps values without an underscore are still flagged.
