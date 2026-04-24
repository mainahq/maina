/**
 * Agent identity detection per adr/0032-agent-id-format.md.
 *
 * Format: <host>:<agent> — both parts match /^[a-z0-9][a-z0-9-]*$/.
 *
 * Precedence (first match wins):
 *   1. MAINA_AGENT_ID env var (escape hatch for CI + scripts)
 *   2. MCP context (deferred to Wave 4 — needs host handshake plumbing alongside the GitHub App)
 *   3. Git trailer `Agent: <host>:<agent>` on the current HEAD commit
 *   4. Fallback `ci:unknown`
 *
 * Model version is separate from the slug — it carries the exact upstream
 * identifier (e.g. `claude-opus-4-7`). The slug (`claude-code:opus`) is
 * stable across minor model upgrades; the precise string goes into
 * `modelVersion` for audit.
 */

import { spawn } from "node:child_process";

export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/;

export interface AgentIdentity {
	id: string;
	modelVersion: string;
}

export interface DetectAgentOptions {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	modelVersion?: string;
}

/**
 * Detect the agent identity for the current Maina invocation.
 *
 * Returns a valid agent.id string matching AGENT_ID_PATTERN, never empty.
 */
export async function detectAgent(
	options: DetectAgentOptions = {},
): Promise<AgentIdentity> {
	const env = options.env ?? process.env;
	const modelVersion =
		options.modelVersion ?? env.MAINA_AGENT_MODEL ?? "unknown";

	// 1. Environment override
	const envId = env.MAINA_AGENT_ID;
	if (envId && AGENT_ID_PATTERN.test(envId)) {
		return { id: envId, modelVersion };
	}

	// 2. MCP context — deferred. Landing alongside the GitHub App (Wave 4)
	//    when we have structured host handshake plumbing.

	// 3. Git trailer on HEAD commit
	const trailer = await readAgentTrailer(options.cwd);
	if (trailer && AGENT_ID_PATTERN.test(trailer)) {
		return { id: trailer, modelVersion };
	}

	// 4. Fallback
	return { id: "ci:unknown", modelVersion };
}

async function readAgentTrailer(cwd?: string): Promise<string | null> {
	try {
		const message = await gitLastCommitMessage(cwd);
		const match = message.match(/^Agent:\s*(\S+)\s*$/m);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

function gitLastCommitMessage(cwd?: string): Promise<string> {
	return new Promise((resolve) => {
		const proc = spawn("git", ["log", "-1", "--pretty=format:%B"], {
			cwd: cwd ?? process.cwd(),
			stdio: ["ignore", "pipe", "ignore"],
		});
		let out = "";
		proc.stdout.on("data", (chunk) => {
			out += chunk.toString();
		});
		proc.on("close", () => resolve(out));
		proc.on("error", () => resolve(""));
	});
}
