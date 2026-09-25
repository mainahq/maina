/**
 * `status`: what this server is and what the repository at the root has:
 * version, enabled tools, code graph, wiki and policy health.
 */

import { z } from "zod";
import { ALL_TOOLS } from "../allowlist";
import { defineTool, ok, rootInput } from "./shared";

const data = z.object({
	version: z.string(),
	root: z.string(),
	tools: z.object({
		enabled: z.array(z.string()),
		available: z.array(z.string()),
	}),
	graph: z.object({ indexed: z.boolean() }),
	wiki: z.object({ initialized: z.boolean() }),
	policy: z.object({ valid: z.boolean(), errors: z.array(z.string()) }),
});

export const statusTool = defineTool({
	name: "status",
	description:
		"Server and repository status: maina version, the enabled and available tools, and whether the code graph, wiki and policy are ready at the root.",
	readOnly: true,
	input: { root: rootInput },
	data,
	run: async (_args, { root, runtime, enabled }) => {
		const result = await runtime.status({ root });
		if (!result.ok) return result;
		const repo = result.value;
		const status = {
			version: runtime.version,
			root,
			tools: { enabled: [...enabled], available: [...ALL_TOOLS] },
			graph: { indexed: repo.graphIndexed },
			wiki: { initialized: repo.wikiInitialized },
			policy: {
				valid: repo.policyErrors.length === 0,
				errors: [...repo.policyErrors],
			},
		};
		const summary = [
			`maina ${status.version} at ${root}`,
			`tools: ${status.tools.enabled.join(", ") || "none"}`,
			`code graph: ${repo.graphIndexed ? "indexed" : "not indexed yet (impact and context index on first use)"}`,
			`wiki: ${repo.wikiInitialized ? "initialized" : "not initialized"}`,
			`policy: ${status.policy.valid ? "valid" : `invalid: ${status.policy.errors.join("; ")}`}`,
		].join("\n");
		return ok({ data: status, summary });
	},
});
