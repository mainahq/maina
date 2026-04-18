import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getFeedbackDb } from "../../db/index";
import {
	ALLOWED_REVIEWERS,
	categoriseComment,
	type ExternalReviewComment,
	getTopCategoriesByFile,
	ingestComments,
	insertFinding,
	queryFindings,
} from "../external-reviews";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-extrev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("categoriseComment", () => {
	test("api-mismatch from 'doesn't exist'", () => {
		expect(categoriseComment("This export doesn't exist on the module")).toBe(
			"api-mismatch",
		);
	});

	test("api-mismatch from 'won't typecheck'", () => {
		expect(categoriseComment("That call won't typecheck")).toBe("api-mismatch");
	});

	test("api-mismatch from 'is not exported'", () => {
		expect(categoriseComment("`importVerifyingKey` is not exported")).toBe(
			"api-mismatch",
		);
	});

	test("signature-drift from 'wrong signature'", () => {
		expect(categoriseComment("This call uses the wrong signature")).toBe(
			"signature-drift",
		);
	});

	test("signature-drift from 'expected.*got'", () => {
		expect(
			categoriseComment("expected `{ tokenBudget }` got `{ format }`"),
		).toBe("signature-drift");
	});

	test("dead-code from 'unused'", () => {
		expect(categoriseComment("This variable is unused")).toBe("dead-code");
	});

	test("dead-code from 'never called'", () => {
		expect(categoriseComment("This function is never called anywhere")).toBe(
			"dead-code",
		);
	});

	test("security from 'race condition'", () => {
		expect(categoriseComment("There's a race condition here")).toBe("security");
	});

	test("security from 'ENOENT'", () => {
		expect(categoriseComment("spawn /bin/foo ENOENT will crash")).toBe(
			"security",
		);
	});

	test("security from 'secret'", () => {
		expect(categoriseComment("This logs the secret token")).toBe("security");
	});

	test("style from 'console.log'", () => {
		expect(categoriseComment("Stray console.log left behind")).toBe("style");
	});

	test("style from 'formatting'", () => {
		expect(categoriseComment("formatting nit: trailing whitespace")).toBe(
			"style",
		);
	});

	test("other when nothing matches", () => {
		expect(categoriseComment("Looks good to me!")).toBe("other");
	});
});

describe("DB layer", () => {
	test("insert + query round-trip", () => {
		const dbResult = getFeedbackDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const result = insertFinding(tmpDir, {
			prNumber: 184,
			prRepo: "mainahq/maina",
			filePath: "packages/core/src/feedback/external-reviews.ts",
			line: 42,
			reviewer: "copilot-pull-request-reviewer",
			reviewerKind: "bot",
			category: "api-mismatch",
			body: "doesn't exist on the module",
			diffAtReview: "+ import { foo } from 'bar';",
			sourceId: "review-comment-12345",
		});
		expect(result.ok).toBe(true);

		const findings = queryFindings(tmpDir, {
			prRepo: "mainahq/maina",
			prNumber: 184,
		});
		expect(findings.ok).toBe(true);
		if (!findings.ok) return;
		expect(findings.value).toHaveLength(1);
		expect(findings.value[0]?.category).toBe("api-mismatch");
		expect(findings.value[0]?.line).toBe(42);
	});

	test("insertFinding dedupes on (repo, pr, source_id)", () => {
		const r1 = insertFinding(tmpDir, {
			prNumber: 1,
			prRepo: "x/y",
			filePath: "a.ts",
			line: 1,
			reviewer: "copilot-pull-request-reviewer",
			reviewerKind: "bot",
			category: "other",
			body: "hi",
			sourceId: "comment-1",
		});
		const r2 = insertFinding(tmpDir, {
			prNumber: 1,
			prRepo: "x/y",
			filePath: "a.ts",
			line: 1,
			reviewer: "copilot-pull-request-reviewer",
			reviewerKind: "bot",
			category: "other",
			body: "hi",
			sourceId: "comment-1",
		});
		expect(r1.ok).toBe(true);
		expect(r2.ok).toBe(true);
		const all = queryFindings(tmpDir, { prRepo: "x/y" });
		expect(all.ok).toBe(true);
		if (!all.ok) return;
		expect(all.value).toHaveLength(1);
	});
});

