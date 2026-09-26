/**
 * OpenCode over ACP: `opencode acp`. Headless fallback: `opencode run`
 * with a JSON event stream.
 */

import type { InnerSandbox, WorkerDefinition } from "./spec";

/** OpenCode has no sandbox of its own. */
const sandbox: InnerSandbox = {
	kind: "none",
	enabledByDefault: false,
	disable: {},
};

const INSTALL = "npm install -g opencode-ai";

export const opencode: WorkerDefinition = {
	name: "opencode",
	adapterPackage: "opencode-ai",
	acp: {
		binaries: ["opencode"],
		args: ["acp"],
		install: INSTALL,
		innerSandbox: sandbox,
	},
	headless: {
		binaries: ["opencode"],
		args: ["run", "--format", "json"],
		taskVia: "argument",
		install: INSTALL,
		innerSandbox: sandbox,
	},
};
