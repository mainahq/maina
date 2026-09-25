---
"@mainahq/cli": patch
---

`maina doctor` no longer launches a project-scope `bunx`/`npx @mainahq/cli@X --mcp` entry when the repo ships its own `node_modules/@mainahq/cli` or a project `.npmrc` (in the working directory or any directory up to the repo root): npx resolves a matching local copy in place of the published package, and honours a project `.npmrc` `registry=`, so that entry could run code the repo chose. It is reported `skipped` with the file that caused it and the fix `maina doctor --launch-project`, which launches it anyway.
