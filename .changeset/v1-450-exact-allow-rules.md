---
"@mainahq/core": minor
"@mainahq/cli": patch
---

Policy rules take an optional `exact: true` (in the schema and the generated `schemas/policy.schema.json`): an exact rule matches the whole command, path, tool or URL literally, with no `*` globbing and, for a shell rule, no extra arguments. `scopedAllowRules` now marks every rule it writes as exact, so a shell command remembered with `maina allow <decision-id> --always` no longer also allows the same command with more arguments (`bun test` no longer covers `bun test --anything`). Rules without `exact` keep their pattern semantics, so a wider rule is still a pattern written into the policy by hand. The CLI output labels remembered rules `(exact)`.
