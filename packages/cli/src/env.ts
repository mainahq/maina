import type { AIContext, EnvPort } from "@mainahq/core";

/**
 * The CLI process environment as the `EnvPort` core reads it through. The
 * lookup is live, so variables set after startup are still seen. This edge
 * is the only place the CLI hands `process.env` to core.
 */
export const processEnv: EnvPort = {
	get: (name) => process.env[name],
};

/** AI context for a command running against the repository at `root`. */
export function aiContext(root: string): AIContext {
	return { root, env: processEnv };
}
