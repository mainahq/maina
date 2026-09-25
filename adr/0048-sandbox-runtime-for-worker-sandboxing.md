# 0048. sandbox-runtime for the per-worker OS sandbox

Date: 2026-09-26

## Status

Accepted

## Context

Phase 4B of the v1 rebuild (mainahq/maina#365) runs coding agents as workers
over ACP. The gate judges what an agent asks to do, but it only sees what the
agent asks about: a headless worker never asks, an agent whose own sandbox has
to be switched off can stop asking, and anything the agent runs as a child
process can act without a tool call. Task 4B.3 (mainahq/maina#316, FR-SBX-1 to
FR-SBX-4, FR-HAR-8) puts every worker inside an OS sandbox that holds whatever
the agent does:

- writes only inside the worker's worktree (and its own temp directory);
- no reads of `~/.ssh` and other home-directory secrets, of other workers'
  worktrees, or of the holdout directory;
- network denied except an allowlist, every decision logged;
- no real credential in the worker's environment or files;
- a decision on the agents' own sandboxes (Claude Code, Codex, Cursor,
  Gemini), which would otherwise run nested inside maina's.

Options considered:

1. **Hand-written Seatbelt profiles and bubblewrap argument lists.** Rejected.
   Correct profiles are subtle (symlinked temp directories, `/dev` nodes,
   mandatory denies for `.git/hooks`, glob expansion under bubblewrap), and a
   network allowlist needs a filtering proxy anyway. This is the part that is
   hard to get right and easy to get wrong silently.
2. **Containers (Docker, Podman).** Rejected as the default: a daemon, an
   image per toolchain and slow start per worker, not present on most
   developer laptops. It stays the fallback below.
3. **Anthropic's sandbox-runtime (`srt`, Apache-2.0).** Chosen. One CLI over
   Seatbelt on macOS and bubblewrap plus seccomp on Linux, with a host-side
   HTTP/SOCKS proxy that enforces a domain allowlist and, with TLS
   termination, swaps masked credentials in on egress. It is what Claude Code
   itself sandboxes with. It is a research preview, so it is used only behind
   a port and pinned.

## Decision

- **A port.** `packages/harness/src/sandbox/port.ts` defines
  `SandboxPort.wrap(command, { writeAllow, readDeny, netAllow, credentials })`,
  which returns the command that starts the worker sandboxed and runs
  nothing, and `decisions(stderr)`. Only `runtime-adapter.ts` knows `srt`
  exists; replacing it is one file.
- **Pinned.** The adapter accepts exactly one tested release,
  `SANDBOX_RUNTIME.version` (0.0.77). `srt --version` prints a hard-coded
  1.0.0, so the version is read from the package the `srt` binary belongs
  to. Any other version, a missing `srt`, or on Linux a missing `bwrap` or
  `socat`, is an error with an install hint; a worker never starts
  unsandboxed. Windows is refused for now (`srt` support there is alpha).
- **Settings, not arguments.** `wrap` writes the worker's `srt` settings to a
  0600 file in a private temp directory and returns
  `srt --debug --settings <file> -- <command>`. The settings hold paths, host
  patterns and variable names only. `strictAllowlist` is on (no prompt
  fallback), `enableWeakerNestedSandbox` is off.
- **Policy to sandbox.** `policyToSandbox(policy, worktree, holdoutDir)` is
  pure. Writes: the worktree, plus the holdout and policy `file.write` denies
  as write denies. Reads: denied for home-directory secrets (`~/.ssh`,
  `~/.aws`, `~/.gnupg`, `~/.config/gh`, ...), the holdout, policy
  `file.read.outside` denies and the worktrees root, with the worker's own
  worktree carved back out, so it cannot read a sibling's. Network: the hosts
  of policy `network` rules. It refuses a worktrees root at or above the home
  directory (denying reads there would hide the agent's own binary) and a
  holdout that contains the worktree.
- **Per-worker temp directory.** `srt` sets the worker's `TMPDIR` to a shared
  `/tmp/claude` unless `CLAUDE_CODE_TMPDIR` is set in its own environment. The
  adapter sets it to the worker's `tmpDir`, so workers do not share temp files.
- **Credential proxy.** A declared credential (`name`, `value`, `hosts`) is an
  `srt` `mask` rule: inside the sandbox the variable holds a per-session
  stand-in, and the proxy swaps the real value in only on requests to the
  credential's hosts (TLS termination is turned on for that, with an
  ephemeral CA only the sandbox trusts). The real value exists only in
  `srt`'s own environment. Every other variable the harness's environment
  carries is withheld (`deny`) unless it is on a short list a process needs
  (`PATH`, `HOME`, locale, terminal, temp, CA bundles), set by the launch, or
  a proxy variable `srt` rewrites: an ambient `GITHUB_TOKEN` never reaches an
  agent, whatever it is called.
