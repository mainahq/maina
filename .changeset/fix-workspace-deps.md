---
"@mainahq/cli": patch
---

Fix: replace workspace:^ with real version ranges for @mainahq/core and @mainahq/mcp dependencies. The workspace protocol was being published to npm literally, making the CLI uninstallable.
