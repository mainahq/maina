/**
 * Claude Code over ACP: `claude-agent-acp`, the adapter around the Claude
 * Agent SDK. Headless fallback: `claude -p` with a stream-json transcript.
 */

import type { InnerSandbox, WorkerDefinition } from "./spec";

/**
 * Claude Code's sandbox (Seatbelt / bubblewrap around Bash) is opt-in
 * through the user's settings: there is nothing to pass to keep it off.
 */
const sandbox: InnerSandbox = {
	kind: "os",
	enabledByDefault: false,
	disable: {},
};

export const claude: WorkerDefinition = {
	name: "claude",
	adapterPackage: "@agentclientprotocol/claude-agent-acp",
	acp: {
		binaries: ["claude-agent-acp"],
		args: [],
		install: "npm install -g @agentclientprotocol/claude-agent-acp",
		innerSandbox: sandbox,
	},
	headless: {
		binaries: ["claude"],
		args: ["-p", "--output-format", "stream-json", "--verbose"],
		taskVia: "stdin",
		install: "npm install -g @anthropic-ai/claude-code",
		innerSandbox: sandbox,
	},
};
