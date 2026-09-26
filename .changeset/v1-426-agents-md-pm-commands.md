---
"@mainahq/cli": patch
---

`maina setup` now writes package-manager-specific commands into AGENTS.md. pnpm repos get `pnpm install` / `pnpm run test`, and yarn repos get `yarn install` / `yarn run test`. Before this, every package manager other than bun got `npm install` / `npm run`. Scripts go through `yarn run` because `yarn check` is a built-in yarn v1 command. Repos with no JavaScript package manager still get npm commands.
