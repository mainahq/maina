---
"@mainahq/cli": patch
"@mainahq/core": patch
---

`maina sync pull` no longer trusts the cloud's prompt `path`: it writes only flat `*.md` file names and refuses absolute paths, `..`, `/` or `\` separators, Windows drive, UNC and device forms, `:` and control characters. It also refuses to write through a symlink at the target name, or when `.maina/prompts` resolves outside the repository. Refused records are listed in the pull summary. New core helpers: `promptFileName` and `isPathWithin`.
