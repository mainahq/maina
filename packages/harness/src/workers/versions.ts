/**
 * Minimum ACP adapter versions: the one place they are pinned.
 *
 * Each is the first release of that adapter built on the ACP v1 SDK
 * (`@agentclientprotocol/sdk` 1.x, the protocol the harness speaks), or,
 * for Gemini CLI, the first release with the stable `--acp` flag. An older
 * adapter is refused with an upgrade hint instead of failing mid-handshake.
 *
 * `null` means not pinned: Cursor's `agent` CLI is date-versioned with no
 * published changelog of its ACP mode, so only the handshake's protocol
 * version check guards it.
 */

import type { WorkerName } from "./spec";

export const MIN_ADAPTER_VERSIONS: Readonly<Record<WorkerName, string | null>> =
	{
		/** @agentclientprotocol/claude-agent-acp: first on ACP SDK 1.0 (0.51.0 was on 0.29). */
		claude: "0.52.0",
		/** @agentclientprotocol/codex-acp: first on ACP SDK 1.x (1.0.0 was on 0.28). */
		codex: "1.0.1",
		/** Cursor `agent`: date-versioned, not pinned (see above). */
		cursor: null,
		/** @google/gemini-cli: first with `--acp` (0.32.0 had only `--experimental-acp`). */
		gemini: "0.33.0",
		/** opencode-ai: first stable major, `opencode acp` included. */
		opencode: "1.0.0",
	};
