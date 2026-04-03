import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContextDb } from "../../db/index.ts";
import { generateDependencyDiagram, generateModuleSummary } from "../index.ts";

const TEST_DIR = join(tmpdir(), `maina-explain-test-${Date.now()}`);

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeDir(sub: string): string {
	const d = join(TEST_DIR, sub);
	mkdirSync(d, { recursive: true });
	return d;
}

// ── generateDependencyDiagram ───────────────────────────────────────────────

describe("generateDependencyDiagram", () => {
	test("no edges returns empty graph", () => {
		const mainaDir = makeDir("diagram-empty");
		const result = generateDependencyDiagram(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toBe("graph LR\n");
	});

	test("with edges returns valid Mermaid syntax", () => {
		const mainaDir = makeDir("diagram-edges");

		const dbResult = getContextDb(mainaDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		db.exec(`
			INSERT INTO dependency_edges (id, source_file, target_file, weight, type)
			VALUES
				('e1', 'src/context/engine.ts', 'src/context/budget.ts', 1.0, 'import'),
				('e2', 'src/context/engine.ts', 'src/context/selector.ts', 1.0, 'import'),
				('e3', 'src/verify/pipeline.ts', 'src/verify/syntax-guard.ts', 1.0, 'import')
		`);

		const result = generateDependencyDiagram(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).toContain("graph LR");
		expect(result.value).toContain("context/engine --> context/budget");
		expect(result.value).toContain("context/engine --> context/selector");
		expect(result.value).toContain("verify/pipeline --> verify/syntax-guard");
		db.close();
	});

	test("with scope filter only returns matching edges", () => {
		const mainaDir = makeDir("diagram-scope");

		const dbResult = getContextDb(mainaDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		db.exec(`
			INSERT INTO dependency_edges (id, source_file, target_file, weight, type)
			VALUES
				('e1', 'src/context/engine.ts', 'src/context/budget.ts', 1.0, 'import'),
				('e2', 'src/verify/pipeline.ts', 'src/verify/syntax-guard.ts', 1.0, 'import'),
				('e3', 'src/context/engine.ts', 'src/verify/detect.ts', 0.5, 'reference')
		`);

		const result = generateDependencyDiagram(mainaDir, {
			scope: "context",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).toContain("context/engine --> context/budget");
		// Edge e3 involves context, so it should be included
		expect(result.value).toContain("context/engine --> verify/detect");
		// Edge e2 is verify-only, should not be included
		expect(result.value).not.toContain(
			"verify/pipeline --> verify/syntax-guard",
		);
		db.close();
	});

	test("DB error returns error Result", () => {
		// Use a path that can't be a DB (e.g. inside a non-existent deeply nested path with null bytes)
		const result = generateDependencyDiagram("/dev/null/nonexistent");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(typeof result.error).toBe("string");
	});
});

// ── generateModuleSummary ───────────────────────────────────────────────────

describe("generateModuleSummary", () => {
	test("no entities returns empty array", () => {
		const mainaDir = makeDir("summary-empty");
		const result = generateModuleSummary(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual([]);
	});

	test("with entities returns correct counts per module", () => {
		const mainaDir = makeDir("summary-entities");

		const dbResult = getContextDb(mainaDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		db.exec(`
			INSERT INTO semantic_entities (id, file_path, name, kind, start_line, end_line, updated_at)
			VALUES
				('s1', 'src/context/engine.ts', 'assembleContext', 'function', 1, 50, '2026-01-01'),
				('s2', 'src/context/engine.ts', 'ContextOptions', 'interface', 51, 60, '2026-01-01'),
				('s3', 'src/context/budget.ts', 'calculateTokens', 'function', 1, 30, '2026-01-01'),
				('s4', 'src/verify/pipeline.ts', 'runPipeline', 'function', 1, 100, '2026-01-01'),
				('s5', 'src/verify/pipeline.ts', 'PipelineResult', 'type', 101, 110, '2026-01-01'),
				('s6', 'src/verify/pipeline.ts', 'PipelineRunner', 'class', 111, 200, '2026-01-01')
		`);

		const result = generateModuleSummary(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const summaries = result.value;

		// Should have entries for context/engine, context/budget, verify/pipeline
		expect(summaries.length).toBe(3);

		const contextEngine = summaries.find((s) => s.module === "context/engine");
		expect(contextEngine).toBeDefined();
		expect(contextEngine?.entityCount).toBe(2);
		expect(contextEngine?.functions).toBe(1);
		expect(contextEngine?.interfaces).toBe(1);
		expect(contextEngine?.classes).toBe(0);
		expect(contextEngine?.types).toBe(0);

		const verifyPipeline = summaries.find(
			(s) => s.module === "verify/pipeline",
		);
		expect(verifyPipeline).toBeDefined();
		expect(verifyPipeline?.entityCount).toBe(3);
		expect(verifyPipeline?.functions).toBe(1);
		expect(verifyPipeline?.classes).toBe(1);
		expect(verifyPipeline?.types).toBe(1);

		const contextBudget = summaries.find((s) => s.module === "context/budget");
		expect(contextBudget).toBeDefined();
		expect(contextBudget?.entityCount).toBe(1);
		expect(contextBudget?.functions).toBe(1);

		db.close();
	});

	test("DB error returns error Result", () => {
		const result = generateModuleSummary("/dev/null/nonexistent");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(typeof result.error).toBe("string");
	});
});
