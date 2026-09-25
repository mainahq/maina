---
description: "Check an agent tool call with the Maina gate (pre_tool_use handler)"
scripts:
  sh: events/pre-tool-use.sh
---

# Maina gate

This command is the extension's `pre_tool_use` event handler: Spec Kit runs
its script for every tool call the agent is about to make, with the host's
hook payload on stdin, and hands the script's answer back to the host.

The script passes the payload to the Maina gate (`maina hook <event>`), which
answers `allow`, `ask` or `deny` in the host's own format. When Maina is not
installed or cannot answer, the script answers `ask`: a gate that cannot run
never allows.

It is not meant to be run by hand. To check an action from a workflow, use
`maina decide --type action.risk --trusted actionClass=<class> --json`.
