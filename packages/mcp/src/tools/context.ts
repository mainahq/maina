/**
 * `context`: the smallest set of source snippets that explains explicit
 * files or a query, from the code graph (FR-GRAPH-4), within a token
 * budget sized for an MCP result.
 */

import { z } from "zod";
import { nodeRef, toNodeRef } from "./impact";
import {
	defineTool,
	filesInput,
	invalid,
	ok,
	optionalRepoRelative,
	plural,
	rootInput,
} from "./shared";

/**
 * MCP results share the host's context window with the conversation, so
 * the budget stays well below a model's window: 8K tokens by default, 30K
 * at most.
 */
const DEFAULT_BUDGET_TOKENS = 8_000;
const MAX_BUDGET_TOKENS = 30_000;

const snippet = nodeRef.extend({
	reason: z.enum(["target", "callee", "caller"]),
	depth: z.number(),
	text: z.string(),
	tokens: z.number(),
});

const data = z.object({
	snippets: z.array(snippet),
	tokens: z.number(),
	naiveTokens: z.number(),
	savedTokens: z.number(),
	omitted: z.array(z.string()),
	stale: z.array(z.string()),
	unknown: z.array(z.string()),
});

export const contextTool = defineTool({
	name: "context",
	description:
		"Source snippets for explicit files or a free-text query plus their call-graph neighbourhood, within a token budget. Cheaper than reading whole files; reports the tokens saved.",
	readOnly: true,
	input: {
		root: rootInput,
		files: filesInput.describe(
			"Files whose symbols are the targets: repo-relative, or absolute inside the root.",
		),
		query: z
			.string()
			.optional()
			.describe("Free text: the best-matching symbols become the targets."),
		budgetTokens: z
			.number()
			.int()
			.min(1)
			.max(MAX_BUDGET_TOKENS)
			.optional()
			.describe(
				`Token ceiling for the snippets. Defaults to ${DEFAULT_BUDGET_TOKENS}.`,
			),
		depth: z
			.number()
			.int()
			.min(0)
			.max(5)
			.optional()
			.describe("Hops of callees and callers to consider. Defaults to 1."),
	},
	data,
	run: async (args, { root, runtime }) => {
		if (!args.files?.length && !args.query?.trim()) {
			return invalid("context needs `files` or a `query`");
		}
		const files = optionalRepoRelative(root, args.files);
		if (!files.ok) return files;
		const result = await runtime.context({
			root,
			...(files.value !== undefined ? { files: files.value } : {}),
			...(args.query !== undefined ? { query: args.query } : {}),
			budgetTokens: args.budgetTokens ?? DEFAULT_BUDGET_TOKENS,
			...(args.depth !== undefined ? { depth: args.depth } : {}),
		});
		if (!result.ok) return result;
		const c = result.value;
		const snippets = c.snippets.map((s) => ({
			...toNodeRef(s),
			reason: s.reason,
			depth: s.depth,
			text: s.text,
			tokens: s.tokens,
		}));
		const summary = [
			`context: ${plural(snippets.length, "snippet")}, ${c.tokens} tokens (saved ${c.savedTokens} of ${c.naiveTokens})`,
			...(c.unknown.length > 0
				? [`not in the code graph: ${c.unknown.join(", ")}`]
				: []),
			...(c.stale.length > 0
				? [`changed since indexing: ${c.stale.join(", ")}`]
				: []),
			...snippets.map(
				(s) =>
					`\n// ${s.path}:${s.startLine}-${s.endLine} ${s.qualifiedName} (${s.reason})\n${s.text}`,
			),
		].join("\n");
		return ok({
			data: {
				snippets,
				tokens: c.tokens,
				naiveTokens: c.naiveTokens,
				savedTokens: c.savedTokens,
				omitted: [...c.omitted],
				stale: [...c.stale],
				unknown: [...c.unknown],
			},
			summary,
		});
	},
});