describe("ingestComments", () => {
	test("filters non-allowed reviewers", () => {
		const comments: ExternalReviewComment[] = [
			{
				sourceId: "1",
				prNumber: 5,
				prRepo: "x/y",
				filePath: "a.ts",
				line: 1,
				reviewer: "random-user",
				body: "this won't typecheck",
				diffAtReview: undefined,
			},
			{
				sourceId: "2",
				prNumber: 5,
				prRepo: "x/y",
				filePath: "a.ts",
				line: 2,
				reviewer: "copilot-pull-request-reviewer",
				body: "doesn't exist",
				diffAtReview: undefined,
			},
		];
		const result = ingestComments(tmpDir, comments, {
			allowedReviewers: ALLOWED_REVIEWERS,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.ingested).toBe(1);
		expect(result.value.skipped).toBe(1);
	});

	test("explicit human reviewer is allowed and stored as kind=human", () => {
		const comments: ExternalReviewComment[] = [
			{
				sourceId: "h1",
				prNumber: 5,
				prRepo: "x/y",
				filePath: "a.ts",
				line: 1,
				reviewer: "alice",
				body: "looks good",
				diffAtReview: undefined,
			},
		];
		const result = ingestComments(tmpDir, comments, {
			allowedReviewers: [...ALLOWED_REVIEWERS, "alice"],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.ingested).toBe(1);
		const findings = queryFindings(tmpDir, { prRepo: "x/y" });
		if (!findings.ok) return;
		expect(findings.value[0]?.reviewerKind).toBe("human");
	});

	test("re-ingesting the same PR doesn't duplicate rows", () => {
		const comments: ExternalReviewComment[] = [
			{
				sourceId: "dup-1",
				prNumber: 9,
				prRepo: "x/y",
				filePath: "a.ts",
				line: 1,
				reviewer: "copilot-pull-request-reviewer",
				body: "won't typecheck",
				diffAtReview: undefined,
			},
		];
		const r1 = ingestComments(tmpDir, comments, {
			allowedReviewers: ALLOWED_REVIEWERS,
		});
		const r2 = ingestComments(tmpDir, comments, {
			allowedReviewers: ALLOWED_REVIEWERS,
		});
		expect(r1.ok).toBe(true);
		expect(r2.ok).toBe(true);
		if (!r1.ok || !r2.ok) return;
		expect(r1.value.ingested).toBe(1);
		// Second pass should skip the duplicate.
		expect(r2.value.ingested).toBe(0);
		expect(r2.value.skipped).toBe(1);
	});

	test("empty comments returns ingested:0 skipped:0", () => {
		const result = ingestComments(tmpDir, [], {
			allowedReviewers: ALLOWED_REVIEWERS,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.ingested).toBe(0);
		expect(result.value.skipped).toBe(0);
	});
});

describe("getTopCategoriesByFile", () => {
	test("returns category counts grouped by file", () => {
		insertFinding(tmpDir, {
			prNumber: 1,
			prRepo: "x/y",
			filePath: "a.ts",
			line: 1,
			reviewer: "copilot-pull-request-reviewer",
			reviewerKind: "bot",
			category: "api-mismatch",
			body: "x",
			sourceId: "s1",
		});
		insertFinding(tmpDir, {
			prNumber: 2,
			prRepo: "x/y",
			filePath: "a.ts",
			line: 2,
			reviewer: "copilot-pull-request-reviewer",
			reviewerKind: "bot",
			category: "api-mismatch",
			body: "x",
			sourceId: "s2",
		});
		insertFinding(tmpDir, {
			prNumber: 3,
			prRepo: "x/y",
			filePath: "b.ts",
			line: 1,
			reviewer: "copilot-pull-request-reviewer",
			reviewerKind: "bot",
			category: "style",
			body: "x",
			sourceId: "s3",
		});

		const result = getTopCategoriesByFile(tmpDir, { limit: 5 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toHaveLength(2);
		const a = result.value.find((r) => r.filePath === "a.ts");
		expect(a?.count).toBe(2);
		expect(a?.category).toBe("api-mismatch");
	});
});
