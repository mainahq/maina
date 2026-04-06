---
"@mainahq/cli": minor
"@mainahq/core": minor
---

v0.6.0 cloud verification

- Cloud verification via `--cloud` flag for offloading verify runs
- Shared type exports between CLI and core packages
- Cloud client methods: submitVerify, getVerifyStatus, getVerifyResult
- Default cloud URL updated to api.mainahq.com
- Fixed snake_case API response mapping to camelCase types
