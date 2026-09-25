/**
 * Findings and review triage through `decide` (v1 task 6.2, FR-VER-3,
 * FR-VER-4): the noise filter acts on `finding.real` probabilities at the
 * policy's confidence threshold, deep review runs only when
 * `diff.needs_review` says so or `--deep` is passed, the receipt records the
 * triage decision, and the AI review's entities come from the code graph.
 */

import { describe, expect, test } from "bun:test";
import { type DecidePorts, defaultDecidePorts } from "../../decide/decide";
import { createRegistry, withBackend } from "../../decide/registry";
import type { Backend } from "../../decide/types";
import type { Preferences } from "../../feedback/preferences";
import { indexedRepo, ROOT } from "../../graph/query/__tests__/fixture";
import { DEFAULT_POLICY } from "../../policy/defaults";
import type { Policy } from "../../policy/schema";
import { createFakeEnv } from "../../ports/testing";
import { buildReceipt } from "../../receipt/build";
import { verifyReceipt } from "../../receipt/verify";
import type { Finding } from "../diff-filter";
import type { PipelineResult } from "../pipeline";
import { graphReviewEntities } from "../review-entities";
import { runsDeepReview, triageDiff, triageFindings } from "../triage";

// ── Helpers ─────────────────────────────────────────────────────────────────

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		tool: "slop",
		file: "src/app.ts",
		line: 3,
		message: "console.log left in",
		severity: "warning",
		ruleId: "slop/console-log",
		...overrides,
	};
}

/** Preferences with `dismissed` of `total` findings of each rule dismissed. */
function prefs(
	rules: Readonly<Record<string, readonly [dismissed: number, total: number]>>,
): Preferences {
	return {
		updatedAt: "2026-01-01T00:00:00.000Z",
		rules: Object.fromEntries(
			Object.entries(rules).map(([ruleId, [dismissed, total]]) => [
				ruleId,
				{
					ruleId,
					dismissCount: dismissed,
					totalCount: total,
					falsePositiveRate: dismissed / total,
				},
			]),
		),
	};
}

function withThreshold(
	type: "finding.real" | "diff.needs_review",
	confidence: number,
): Policy {
	const current = DEFAULT_POLICY.decisions[type];
	return {
		...DEFAULT_POLICY,
		decisions: {
			...DEFAULT_POLICY.decisions,
			[type]: { ...current, thresholds: { confidence } },
		},
	};
}

function portsWith(policy: Policy, backends = defaultDecidePorts.backends) {
	return { ...defaultDecidePorts, policy, backends } satisfies DecidePorts;
}

/** A System 1 stand-in that answers every bool question with `pTrue`. */
function fixedBoolBackend(pTrue: number): Backend {
	return {
		id: "system1",
		version: "test",
		answer: ({ questions }) => ({
			ok: true,
			value: questions.map(() => ({
				answer: pTrue >= 0.5,
				distribution: [
					{ answer: true, p: pTrue },
					{ answer: false, p: 1 - pTrue },
				],
			})),
		}),
	};
}

function system1Ports(
	type: "finding.real" | "diff.needs_review",
	pTrue: number,
): DecidePorts {
	return {
		...defaultDecidePorts,
		policy: withBackend(DEFAULT_POLICY, type, "system1"),
		backends: createRegistry([
			...defaultDecidePorts.backends.values(),
			fixedBoolBackend(pTrue),
		]),
	};
}

