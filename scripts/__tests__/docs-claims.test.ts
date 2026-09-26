/**
 * "No forbidden claims" lint (#359, FR-DOC-4).
 *
 * The docs must not promise what the code does not do: that maina is
 * deterministic, that it cannot hallucinate, that it sends no telemetry
 * when the telemetry config says otherwise, or that something is AST-based
 * when no tree-sitter grammar backs it.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	AST_EVIDENCE,
	astEvidenceProblems,
	type ClaimContext,
	checkDocsClaims,
	findClaims,
} from "../docs-claims";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const OFF: ClaimContext = { telemetryOnByDefault: [], astAllowed: false };

const rules = (text: string, ctx: ClaimContext = OFF): string[] =>
	findClaims(text, ctx).map((c) => c.rule);

describe("findClaims: deterministic", () => {
	test("flags maina described as deterministic", () => {
		expect(rules("Maina is deterministic: same code, same findings.")).toEqual([
			"deterministic",
		]);
		expect(rules("It runs deterministically on every diff.")).toEqual([
			"deterministic",
		]);
		expect(rules("Deterministic verification works offline.")).toEqual([
			"deterministic",
		]);
	});

	test("leaves 'non-deterministic' alone", () => {
		expect(rules("Model output is non-deterministic.")).toEqual([]);
	});
});

describe("findClaims: cannot hallucinate", () => {
	test("flags promises that nothing hallucinates", () => {
		for (const text of [
			"The gate can't hallucinate.",
			"The gate can’t hallucinate.",
			"It cannot hallucinate an import.",
			"Heuristics never hallucinate.",
			"Hallucination-free reviews.",
			"Zero hallucinations.",
		]) {
			expect({ text, rules: rules(text) }).toEqual({
				text,
				rules: ["cannot-hallucinate"],
			});
		}
	});

	test("leaves names of the thing being caught alone", () => {
		expect(rules("The slop detector catches hallucinated imports.")).toEqual(
			[],
		);
		expect(rules("An agent hallucinates an API.")).toEqual([]);
	});
});

describe("findClaims: telemetry", () => {
	test("flags an unqualified 'no telemetry'", () => {
		expect(rules("No account, no telemetry.")).toEqual(["no-telemetry"]);
		expect(rules("Maina never phones home.")).toEqual(["no-telemetry"]);
		expect(rules("Zero telemetry, ever.")).toEqual(["no-telemetry"]);
	});

	test("accepts 'no telemetry' qualified the way the config is", () => {
		expect(rules("No telemetry unless you turn it on.")).toEqual([]);
		expect(rules("No telemetry by default.")).toEqual([]);
		expect(rules("Telemetry is off by default.")).toEqual([]);
	});

	test("flags even the qualified claims when a channel is on by default", () => {
		const on: ClaimContext = { ...OFF, telemetryOnByDefault: ["usage"] };
		expect(rules("No telemetry unless you turn it on.", on)).toEqual([
			"no-telemetry",
		]);
		expect(rules("Telemetry is off by default.", on)).toEqual(["no-telemetry"]);
	});
});

describe("findClaims: AST", () => {
	test("flags AST claims on a page with no tree-sitter evidence", () => {
		expect(rules("An AST-based consistency check.")).toEqual(["ast"]);
		expect(rules("It walks the abstract syntax tree.")).toEqual(["ast"]);
	});

	test("accepts them where the evidence map backs the page", () => {
		expect(
			rules("An AST-based consistency check.", { ...OFF, astAllowed: true }),
		).toEqual([]);
	});

	test("does not read 'last' or 'fast' as AST", () => {
		expect(rules("The last step is fast.")).toEqual([]);
	});
});

describe("findClaims: scope", () => {
	test("skips fenced code and inline code, and reports 1-based lines", () => {
		const text = [
			"---",
			"title: A page",
			"---",
			"```bash",
			"# deterministic build",
			"```",
			"The `deterministic` flag is a name.",
			"",
			"But maina is deterministic.",
		].join("\n");
		expect(findClaims(text, OFF)).toEqual([
			{
				line: 9,
				rule: "deterministic",
				match: "deterministic",
				reason: expect.any(String),
			},
		]);
	});
});

describe("AST evidence", () => {
	test("every page it vouches for cites source that loads a tree-sitter grammar", () => {
		expect(Object.keys(AST_EVIDENCE).length).toBeGreaterThan(0);
		expect(astEvidenceProblems(REPO_ROOT)).toEqual([]);
	});

	test("reports a cited source that is missing or not tree-sitter", () => {
		expect(
			astEvidenceProblems(REPO_ROOT, {
				"README.md": ["packages/core/src/verify/consistency.ts"],
				"docs.mdx": ["packages/core/src/does-not-exist.ts"],
			}),
		).toEqual([
			"README.md: packages/core/src/verify/consistency.ts does not load a tree-sitter grammar",
			"docs.mdx: packages/core/src/does-not-exist.ts does not exist",
		]);
	});
});

describe("the docs", () => {
	test("make no forbidden claims", () => {
		expect(checkDocsClaims(REPO_ROOT)).toEqual([]);
	});
});
