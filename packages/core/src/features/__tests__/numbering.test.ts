import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	FEATURE_TEMPLATES,
	renderTemplate,
} from "../../prompts/templates/index";
import type { DesignChoices } from "../numbering";
import {
	createFeatureDir,
	getNextFeatureNumber,
	scaffoldFeature,
	scaffoldFeatureWithContext,
} from "../numbering";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-features-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("getNextFeatureNumber", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("empty dir returns '001'", async () => {
		const featuresDir = join(tmpDir, ".maina", "features");
		mkdirSync(featuresDir, { recursive: true });
		const result = await getNextFeatureNumber(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("001");
		}
	});

	test("existing 001, 002 returns '003'", async () => {
		const featuresDir = join(tmpDir, ".maina", "features");
		mkdirSync(join(featuresDir, "001-first-feature"), { recursive: true });
		mkdirSync(join(featuresDir, "002-second-feature"), { recursive: true });
		const result = await getNextFeatureNumber(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("003");
		}
	});

	test("non-sequential (001, 003) returns '004'", async () => {
		const featuresDir = join(tmpDir, ".maina", "features");
		mkdirSync(join(featuresDir, "001-first"), { recursive: true });
		mkdirSync(join(featuresDir, "003-third"), { recursive: true });
		const result = await getNextFeatureNumber(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("004");
		}
	});

	test("no .maina/features dir yet creates it and returns '001'", async () => {
		// tmpDir exists but has no .maina/features
		const result = await getNextFeatureNumber(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("001");
		}
		expect(existsSync(join(tmpDir, ".maina", "features"))).toBe(true);
	});

	test("ignores non-directory entries", async () => {
		const featuresDir = join(tmpDir, ".maina", "features");
		mkdirSync(featuresDir, { recursive: true });
		mkdirSync(join(featuresDir, "001-first"), { recursive: true });
		// Create a file that looks like a feature but isn't a directory
		Bun.write(join(featuresDir, "002-not-a-dir.md"), "just a file");
		const result = await getNextFeatureNumber(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("002");
		}
	});

	test("ignores directories without numeric prefix", async () => {
		const featuresDir = join(tmpDir, ".maina", "features");
		mkdirSync(featuresDir, { recursive: true });
		mkdirSync(join(featuresDir, "001-first"), { recursive: true });
		mkdirSync(join(featuresDir, "not-numbered"), { recursive: true });
		const result = await getNextFeatureNumber(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("002");
		}
	});
});

describe("createFeatureDir", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		mkdirSync(join(tmpDir, ".maina", "features"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("creates correct directory structure", async () => {
		const result = await createFeatureDir(tmpDir, "001", "my-feature");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(existsSync(result.value)).toBe(true);
		}
	});

	test("returns full path", async () => {
		const result = await createFeatureDir(tmpDir, "001", "my-feature");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const expected = join(tmpDir, ".maina", "features", "001-my-feature");
			expect(result.value).toBe(expected);
		}
	});

	test("handles kebab-case conversion from spaces", async () => {
		const result = await createFeatureDir(tmpDir, "002", "My Cool Feature");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toContain("002-my-cool-feature");
			expect(existsSync(result.value)).toBe(true);
		}
	});

	test("handles kebab-case conversion from camelCase", async () => {
		const result = await createFeatureDir(tmpDir, "003", "myCoolFeature");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toContain("003-my-cool-feature");
			expect(existsSync(result.value)).toBe(true);
		}
	});

	test("handles kebab-case conversion from PascalCase", async () => {
		const result = await createFeatureDir(tmpDir, "004", "MyCoolFeature");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toContain("004-my-cool-feature");
			expect(existsSync(result.value)).toBe(true);
		}
	});

	test("returns error if directory already exists", async () => {
		const dir = join(tmpDir, ".maina", "features", "001-my-feature");
		mkdirSync(dir, { recursive: true });
		const result = await createFeatureDir(tmpDir, "001", "my-feature");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("already exists");
		}
	});
});

