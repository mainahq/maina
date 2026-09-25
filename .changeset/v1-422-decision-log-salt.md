---
"@mainahq/core": minor
---

Decision log privacy: input, schema and option hashes can now be keyed by a per-repo random salt (`loadLogSalt`, stored in `.maina/private/log-salt`, which ignores itself in git and is never shared), so a list of repo files no longer reveals which path a hash stands for. Policy gains `log.paths: "hashed" | "plain"` (default `hashed`), and `logPrivacy(policy, salt)` turns it into the log's privacy settings.
