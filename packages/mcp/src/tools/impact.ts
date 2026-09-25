/**
 * `impact`: what a change to explicit files or symbols can affect, from the
 * code graph (FR-GRAPH-3): transitive callers, dependent files, covering
 * tests and a blast score.
 */

import type { CodeGraphNodeRef } from "@mainahq/core";
import { z } from "zod";
import {
	capped,
	defineTool,
	filesInput,
	invalid,
	ok,
	optionalRepoRelative,
	rootInput,
} from "./shared";

export const nodeRef = z.object({
	id: z.string(),
	path: z.string(),
	name: z.string(),
	qualifiedName: z.string(),
	kind: z.string(),
	startLine: z.number(),
	endLine: z.number(),
});

const impacted = nodeRef.extend({ depth: z.number() });

const data = z.object({
	targets: z.array(nodeRef),
	unknown: z.array(z.string()),
	callers: z.array(impacted),
	dependents: z.array(z.string()),
	tests: z.array(impacted),
	blastScore: z.number(),
});

/** The graph node fields the wire contract carries, and nothing else. */
export const toNodeRef = (n: CodeGraphNodeRef) => ({
	id: n.id,
	path: n.path,
	name: n.name,
	qualifiedName: n.qualifiedName,
	kind: n.kind,
	startLine: n.startLine,
	endLine: n.endLine,
});

export const impactTool = defineTool({
	name: "impact",
	description:
		"What changing explicit files or symbols can affect: transitive callers, dependent files, tests that cover them, and a blast score (share of the repo's files touched).",
	readOnly: true,
	input: {
		root: rootInput,
		files: filesInput.describe(
			"Files whose symbols are the targets: repo-relative, or absolute inside the root.",
		),
		symbols: z
			.array(z.string())
			.optional()
			.describe(
				"Node ids (path#qualifiedName) or qualified names (Circle.area).",
			),
		depth: z
			.number()
			.int()
			.min(1)
			.max(10)
			.optional()
			.describe("Call hops to follow back from the targets. Defaults to 3."),
	},
	data,
	run: async (args, { root, runtime }) => {
		if (!args.files?.length && !args.symbols?.length) {
			return invalid("impact needs `files` or `symbols`");
		}
		const files = optionalRepoRelative(root, args.files);
		if (!files.ok) return files;
		const result = await runtime.impact({
			root,
			...(files.value !== undefined ? { files: files.value } : {}),
			...(args.symbols !== undefined ? { symbols: args.symbols } : {}),
			...(args.depth !== undefined ? { depth: args.depth } : {}),
		});
		if (!result.ok) return result;
		const r = result.value;
		const withDepth = (n: CodeGraphNodeRef & { depth: number }) => ({
			...toNodeRef(n),
			depth: n.depth,
		});
		const summary = [
			`impact: ${r.targets.length} target(s), ${r.callers.length} caller(s), ${r.dependents.length} dependent file(s), ${r.tests.length} test(s); blast score ${r.blastScore.toFixed(2)}`,
			...(r.unknown.length > 0
				? [`not in the code graph: ${r.unknown.join(", ")}`]
				: []),
			...(r.dependents.length > 0
				? ["dependents:", ...capped(r.dependents.map((d) => `- ${d}`))]
				: []),
		].join("\n");
		return ok({
			data: {
				targets: r.targets.map(toNodeRef),
				unknown: [...r.unknown],
				callers: r.callers.map(withDepth),
				dependents: [...r.dependents],
				tests: r.tests.map(withDepth),
				blastScore: r.blastScore,
			},
			summary,
		});
	},
});