/** A unified diff adding `lines` lines to `path`. */
function diffOf(path: string, lines: number): string {
	const added = Array.from({ length: lines }, (_, i) => `+const v${i} = ${i};`);
	return [
		`diff --git a/${path} b/${path}`,
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -1,0 +1,${lines} @@`,
		...added,
	].join("\n");
}

// ── Noise filter ────────────────────────────────────────────────────────────

describe("noise filter: finding.real probabilities at the policy threshold", () => {
	test("a rule dismissed 60% of the time is downgraded, not dropped (the old ratio cut dropped it)", () => {
		const result = triageFindings(
			defaultDecidePorts,
			[finding()],
			prefs({ "slop/console-log": [6, 10] }),
		);
		expect(result.suppressed).toBe(0);
		expect(result.kept).toHaveLength(1);
		expect(result.kept[0]?.severity).toBe("info");
		expect(result.kept[0]?.realProbability).toBeCloseTo(0.4, 10);
	});

	test("a rule whose noise probability reaches the policy threshold is suppressed", () => {
		const result = triageFindings(
			defaultDecidePorts,
			[finding()],
			prefs({ "slop/console-log": [9, 10] }),
		);
		expect(result.kept).toEqual([]);
		expect(result.suppressed).toBe(1);
	});

	test("the threshold comes from the policy", () => {
		const input = [finding()];
		const evidence = prefs({ "slop/console-log": [9, 10] });
		const strict = triageFindings(
			portsWith(withThreshold("finding.real", 0.95)),
			input,
			evidence,
		);
		expect(strict.suppressed).toBe(0);
		expect(strict.kept[0]?.severity).toBe("info");

		const loose = triageFindings(
			portsWith(withThreshold("finding.real", 0.55)),
			[finding()],
			prefs({ "slop/console-log": [6, 10] }),
		);
		expect(loose.suppressed).toBe(1);
	});

	test("it acts on the decide distribution, not on dismiss ratios", () => {
		// No dismissals at all, but the backend is sure the finding is noise.
		const sure = triageFindings(
			system1Ports("finding.real", 0.05),
			[finding()],
			prefs({ "slop/console-log": [0, 10] }),
		);
		expect(sure.suppressed).toBe(1);

		// Every finding dismissed, but the backend says it is real.
		const real = triageFindings(
			system1Ports("finding.real", 0.9),
			[finding({ severity: "error" })],
			prefs({ "slop/console-log": [10, 10] }),
		);
		expect(real.suppressed).toBe(0);
		expect(real.kept[0]).toMatchObject({
			severity: "error",
			realProbability: 0.9,
		});
	});

	test("a finding without recorded outcomes is kept as reported at an even probability", () => {
		const input = finding({ ruleId: undefined, severity: "error" });
		const result = triageFindings(defaultDecidePorts, [input], prefs({}));
		expect(result.kept).toEqual([{ ...input, realProbability: 0.5 }]);
	});

	test("the input findings are never mutated, and byOriginal maps each one", () => {
		const noisy = finding();
		const dropped = finding({ ruleId: "slop/todo" });
		const before = structuredClone([noisy, dropped]);
		const result = triageFindings(
			defaultDecidePorts,
			[noisy, dropped],
			prefs({ "slop/console-log": [6, 10], "slop/todo": [10, 10] }),
		);
		expect([noisy, dropped]).toEqual(before);
		expect(result.byOriginal.get(noisy)?.severity).toBe("info");
		expect(result.byOriginal.get(dropped)).toBeNull();
	});
});

// ── Review triage ───────────────────────────────────────────────────────────

describe("review triage: diff.needs_review", () => {
	test("a small change in ordinary code needs no deep review", () => {
		const result = triageDiff(defaultDecidePorts, diffOf("src/app.ts", 5));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.needsReview).toBe(false);
		expect(result.value.confidence).toBe(1);
		expect(result.value.decisionId).toMatch(/^needs_review:[0-9a-f]{16}$/);
	});

	test("a large change needs a deep review", () => {
		const result = triageDiff(defaultDecidePorts, diffOf("src/app.ts", 500));
		expect(result.ok && result.value.needsReview).toBe(true);
	});

	test("a change to security-sensitive code needs a deep review", () => {
		const result = triageDiff(
			defaultDecidePorts,
			diffOf("src/auth/session.ts", 3),
		);
		expect(result.ok && result.value.needsReview).toBe(true);
	});

	test("the decision id is stable for the same diff and differs for another", () => {
		const a = triageDiff(defaultDecidePorts, diffOf("src/app.ts", 5));
		const b = triageDiff(defaultDecidePorts, diffOf("src/app.ts", 5));
		const c = triageDiff(defaultDecidePorts, diffOf("src/app.ts", 6));
		expect(a.ok && b.ok && c.ok).toBe(true);
		if (!a.ok || !b.ok || !c.ok) return;
		expect(a.value.decisionId).toBe(b.value.decisionId);
		expect(a.value.decisionId).not.toBe(c.value.decisionId);
	});

	test("an unsure 'no' below the policy threshold still asks for a review", () => {
		const unsure = triageDiff(
			system1Ports("diff.needs_review", 0.4),
			diffOf("src/app.ts", 5),
		);
		expect(unsure.ok).toBe(true);
		if (!unsure.ok) return;
		expect(unsure.value).toMatchObject({ needsReview: true, confidence: 0.6 });

		const sure = triageDiff(
			system1Ports("diff.needs_review", 0.1),
			diffOf("src/app.ts", 5),
		);
		expect(sure.ok && sure.value.needsReview).toBe(false);
	});

	test("deep review runs only when needsReview is true or --deep is passed", () => {
		const no = {
			decisionId: "needs_review:0",
			needsReview: false,
			confidence: 1,
		};
		const yes = { ...no, needsReview: true };
		expect(runsDeepReview(false, no)).toBe(false);
		expect(runsDeepReview(false, undefined)).toBe(false);
		expect(runsDeepReview(false, yes)).toBe(true);
		expect(runsDeepReview(true, no)).toBe(true);
		expect(runsDeepReview(true, undefined)).toBe(true);
	});
});

// ── Receipt ─────────────────────────────────────────────────────────────────

function stubPipeline(overrides: Partial<PipelineResult> = {}): PipelineResult {
	return {
		status: "passed",
		passed: true,
		scope: { kind: "working-tree", files: ["src/app.ts"] },
		syntaxPassed: true,
		tools: [
			{
				tool: "slop",
				findings: [{ ...finding(), realProbability: 0.123456 }],
				skipped: false,
				duration: 1,
			},
		],
		findings: [],
		hiddenCount: 0,
		detectedTools: [],
		duration: 1,
		cacheHits: 0,
		cacheMisses: 0,
		...overrides,
	};
}

async function receiptOf(pipeline: PipelineResult) {
	const built = await buildReceipt({
		prTitle: "triage PR",
		pipeline,
		constitutionHash: "a".repeat(64),
		promptsHash: "b".repeat(64),
		cwd: process.cwd(),
		env: createFakeEnv(),
	});
	expect(built.ok).toBe(true);
	if (!built.ok) throw new Error(built.message);
	return built.data;
}

describe("receipt", () => {
	const triage = {
		decisionId: "needs_review:0123456789abcdef",
		needsReview: true,
		confidence: 1,
	};

	test("the receipt contains the triage decision, covered by its hash", async () => {
		const receipt = await receiptOf(stubPipeline({ triage }));
		expect(receipt.triage).toEqual(triage);
		expect(verifyReceipt(receipt).ok).toBe(true);

		const tampered = { ...receipt, triage: { ...triage, needsReview: false } };
		const verified = verifyReceipt(tampered);
		expect(verified.ok).toBe(false);
		if (verified.ok) return;
		expect(verified.code).toBe("hash-mismatch");
	});

	test("each finding carries its realProbability, rounded to 4 places", async () => {
		const receipt = await receiptOf(stubPipeline({ triage }));
		expect(receipt.checks[0]?.findings[0]?.realProbability).toBe(0.1235);
	});

	test("a receipt without triage has no triage field", async () => {
		const receipt = await receiptOf(stubPipeline());
		expect("triage" in receipt).toBe(false);
		expect(verifyReceipt(receipt).ok).toBe(true);
	});

	test("verifyReceipt rejects a malformed triage or realProbability", async () => {
		const receipt = await receiptOf(stubPipeline({ triage }));
		const badTriage = verifyReceipt({
			...receipt,
			triage: { ...triage, confidence: 2 },
		});
		expect(badTriage.ok).toBe(false);
		if (!badTriage.ok) expect(badTriage.code).toBe("invalid-field");

		const [check] = receipt.checks;
		if (check === undefined) throw new Error("no check");
		const badFinding = verifyReceipt({
			...receipt,
			checks: [
				{
					...check,
					findings: check.findings.map((f) => ({ ...f, realProbability: -1 })),
				},
			],
		});
		expect(badFinding.ok).toBe(false);
		if (!badFinding.ok) expect(badFinding.code).toBe("invalid-field");
	});
});

// ── Entities from the graph ─────────────────────────────────────────────────

describe("AI review entities come from the graph", () => {
	const diff = [
		"diff --git a/src/app.ts b/src/app.ts",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -1,0 +1,1 @@",
		"+const doubled = mid(2) + other();",
	].join("\n");

	test("functions the added lines call come back with their line-exact bodies", async () => {
		const repo = await indexedRepo();
		const result = await graphReviewEntities(repo.ports, ROOT, diff);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const mid = result.value.find((e) => e.name === "mid");
		expect(mid).toEqual({
			name: "mid",
			kind: "function",
			filePath: "src/mid.ts",
			startLine: 3,
			endLine: 5,
			body: "export function mid(n: number): number {\n\treturn base(n) * 2;\n}",
		});
		// Only what the diff calls: `base` and `top` are not called.
		expect(result.value.map((e) => e.name).sort()).toEqual(["mid", "other"]);
	});

	test("a diff that calls nothing needs no graph entities", async () => {
		const repo = await indexedRepo();
		const result = await graphReviewEntities(repo.ports, ROOT, "+const x = 1;");
		expect(result.ok && result.value).toEqual([]);
	});

	test("a file edited since indexing is left out rather than sliced wrongly", async () => {
		const repo = await indexedRepo();
		await repo.write("src/mid.ts", "// moved\n\n\nexport const mid = 1;\n");
		const result = await graphReviewEntities(repo.ports, ROOT, diff);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.map((e) => e.name)).toEqual(["other"]);
	});
});
