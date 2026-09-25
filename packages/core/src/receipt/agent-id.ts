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

import { getHeadCommitMessage } from "../git/index";
import type { EnvPort } from "../ports/env";
import type { GitPort } from "../ports/git";

export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/;

export interface AgentIdentity {
	id: string;
	modelVersion: string;
}

export interface DetectAgentOptions {
	/** Environment to read `MAINA_AGENT_ID` / `MAINA_AGENT_MODEL` from. */
	env: EnvPort;
	/** Repository root whose HEAD commit may carry an `Agent:` trailer. */
	cwd: string;
	modelVersion?: string;
	/** Git port; defaults to the real git binary. */
	git?: GitPort;
}

/**
 * Detect the agent identity for the current Maina invocation.
 *
 * Returns a valid agent.id string matching AGENT_ID_PATTERN, never empty.
 */
export async function detectAgent(
	options: DetectAgentOptions,
): Promise<AgentIdentity> {
	const { env } = options;
	const modelVersion =
		nonEmpty(options.modelVersion) ??
		nonEmpty(env.get("MAINA_AGENT_MODEL")) ??
		"unknown";

	// 1. Environment override
	const envId = env.get("MAINA_AGENT_ID");
	if (envId && AGENT_ID_PATTERN.test(envId)) {
		return { id: envId, modelVersion };
	}

	// 2. MCP context — deferred. Landing alongside the GitHub App (Wave 4)
	//    when we have structured host handshake plumbing.

	// 3. Git trailer on HEAD commit
	const message = await getHeadCommitMessage(options.cwd, options.git);
	const trailer = message.match(/^Agent:\s*(\S+)\s*$/m)?.[1];
	if (trailer && AGENT_ID_PATTERN.test(trailer)) {
		return { id: trailer, modelVersion };
	}

	// 4. Fallback
	return { id: "ci:unknown", modelVersion };
}

function nonEmpty(s: string | undefined | null): string | undefined {
	return s && s.length > 0 ? s : undefined;
}
