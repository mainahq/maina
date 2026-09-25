/**
 * Gemini CLI over ACP: `gemini --acp`. Headless fallback: `gemini` with a
 * stream-json transcript and the task as `--prompt`.
 */

import type { InnerSandbox, WorkerDefinition } from "./spec";

/**
 * Docker, Podman or Seatbelt, off unless the user's settings or
 * `GEMINI_SANDBOX` turn it on; the variable wins over settings.
 */
const sandbox: InnerSandbox = {
	kind: "container",
	enabledByDefault: false,
	disable: { env: { GEMINI_SANDBOX: "false" } },
};

const INSTALL = "npm install -g @google/gemini-cli";

export const gemini: WorkerDefinition = {
	name: "gemini",
	adapterPackage: "@google/gemini-cli",
	acp: {
		binaries: ["gemini"],
		args: ["--acp"],
		install: INSTALL,
		innerSandbox: sandbox,
	},
	headless: {
		binaries: ["gemini"],
		args: ["--output-format", "stream-json", "--prompt"],
		taskVia: "argument",
		install: INSTALL,
		innerSandbox: sandbox,
	},
};
