---
"@mainahq/core": patch
"@mainahq/cli": patch
---

verify: the semgrep, trivy, secretlint, sonar-scanner, stryker and diff-cover runners now run the tool path that detection found, including a copy installed only in `<root>/node_modules/.bin`. Before, they ran the bare command name. If a detected tool cannot be started, the runner marks it skipped with a notice (shown by `maina verify` and included in `--json` output). It no longer counts as a pass with zero findings.
