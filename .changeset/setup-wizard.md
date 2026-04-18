---
"@mainahq/cli": minor
"@mainahq/core": minor
"@mainahq/mcp": patch
"@mainahq/skills": patch
---

feat(cli): zero-friction setup wizard

Adds `maina setup`, a one-command onboarding wizard that detects your stack,
tailors a constitution via host-delegated or cloud AI (anonymous, no API key),
scaffolds 5 agent instruction files with non-destructive managed regions,
seeds the codebase wiki, and runs verify to surface a real finding inline —
all in under 60 seconds.

- `--ci` mode emits per-phase JSON for automation
- `--update` re-tailors constitution + agent files for the current stack
- `--reset` backs up `.maina/` and starts fresh
- `--agents <list>` scopes which agent files are written
- `maina configure` is now a deprecated alias for `setup --update` (removed in v1.5)

Docs: new `getting-started.mdx` features the wizard as the primary CTA. The
previous `quickstart` page redirects to `/getting-started`. `full-setup` is
demoted under "Advanced" as the long-form reference. Landing-page hero and
root `README.md` now lead with `bunx @mainahq/cli@latest setup`.
