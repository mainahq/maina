---
"@mainahq/cli": minor
"@mainahq/core": minor
---

Maina Link event producers. On an enrolled device the resident runtime now queues these events in its Link outbox:

- `decision`: one per gate decision in the decision log. It carries the record's hashes, the decision type, the action taken, the answer's confidence and the latency. The question, its options and the distribution stay on the machine.
- `inventory`: sent when the runtime starts and again when something changes. There's one per agent CLI on PATH. It carries the agent's version, its MCP server count, whether Maina's hooks are installed (`hooksInstalled: false` when the agent is there but the hooks aren't), how many Maina plugins it has enabled, and the runtime version.

Core gains observer ports, so the runtime can uplink without core making network calls: `appendDecision`'s `onAppended`, `recordOverride`'s `onOverride` (new `OverrideFact`), and `createSpendLedger`'s `onRecorded`. It also gains `receiptSummary` (a receipt's `sha256:` hash and whether it passed) and `savingsEstimateUsd`. An observer sees a write only after it succeeds, and it can't undo or fail that write. The runtime also has producers for `override`, `receipt` and `spend` events, but no CLI command calls them yet.

Events are metadata only. Every string a producer sends is a hash, a Maina label or id, a version or a commit sha. Nothing else goes out as it is: a path, a command, a prompt or a name is left out, replaced with `unknown`/`other`, or not sent at all. A property test feeds path-like and command-like values into every field and checks that none of them reaches an event. Nothing is queued on a device that isn't enrolled.