describe("scaffoldFeature", () => {
	let tmpDir: string;
	let featureDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		featureDir = join(tmpDir, ".maina", "features", "001-test-feature");
		mkdirSync(featureDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("creates spec.md, plan.md, tasks.md", async () => {
		const result = await scaffoldFeature(featureDir);
		expect(result.ok).toBe(true);
		expect(existsSync(join(featureDir, "spec.md"))).toBe(true);
		expect(existsSync(join(featureDir, "plan.md"))).toBe(true);
		expect(existsSync(join(featureDir, "tasks.md"))).toBe(true);
	});

	test("writes the shipped templates, the single source of truth", async () => {
		await scaffoldFeature(featureDir);
		for (const kind of ["spec", "plan", "tasks"] as const) {
			const written = readFileSync(join(featureDir, `${kind}.md`), "utf-8");
			expect(written).toBe(
				renderTemplate(FEATURE_TEMPLATES[kind], {
					name: "test-feature",
					branch: "001-test-feature",
				}),
			);
		}
	});

	test("fills the feature name and branch placeholders", async () => {
		await scaffoldFeature(featureDir);
		const spec = readFileSync(join(featureDir, "spec.md"), "utf-8");
		expect(spec).toContain("# Verification Specification: test-feature");
		expect(spec).toContain("**Branch**: `001-test-feature`");
		expect(spec).not.toContain("[FEATURE NAME]");
		expect(spec).not.toContain("[###-feature-name]");
	});

	test("spec.md holds WHAT only, plan.md the constitution gate, tasks.md phases", async () => {
		await scaffoldFeature(featureDir);
		const spec = readFileSync(join(featureDir, "spec.md"), "utf-8");
		const plan = readFileSync(join(featureDir, "plan.md"), "utf-8");
		const tasks = readFileSync(join(featureDir, "tasks.md"), "utf-8");
		expect(spec).toContain("## Requirements *(mandatory)*");
		expect(spec).not.toContain("## Module map");
		expect(plan).toContain("## Constitution gate");
		expect(plan).not.toContain("## User journeys");
		expect(tasks).toContain("## Phases");
		expect(spec).toContain("[NEEDS CLARIFICATION:");
		expect(plan).toContain("[NEEDS CLARIFICATION:");
	});

	test("numbering.ts carries no inline template constants", () => {
		const source = readFileSync(
			join(import.meta.dir, "..", "numbering.ts"),
			"utf-8",
		);
		expect(source).not.toMatch(/const\s+(SPEC|PLAN|TASKS)_TEMPLATE\s*=/);
		expect(source).toContain("prompts/templates");
	});

	test("returns error if featureDir does not exist", async () => {
		const badDir = join(tmpDir, "nonexistent");
		const result = await scaffoldFeature(badDir);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("does not exist");
		}
	});
});

describe("scaffoldFeatureWithContext", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("creates enriched spec.md with description and tradeoffs", async () => {
		mkdirSync(tmpDir, { recursive: true });
		const choices: DesignChoices = {
			description: "User authentication system with OAuth support",
			pattern: "service-layer",
			libraries: ["passport.js", "jsonwebtoken"],
			tradeoffs: ["Chose simplicity over enterprise features for MVP"],
			clarifications: [
				{ question: "Support OAuth?", answer: "Yes, Google and GitHub" },
			],
		};

		const result = await scaffoldFeatureWithContext(
			tmpDir,
			"user-auth",
			choices,
		);
		expect(result.ok).toBe(true);

		const spec = readFileSync(join(tmpDir, "spec.md"), "utf-8");
		expect(spec).toContain("User authentication system with OAuth support");
		expect(spec).toContain("Chose simplicity over enterprise features for MVP");
		expect(spec).toContain("Support OAuth?");
		expect(spec).toContain("Yes, Google and GitHub");
		// Spec should NOT contain implementation details (HOW)
		expect(spec).not.toContain("service-layer");
		expect(spec).not.toContain("passport.js");
	});

	test("creates enriched plan.md with pattern and libraries", async () => {
		mkdirSync(tmpDir, { recursive: true });
		const choices: DesignChoices = {
			pattern: "repository",
			libraries: ["drizzle", "zod"],
		};

		const result = await scaffoldFeatureWithContext(
			tmpDir,
			"data-layer",
			choices,
		);
		expect(result.ok).toBe(true);

		const plan = readFileSync(join(tmpDir, "plan.md"), "utf-8");
		expect(plan).toContain("repository");
		expect(plan).toContain("drizzle");
		expect(plan).toContain("zod");
		// Plan should NOT contain WHAT/WHY
		expect(plan).not.toContain("## User journeys");
	});

	test("falls back to generic markers when choices are empty", async () => {
		mkdirSync(tmpDir, { recursive: true });
		const choices: DesignChoices = {};

		const result = await scaffoldFeatureWithContext(tmpDir, "simple", choices);
		expect(result.ok).toBe(true);

		const plan = readFileSync(join(tmpDir, "plan.md"), "utf-8");
		expect(plan).toContain("[NEEDS CLARIFICATION:");
	});

	test("creates tasks.md with standard template", async () => {
		mkdirSync(tmpDir, { recursive: true });
		const choices: DesignChoices = { description: "Test feature" };

		await scaffoldFeatureWithContext(tmpDir, "test", choices);

		const tasks = readFileSync(join(tmpDir, "tasks.md"), "utf-8");
		expect(tasks).toBe(
			renderTemplate(FEATURE_TEMPLATES.tasks, {
				name: "test",
				branch: basename(tmpDir),
			}),
		);
	});

	test("enriched spec and plan keep the template's sections", async () => {
		mkdirSync(tmpDir, { recursive: true });
		await scaffoldFeatureWithContext(tmpDir, "user-auth", {
			description: "Login",
			pattern: "repository",
		});
		const spec = readFileSync(join(tmpDir, "spec.md"), "utf-8");
		const plan = readFileSync(join(tmpDir, "plan.md"), "utf-8");
		expect(spec).toContain("# Verification Specification: user-auth");
		expect(spec).toContain("## Requirements *(mandatory)*");
		expect(plan).toContain("## Constitution gate");
		expect(plan).toContain("## Module map");
	});
});
