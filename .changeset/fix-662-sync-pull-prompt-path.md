---
"@mainahq/cli": patch
"@mainahq/core": patch
---

`maina sync pull` no longer trusts the cloud's prompt `path`: it writes only flat `*.md` file names and refuses absolute paths, `..`, `/` or `\` separators, Windows drive, UNC and device forms, Windows reserved device names (`CON.md`, `NUL.md`, `COM1.md`, ...), `:` and control characters. It also refuses to write through a symlink at the target name, or when `.maina` or `.maina/prompts` resolves outside the repository (nothing is created there). Refused records are listed in the pull summary, with the cloud's path and id escaped so no raw control character reaches the terminal. New core helpers: `promptFileName` (returns a typed `PromptPathError`) and `isPathWithin`.
