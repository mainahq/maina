import type { AIContext, EnvPort } from "@mainahq/core";

/**
 * The MCP server's process environment as the `EnvPort` core reads it
 * through. The lookup is live, so `MAINA_MCP_SERVER=1` (set at server
 * start) is seen by every later call.
 */
export const processEnv: EnvPort = {
	get: (name) => process.env[name],
};

/** AI context for a tool call against the repository at `root`. */
export function aiContext(root: string): AIContext {
	return { root, env: processEnv };
}
