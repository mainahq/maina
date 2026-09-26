---
"@mainahq/core": patch
"@mainahq/cli": patch
---

Quieter, more honest verify tools, and `maina decide` now applies the policy's confidence threshold.

- secretlint runs only when the repository has a secretlint config (`.secretlintrc*` or a `secretlint` field in `package.json`). Without one secretlint refuses to run, and verify used to print its stack trace as a notice on every run.
- sonar-scanner runs only when the repository has a `sonar-project.properties`, and no longer passes the `sonar.analysis.mode=issues` preview mode that SonarQube removed in 7.0. A run that leaves no local issues report is now skipped with a notice instead of counting as a pass.
- diff-cover gets `--json-report - --quiet`. The bare `--json` it used to get was read as `--json-report` with no argument, a usage error on every run.
- `maina decide` applies the policy's confidence threshold for the decision type, as the gate does. Below it, `action.risk` answers `ask` and any other type answers `unsure`. The JSON envelope gains `threshold` and `belowThreshold`, and the backend's own answer stays in `decisions`. Core exports `confidenceThreshold(policy, type)`, which the gate now uses too.
- `maina run` removes the sandbox's `maina-sandbox-*` settings temp directory when the run ends.
