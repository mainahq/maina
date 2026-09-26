---
description: "Check an agent tool call with the Maina gate (pre_tool_use handler)"
scripts:
  sh: events/pre-tool-use.sh
---

# Maina gate

This command is the extension's `pre_tool_use` event handler: Spec Kit runs
its script for every tool call the agent is about to make, with the host's
hook payload on stdin, and hands the script's answer back to the host.

The script passes the payload to the Maina gate
(`maina hook --host <claude|codex|cursor> <event>`, the host read from the
event name, the payload and the environment), which answers `allow`, `ask`
or `deny` in the host's own format. When Maina is not installed or cannot
answer, the script prints the maina runtime's fail-closed answer for that
host: `ask` where the host enforces it, and a deny (exit 2) where it does not
(Codex, Cursor `preToolUse`) or the host is unknown. A gate that cannot run
never allows.

It is not meant to be run by hand. To check an action from a workflow, use
`maina decide --type action.risk --trusted actionClass=<class> --json`.
