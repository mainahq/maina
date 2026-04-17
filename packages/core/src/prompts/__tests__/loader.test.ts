import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	loadConstitution,
	loadConstitutionShards,
	loadScopedConstitution,
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

// ── loadConstitutionShards ──────────────────────────────────────────────

describe("loadConstitutionShards", () => {
	test("reads shards from constitution.d/ sorted alphabetically", async () => {
		const shardsDir = join(tmpDir, "constitution.d");
		mkdirSync(shardsDir, { recursive: true });
		writeFileSync(
			join(shardsDir, "frontend.md"),
			'---\napplies_to: ["apps/web/**"]\n---\nUse React.',
		);
		writeFileSync(
			join(shardsDir, "api.md"),
			'---\napplies_to: ["apps/api/**"]\n---\nUse Hono.',
		);

		const shards = await loadConstitutionShards(tmpDir);
		expect(shards.length).toBe(2);
		// Sorted: api.md before frontend.md
		expect(shards[0]?.filename).toBe("api.md");
		expect(shards[0]?.content).toBe("Use Hono.");
		expect(shards[0]?.appliesTo).toEqual(["apps/api/**"]);
		expect(shards[1]?.filename).toBe("frontend.md");
		expect(shards[1]?.content).toBe("Use React.");
	});

	test("returns empty when constitution.d/ does not exist", async () => {
		const shards = await loadConstitutionShards(tmpDir);
		expect(shards).toEqual([]);
	});

	test("handles shards without applies_to (global shards)", async () => {
		const shardsDir = join(tmpDir, "constitution.d");
		mkdirSync(shardsDir, { recursive: true });
		writeFileSync(join(shardsDir, "global.md"), "No frontmatter here.");

		const shards = await loadConstitutionShards(tmpDir);
		expect(shards.length).toBe(1);
		expect(shards[0]?.appliesTo).toEqual([]);
		expect(shards[0]?.content).toBe("No frontmatter here.");
	});
});

// ── loadScopedConstitution ──────────────────────────────────────────────

describe("loadScopedConstitution", () => {
	test("returns only root when no constitution.d/ exists (backward compat)", async () => {
		writeFileSync(join(tmpDir, "constitution.md"), "# Root rules");

		const result = await loadScopedConstitution(tmpDir);
		expect(result).toBe("# Root rules");
	});

	test("merges root + all shards when no filePath given", async () => {
		writeFileSync(join(tmpDir, "constitution.md"), "# Root");
		const shardsDir = join(tmpDir, "constitution.d");
		mkdirSync(shardsDir, { recursive: true });
		writeFileSync(
			join(shardsDir, "extra.md"),
			'---\napplies_to: ["src/**"]\n---\nExtra rule.',
		);

		const result = await loadScopedConstitution(tmpDir);
		expect(result).toContain("# Root");
		expect(result).toContain("Extra rule.");
		expect(result).toContain("constitution.d/extra.md");
	});

	test("filters shards by filePath glob", async () => {
		writeFileSync(join(tmpDir, "constitution.md"), "# Root");
		const shardsDir = join(tmpDir, "constitution.d");
		mkdirSync(shardsDir, { recursive: true });
		writeFileSync(
			join(shardsDir, "frontend.md"),
			'---\napplies_to: ["apps/web/**"]\n---\nReact rules.',
		);
		writeFileSync(
			join(shardsDir, "api.md"),
			'---\napplies_to: ["apps/api/**"]\n---\nHono rules.',
		);

		const webResult = await loadScopedConstitution(
			tmpDir,
			"apps/web/src/App.tsx",
		);
		expect(webResult).toContain("React rules.");
		expect(webResult).not.toContain("Hono rules.");

		const apiResult = await loadScopedConstitution(
			tmpDir,
			"apps/api/src/index.ts",
		);
		expect(apiResult).toContain("Hono rules.");
		expect(apiResult).not.toContain("React rules.");
	});

	test("includes global shards (no applies_to) for any filePath", async () => {
		writeFileSync(join(tmpDir, "constitution.md"), "# Root");
		const shardsDir = join(tmpDir, "constitution.d");
		mkdirSync(shardsDir, { recursive: true });
		writeFileSync(join(shardsDir, "global.md"), "Global rule for all.");
		writeFileSync(
			join(shardsDir, "scoped.md"),
			'---\napplies_to: ["apps/web/**"]\n---\nWeb only.',
		);

		const result = await loadScopedConstitution(
			tmpDir,
			"packages/core/src/index.ts",
		);
		expect(result).toContain("Global rule for all.");
		expect(result).not.toContain("Web only.");
	});
});
