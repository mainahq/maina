# Host hook contract fixtures

Pinned wire contracts for the hosts maina gates (FR-GATE-7). Checked by
`../__tests__/contracts.test.ts`.

Each host folder has:

- `manifest.json`: the source doc URL, retrieval date and (where known) the
  host version, plus one entry per fixture: the native `event`, `direction`
  (`input` = hook stdin, `output` = hook stdout), the host-neutral slot it
  `covers`, and its `origin` (`captured`, `docs` or `docs-partial`).
- `schemas/*.schema.json`: JSON Schema (draft-07) for each event, taken from
  the host's documentation. Each schema has an `x-source` annotation with its
  URL and retrieval date.
- `*.json`: sample inputs and valid outputs. `invalid/*.json` are negative
  cases, and each one names the ajv error (`keyword` + `instancePath`) that
  must reject it.

| Host | Source | Origin of inputs |
| --- | --- | --- |
| `claude-code` | <https://code.claude.com/docs/en/hooks> | Captured from Claude Code 2.1.282 (`claude -p`) with a hook that dumps stdin; only the paths were changed |
| `cursor` | <https://cursor.com/docs/hooks> | Built from the documented examples. Cursor does not document `tool_input` for `Write`, so that fixture is `docs-partial` |
| `codex` | <https://developers.openai.com/codex/hooks> | Schemas copied unchanged from `openai/codex` `codex-rs/hooks/schema/generated` at the commit pinned in `manifest.json`; fixtures follow the docs |

Output schemas list only the documented, non-deprecated fields
(`additionalProperties: false`), so an adapter cannot emit a key the host
ignores. Input schemas allow unknown fields, because hosts add fields over
time. Codex is the exception: its upstream input schemas are strict.

To refresh: re-fetch the doc or schema, update the schema and its `x-source`
date, recapture payloads where a host is installed, and run
`bun test packages/runtime`.
