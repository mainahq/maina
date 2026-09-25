---
"@mainahq/cli": patch
---

`maina doctor` no longer launches a project-scope `bunx`/`npx @mainahq/cli@X --mcp` entry when the repo ships its own `node_modules/@mainahq/cli` (in the working directory or any directory up to the repo root): npx resolves a matching local copy in place of the published package, so that entry would run repo code. It is reported `skipped` with the reason and the fix `maina doctor --launch-project`, which launches it anyway.
