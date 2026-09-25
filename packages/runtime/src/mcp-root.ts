/**
 * Root resolution for the standalone MCP server (FR-INS-3, FR-MCP-4).
 *
 * A tool call's explicit `root` wins; without one the host's project dir,
 * then the server's working directory. Each maps to its git top level
 * through `resolveRootAsync`, so the MCP tools act on the same root as the
 * gate and the graph hooks, and `$HOME` or `/` is refused unless explicit.
 */

import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { RootResolver } from "@mainahq/mcp";
import { asyncGitProbe, resolveRootAsync } from "./root";

type Probe = Parameters<typeof resolveRootAsync>[1];

type McpRootInputs = Readonly<{
	cwd: string;
	hostProjectDir?: string;
	/** The user's home; a non-explicit root there is refused. */
	home?: string;
}>;

/** `home` as git spells paths (symlinks resolved), or undefined. */
function realHome(home: string | undefined): string | undefined {
	if (home === undefined) return undefined;
	try {
		return realpathSync(home);
	} catch {
		return home;
	}
}

export function mcpRootResolver(
	inputs: McpRootInputs,
	probe: Probe = asyncGitProbe,
): RootResolver {
	const home = realHome(inputs.home);
	return async (explicit) => {
		// A relative root would resolve against the server's cwd (FR-MCP-4).
		if (explicit?.trim() && !isAbsolute(explicit)) {
			return {
				ok: false,
				error: {
					kind: "no_root",
					message: `root must be an absolute path, got ${explicit}`,
				},
			};
		}
		const resolved = await resolveRootAsync(
			{
				cwd: inputs.cwd,
				...(explicit !== undefined ? { explicit } : {}),
				...(inputs.hostProjectDir !== undefined
					? { hostProjectDir: inputs.hostProjectDir }
					: {}),
				...(home !== undefined ? { home } : {}),
			},
			probe,
		);
		return resolved.ok
			? { ok: true, value: resolved.value.path }
			: {
					ok: false,
					error: {
						kind: "no_root",
						message: `no repository from the ${resolved.error.source} root (tried ${resolved.error.tried.join(", ")}); pass an explicit root`,
					},
				};
	};
}
