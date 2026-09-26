# 0045. Standalone runtime packaging and launcher

Date: 2026-09-25

## Status

Accepted

## Context

The real-config e2e matrix (mainahq/maina#283) reproduces two launch failures that no config fix can remove:

- **P2:** the MCP entry needs a runtime that is not on the PATH a GUI-launched host passes. On macOS that PATH is `/usr/bin:/bin:/usr/sbin:/sbin`, so `#!/usr/bin/env bun` fails with `env: bun: No such file or directory`, and `bunx` is not found.
- **P4:** `bunx @mainahq/cli` downloads the package on the first spawn, which takes 1 to 5 s. That exceeds the 1.5 s cold-start budget and can exceed a host's startup timeout (Codex allows 10 s).

Task 2.3 (mainahq/maina#298, FR-INS-1, FR-INS-2, FR-INS-7) ships maina as a runtime artifact that needs nothing from the host's PATH, plus a small launcher that the host plugins (mainahq/maina#341–#343) run. The issue leaves the packaging choice to the implementer and asks for it to be recorded here.

The requirements:

- a host spawns one fixed command: `launch mcp`, `launch hook <event>` or `launch cli ...`;
- the command works with `PATH=/usr/bin:/bin` and no bun, node, jq or python installed;
- a cold MCP start from the cache takes at most 1.5 s;
- a downloaded artifact runs only after its sha256 and its signature both check out;
- the launcher degrades rather than fails: when the one self-heal fails, a hook prints the host's fail-closed output and MCP starts in a rules-only mode with a status notice.

## Decision

### Packaging: one `bun build --compile` executable per target

`packages/runtime/build/standalone.ts` compiles `packages/runtime/src/standalone/main.ts` with `bun build --compile --minify --target=bun-<target>`. The targets are `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl` and `windows-x64`. The output is one file, `maina-<version>-<target>` (with `.exe` on Windows). It embeds the Bun runtime and the whole program: the CLI, the MCP server and the resident runtime daemon. The binary's first argument selects the mode (`mcp`, `hook <event>`, `cli ...` or `runtime-daemon ...`), and each mode imports only its own code.

Options considered:

1. **npm package run with the host's bun or node.** Rejected: this is P2.
2. **A pinned Bun binary plus the bundled JS, shipped as a tarball.** Rejected. The launcher would have to extract an archive, which needs `tar` (and `unzip` on Windows) and is not atomic, and it would have to check two files instead of one. It gains nothing over option 4.
3. **Node single executable applications (SEA).** Rejected. The code base uses Bun APIs (`bun:sqlite`, `Bun.spawn`, `Bun.listen`), and SEA would still need a separate build of the native modules for each target.
4. **`bun build --compile`.** Chosen. It is already in the toolchain, it cross-compiles every target from one machine, and it produces a single file that is installed with one rename. A compiled binary answers MCP `initialize` in about 0.1 s on a laptop once the OS has seen it. On macOS the first exec of a new binary is scanned (about 2 s), and the launcher pays that on the self-heal run, not on the cached cold start.

Each binary is about 60 MB. `--bytecode` would start faster, but it needs CommonJS output, and the CLI and MCP entries use top-level `await`.

When the daemon runs inside a compiled binary, its modules live under Bun's virtual `$bunfs` (`B:/~BUN` on Windows). `daemonCommand` in `src/lifecycle.ts` detects this and starts the daemon as `<executable> runtime-daemon ...` instead of `bun daemon.ts ...`. This closes the note left open in ADR 0044.

### Launcher: `launch.sh` (POSIX sh) and `launch.ps1` (PowerShell 5.1+)

The launchers are in `packages/runtime/launcher/`. Each is under 16 KiB and uses only tools that ship with the OS: `sh`, `awk`, `sed`, `uname`, `curl` or `wget`, `sha256sum` or `shasum`, and `openssl`. On Windows it uses .NET only.

1. It reads `manifest.json`, which sits next to it. The build writes the manifest in a fixed layout, one field per line, so `awk` can parse it without a JSON tool. The manifest holds the version, and for each target the URL, the sha256 and the signature.
2. It resolves the cache: `${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.maina}}/runtime/<version>/maina`. If a runtime is cached there, it `exec`s it with the mode.
3. Otherwise it self-heals once. It downloads the artifact to a temp file in the same directory; it accepts only `https` URLs, plus `http` on 127.0.0.1 or localhost for the tests. It checks the sha256 against the manifest, then checks the signature with `openssl dgst -sha256 -verify release.pub.pem` (.NET `RSA.VerifyData` against `release.pub.xml` on Windows). It marks the file executable and renames it into place, then runs it. A runtime at the cache path has therefore always been verified, and a cached start costs only the launcher's own startup: no hashing and no network.
4. If any step fails, it degrades, and the reason goes to stderr:
   - **Hook mode** prints the host's fail-closed output and exits 0. A pre-tool event gets `ask` (Claude Code and Codex use `permissionDecision`, Cursor uses `permission`). A session start gets a context notice. Every other event gets `{}`, which leaves the host's own permission prompt in place and never blocks a stop. The TypeScript function `src/standalone/hook-fallback.ts` defines these outputs, and the tests hold both launchers to it byte for byte and validate the outputs against the pinned host schemas.
   - **MCP mode** serves a minimal stdio JSON-RPC loop. `initialize` returns a notice in `instructions`, `tools/list` offers a single `status` tool that explains the degradation, `ping` works, and every other request gets an error.
   - **CLI mode** exits 69 (`EX_UNAVAILABLE`).

Until the gate adapters land (mainahq/maina#309–#311), the binary's own `hook` mode also prints the fail-closed output, with the cause `gate_not_active`.

### Signatures: RSA-SHA256 against a pinned public key

Each artifact is signed with RSA PKCS#1 v1.5 over SHA-256. The launcher trusts only the public key that ships next to it (`release.pub.pem` for `sh`, and the same key as `release.pub.xml` for PowerShell). No environment variable can override the key. If the key file is missing, the launcher refuses to install anything (`no_release_key`), and it refuses empty signatures.

RSA was chosen because it is the only scheme that both `/usr/bin/openssl` and Windows PowerShell 5.1 can verify with no extra tools. macOS ships LibreSSL 3.3, which cannot verify Ed25519 with `pkeyutl -rawin`, and .NET Framework has no Ed25519 at all. minisign, cosign and GPG were rejected because each needs an extra binary on every machine.

The `release` job in `.github/workflows/runtime-artifacts.yml` signs the artifacts. It runs on a `runtime-v*` tag or a manual dispatch, reads the private key from the `MAINA_RUNTIME_SIGNING_KEY` secret, and refuses to publish without it. The build jobs never see the key.

*Update (mainahq/maina#346):* signing and publishing moved to the lockstep release in `.github/workflows/release.yml` (`scripts/release/`). The runtime is released with the CLI packages and the host plugins at one version, in one `runtime-v<version>` release, with the same key and scheme; `runtime-artifacts.yml` now only builds and smoke-tests.

## Consequences

### Positive

- P2 and P4 are gone for any install path that uses the launcher. `ci/e2e/real-config/__tests__/plugin-launcher.test.ts` builds the real binary and spawns `launch.sh mcp` the way a GUI host does. From the cache, it gets `initialize` within 1.5 s and a successful `verify`.
- The installer is a rename: a crash or a concurrent launch never leaves a half-written runtime at the cache path.
- Offline use works from the cache, and offline with no cache degrades in a way that is safe for the host.

### Negative

- **The real release key is not provisioned yet** (manual follow-up). Until the key pair is generated, its private half is stored as the `MAINA_RUNTIME_SIGNING_KEY` secret and its public half is committed as `launcher/release.pub.pem` and `release.pub.xml`, the committed launcher refuses to install (`no_release_key`), and `launcher/manifest.json` lists no artifacts. The tests use keys generated per run.
- Rotating the key needs a new launcher release, because the key is pinned in the launcher. A compromised key is handled the same way.
- Each download is about 60 MB. A download made in hook mode runs inside the host's hook timeout, so the plugins should warm the cache early (for example, at session start).
- The installers (`setup`, `mcp add`, `install.sh`) still write `bunx` or global-bin entries. Switching them to the launcher is mainahq/maina#299, so the matrix's P4 entries for those paths now point there.
- The `sh` launcher's degraded MCP loop parses JSON-RPC with `awk`. It reads the first `"id"` and `"method"` in each line, which is enough for the requests it answers, but it is not a general JSON parser.
- Only the macOS and Linux launchers are exercised locally. The Windows launcher runs in the `launcher` job on `windows-latest`.
