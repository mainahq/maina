/**
 * Findings and review triage through `decide` (v1 task 6.2, FR-VER-3,
 * FR-VER-4): the noise filter acts on `finding.real` probabilities at the
 * policy's confidence threshold, deep review runs only when
 * `diff.needs_review` says so or `--deep` is passed, the receipt records the
 * triage decision, and the AI review's entities come from the code graph.
 */

import { describe, expect, test } from "bun:test";
import {
	type DecidePorts,
	decide,
	defaultDecidePorts,
} from "../../decide/decide";
import { createRegistry, withBackend } from "../../decide/registry";
import type { Backend, BackendInput } from "../../decide/types";
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

/**
 * A System 1 stand-in that answers every bool question with `pTrue`, and
 * reports `escalate` as its escalate probability when given.
 */
function fixedBoolBackend(pTrue: number, escalate?: number): Backend {
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
				...(escalate === undefined ? {} : { diagnostics: { escalate } }),
			})),
		}),
	};
}

function system1Ports(
	type: "finding.real" | "diff.needs_review",
	pTrue: number,
	escalate?: number,
): DecidePorts {
	return {
		...defaultDecidePorts,
		policy: withBackend(DEFAULT_POLICY, type, "system1"),
		backends: createRegistry([
			...defaultDecidePorts.backends.values(),
			fixedBoolBackend(pTrue, escalate),
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

	test("an escalated 'noise' answer is not acted on: the finding stays (#577)", () => {
		// finding.real costs FP 1, FN 1 by default: the cutoff is 0.5.
		const calm = triageFindings(
			system1Ports("finding.real", 0.05, 0.2),
			[finding()],
			prefs({ "slop/console-log": [0, 10] }),
		);
		expect(calm.suppressed).toBe(1);
		const escalated = triageFindings(
			system1Ports("finding.real", 0.05, 0.8),
			[finding()],
			prefs({ "slop/console-log": [0, 10] }),
		);
		expect(escalated.suppressed).toBe(0);
	});

	test("an escalated severity answer is not acted on: the reported severity stays (#577)", () => {
		// A System 1 stand-in for finding.severity that downgrades to info.
		const downgrade = (escalate: number): Backend => ({
			id: "system1",
			version: "test",
			answer: ({ questions }) => ({
				ok: true,
				value: questions.map(() => ({
					answer: "info",
					distribution: [
						{ answer: "error", p: 0.05 },
						{ answer: "warning", p: 0.05 },
						{ answer: "info", p: 0.9 },
					],
					diagnostics: { escalate },
				})),
			}),
		});
		const ports = (escalate: number): DecidePorts => ({
			...defaultDecidePorts,
			policy: withBackend(DEFAULT_POLICY, "finding.severity", "system1"),
			backends: createRegistry([
				...defaultDecidePorts.backends.values(),
				downgrade(escalate),
			]),
		});
		const input = [finding({ ruleId: undefined, severity: "error" })];
		// finding.severity costs FP 1, FN 1 by default: the cutoff is 0.5.
		const calm = triageFindings(ports(0.1), input, prefs({}));
		expect(calm.kept[0]?.severity).toBe("info");
		const escalated = triageFindings(ports(0.9), input, prefs({}));
		expect(escalated.kept[0]?.severity).toBe("error");
	});

	test("an escalated 'no review needed' still asks for a review (#577)", () => {
		const escalated = triageDiff(
			system1Ports("diff.needs_review", 0.1, 0.9),
			diffOf("src/app.ts", 5),
		);
		expect(escalated.ok && escalated.value.needsReview).toBe(true);
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
		expect(runsDeepReview(false, yes)).toBe(true);
		expect(runsDeepReview(true, no)).toBe(true);
		expect(runsDeepReview(true, undefined)).toBe(true);
	});

	test("a failed triage fails closed: the deep review runs", () => {
		// No decision is the least sure answer there is; like an unsure "no",
		// it must not skip the review.
		expect(runsDeepReview(false, undefined)).toBe(true);
	});

	test("camelCase file names are split into words for the sensitive-path check", () => {
		for (const path of [
			"src/services/authService.ts",
			"src/sessionStore.ts",
			"src/lib/resetPassword.ts",
			"src/JWTVerifier.ts",
		]) {
			const result = triageDiff(defaultDecidePorts, diffOf(path, 3));
			expect({ path, needs: result.ok && result.value.needsReview }).toEqual({
				path,
				needs: true,
			});
		}
		const plain = triageDiff(
			defaultDecidePorts,
			diffOf("src/authorList.ts", 3),
		);
		expect(plain.ok && plain.value.needsReview).toBe(false);
	});

	test("OAuth, JWT and similar identity code is security-sensitive", () => {
		for (const path of ["src/oauth.ts", "src/jwt/verify.ts", "src/sso.ts"]) {
			const result = triageDiff(defaultDecidePorts, diffOf(path, 3));
			expect({ path, needs: result.ok && result.value.needsReview }).toEqual({
				path,
				needs: true,
			});
		}
	});

	test("a pure rename or a binary change of a sensitive file still counts", () => {
		const rename = [
			"diff --git a/src/app.ts b/src/auth/app.ts",
			"similarity index 100%",
			"rename from src/app.ts",
			"rename to src/auth/app.ts",
		].join("\n");
		const renamed = triageDiff(defaultDecidePorts, rename);
		expect(renamed.ok && renamed.value.needsReview).toBe(true);

		const binary = [
			"diff --git a/config/secrets.bin b/config/secrets.bin",
			"new file mode 100644",
			"index 0000000..e69de29",
			"Binary files /dev/null and b/config/secrets.bin differ",
		].join("\n");
		const bin = triageDiff(defaultDecidePorts, binary);
		expect(bin.ok && bin.value.needsReview).toBe(true);
	});
});

// ── diff.sensitive ──────────────────────────────────────────────────────────

/**
 * Ports whose `diff.sensitive` is served by a System 1 stand-in answering
 * yes with `pTrue`; every request it gets is recorded in `seen`.
 */
function sensitivePorts(pTrue: number): {
	ports: DecidePorts;
	seen: BackendInput[];
} {
	const seen: BackendInput[] = [];
	const inner = fixedBoolBackend(pTrue);
	const recording: Backend = {
		...inner,
		answer: (input) => {
			seen.push(input);
			return inner.answer(input);
		},
	};
	return {
		seen,
		ports: {
			...defaultDecidePorts,
			policy: withBackend(DEFAULT_POLICY, "diff.sensitive", "system1"),
			backends: createRegistry([
				...defaultDecidePorts.backends.values(),
				recording,
			]),
		},
	};
}

/** The one `diff.sensitive` request `triageDiff` made over `diff`. */
function sensitiveRequest(diff: string): BackendInput {
	const { ports, seen } = sensitivePorts(0.01);
	const result = triageDiff(ports, diff);
	expect(result.ok).toBe(true);
	expect(seen).toHaveLength(1);
	const [request] = seen;
	if (request === undefined) throw new Error("no diff.sensitive request");
	return request;
}

function patchOf(diff: string): unknown {
	return sensitiveRequest(diff).state.untrusted.patch;
}

/** One change in `src/app.ts`, git's default three lines of context. */
const CONTEXT_DIFF = [
	"diff --git a/src/app.ts b/src/app.ts",
	"index 1111111..2222222 100644",
	"--- a/src/app.ts",
	"+++ b/src/app.ts",
	"@@ -1,8 +1,10 @@ function main() {",
	" l1",
	" l2",
	"-const a = 1;",
	"+const a = 2;",
	" l4",
	" l5",
	" l6",
	"+x",
	"+y",
	" l7",
	" l8",
	"\\ No newline at end of file",
].join("\n");

/** The same change as `CONTEXT_DIFF`, as `git diff -U0` writes it. */
const ZERO_CONTEXT_DIFF = [
	"diff --git a/src/app.ts b/src/app.ts",
	"index 1111111..2222222 100644",
	"--- a/src/app.ts",
	"+++ b/src/app.ts",
	"@@ -3 +3 @@ function main() {",
	"-const a = 1;",
	"+const a = 2;",
	"@@ -6,0 +7,2 @@ l6",
	"+x",
	"+y",
].join("\n");

describe("diff.sensitive: the caller and its state (#585)", () => {
	test("every diff triage asks diff.sensitive one bool question over the whole diff", () => {
		const request = sensitiveRequest(diffOf("src/app.ts", 5));
		expect(request.type).toBe("diff.sensitive");
		expect(request.questions).toHaveLength(1);
		expect(request.questions[0]?.kind).toBe("bool");
		expect(request.questions[0]?.id).toMatch(/^sensitive:[0-9a-f]{16}$/);
		expect(request.state.trusted).toEqual({
			additions: 5,
			deletions: 0,
			files: 1,
		});
		expect(Object.keys(request.state.untrusted).sort()).toEqual([
			"patch",
			"paths",
		]);
		expect(request.state.untrusted.paths).toEqual(["src/app.ts"]);
	});

	test("the question id is stable for the same diff and differs for another", () => {
		const a = sensitiveRequest(diffOf("src/app.ts", 5)).questions[0]?.id;
		const b = sensitiveRequest(diffOf("src/app.ts", 5)).questions[0]?.id;
		const c = sensitiveRequest(diffOf("src/app.ts", 6)).questions[0]?.id;
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});

	test("the patch is zero-context: the file line, recomputed hunk headers and the changed lines", () => {
		expect(patchOf(CONTEXT_DIFF)).toBe(
			[
				"diff --git a/src/app.ts b/src/app.ts",
				"@@ -3 +3 @@",
				"-const a = 1;",
				"+const a = 2;",
				"@@ -6,0 +7,2 @@",
				"+x",
				"+y",
			].join("\n"),
		);
	});

	test("the patch is the same whatever context the diff was taken with", () => {
		expect(patchOf(ZERO_CONTEXT_DIFF)).toBe(patchOf(CONTEXT_DIFF) as string);
	});

	test("new and deleted files get git's zero-count hunk headers", () => {
		const diff = [
			"diff --git a/src/new.ts b/src/new.ts",
			"new file mode 100644",
			"index 0000000..3333333",
			"--- /dev/null",
			"+++ b/src/new.ts",
			"@@ -0,0 +1,2 @@",
			"+a",
			"+b",
			"diff --git a/src/old.ts b/src/old.ts",
			"deleted file mode 100644",
			"index 4444444..0000000",
			"--- a/src/old.ts",
			"+++ /dev/null",
			"@@ -1,2 +0,0 @@",
			"-c",
			"--- d",
		].join("\n");
		expect(patchOf(diff)).toBe(
			[
				"diff --git a/src/new.ts b/src/new.ts",
				"@@ -0,0 +1,2 @@",
				"+a",
				"+b",
				"diff --git a/src/old.ts b/src/old.ts",
				"@@ -1,2 +0,0 @@",
				"-c",
				"--- d",
			].join("\n"),
		);
	});

	test("a change without hunks keeps only its file line", () => {
		const rename = [
			"diff --git a/src/app.ts b/src/auth/app.ts",
			"similarity index 100%",
			"rename from src/app.ts",
			"rename to src/auth/app.ts",
		].join("\n");
		expect(patchOf(rename)).toBe("diff --git a/src/app.ts b/src/auth/app.ts");
	});

	test("a patch over 6000 code points is cut there and marked with a trailing ellipsis line", () => {
		const long = patchOf(diffOf("src/app.ts", 1000));
		expect(typeof long).toBe("string");
		if (typeof long !== "string") return;
		expect(Array.from(long)).toHaveLength(6000 + "\n…".length);
		expect(long.endsWith("\n…")).toBe(true);
		expect(long.startsWith("diff --git a/src/app.ts b/src/app.ts\n")).toBe(
			true,
		);
	});

	test("the cut counts code points, not UTF-16 units, as the model's Python does", () => {
		// About 4,550 code points but over 6,000 UTF-16 units: not cut.
		const emoji = [
			"diff --git a/src/e.ts b/src/e.ts",
			"@@ -0,0 +1,1500 @@",
			...Array.from({ length: 1500 }, () => "+😀"),
		].join("\n");
		const patch = patchOf(emoji);
		expect(typeof patch).toBe("string");
		if (typeof patch !== "string") return;
		expect(patch.length).toBeGreaterThan(6000);
		expect(patch.endsWith("…")).toBe(false);
		expect(patch.endsWith("+😀")).toBe(true);
	});

	test("a confident diff.sensitive yes asks for the deep review when diff.needs_review says no", () => {
		const { ports } = sensitivePorts(0.95);
		const result = triageDiff(ports, diffOf("src/app.ts", 5));
		expect(result.ok && result.value.needsReview).toBe(true);
	});

	test("the triage cites the decision that asked for the deep review", () => {
		// diff.needs_review says a confident no (confidence 1) to this diff.
		const diff = diffOf("src/app.ts", 5);
		// Only diff.sensitive says yes: the receipt must not cite the "no".
		const yes = triageDiff(sensitivePorts(0.95).ports, diff);
		expect(yes.ok).toBe(true);
		if (!yes.ok) return;
		expect(yes.value.needsReview).toBe(true);
		expect(yes.value.decisionId).toMatch(/^sensitive:[0-9a-f]{16}$/);
		expect(yes.value.confidence).toBeCloseTo(0.95, 10);
		// An unsure diff.sensitive no is cited the same way.
		const unsure = triageDiff(sensitivePorts(0.3).ports, diff);
		expect(unsure.ok && unsure.value.decisionId).toMatch(/^sensitive:/);
		expect(unsure.ok && unsure.value.confidence).toBeCloseTo(0.7, 10);
		// Both confident no: diff.needs_review's decision, as before #585.
		const no = triageDiff(sensitivePorts(0.05).ports, diff);
		expect(no.ok && no.value.decisionId).toMatch(/^needs_review:/);
		expect(no.ok && no.value.confidence).toBe(1);
		// diff.needs_review says yes: its decision is cited.
		const big = triageDiff(sensitivePorts(0.95).ports, diffOf("src/a.ts", 900));
		expect(big.ok && big.value.decisionId).toMatch(/^needs_review:/);
	});

	test("an unsure diff.sensitive no still asks for the deep review", () => {
		// The policy's diff.sensitive threshold is 0.9: 0.7 is unsure.
		const unsure = triageDiff(sensitivePorts(0.3).ports, diffOf("src/a.ts", 5));
		expect(unsure.ok && unsure.value.needsReview).toBe(true);
		const sure = triageDiff(sensitivePorts(0.05).ports, diffOf("src/a.ts", 5));
		expect(sure.ok && sure.value.needsReview).toBe(false);
	});

	test("a failed diff.sensitive decision fails the triage, so the deep review runs", () => {
		const failing: Backend = {
			id: "system1",
			version: "test",
			answer: () => ({
				ok: false,
				error: {
					kind: "unsupported",
					questionId: undefined,
					message: "model not loaded",
				},
			}),
		};
		const ports: DecidePorts = {
			...defaultDecidePorts,
			policy: withBackend(DEFAULT_POLICY, "diff.sensitive", "system1"),
			backends: createRegistry([
				...defaultDecidePorts.backends.values(),
				failing,
			]),
		};
		const result = triageDiff(ports, diffOf("src/app.ts", 5));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatchObject({
			kind: "unsupported",
			type: "diff.sensitive",
			backend: "system1",
		});
		expect(runsDeepReview(false, undefined)).toBe(true);
	});

	test("the heuristic flags security-sensitive paths and answers with confidence 1", () => {
		const ask = (paths: readonly string[]) =>
			decide(defaultDecidePorts, {
				type: "diff.sensitive",
				state: {
					trusted: { additions: 1, deletions: 0, files: paths.length },
					untrusted: { paths, patch: "" },
				},
				questions: [{ kind: "bool", id: "sensitive:0123456789abcdef" }],
			});
		for (const path of [
			"src/auth/login.ts",
			"src/services/authService.ts",
			"src/JWTVerifier.ts",
			"config/secrets.bin",
		]) {
			const result = ask(["README.md", path]);
			expect(result.ok).toBe(true);
			if (!result.ok) continue;
			expect({ path, answer: result.value[0]?.answer }).toEqual({
				path,
				answer: true,
			});
			expect(result.value[0]?.confidence).toBe(1);
		}
		const plain = ask(["src/app.ts", "src/authorList.ts"]);
		expect(plain.ok && plain.value[0]?.answer).toBe(false);
	});

	test("business-critical paths need a deep review but are not security-sensitive", () => {
		for (const path of [
			"src/billing/invoice.ts",
			"src/payments.ts",
			"db/migrations/001.sql",
			"src/sessionStore.ts",
			"src/env.ts",
		]) {
			const result = decide(defaultDecidePorts, {
				type: "diff.sensitive",
				state: {
					trusted: { additions: 1, deletions: 0, files: 1 },
					untrusted: { paths: [path], patch: "" },
				},
				questions: [{ kind: "bool", id: "sensitive" }],
			});
			expect(result.ok).toBe(true);
			expect({ path, answer: result.ok && result.value[0]?.answer }).toEqual({
				path,
				answer: false,
			});
			const triage = triageDiff(defaultDecidePorts, diffOf(path, 3));
			expect({ path, needs: triage.ok && triage.value.needsReview }).toEqual({
				path,
				needs: true,
			});
		}
	});

	test("the heuristic answers only its own question over a state with paths", () => {
		const noPaths = decide(defaultDecidePorts, {
			type: "diff.sensitive",
			state: { trusted: {}, untrusted: { patch: "" } },
			questions: [{ kind: "bool", id: "sensitive" }],
		});
		expect(noPaths.ok).toBe(false);
		if (!noPaths.ok) expect(noPaths.error.kind).toBe("unsupported");
		const otherCheck = decide(defaultDecidePorts, {
			type: "diff.sensitive",
			state: { trusted: {}, untrusted: { paths: ["src/auth.ts"] } },
			questions: [{ kind: "bool", id: "needs_review" }],
		});
		expect(otherCheck.ok).toBe(false);
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
