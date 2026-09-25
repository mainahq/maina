/**
 * `receipt`: verify explicit maina receipt files against the v1 schema and
 * their canonical hash, so an agent can prove a receipt was not edited.
 */

import { z } from "zod";
import { defineTool, ok, plural, repoRelative, rootInput } from "./shared";

const entry = z.object({
	path: z.string(),
	verified: z.boolean(),
	status: z.string().optional(),
	hash: z.string().optional(),
	passed: z.number().optional(),
	total: z.number().optional(),
	code: z.string().optional(),
	message: z.string().optional(),
});

const data = z.object({
	verified: z.number(),
	failed: z.number(),
	receipts: z.array(entry),
});

export const receiptTool = defineTool({
	name: "receipt",
	description:
		"Verify explicit maina receipt JSON files against the v1 schema and their canonical hash. Reports each receipt's status and how many of its checks passed.",
	readOnly: true,
	input: {
		root: rootInput,
		paths: z
			.array(z.string())
			.min(1)
			.describe(
				"Receipt JSON files: repo-relative, or absolute inside the root.",
			),
	},
	data,
	run: async (args, { root, runtime }) => {
		const paths = repoRelative(root, args.paths);
		if (!paths.ok) return paths;
		const result = await runtime.receipts({ root, paths: paths.value });
		if (!result.ok) return result;
		const receipts = result.value.map(({ path, result: r }) =>
			r.ok
				? {
						path,
						verified: true,
						status: r.data.status,
						hash: r.data.hash,
						passed: r.data.checks.filter((c) => c.status === "passed").length,
						total: r.data.checks.length,
					}
				: { path, verified: false, code: r.code, message: r.message },
		);
		const verified = receipts.filter((r) => r.verified).length;
		const failed = receipts.length - verified;
		const summary = [
			`receipt: ${verified} verified, ${failed} failed`,
			...receipts.map((r) =>
				r.verified
					? `- ${r.path}: verified, ${r.status}, ${r.passed} of ${plural(r.total ?? 0, "check")} passed`
					: `- ${r.path}: FAILED [${r.code}] ${r.message}`,
			),
		].join("\n");
		return ok({ data: { verified, failed, receipts }, summary });
	},
});
