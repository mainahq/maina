/**
 * The optional extras a receipt comment shows beside a v1 receipt
 * (criteria, verify scope, gate tally, receipt url), parsed from JSON a
 * caller hands over. Strict: an unknown key is an error, not a silent drop.
 */

import { z } from "zod";
import { toSchemaIssues } from "../config/schema";
import type { Result } from "../db/index";
import type { CommentReceipt } from "./receipt-comment";

const Count = z.number().int().nonnegative();

const ExtrasSchema = z.strictObject({
	criteria: z
		.array(
			z.strictObject({
				id: z.string().min(1),
				text: z.string(),
				status: z.enum(["met", "unmet", "unverified"]),
				evidence: z.array(z.string()),
			}),
		)
		.optional(),
	verifyScope: z
		.strictObject({
			kind: z.enum(["working-tree", "staged", "range", "files"]),
			base: z.string().min(1).optional(),
			files: Count,
		})
		.optional(),
	gate: z
		.strictObject({
			blocked: Count,
			asked: Count,
			allowed: Count,
			overrides: z.array(
				z.strictObject({ decisionId: z.string(), summary: z.string() }),
			),
		})
		.optional(),
	url: z.url().optional(),
});

export type CommentExtras = Pick<
	CommentReceipt,
	"criteria" | "verifyScope" | "gate" | "url"
>;

export type ExtrasError = Readonly<{ kind: "invalid_extras"; message: string }>;

export function parseCommentExtras(
	raw: unknown,
): Result<CommentExtras, ExtrasError> {
	const parsed = ExtrasSchema.safeParse(raw);
	if (parsed.success) return { ok: true, value: parsed.data };
	const message = toSchemaIssues(parsed.error)
		.map((issue) => `${issue.path}: ${issue.message}`)
		.join("; ");
	return { ok: false, error: { kind: "invalid_extras", message } };
}
