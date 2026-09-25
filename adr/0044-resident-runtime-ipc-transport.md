# 0044. Resident runtime IPC transport

Date: 2026-09-25

## Status

Accepted

## Context

The v1 gate (mainahq/maina#365) answers every agent hook: before a shell command, a file write, or an MCP call. A hook is a short-lived process that the host starts for each event, so loading policy, the code graph and a local model in every hook would cost far more than the gate's latency budget. Task 2.2 (mainahq/maina#297, FR-GATE-1, FR-MCP-5, FR-S1-5) adds a resident runtime that keeps that state warm. Hooks, the CLI and the MCP server talk to it over local IPC.

The requirements:

- a warm round trip under 10 ms at p95;
- one runtime per user per version, started on demand by the first client that needs it, with no duplicate daemons when several hooks fire at once;
- a client of another version restarts the runtime;
- an idle runtime exits after a configurable TTL;
- fail closed (spec §6.1 rule 2): when the runtime cannot answer, the hook evaluates rules only, in process, and flags the result `degraded`. A degraded result is never `allow`.

The issue leaves the transport to the implementer and asks for the choice to be recorded here.

Options considered:

1. **TCP on localhost.** Rejected. Every local user can connect to a port, so access control would need a token handshake. Ports can also collide with other software, and firewalls sometimes prompt for them.
2. **HTTP over a Unix socket.** Rejected. It adds request parsing and header overhead on the hot path for no benefit, since both ends are ours.
3. **Unix domain socket (named pipe on Windows) with newline-delimited JSON.** Chosen. Bun supports it natively with `Bun.listen` and `Bun.connect`, so there is no new dependency. Access follows filesystem permissions, and the round trip is well under a millisecond: the bench measures a p95 of about 0.15 ms on a laptop.
4. **stdio to a child process.** Rejected. A hook process exits after each event, so the runtime would not stay resident.

## Decision

- **Transport:** a Unix domain socket on macOS and Linux, and the named pipe `\\.\pipe\maina-<user>-<version>` on Windows. Each connection carries newline-delimited JSON, one message per line, with a maximum of 1 MiB per message.
- **Location (`packages/runtime/src/registry.ts`):** the runtime dir is `$XDG_RUNTIME_DIR/maina` when that variable is set, and `~/.maina/run` otherwise. It is created with mode `0700`, and the socket is set to `0600`. For version `V` the dir holds `rt-V.sock`, `rt-V.pid` (the running runtime's claim) and `rt-V.lock` (the spawn lock). Because each version has its own endpoint, each user gets one runtime per version. When the socket path would exceed the 103-byte `sun_path` limit, the socket moves to a private per-user dir with a hashed name (`maina-<hash>/`) in the OS temp dir. The pid file and the lock stay in the runtime dir. The socket's dir must be private: a real directory, not a symlink, owned by the user, with no group or other access. A loose dir the user owns is tightened to `0700`, and any other dir is refused. The hook client checks this before it connects and degrades with `insecure_endpoint` when the check fails, because whoever controls that dir could bind a socket that answers for the runtime.
- **Protocol v1 (`packages/runtime/src/ipc.ts`):** a request is `{v, id, method, clientVersion, params?}`, where `method` is one of `hook.evaluate`, `decide`, `graph.query`, `verify.run` or `status`. A response is `{v, id, runtimeVersion, ok, result | error}`. Error codes are `bad_request`, `unknown_method`, `version_mismatch`, `not_implemented` and `handler_failed`. A later protocol change bumps `v`.
- **Exclusivity:** the runtime claims its endpoint by creating the pid file exclusively. It takes over a claim whose process is gone, or one written before the last boot, so a pid reused after a reboot never blocks a start. A takeover happens under an exclusive `<file>.takeover` marker directory, so it is atomic. A second runtime on a live endpoint refuses to start with `already_running`.
- **Single-flight spawn (`packages/runtime/src/lifecycle.ts`):** a client that cannot connect takes the spawn lock, checks once more that no runtime answers, and spawns the detached daemon (`src/daemon.ts`). Other clients poll `status` until the runtime answers or their deadline passes. A lock whose holder died or that is older than 10 s is abandoned and taken over.
- **Version mismatch:** when a client's `clientVersion` or protocol version differs from the runtime's (a request with no numeric `v` is a `bad_request`, so it does not stop the runtime), the runtime first frees its endpoint: it stops accepting connections, then removes the socket and the pid file. Only then does it answer `version_mismatch` and exit. The client then spawns a runtime of its own version within the same time budget.
- **Idle TTL:** the runtime exits once `idleTtlMs` passes with no request in flight.
- **Fail closed (`packages/runtime/src/client/hook-client.ts`):** `evaluate(event, { timeoutMs })` never throws and never allows on error. A connection failure or version mismatch gets one spawn or restart attempt within the budget. Anything else, or a failed recovery, runs the injected rules-only `fallback` in process: a timeout, a crash mid-request, a bad response, a handler error, an unexpected client error (`client_error`, such as a port that throws), or a socket dir that is not private (`insecure_endpoint`). An answer whose `runtimeVersion` or `id` does not match the request is never used. The result is flagged `degraded: true` with a `degradedCause`. An `allow` from the fallback is tightened to `ask`, and a fallback that throws, hangs or returns garbage yields `ask`.
- **Ports:** the runtime serves `hook.evaluate` through a `GateEvaluator` port (`packages/runtime/src/gate.ts`), and `decide`, `graph.query` and `verify.run` through optional handler ports. A method without a port answers `not_implemented`. Until the real gate lands (mainahq/maina#307, mainahq/maina#308), the daemon runs a placeholder evaluator that always answers `ask`.

## Consequences

### Positive

- The hook path costs one local connect and one line each way. `bun packages/runtime/bench/gate-roundtrip.bench.ts` measures it and exits non-zero when p95 is 10 ms or more.
- Access control is the filesystem's: only the owning user can reach the socket.
- Later tasks plug the rules engine, decision backends, graph and verify into ports without changing the protocol.

### Negative

- The named pipe path on Windows is not yet covered by CI, and pipe ACLs are Windows defaults rather than an explicit per-user ACL.
- A stale pid file or spawn lock is taken over under an exclusive marker directory (`<file>.takeover`), and only the marker holder removes the old claim, so two claimants cannot both take over the same stale claim. A marker older than 5 s is treated as left by a claimant that crashed mid-takeover and is removed; two claimants removing the same abandoned marker at once can still race, but that needs a crash inside a window of microseconds first. A runtime displaced from its claim leaves the socket path alone when it stops, because that path belongs to the runtime holding the pid file.
- The daemon runs `src/daemon.ts` with the Bun executable that started the client. Packaging it for compiled binaries is left to the launcher task.
