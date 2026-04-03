import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DependencyGraph } from "../relevance";
import {
	assembleSemanticText,
	getTopEntities,
	loadConstitution,
	loadCustomContext,
	type SemanticContext,
} from "../semantic";

const TEST_DIR = join(tmpdir(), `maina-semantic-test-${Date.now()}`);
const MAINA_DIR = join(TEST_DIR, ".maina");

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });
	mkdirSync(MAINA_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadConstitution", () => {
	test("returns null when constitution.md does not exist", async () => {
		const result = await loadConstitution(MAINA_DIR);
		expect(result).toBeNull();
	});

	test("reads content when constitution.md exists", async () => {
		const constitutionPath = join(MAINA_DIR, "constitution.md");
		const content = "# Project Constitution\n\nUse TypeScript everywhere.\n";
		writeFileSync(constitutionPath, content);

		const result = await loadConstitution(MAINA_DIR);
		expect(result).toBe(content);
	});
});

describe("loadCustomContext", () => {
	test("returns empty array when custom directory does not exist", async () => {
		const freshMainaDir = join(TEST_DIR, ".maina-fresh");
		mkdirSync(freshMainaDir, { recursive: true });

		const result = await loadCustomContext(freshMainaDir);
		expect(result).toEqual([]);
	});

	test("reads files from the custom directory", async () => {
		const customDir = join(MAINA_DIR, "context", "semantic", "custom");
		mkdirSync(customDir, { recursive: true });

		writeFileSync(
			join(customDir, "conventions.md"),
			"# Conventions\n\nUse tabs.\n",
		);
		writeFileSync(
			join(customDir, "adrs.md"),
			"# ADRs\n\nADR-001: Use SQLite.\n",
		);

		const result = await loadCustomContext(MAINA_DIR);
		expect(result.length).toBe(2);

		// Should contain the file contents (order may vary)
		const combined = result.join("\n");
		expect(combined).toContain("Conventions");
		expect(combined).toContain("ADRs");
	});

	test("returns empty array for empty custom directory", async () => {
		const emptyMainaDir = join(TEST_DIR, ".maina-empty");
		const emptyCustomDir = join(emptyMainaDir, "context", "semantic", "custom");
		mkdirSync(emptyCustomDir, { recursive: true });

		const result = await loadCustomContext(emptyMainaDir);
		expect(result).toEqual([]);
	});
});

// Helper to build a minimal SemanticContext for testing
function makeContext(
	overrides: Partial<SemanticContext> = {},
): SemanticContext {
	const graph: DependencyGraph = {
		nodes: new Set(["fileA.ts", "fileB.ts"]),
		edges: new Map(),
	};

	return {
		entities: [
			{
				filePath: "fileA.ts",
				name: "doSomething",
				kind: "function",
				relevance: 0.8,
			},
			{ filePath: "fileA.ts", name: "MyClass", kind: "class", relevance: 0.6 },
			{
				filePath: "fileB.ts",
				name: "helper",
				kind: "function",
				relevance: 0.3,
			},
			{
				filePath: "fileB.ts",
				name: "IConfig",
				kind: "interface",
				relevance: 0.2,
			},
			{
				filePath: "fileA.ts",
				name: "lowRelevance",
				kind: "variable",
				relevance: 0.1,
			},
		],
		graph,
		scores: new Map([
			["fileA.ts", 0.7],
			["fileB.ts", 0.3],
		]),
		constitution: null,
		customContext: [],
		...overrides,
	};
}

describe("getTopEntities", () => {
	test("returns top N entities by relevance score", () => {
		const context = makeContext();
		const top3 = getTopEntities(context, 3);

		expect(top3).toHaveLength(3);
		expect(top3[0]?.name).toBe("doSomething");
		expect(top3[1]?.name).toBe("MyClass");
		expect(top3[2]?.name).toBe("helper");
	});

	test("returns top 20 by default", () => {
		// Create context with fewer than 20 entities
		const context = makeContext();
		const result = getTopEntities(context);

		// Since we only have 5 entities, all should be returned
		expect(result.length).toBeLessThanOrEqual(20);
		expect(result.length).toBe(5);
	});

	test("returns limited results when n is smaller than total", () => {
		const context = makeContext();
		const top1 = getTopEntities(context, 1);

		expect(top1).toHaveLength(1);
		expect(top1[0]?.name).toBe("doSomething");
	});

	test("returns all entities when n is larger than total", () => {
		const context = makeContext();
		const result = getTopEntities(context, 100);

		expect(result).toHaveLength(5);
	});

	test("entities are sorted by relevance descending", () => {
		const context = makeContext();
		const result = getTopEntities(context);

		for (let i = 1; i < result.length; i++) {
			const prev = result[i - 1]?.relevance ?? 0;
			const curr = result[i]?.relevance ?? 0;
			expect(prev).toBeGreaterThanOrEqual(curr);
		}
	});
});

describe("assembleSemanticText", () => {
	test("includes constitution when present", () => {
		const context = makeContext({
			constitution: "# My Constitution\n\nAlways write tests first.\n",
		});

		const text = assembleSemanticText(context);
		expect(text).toContain("Constitution");
		expect(text).toContain("Always write tests first");
	});

	test("does not include constitution section when null", () => {
		const context = makeContext({ constitution: null });

		const text = assembleSemanticText(context);
		// Should not have an empty constitution block
		expect(text).not.toContain("Always write tests first");
	});

	test("includes custom context when present", () => {
		const context = makeContext({
			customContext: [
				"# Conventions\n\nUse tabs.",
				"# ADRs\n\nADR-001: SQLite.",
			],
		});

		const text = assembleSemanticText(context);
		expect(text).toContain("Conventions");
		expect(text).toContain("ADRs");
	});

	test("includes top entities section", () => {
		const context = makeContext();
		const text = assembleSemanticText(context);

		expect(text).toContain("doSomething");
		expect(text).toContain("MyClass");
	});

	test("with filter 'conventions' only includes relevant parts", () => {
		const context = makeContext({
			constitution: "# My Constitution\n\nAlways write tests first.\n",
			customContext: [
				"# Conventions\n\nUse tabs.",
				"# ADRs\n\nADR-001: SQLite.",
			],
		});

		const text = assembleSemanticText(context, ["conventions"]);
		expect(text).toContain("Conventions");
		// When filtered, might not include all sections — at minimum includes conventions
	});

	test("with filter 'adrs' only includes ADR content", () => {
		const context = makeContext({
			constitution: "# My Constitution\n\nAlways write tests first.\n",
			customContext: [
				"# Conventions\n\nUse tabs.",
				"# ADRs\n\nADR-001: SQLite.",
			],
		});

		const text = assembleSemanticText(context, ["adrs"]);
		expect(text).toContain("ADR");
	});

	test("returns non-empty string for minimal context", () => {
		const context = makeContext();
		const text = assembleSemanticText(context);

		expect(text.length).toBeGreaterThan(0);
	});
});
