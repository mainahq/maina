import { describe, expect, test } from "bun:test";
import { FEATURE_TEMPLATES } from "../../prompts/templates/index";
import { constitutionGate } from "../constitution-gate";

function plan(gate: string, justifications = ""): string {
	return `# Verification Plan: Demo

## Constitution gate

${gate}

${justifications}

## Architecture summary

Lives in core.
`;
}

const BY = "<!-- ticked-by: human:bikash -->";

const ALL_CHECKED = [
	`- [x] **Stack alignment** — uses the locked stack. ${BY}`,
	`- [x] **Result<T, E> error model** — no throws. ${BY}`,
].join("\n");

const ONE_UNCHECKED = [
	`- [x] **Stack alignment** — uses the locked stack. ${BY}`,
	"- [ ] **Single LLM call per command** — exception needs a note.",
].join("\n");

describe("constitutionGate", () => {
	test("a plan with every rule checked passes", () => {
		const report = constitutionGate(plan(ALL_CHECKED));
		expect(report.passed).toBe(true);
		expect(report.violations).toEqual([]);
		expect(report.rules.map((r) => r.name)).toEqual([
			"Stack alignment",
			"Result<T, E> error model",
		]);
	});

	test("an unchecked MUST rule blocks when no justification records it", () => {
		const report = constitutionGate(plan(ONE_UNCHECKED));
		expect(report.passed).toBe(false);
		expect(report.violations).toEqual([
			{
				rule: "Single LLM call per command",
				level: "must",
				line: 6,
				justification: undefined,
				blocking: true,
			},
		]);
	});

	test("a justification table row lets the MUST violation through", () => {
		const table = [
			"### Justifications",
			"",
			"| Rule | Justification |",
			"|---|---|",
			"| Single LLM call per command | PR review needs two passes |",
		].join("\n");
		const report = constitutionGate(plan(ONE_UNCHECKED, table));
		expect(report.passed).toBe(true);
		expect(report.violations).toEqual([
			{
				rule: "Single LLM call per command",
				level: "must",
				line: 6,
				justification: "PR review needs two passes",
				blocking: false,
			},
		]);
	});

	test("a justification row with no reason does not count", () => {
		const table = [
			"## Complexity tracking",
			"",
			"| Rule | Justification |",
			"|------|---------------|",
			"| **Single LLM call per command** |  |",
		].join("\n");
		const report = constitutionGate(plan(ONE_UNCHECKED, table));
		expect(report.passed).toBe(false);
		expect(report.violations[0]?.blocking).toBe(true);
	});

	test("a justification for another rule does not count", () => {
		const table = [
			"### Justifications",
			"",
			"| Rule | Justification |",
			"|---|---|",
			"| Stack alignment | unrelated |",
		].join("\n");
		expect(constitutionGate(plan(ONE_UNCHECKED, table)).passed).toBe(false);
	});

	test("an unchecked SHOULD rule is recorded but never blocks", () => {
		const gate = [
			ALL_CHECKED,
			"- [ ] **Docs page** — SHOULD add a docs page.",
		].join("\n");
		const report = constitutionGate(plan(gate));
		expect(report.passed).toBe(true);
		expect(report.violations).toHaveLength(1);
		expect(report.violations[0]?.level).toBe("should");
		expect(report.violations[0]?.blocking).toBe(false);
	});

	test("a plan without a constitution gate section blocks", () => {
		const report = constitutionGate("# Plan\n\n## Architecture\n\nx\n");
		expect(report.passed).toBe(false);
		expect(report.violations).toEqual([
			{
				rule: "Constitution gate",
				level: "must",
				line: 0,
				justification: undefined,
				blocking: true,
			},
		]);
	});

	test("the shipped plan template blocks until its rules are addressed", () => {
		const report = constitutionGate(FEATURE_TEMPLATES.plan);
		expect(report.rules.length).toBeGreaterThanOrEqual(7);
		expect(report.rules.every((r) => r.level === "must")).toBe(true);
		expect(report.passed).toBe(false);
	});
});

describe("constitutionGate review fixes (#332)", () => {
	test("a gate section with no rules blocks", () => {
		const report = constitutionGate(plan("Nothing to check yet."));
		expect(report.passed).toBe(false);
		expect(report.violations).toEqual([
			{
				rule: "Constitution gate",
				level: "must",
				line: 3,
				justification: undefined,
				blocking: true,
			},
		]);
	});

	test("a MUST rule ticked with no decide or human source blocks", () => {
		const gate = "- [x] **Stack alignment** — the agent ticked this itself.";
		const report = constitutionGate(plan(gate));
		expect(report.passed).toBe(false);
		expect(report.rules[0]?.attested).toBe(false);
		expect(report.violations.map((v) => [v.rule, v.blocking])).toEqual([
			["Stack alignment", true],
		]);
	});

	test("a rule ticked by a decide id counts as checked", () => {
		const gate =
			"- [x] **Stack alignment** — ok. <!-- ticked-by: decide:dec-42 -->";
		const report = constitutionGate(plan(gate));
		expect(report.passed).toBe(true);
		expect(report.rules[0]?.attested).toBe(true);
	});

	test("a ticked-by tag with a malformed source does not count", () => {
		const gate =
			"- [x] **Stack alignment** — ok. <!-- ticked-by: decide:a/b -->";
		expect(constitutionGate(plan(gate)).passed).toBe(false);
	});
});
