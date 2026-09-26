/**
 * Cursor over ACP: its CLI's (hidden) `agent acp` subcommand. Headless
 * fallback: `agent -p` with a stream-json transcript. Older installs name
 * the binary `cursor-agent`.
 */

import type { InnerSandbox, WorkerDefinition } from "./spec";

/** Cursor sandboxes the agent's shell commands; `--sandbox` is a root flag. */
const sandbox: InnerSandbox = {
	kind: "os",
	enabledByDefault: true,
	disable: { args: ["--sandbox", "disabled"] },
};

const INSTALL = "curl https://cursor.com/install -fsS | bash";

export const cursor: WorkerDefinition = {
	name: "cursor",
	adapterPackage: "Cursor CLI",
	acp: {
		binaries: ["agent", "cursor-agent"],
		args: ["acp"],
		install: INSTALL,
		innerSandbox: sandbox,
	},
	headless: {
		binaries: ["agent", "cursor-agent"],
		args: ["-p", "--output-format", "stream-json"],
		taskVia: "argument",
		install: INSTALL,
		innerSandbox: sandbox,
	},
};
