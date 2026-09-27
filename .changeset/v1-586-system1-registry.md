---
"@mainahq/core": patch
---

`system1` now only serves the ten decision types the model covers (`action.risk`, `diff.sensitive`, `diff.needs_review`, `task.tier`, `finding.real` and every `spec.*` check; `SYSTEM1_TYPES`). A policy that names `system1` for any other type is served by that type's catalog default, the heuristic. The new `system1Backend` adapter hands anything the model answers `unsupported` to the type's built-in backend (rules for `action.risk`, the heuristic otherwise), and the decision names the backend that actually answered. `decide` itself still never falls back. The catalog's `defaultBackend` can no longer be `system1`: promoting a type to the model changes the default policy's backend, never the fallback.
