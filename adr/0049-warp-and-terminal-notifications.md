# 0049. Warp and terminal notifications over documented escape sequences

Date: 2026-09-26

## Status

Accepted

## Context

Task 9B.5 of the v1 rebuild (mainahq/maina#351, FR-RET-6) tells the human
when maina needs them: when the gate asks about an agent's action, and when
verify on session stop finishes. Most agent sessions run in a terminal the
human has switched away from, so the signal has to be a desktop
notification. Warp is the first target; other terminals get the same thing
where they document it, and nothing where they don't.

What Warp offers a third-party program:

1. **OSC 777 `notify`.** Documented at
   https://docs.warp.dev/terminal/more-features/notifications/ as the way
   for "scripts and tools" to raise a desktop notification:
   `ESC ] 777 ; notify ; <title> ; <body> BEL`, with OSC 9 (body only)
   beside it. Newlines and semicolons are to be avoided in the payload. Warp
   shows it only while it is not the focused window, and it is on by
   default.
2. **The structured agent channel.** Warp's own agent plugins
   (`warpdotdev/claude-code-warp`, `warpdotdev/codex-warp`) send a JSON
   payload through OSC 777 with a Warp-specific title, negotiate a protocol
   version through Warp-set environment variables, and keep a list of Warp
   builds that advertise the protocol but cannot render it. None of this is
   in Warp's documentation; the schema lives only in those plugins' source.
   It is what drives Warp's richer agent UI for the agents Warp integrates.

Warp identifies itself with `TERM_PROGRAM=WarpTerminal`, which its docs use
for shell configuration (https://docs.warp.dev/terminal/appearance/prompt/).

How a hook reaches the terminal differs by host. Claude Code runs hooks
without a controlling terminal and documents a `terminalSequence` field in
hook JSON output for exactly this: Claude Code writes the sequence itself,
restricted to OSC 0/1/2/9/99/777 and BEL
(https://code.claude.com/docs/en/hooks#emit-terminal-notifications). Codex
gives hooks the terminal, and Warp's own Codex plugin writes to `/dev/tty`.

## Decision

- **Only the documented sequence.** In Warp, maina sends the OSC 777
  `notify` sequence with a plain title and body (`notify/warp.ts`). It does
  not use the structured agent channel, read Warp's protocol or version
  variables, or import anything of Warp's. A test scans `notify/` for the
  channel's scheme, for `WARP_*` variables and for Warp package imports.
- **Detection from documented signals.** `detectTerminal(env)` is pure:
  `TERM_PROGRAM=WarpTerminal` is Warp; `iTerm.app` and `WezTerm` (OSC 9),
  `ghostty` (OSC 777) and Windows Terminal's `WT_SESSION` (OSC 9) are the
  generic terminals; everything else is nothing. Inside tmux or GNU screen
  (`TMUX`, `STY`) it is nothing too, since they drop the sequence unless the
  user set up passthrough. `MAINA_NOTIFY=off` turns it off.
- **Two events.** `notify(event)` fires for a gate `ask` and for a verify on
  stop that ran (pass, fail, or could not run). Allows, denies and a stop
  with nothing to verify never notify.
- **Untrusted text.** Reasons can quote what an agent asked to run, so the
  title and body lose every control character, `;` becomes `,`, and the text
  is cut at 200 characters. A reason can never end the sequence early or
  start another one.
- **Delivery per host.** Claude Code: the sequence is added to the hook's
  JSON as `terminalSequence` (never to an exit-2 deny, whose JSON Claude
  Code does not read). Codex and Cursor: written to `/dev/tty`, best effort;
  no terminal means no notification, never a failed hook.

## Consequences

- In Warp, a maina notification is a plain desktop notification. It does not
  appear in Warp's agent session UI (tab status, the agent mailbox), which
  only the structured channel drives. If Warp documents that channel, adopt
  it behind the same `warpSequence` and update this ADR.
- Warp suppresses the notification while it is the focused window, as its
  docs say. That is the right behaviour for "the human is elsewhere".
- A user who also installed Warp's agent plugin gets Warp's own "needs
  input" and "finished" notifications alongside maina's; maina's say what
  maina decided (the ask's reason, verify's result).
- A user who registers maina for both Claude Code's `PreToolUse` and
  `PermissionRequest` gets one notification per hook that asks about the
  same action.
- Claude Code writes `terminalSequence` only in an interactive session with
  its interface on screen, so `claude -p` and SDK runs get no notification.
- A terminal outside the list gets nothing until it is added with a doc
  reference. Kitty (OSC 99) is not in the first cut.
- The manual smoke test in Warp with Claude Code and Codex is tracked as a
  follow-up to #351.
