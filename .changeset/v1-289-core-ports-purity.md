---
"@mainahq/core": minor
---

Add the functional-core ports boundary: `CorePorts` (`fs`, `git`, `db`, `clock`, `logger`, `model`, `env`) and their typed errors are exported from `@mainahq/core`, with in-memory fakes in `ports/testing.ts`. A purity ratchet test now fails CI on new `process.cwd`/`process.env`/`process.stdout`/`console.*`/`throw` usage in core; existing offenders are listed in an allow-list that may only shrink.
