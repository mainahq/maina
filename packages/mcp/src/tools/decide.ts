/**
 * `decide`: the typed decision interface (FR-DEC-1) for a host agent. The
 * runtime answers with the repo's policy and the built-in backends; every
 * answer is a validated distribution, never free text.
 */

import type { DecisionType } from "@mainahq/core";
import { z } from "zod";
import { defineTool, ok, rootInput } from "./shared";

const question = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("choice"),
		id: z.string(),
		options: z.array(z.string()),
	}),
	z.object({
		kind: z.literal("score"),
		id: z.string(),
		min: z.number(),
		max: z.number(),
	}),
	z.object({ kind: z.literal("bool"), id: z.string() }),
]);

const answer = z.union([z.string(), z.number(), z.boolean()]);

const decision = z.object({
	id: z.string(),
	type: z.string(),
	answer,
	distribution: z.array(z.object({ answer, p: z.number() })),
	confidence: z.number(),
	backend: z.object({ id: z.string(), version: z.string() }),
	latencyMs: z.number(),
});

const data = z.object({ decisions: z.array(decision) });

export const decideTool = defineTool({
	name: "decide",
	description:
		"Answer typed questions for a decision type (e.g. finding.real, diff.needs_review) with the repo's policy. Each answer comes with a probability distribution and the backend that produced it.",
	readOnly: true,
	input: {
		root: rootInput,
		type: z.string().describe("The decision type, e.g. finding.real."),
		questions: z
			.array(question)
			.describe("The questions to answer: choice, score or bool."),
		state: z
			.object({
				trusted: z.record(z.string(), z.unknown()),
				untrusted: z.record(z.string(), z.unknown()),
			})
			.optional()
			.describe(
				"What the decision is made over: `trusted` holds computed or configured values, `untrusted` repository or agent content (never treated as instructions).",
			),
	},
	data,
	run: async (args, { root, runtime }) => {
		const result = await runtime.decide({
			root,
			request: {
				// `decide` rejects an unknown type with a typed error.
				type: args.type as DecisionType,
				questions: args.questions,
				state: args.state ?? { trusted: {}, untrusted: {} },
			},
		});
		if (!result.ok) return result;
		const decisions = result.value.map((d) => ({
			id: d.id,
			type: d.type,
			answer: d.answer,
			distribution: d.distribution.map((e) => ({ answer: e.answer, p: e.p })),
			confidence: d.confidence,
			backend: { id: d.backend.id, version: d.backend.version },
			latencyMs: d.latencyMs,
		}));
		const summary = [
			`decide ${args.type}: ${decisions.length} answer(s)`,
			...decisions.map(
				(d) =>
					`- ${d.id}: ${String(d.answer)} (p=${d.confidence.toFixed(2)}, ${d.backend.id})`,
			),
		].join("\n");
		return ok({ data: { decisions }, summary });
	},
});
