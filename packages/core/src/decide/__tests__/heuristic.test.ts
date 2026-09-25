/**
 * The heuristic backend must reproduce the recorded 1.x behaviour exactly
 * (FR-DEC-6). The site-level replay lives in `__golden__/decisions.test.ts`;
 * this file checks that every golden site now reaches its verdict through
 * `decide`, replays the single-question goldens straight through `decide`,
 * and pins how heuristic confidence is derived.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN_SITES, type GoldenCase } from "../../__golden__/sites";
import type { DecisionType } from "../../policy/schema";
import { decide, defaultDecidePorts } from "../decide";
import type { DecideRequest, Decision } from "../types";

const CORE_SRC = join(import.meta.dir, "..", "..");
const FIXTURES = join(CORE_SRC, "__golden__", "decisions");

/** Each golden site, the file that holds it and the decision types it asks. */
const SITE_DECISIONS: Readonly<
	Record<
		(typeof GOLDEN_SITES)[number],
		{ file: string; types: readonly DecisionType[] }
	>
> = {
	"features/checklist.ts": {
		file: "features/checklist.ts",
		types: ["spec.coverage"],
	},
	"features/analyzer.ts": {
		file: "features/analyzer.ts",
		types: [
			"spec.coverage",
			"spec.orphan",
			"spec.contradiction",
			"spec.impl_leak",
		],
	},
	"features/quality.ts": {
		file: "features/quality.ts",
		types: ["spec.quality"],
	},
	"review/index.ts#spec-compliance": {
		file: "review/index.ts",
		types: ["spec.coverage", "spec.orphan", "spec.contradiction"],
	},
	"review/index.ts#code-quality": { file: "review/index.ts", types: ["slop"] },
	"feedback/external-reviews.ts#category": {
		file: "feedback/external-reviews.ts",
		types: ["review.category"],
	},
	"feedback/external-reviews.ts#reviewer-kind": {
		file: "feedback/external-reviews.ts",
		types: ["review.reviewer_kind"],
	},
	"feedback/preferences.ts#false-positive": {
		file: "feedback/preferences.ts",
		types: ["finding.real"],
	},
	"verify/slop.ts": { file: "verify/slop.ts", types: ["slop"] },
	"ai/validate.ts": { file: "ai/validate.ts", types: ["slop"] },
	"wiki/consult.ts": {
		file: "wiki/consult.ts",
		types: ["wiki.relevance", "spec.contradiction"],
	},
	"context/relevance.ts": {
		file: "context/relevance.ts",
		types: ["context.select"],
	},
	"ai/tiers.ts": { file: "ai/tiers.ts", types: ["task.tier"] },
};

function fixture(name: string): readonly GoldenCase[] {
	return (
		JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf-8")) as {
			cases: readonly GoldenCase[];
		}
	).cases;
}

function onlyDecision(request: DecideRequest): Decision {
	const result = decide(defaultDecidePorts, request);
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	const [decision] = result.value;
	if (!decision) throw new Error("no decision");
	return decision;
}

describe("every golden decision site routes through decide", () => {
	test("the table covers every golden site", () => {
		expect(Object.keys(SITE_DECISIONS).sort()).toEqual(
			[...GOLDEN_SITES].sort(),
		);
	});

	test.each(
		GOLDEN_SITES.map((site) => [site] as const),
	)("%s calls decide for its decision types", (site) => {
		const { file, types } = SITE_DECISIONS[site];
		const source = readFileSync(join(CORE_SRC, file), "utf-8");
		expect(source).toMatch(/from "\.\.\/decide\/decide"/);
		for (const type of types) {
			expect(source).toContain(`"${type}"`);
		}
	});
});

describe("heuristic backend reproduces the goldens through decide", () => {
	test("ai/tiers.ts → task.tier", () => {
		for (const c of fixture("ai-tiers")) {
			const input = c.input as { task: string };
			const decision = onlyDecision({
				type: "task.tier",
				state: { trusted: { task: input.task }, untrusted: {} },
				questions: [
					{
						kind: "choice",
						id: "tier",
						options: ["mechanical", "standard", "architectural", "local"],
					},
				],
			});
			expect(decision.answer).toBe((c.output as { tier: string }).tier);
		}
	});

	test("feedback/external-reviews.ts#category → review.category", () => {
		for (const c of fixture("feedback-external-reviews-category")) {
			const decision = onlyDecision({
				type: "review.category",
				state: {
					trusted: {},
					untrusted: { body: (c.input as { body: string }).body },
				},
				questions: [
					{
						kind: "choice",
						id: "category",
						options: [
							"api-mismatch",
							"signature-drift",
							"dead-code",
							"security",
							"style",
							"other",
						],
					},
				],
			});
			expect(decision.answer).toBe(c.output as string);
		}
	});

	test("feedback/external-reviews.ts#reviewer-kind → review.reviewer_kind", () => {
		for (const c of fixture("feedback-external-reviews-reviewer-kind")) {
			const decision = onlyDecision({
				type: "review.reviewer_kind",
				state: {
					trusted: {},
					untrusted: { reviewer: (c.input as { reviewer: string }).reviewer },
				},
				questions: [{ kind: "choice", id: "kind", options: ["bot", "human"] }],
			});
			expect(decision.answer).toBe(c.output as string);
		}
	});
});

describe("heuristic confidence", () => {
	const coverage = (matched: number, total: number) =>
		onlyDecision({
			type: "spec.coverage",
			state: {
				trusted: { candidates: { "0": { matched, total } } },
				untrusted: {},
			},
			questions: [{ kind: "bool", id: "criterion:0" }],
		});

	test("exact rules give a degenerate distribution with confidence 1", () => {
		const decision = onlyDecision({
			type: "review.reviewer_kind",
			state: { trusted: {}, untrusted: { reviewer: "dependabot" } },
			questions: [{ kind: "choice", id: "kind", options: ["bot", "human"] }],
		});
		expect(decision.distribution).toEqual([
			{ answer: "bot", p: 1 },
			{ answer: "human", p: 0 },
		]);
		expect(decision.confidence).toBe(1);
	});

	test("threshold rules derive confidence from the distance to the threshold", () => {
		// covered iff matched/total >= 0.5
		expect(coverage(4, 4)).toMatchObject({ answer: true, confidence: 1 });
		expect(coverage(3, 4)).toMatchObject({ answer: true, confidence: 0.75 });
		expect(coverage(1, 2)).toMatchObject({ answer: true, confidence: 0.5 });
		expect(coverage(1, 4)).toMatchObject({ answer: false, confidence: 0.75 });
		expect(coverage(0, 4)).toMatchObject({ answer: false, confidence: 1 });
	});

	test("too few samples for a false-positive call is an even split that keeps the finding", () => {
		const decision = onlyDecision({
			type: "finding.real",
			state: {
				trusted: { candidates: { r: { falsePositiveRate: 1, totalCount: 4 } } },
				untrusted: {},
			},
			questions: [{ kind: "bool", id: "rule:r" }],
		});
		expect(decision).toMatchObject({ answer: true, confidence: 0.5 });
	});
});
