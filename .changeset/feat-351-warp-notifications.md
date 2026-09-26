---
"@mainahq/cli": minor
---

Terminal notifications for agent hooks: when the gate asks about an agent's action, or verify on session stop finishes, maina raises a desktop notification in the terminal the agent runs in. In Warp (`TERM_PROGRAM=WarpTerminal`) it uses Warp's documented OSC 777 notification; iTerm2, WezTerm, Ghostty and Windows Terminal get their documented OSC 9 or OSC 777 notification; any other terminal, and tmux or screen, gets nothing. Claude Code receives it as the hook's `terminalSequence`; Codex and Cursor get it on the controlling terminal. Allows, denies and stops with nothing to verify never notify. Set `MAINA_NOTIFY=off` to turn it off. See ADR 0049.
