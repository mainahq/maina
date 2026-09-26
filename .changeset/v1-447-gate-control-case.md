---
"@mainahq/core": patch
---

`gate.self_override` now matches gate control files and directories in any letter case. On macOS and Windows, `.Claude/Settings.json` and `.MAINA/policy.json` are the same files as their lower-case names. Before this fix, an agent could write or delete them and the gate saw only a plain `fs.write`.
