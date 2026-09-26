---
"@mainahq/cli": minor
---

Agent status line: `maina statusline install|remove|preview`. The standalone runtime answers `maina statusline` (and `maina cli statusline`) with one line of at most 80 visible characters: `Maina: on · 1 blocked · 2 asked · 14 allowed · 5 routed ~$0.42 saved · +38ms p95`. It shows `Maina: degraded (…)` when the runtime answers but can't serve, or when the session's last gate decision was degraded. It prints `Maina: off` when no runtime is running, and it never fails. Install and remove own one key, `statusLine`, in a Claude Code settings file (`--scope local|project|user`, `local` by default). They leave every other byte unchanged, back the file up before the first write, and never replace or remove a status line that isn't maina's.
