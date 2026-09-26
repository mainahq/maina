---
"@mainahq/skills": major
"@mainahq/cli": major
---

Skills follow the Agent Skills spec and are rewritten around the v1 flows: `gate`, `verify`, `spec`, `triage` and `graph`. Each `SKILL.md` has only the spec's front matter fields (`name` matching its folder, a `description` of at most 1024 characters that says what the skill does and when to use it, `license`, `compatibility`, `metadata`); `triggers` is gone. Breaking: the 1.x skills (`onboarding`, `verification-workflow`, `code-review`, `tdd`, `plan-writing`, `context-generation`, `wiki-workflow`, `cloud-workflow`) are removed. Skills now ship only through the maina plugins and `.agents/skills`: `maina setup` copies them into `.agents/skills/<name>/SKILL.md` instead of `.maina/skills/`, and never overwrites a skill of the same name that maina did not write (one without `metadata.author: mainahq`), warning instead.
