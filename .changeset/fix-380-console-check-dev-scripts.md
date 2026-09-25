---
"@mainahq/core": patch
---

The built-in `no-console-log` check no longer reports `console.*` calls in dev-only tooling at the repo root (`scripts/`, `ci/`, `bench/`), matching the Biome `noConsole` override. Package source, including nested directories like `packages/x/src/scripts/`, is still checked.
