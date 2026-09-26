# Host plugin contract fixtures

Pinned plugin package contracts for the hosts maina ships a plugin to
(spec §5). Checked by `../__tests__/generate.test.ts`: every generated file
listed in a host's `manifest.json` must validate against the named schema.

Each host folder has:

- `manifest.json`: the source doc URL and retrieval date; `hookContracts`,
  the runtime's hook contract folder for the host
  (`packages/runtime/src/adapters/__fixtures__/<name>`, #375), whose events
  are the documented hook events the plugin may register; and one entry per
  generated file with the schema it must pass (`pointer` picks part of the
  file, such as a manifest's extension namespace).
- `schemas/*.schema.json`: JSON Schema (draft 2020-12). Each has an
  `x-source` annotation with its URL and retrieval date.

| Host | Source |
| --- | --- |
| `claude` | <https://code.claude.com/docs/en/plugins-reference>, <https://code.claude.com/docs/en/hooks> |
| `cursor` | <https://cursor.com/docs/reference/plugins>, <https://cursor.com/docs/hooks> |
| `codex` | <https://developers.openai.com/plugins/build/plugins>, <https://developers.openai.com/codex/hooks>; the Agent Plugins schemas are copied unchanged |
| `agent-plugins` | <https://agent-plugins.org/specification>; both schemas are copied unchanged |

`claude/schemas/marketplace.schema.json` pins the Claude Code marketplace
listing (<https://code.claude.com/docs/en/plugin-marketplaces>) that the
generator writes to `.claude-plugin/marketplace.json` at the repo root;
`../__tests__/marketplace.test.ts` checks it.

Manifest schemas are strict (`additionalProperties: false`), so the
generator cannot emit a key that a host ignores or warns about.

To refresh: re-fetch the doc or schema, update the schema and its `x-source`
date, run `bun run plugins:generate`, then `bun test packages/plugins`.
