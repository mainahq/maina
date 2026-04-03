import { describe, expect, test } from "bun:test";
import { loadDefault, type PromptTask } from "../defaults/index";

const ALL_TASKS: PromptTask[] = [
	"review",
	"commit",
	"tests",
	"fix",
	"explain",
	"design",
	"context",
];

describe("loadDefault", () => {
	test("loadDefault('review') returns string containing '{{constitution}}'", async () => {
		const template = await loadDefault("review");
		expect(template).toContain("{{constitution}}");
	});

	test("loadDefault('commit') returns string containing '{{diff}}'", async () => {
		const template = await loadDefault("commit");
		expect(template).toContain("{{diff}}");
	});

	test("loadDefault('tests') returns string containing '{{plan}}'", async () => {
		const template = await loadDefault("tests");
		expect(template).toContain("{{plan}}");
	});

	test("every default prompt contains [NEEDS CLARIFICATION]", async () => {
		for (const task of ALL_TASKS) {
			const template = await loadDefault(task);
			expect(template).toContain("[NEEDS CLARIFICATION");
		}
	});

	test("loadDefault for all 7 task types returns non-empty strings", async () => {
		for (const task of ALL_TASKS) {
			const template = await loadDefault(task);
			expect(typeof template).toBe("string");
			expect(template.length).toBeGreaterThan(0);
		}
	});

	test("loadDefault for unknown task returns fallback template", async () => {
		// Cast to PromptTask to simulate unknown task
		const template = await loadDefault("unknown" as PromptTask);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
		expect(template).toContain("{{task}}");
	});
});
