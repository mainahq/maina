import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	loadConstitution,
	loadUserOverride,
	mergePrompts,
	renderTemplate,
} from "../loader";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-loader-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	// cleanup is best-effort
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("loadConstitution", () => {
	test("returns content when file exists", async () => {
		const constitutionContent = "# My Constitution\nBe helpful.";
		writeFileSync(join(tmpDir, "constitution.md"), constitutionContent);

		const result = await loadConstitution(tmpDir);
		expect(result).toBe(constitutionContent);
	});

	test("returns empty string when file does not exist", async () => {
		const result = await loadConstitution(tmpDir);
		expect(result).toBe("");
	});
});

describe("loadUserOverride", () => {
	test("returns content when file exists", async () => {
		const promptsDir = join(tmpDir, "prompts");
		mkdirSync(promptsDir, { recursive: true });
		const overrideContent = "# Custom Review Prompt\nReview carefully.";
		writeFileSync(join(promptsDir, "review.md"), overrideContent);

		const result = await loadUserOverride(tmpDir, "review");
		expect(result).toBe(overrideContent);
	});

	test("returns null when file does not exist", async () => {
		const result = await loadUserOverride(tmpDir, "review");
		expect(result).toBeNull();
	});
});

describe("mergePrompts", () => {
	test("returns default when no override", () => {
		const defaultPrompt = "Default prompt content";
		const result = mergePrompts(defaultPrompt, null);
		expect(result).toBe(defaultPrompt);
	});

	test("returns override when provided (user has full control)", () => {
		const defaultPrompt = "Default prompt content";
		const userOverride = "User override content";
		const result = mergePrompts(defaultPrompt, userOverride);
		expect(result).toBe(userOverride);
	});
});

describe("renderTemplate", () => {
	test("replaces {{variables}} with values", () => {
		const template = "Hello {{name}}, your task is {{task}}.";
		const variables = { name: "Alice", task: "review" };
		const result = renderTemplate(template, variables);
		expect(result).toBe("Hello Alice, your task is review.");
	});

	test("leaves unreplaced variables as-is", () => {
		const template = "Hello {{name}}, your {{missing}} is here.";
		const variables = { name: "Alice" };
		const result = renderTemplate(template, variables);
		expect(result).toBe("Hello Alice, your {{missing}} is here.");
	});

	test("replaces multiple occurrences of same variable", () => {
		const template = "{{task}} is the task. Do {{task}} well.";
		const variables = { task: "review" };
		const result = renderTemplate(template, variables);
		expect(result).toBe("review is the task. Do review well.");
	});

	test("handles empty variables object", () => {
		const template = "Hello {{name}}.";
		const result = renderTemplate(template, {});
		expect(result).toBe("Hello {{name}}.");
	});
});