- **Decisions.** `srt --debug` logs each network decision to stderr
  (`Allowed by config rule: host:port`, `No matching config rule, denying:
  host:port`, ...); `decisions(stderr)` parses them into `SandboxDecision`s.
  The worker shares that stderr, so it can forge a decision line: a forged
  line can add a decision that never happened but cannot hide or undo one
  `srt` enforced. Recording them in the decision log is 4B.5's.

### The nested-sandbox spike

Each agent's own sandbox engine was started inside `srt` (rerun by
`packages/harness/src/sandbox/__tests__/nested.test.ts` on every machine with
`srt`, and by the `sandbox` CI job on macOS and Linux):

| Inner sandbox | macOS (Seatbelt outer) | Linux (bubblewrap outer) |
|---|---|---|
| Codex 0.157.0 (`codex sandbox`: Seatbelt on macOS, bubblewrap on Linux) | fails: `sandbox-exec: sandbox_apply: Operation not permitted` | fails: `error building bubblewrap command: Read-only file system (os error 30)` |
| Claude Code (sandbox-runtime 0.0.77) | fails: the inner `srt` cannot bind its proxy socket (`listen EPERM`), and Seatbelt would refuse the nested profile regardless | fails: the inner `srt` cannot bind its proxy socket (`listen EPERM`) |

Recorded locally (macOS 26) and by the `sandbox` CI job on `macos-latest`
and `ubuntu-latest` (mainahq/maina#500), which prints each outcome as a
`[spike]` line.

On macOS the result is general, not specific to these agents: any Seatbelt
profile beyond `(allow default)` makes a nested `sandbox_apply` fail with
`EPERM`, verified with bare `sandbox-exec` inside `sandbox-exec`. On Linux
the outer sandbox mounts the filesystem read-only outside the allowed write
paths and does not let the sandboxed process bind the Unix sockets an inner
sandbox-runtime needs. So on neither platform does any agent's own sandbox
start inside maina's, and `INNER_SANDBOX_NESTS` is empty for both.

So `configureInnerSandbox(worker)` switches the agent's own sandbox off
wherever it cannot nest, using the worker registry's `disable` patch (Codex
`INITIAL_AGENT_MODE=agent-full-access` over ACP or
`-c sandbox_mode="danger-full-access"` headless, Cursor `--sandbox disabled`,
Gemini `GEMINI_SANDBOX=false`; Claude Code's is opt-in, so there is nothing to
pass). A container sandbox (Gemini) never nests: no container runtime is
reachable from inside the outer sandbox. The outer sandbox is never touched:
it wraps whatever launch `configureInnerSandbox` returns, and stays the layer
that enforces. Where a platform is shown to nest an agent's sandbox,
`INNER_SANDBOX_NESTS` lists it and that sandbox stays on as a second layer.

## Consequences

- Codex over ACP loses the gate on macOS: `agent-full-access` is the only
  codex-acp mode without its sandbox, and its approval policy is `never`, so
  the worker is marked `sandbox-only`. Only the OS sandbox enforces for it
  until codex-acp offers "sandbox off, approvals on".
- A user who turned on Claude Code's own sandbox in their settings gets a
  Bash tool that fails under maina's on macOS; maina cannot switch it off
  from the ACP launch.
- `/tmp/claude` stays writable inside every `srt` sandbox (srt needs it for
  itself), so it is a channel two workers could share on purpose even though
  their `TMPDIR`s are separate.
- Agents keep state under the home directory (`~/.claude`, `~/.codex`); those
  directories are not writable unless the caller passes them as `writable`.
  Choosing them per worker is the session manager's (4B.4).
- A new `srt` release is adopted deliberately: bump `SANDBOX_RUNTIME.version`,
  rerun the `sandbox` CI job (which installs the version the adapter pins).

### Fallback

If `srt` is withdrawn, changes licence, or breaks in a way the pin cannot
hold: implement `SandboxPort` over a rootless container (Podman, or Docker
with `--network none` plus an egress proxy container for the allowlist and
credential injection, the worktree bind-mounted read-write and nothing else
mounted). It is slower to start and needs a runtime installed, but it keeps
the same port, the same `policyToSandbox` output and the same tests.
