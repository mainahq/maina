---
"@mainahq/core": patch
---

Context commands that use the episodic layer (such as `review` and `verify`) no longer hang for about 43 seconds when maina cloud is slow or unreachable. The team-entry fetch now makes one attempt capped at 1.5 seconds, is skipped when you are not logged in, and caches its result (success for 10 minutes, failure for 2 minutes) in `.maina/cache/episodic-cloud.json`.
