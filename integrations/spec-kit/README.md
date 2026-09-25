# Maina for GitHub Spec Kit

Maina guardrails inside a [Spec Kit](https://github.com/github/spec-kit) v1
project (FR-SPEC-7, mainahq/maina#333). Three pieces, each usable alone:

| Piece | What it does |
| --- | --- |
| `extension/` | A Spec Kit extension. Its `pre_tool_use` event runs `speckit.maina.gate` on every agent tool call, which asks the Maina gate (`maina hook <event>`) and answers `ask` when Maina cannot. `after_tasks` offers `speckit.maina.analyze`. |
| `workflows/maina-gate-overlay.yml` | An overlay for the stock `speckit` workflow: `maina analyze` after `tasks`, then `maina decide` before `implement`, with a `switch` on the verdict (`allow` continues, `deny` fails the run, `ask` pauses at a review gate). |
| `maina analyze` / `maina decide` | Maina reads Spec Kit's `specs/<feature>/{spec,plan,tasks}.md` as feature input, and any workflow `shell` step can route on a Maina verdict. |

## Install

```bash
specify extension add --dev path/to/maina/integrations/spec-kit/extension
specify workflow add speckit
specify workflow overlay add path/to/maina/integrations/spec-kit/workflows/maina-gate-overlay.yml
```

`specify extension add` writes the `pre_tool_use` hook into the native hook
config of the integration the project was initialised with (for Claude Code,
a `PreToolUse` entry in `.claude/settings.json`). The handler is a POSIX
shell script; on Windows, Spec Kit runs it with `bash` when one is installed.

The gate handler calls `maina hook <event>` (override the executable with
`MAINA_BIN`). Until the host adapters ship in the `maina` CLI
(mainahq/maina#309 to #311), that call fails and the handler answers `ask`:
a gate that cannot run never allows.

## Routing a workflow on a Maina verdict

```yaml
- id: verdict
  type: shell
  run: "maina decide --type action.risk --trusted actionClass=deploy --json"
  output_format: json

- id: route
  type: switch
  expression: "{{ steps.verdict.output.data.data.verdict }}"
  cases:
    allow: [...]
    deny: [...]
  default: [...]   # ask, or anything unexpected
```

`output.data` is the step's stdout parsed as JSON; `maina decide --json`
prints a `{ data, error, meta }` envelope, so the verdict is
`output.data.data.verdict`. `maina decide` exits 0 whenever it reaches a
verdict, whatever the verdict is. It exits 3 on bad input, an unknown type
or an invalid policy, and 2 when the backend cannot answer; the shell step
then fails and the run stops, so the workflow fails closed.

The verdict comes from the same layered policy as the gate: defaults, then
`~/.maina/policy.json`, then `.maina/policy.json`. An action class the policy
does not name resolves to `ask`. For the overlay's `speckit.implement`:

```json
{ "action_classes": { "speckit.implement": { "irreversible": false, "verdict": "allow" } } }
```

## Feature input

`maina analyze` finds the Spec Kit feature the way Spec Kit's scripts do:
`SPECIFY_FEATURE_DIRECTORY`, then `.specify/feature.json`, then the branch
(`SPECIFY_FEATURE` or git) matched to `specs/<branch>` by name or number
prefix. A Maina feature branch (`feature/<name>` with `.maina/features/<name>`)
still wins. `maina analyze --all` includes the numbered `specs/` folders.

## Tests

`__tests__/interop.test.ts` checks the manifest, the gate handler (against
the pinned host hook fixtures in `packages/runtime/src/adapters/__fixtures__`)
and the overlay statically, then drives a stock Spec Kit CLI: a workflow
routing on `maina decide`, the overlay on a `speckit`-shaped workflow and on
the stock one from the catalog, and the extension installed into a Claude
Code project. Those live cases skip when no Spec Kit v1 CLI is found
(`specify`, or `SPECIFY_BIN`), unless `MAINA_REQUIRE_SPECKIT=1`. CI installs
Spec Kit v1.0.12 and sets it.

Publishing the extension to the Spec Kit community catalog is planned for
Phase 9.
